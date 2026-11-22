// main.js — Crescent Bay boot + the one loop. Fixed 1/60s steps, autopilot
// runs BEFORE the dialog branch (otherwise the autopilot can never press
// E to accept a mission), and manual driving is skipped on frames the
// autopilot drove (otherwise it brakes the car back to ~0 every frame).
// One PoliceHelicopter, one WeaponInventory, mission runner m1–m8
// (+ m9–m12 registered by the Act 2 module). No Rockstar/GTA terms:
// game over says CAUGHT / DOWN, the repaint garage is the Spray Shop.
//
// ?seed=N fixes the world. ?shot=cover|mission|night|start (&seed=7)
// stages that scene and sets window.__shotReady. ?autopilot=1 starts
// the autopilot on New Game.

import { STEP, SEED_DEFAULT, WORLD_SIZE, SPRAY_SHOP } from './config.js';
import { createRandom } from './random.js';
import { createWorld, LANDMARKS, findRoute, nearestRoadPoint, isOnRoad } from './world.js';
import { createInput, ACTION_CONFIRM, ACTION_PAUSE, ACTION_ENTER_CAR, ACTION_RADIO, ACTION_CYCLE_WEAPON } from './input.js';
import { createRenderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSED, SCREEN_OVER } from './render.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { MISSION_DEFS, createMissionRunner, missionById } from './missions.js';
import { makeCar, followRoute, moveCar, angleDiff, applyUpgrades } from './vehicles.js';
import { createTraffic } from './traffic.js';
import { createPedestrians } from './pedestrians.js';
import { createPolice, starsForHeat } from './police.js';
import { createCombat, arenaSupplies } from './combat.js';
import { makePlayer } from './player.js';
import { createAutopilot } from './autopilot.js';
import { PoliceHelicopter } from './helicopter.js';
import { Garage, PAINT_COLORS } from './garage.js';
import { WeaponInventory, makeWorldCrates, checkPickups } from './weapons.js';
import { ACT2_LOCATIONS, ARRIVAL_RADIUS } from './act2-locations.js';
import { saveGame, loadGame, applySave, autosave } from './save.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;
const params = new URLSearchParams(window.location.search);
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : SEED_DEFAULT;
const shotName = params.get('shot');
const autoParam = params.get('autopilot') === '1';

export function createGame() {
  const rng = createRandom(seed);
  const world = createWorld(rng);
  const player = makePlayer(world, LANDMARKS.hideout.x, LANDMARKS.hideout.y);
  const traffic = createTraffic(rng, world);
  const pedestrians = createPedestrians(rng, world);
  const police = createPolice(world);
  const combat = createCombat(world);
  const helicopter = new PoliceHelicopter();
  const garage = new Garage({ location: ACT2_LOCATIONS.garage });
  const weapons = new WeaponInventory();
  const runner = createMissionRunner();
  const audio = createAudio();
  const crates = makeWorldCrates(ACT2_LOCATIONS);
  const ammoBoxes = [];
  const healthPacks = [];
  let courier = null;
  let ramHits = 0;
  let ramCooldown = 0;
  let timeOfDay = 0.25; // 0 dawn, 0.5 noon, 0.75 dusk, 0.9 night
  let missionIndex = 0;
  let screen = SCREEN_TITLE;
  let dialogOpen = false;
  let dialogMission = null;
  let pendingOffer = -1;
  let pendingOfferTimer = 0;
  let toasts = [];
  let toastTimer = 0;
  let heliForced = false;
  let garageOpen = false;

  const game = {
    world, player, traffic, pedestrians, police, combat, helicopter, weapons,
    runner, audio, crates, ammoBoxes, healthPacks,
    get courier() { return courier; },
    get ramHits() { return ramHits; },
    get stars() { return police.state.stars; },
    get missionIndex() { return missionIndex; },
    set missionIndex(v) { missionIndex = v; },
    get timeOfDay() { return timeOfDay; },
    set timeOfDay(v) { timeOfDay = v; },
    get screen() { return screen; },
    get dialogOpen() { return dialogOpen; },
    get garageOpen() { return garageOpen; },
    garage, // live Garage instance (spec 3.3) — E routes through it first
    radio: null,  // attached by the radio module (Builder B-2)
    get radioStation() { return game.radio ? game.radio.stationName : null; },
    get nightFactor() {
      if (runner.activeDef?.night) return 1;
      if (timeOfDay < 0.55) return 0;
      if (timeOfDay < 0.7) return (timeOfDay - 0.55) / 0.15 * 0.5;
      return 0.5 + (timeOfDay - 0.7) / 0.3 * 0.5;
    },
    get timeLabel() {
      const h = Math.floor(timeOfDay * 24);
      const d = worldDistrictName();
      return `${String(h).padStart(2, '0')}:00 · ${d}`;
    },
    get objective() { return runner.activeDef ? runner.currentObjective(missionCtx()) : freeRoamObjective(); },
    get missionTimeLeft() { return runner.activeDef ? runner.timeLeft : null; },
    get toasts() { return toasts; },
    get allCars() {
      const list = [...traffic.allCars(), ...police.state.patrolCars];
      for (const rb of police.state.roadblocks) list.push(...rb.cars);
      if (courier) list.push(courier);
      return list;
    },
    get peds() { return pedestrians.peds; },
    get footCops() { return police.state.footCops; },
    get enemies() { return combat.enemies; },
    get bullets() { return combat.bullets; },
  };

  function worldDistrictName() {
    const x = player.inCar ? player.inCar.x : player.x;
    const y = player.inCar ? player.inCar.y : player.y;
    if (x > 3060) return 'Waterfront';
    if (y < 800) return 'Northside';
    if (y < 1800) return x < 1600 ? 'Old Town' : 'Downtown';
    if (y < 2600) return 'Waterfront';
    return 'South Docks';
  }
  function freeRoamObjective() {
    return missionIndex < MISSION_DEFS.length
      ? { x: LANDMARKS.hideout.x, y: LANDMARKS.hideout.y, label: `Next job: ${MISSION_DEFS[missionIndex].name} — talk to ${MISSION_DEFS[missionIndex].fixer}`, kind: 'free' }
      : { x: player.x, y: player.y, label: 'Free roam — Crescent Bay is yours', kind: 'free' };
  }
  function toast(msg) {
    toasts.push(msg);
    if (toasts.length > 3) toasts.shift();
    toastTimer = 4;
  }
  function nearestEnemy() {
    let best = null, bestD = Infinity;
    for (const e of combat.enemies) {
      const d = Math.hypot(e.x - player.x, e.y - player.y);
      if (d < bestD) { best = e; bestD = d; }
    }
    return best;
  }
  function nearestArenaAmmo() {
    let best = null, bestD = Infinity;
    for (const b of ammoBoxes) {
      if (b.taken) continue;
      const d = Math.hypot(b.x - player.x, b.y - player.y);
      if (d < bestD) { best = b; bestD = d; }
    }
    return best;
  }
  function nearestArenaCrate() {
    let best = null, bestD = Infinity;
    for (const c of crates) {
      if (c.taken) continue;
      const d = Math.hypot(c.x - player.x, c.y - player.y);
      if (d < 400 && d < bestD) { best = c; bestD = d; }
    }
    return best;
  }
  game.nearestEnemy = nearestEnemy;
  game.nearestArenaAmmo = nearestArenaAmmo;
  game.nearestArenaCrate = nearestArenaCrate;

  function spawnCourier() {
    const jx = [600, 1000, 1400, 1800, 2200, 2600][Math.floor(rng() * 6)];
    const jy = [600, 1000, 1400, 1800, 2200, 2600][Math.floor(rng() * 6)];
    courier = makeCar('sports', jx, jy, 0);
    courier.cruise = 380;
    courier.isCourier = true;
    courier.dest = { x: 600 + rng() * 2000, y: 600 + rng() * 2000 };
    courier.route = null; courier.routeDest = null;
    ramHits = 0;
    toast('Courier spotted — ram him 4 times!');
  }
  function spawnArena(center, count) {
    combat.spawnArena(center, count);
    const sup = arenaSupplies(center);
    crates.push(...sup.crates);
    ammoBoxes.push(...sup.ammo);
    for (let i = 0; i < 3; i++) {
      healthPacks.push({ x: center.x + (i - 1) * 120, y: center.y - 130, taken: false });
    }
  }
  function missionCtx() {
    return {
      player, playerCar: player.inCar, courier, ramHits,
      enemiesAlive: combat.enemies.length, heat: police.state.heat,
      nearestEnemy, spawnArena, spawnCourier,
      setHeat: (v) => police.setHeat(v),
      onEvent: (ev) => {
        if (ev.type === 'start') {
          const def = ev.mission;
          heliForced = !!def.helicopter;
          if (def.helicopter && helicopter) helicopter.forceSpawn(player.inCar || player);
          toast(`${def.name} — ${def.fixer}`);
          audio.sfx.mission();
        } else if (ev.type === 'complete') {
          player.cash += ev.mission.reward;
          audio.sfx.cash();
          toast(`${ev.mission.name} complete! +$${ev.mission.reward}`);
          autosave(game);
          missionIndex = Math.min(missionIndex + 1, MISSION_DEFS.length);
          pendingOffer = missionIndex;
          pendingOfferTimer = 1.2;
          heliForced = false;
        } else if (ev.type === 'fail') {
          audio.sfx.fail();
          toast(`${ev.mission.name} failed — starting over from stage 1.`);
          pendingOffer = MISSION_DEFS.indexOf(ev.mission);
          pendingOfferTimer = 1.2;
          heliForced = false;
          combat.clearArena();
        } else if (ev.type === 'checkpoint') {
          audio.sfx.pickup();
          toast(`Checkpoint ${ev.index}/${ev.total}`);
        }
      },
    };
  }
  game.missionCtx = missionCtx;

  function offerMission(index) {
    if (index < 0 || index >= MISSION_DEFS.length) return;
    dialogMission = MISSION_DEFS[index];
    dialogOpen = true;
    showDialog(dialogMission);
  }
  function acceptDialog() {
    if (!dialogOpen || !dialogMission) return;
    const def = dialogMission;
    dialogOpen = false;
    hideDialog();
    runner.start(def, missionCtx());
  }
  function declineDialog() {
    dialogOpen = false;
    hideDialog();
  }

  function teleport(x, y) {
    if (player.inCar) { player.inCar.x = x; player.inCar.y = y; }
    player.x = x; player.y = y;
  }
  function giveCar(type) {
    const car = makeCar(type, player.x + 60, player.y, 0);
    traffic.parked.push(car);
    player.tryEnterCar([car], null, null);
    return car;
  }
  function setTimeOfDay(v) { timeOfDay = v; }
  game.teleport = teleport;
  game.giveCar = giveCar;
  game.setTimeOfDay = setTimeOfDay;
  game.offerMission = offerMission;
  game.startMissionById = (id, opts = {}) => {
    const def = missionById(id);
    if (!def) return false;
    if (opts.silent) { runner.start(def, missionCtx()); return true; }
    offerMission(MISSION_DEFS.indexOf(def));
    return true;
  };

  // ---- dialog DOM (defined by the boot code below) ----
  let showDialog = () => {};
  let hideDialog = () => {};
  game._bindDialog = (show, hide) => { showDialog = show; hideDialog = hide; };
  game.acceptDialog = acceptDialog;
  game.declineDialog = declineDialog;

  function stepFixed(dt) {
    // Ambient world always simmers (title backdrop + play).
    const px = player.inCar ? player.inCar.x : player.x;
    const py = player.inCar ? player.inCar.y : player.y;
    if (screen === SCREEN_TITLE) {
      traffic.update(dt, null, []);
      pedestrians.update(dt, player, null);
      return;
    }
    if (screen !== SCREEN_PLAY) return;

    // --- Autopilot FIRST (before the dialog branch) ---
    let apOut = null;
    let autopilotDrove = false;
    if (autopilot.enabled) {
      apOut = autopilot.step(dt, runner.activeDef ? runner.currentObjective(missionCtx()) : null);
      if (apOut.confirm && dialogOpen) acceptDialog();
    }

    // --- Dialog: world waits while a mission offer is open ---
    if (dialogOpen) {
      if (apOut?.confirm) acceptDialog();
      return;
    }

    // --- Garage: zone prompt every frame; world pauses while open ---
    garage.update({ x: px, y: py });
    if (garage.isOpen) return;
    if (player.inCar) {
      const stats = garage.statsFor(player.inCar);
      player.inCar.topSpeed = player.inCar.def.topSpeed + stats.topSpeedBonus;
      player.inCar.upgrades = stats.levels;
      const paint = PAINT_COLORS.find((c) => c.id === stats.paint);
      player.inCar.paint = paint ? paint.hex : null;
    }
    // Autopilot garage step (m11): open, buy cheapest, close, sync cash.
    if (apOut?.garageAction && player.inCar && garage.isInZone({ x: px, y: py })) {
      garage.open(player.inCar, player.cash);
      const res = garage.buyCheapest(player.inCar, player.cash);
      const closed = garage.close();
      player.cash = res.ok ? res.cashLeft : closed.cash;
      if (res.ok) { toast(`Bought ${res.category} level ${res.level} ($${res.cost})`); audio.sfx.cash(); }
      else toast('Garage: nothing affordable to buy.');
    }

    // Time of day: 240s full cycle; night missions pin the clock.
    if (!runner.activeDef?.night) timeOfDay = (timeOfDay + dt / 240) % 1;

    // --- Player ---
    const input = game._input;
    const mouse = input ? input.mouse() : { x: 0, y: 0, down: false };
    const cam = game._camera || { x: 0, y: 0 };
    const aimAngle = player.inCar
      ? player.inCar.angle
      : Math.atan2((mouse.y + cam.y) - player.y, (mouse.x + cam.x) - player.x);

    if (player.inCar) {
      const car = player.inCar;
      // Rook's position IS the car's position while driving.
      player.x = car.x; player.y = car.y;
      if (apOut?.drive) {
        autopilotDrove = true;
        const d = apOut.drive;
        if (d.chase && courier) followRoute(car, courier.x, courier.y, dt, world, { cruise: d.cruise, arrive: 20 });
        else followRoute(car, d.x, d.y, dt, world, { cruise: d.cruise, arrive: d.arrive ?? 46 });
      } else if (input) {
        // Manual driving (skipped on autopilot-driven frames).
        const held = input.held;
        const steer = (held.right ? 1 : 0) - (held.left ? 1 : 0);
        if (held.up) car.speed = Math.min(car.topSpeed, car.speed + car.accel * dt);
        else if (held.down) car.speed = Math.max(-130, car.speed - car.def.brake * dt);
        else car.speed = Math.abs(car.speed) < 8 ? 0 : car.speed - Math.sign(car.speed) * 160 * dt;
        if (steer !== 0 && Math.abs(car.speed) > 1) {
          const radius = Math.max(40, car.def.turnRadius);
          const turn = Math.max(0.5, Math.abs(car.speed) / radius) * dt;
          car.angle += steer * turn * Math.sign(car.speed);
        }
        moveCar(car, dt, world);
      }
      // Wall damage ticks.
      if (car.wallDamage) {
        player.damage(car.wallDamage);
        car.wallDamage = 0;
        if (player.dead) return gameOver('DOWN');
      }
      if (car.collisionDamage) {
        player.damage(car.collisionDamage);
        car.collisionDamage = 0;
        if (player.dead) return gameOver('DOWN');
      }
    } else {
      let move = { x: 0, y: 0 };
      let sprint = false;
      if (apOut) { move = apOut.move; }
      else if (input) { move = input.moveVector(); sprint = input.held.shift; }
      player.updateOnFoot(dt, move, aimAngle, sprint);
      // Shooting on foot only.
      const wantFire = apOut?.fire || (mouse.down && !autopilot.enabled);
      if (wantFire) {
        const shot = weapons.fire(player.aimAngle);
        if (shot) {
          for (const pellet of shot.pellets) combat.fireBullet(player.x, player.y, pellet.angle, pellet.damage, pellet.range, true);
          audio.sfx.shoot();
          pedestrians.scare(player.x, player.y, 260);
          police.addHeat(0.6);
        }
      }
      if (apOut?.enterCar) {
        player.tryEnterCar(game.allCars, police, pedestrians);
      }
    }
    if (apOut?.exitCar && player.inCar) player.exitCar();

    // E near the Fixer Garage opens the upgrade menu (B-2 module).
    // (Handled in the action handler; see boot code.)

    // --- Traffic / pedestrians / police / helicopter / combat ---
    traffic.update(dt, player.inCar, [courier, ...police.state.patrolCars].filter(Boolean));
    pedestrians.update(dt, player, player.inCar);
    const caught = police.update(dt, player, player.inCar, helicopter, { shootout: runner.activeDef?.stages[runner.stage]?.type === 'shootout' });
    if (caught === 'caught') { player.caught = true; return gameOver('CAUGHT'); }
    if (police.state.stars >= 3 || heliForced) {
      if (helicopter.state === 'inactive') helicopter.spawnNear(player.inCar || player);
      if (heliForced) helicopter.forceSpawn(player.inCar || player);
    }
    helicopter.update(dt, player.inCar || player, police.state.stars);
    weapons.update(dt);
    combat.update(dt, player, player.inCar, (dmg) => {
      // Armor upgrades on the current car reduce damage while driving;
      // on foot the player takes it straight.
      player.damage(dmg);
    }, helicopter);
    if (player.dead) return gameOver('DOWN');

    // Weapon + ammo pickups.
    const pickupEvents = checkPickups(weapons, crates, ammoBoxes, player);
    for (const ev of pickupEvents) {
      audio.sfx.pickup();
      toast(ev.type === 'weapon' ? `Picked up ${ev.weapon.toUpperCase()}!` : `+${ev.amount} ${ev.weapon} ammo`);
    }
    // Health packs in the arena.
    for (const hp of healthPacks) {
      if (!hp.taken && Math.hypot(hp.x - player.x, hp.y - player.y) < 40) {
        hp.taken = true;
        player.heal(30);
        audio.sfx.pickup();
        toast('Health +30');
      }
    }
    // Money drops are collected by the mission runner (checkpoints).

    // --- Courier (m2) ---
    if (courier) {
      ramCooldown -= dt;
      if (Math.hypot(courier.dest.x - courier.x, courier.dest.y - courier.y) < 60) {
        courier.dest = { x: 600 + rng() * 2000, y: 600 + rng() * 2000 };
        courier.route = null; courier.routeDest = null;
      }
      followRoute(courier, courier.dest.x, courier.dest.y, dt, world, { cruise: courier.cruise, arrive: 50 });
      if (player.inCar && ramCooldown <= 0) {
        const d = Math.hypot(courier.x - player.inCar.x, courier.y - player.inCar.y);
        if (d < 70 && Math.abs(player.inCar.speed) > 120) {
          ramHits += 1;
          ramCooldown = 1.2;
          courier.cruise *= 0.55;
          police.addHeat(4);
          audio.sfx.crash();
          toast(`Ram hit ${ramHits}/4!`);
        }
      }
      // Courier flees the player a little: keep its cruise honest.
      if (runner.activeDef?.id !== 'm2') { courier = null; }
    }

    // --- Missions ---
    if (runner.activeDef) {
      const ev = runner.update(dt, missionCtx());
      void ev;
    }
    if (pendingOffer >= 0) {
      pendingOfferTimer -= dt;
      if (pendingOfferTimer <= 0) {
        const idx = pendingOffer;
        pendingOffer = -1;
        if (idx < MISSION_DEFS.length) offerMission(idx);
      }
    }
    // Heat from being near police cars while speeding is handled by police.

    // Toasts decay.
    toastTimer -= dt;
    if (toastTimer <= 0) toasts = [];
  }
  game.stepFixed = stepFixed;

  function gameOver(kind) {
    screen = SCREEN_OVER;
    game._onGameOver?.(kind);
    return kind;
  }
  game.gameOver = gameOver;

  const autopilot = createAutopilot(game);
  game.autopilot = autopilot;
  game._setScreen = (s) => { screen = s; };
  game._getScreen = () => screen;
  return game;
}

// ---------------- boot ----------------
const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const toastEl = document.getElementById('toast');
const titleEl = document.getElementById('title-screen');
const pauseEl = document.getElementById('pause-menu');
const overEl = document.getElementById('game-over-screen');
const dialogEl = document.getElementById('mission-dialog');

const game = createGame();
const renderer = createRenderer(canvas, game.world);
const hud = createHud();
const input = createInput(canvas);
game._input = input;

function announce(msg) { statusEl.textContent = msg; }
function showOnly(el) {
  for (const o of [titleEl, pauseEl, overEl, dialogEl]) o.hidden = o !== el;
  if (!el) for (const o of [titleEl, pauseEl, overEl, dialogEl]) o.hidden = true;
}
game._bindDialog(
  (def) => {
    document.getElementById('mission-title').textContent = `${def.id.toUpperCase()} — ${def.name}`;
    document.getElementById('mission-fixer').textContent = def.fixer;
    document.getElementById('mission-hook').textContent = def.hook;
    document.getElementById('mission-meta').textContent = `Reward $${def.reward} · Time ${def.timeLimit}s`;
    dialogEl.hidden = false;
  },
  () => { dialogEl.hidden = true; },
);
game._onGameOver = (kind) => {
  document.getElementById('game-over-title').textContent = kind;
  document.getElementById('game-over-text').textContent =
    kind === 'CAUGHT' ? 'The police took Rook in. The job is blown — start the job over.' : 'Rook went down. The city moves on without him.';
  showOnly(overEl);
  announce(`Game over: ${kind}.`);
};

function startNewGame() {
  game.player.reset(LANDMARKS.hideout.x, LANDMARKS.hideout.y);
  game.player.cash = 200;
  game.police.clearHeat();
  game.combat.clearArena();
  game.missionIndex = 0;
  game._setScreen(SCREEN_PLAY);
  showOnly(null);
  game.audio.startAmbient();
  announce('Playing. First job: talk to Mara.');
  game.offerMission(0);
}
function resumeGame() {
  game._setScreen(SCREEN_PLAY);
  showOnly(null);
  announce('Playing.');
}

document.getElementById('btn-new-game').addEventListener('click', startNewGame);
document.getElementById('btn-continue').addEventListener('click', () => {
  const saved = loadGame();
  if (saved && applySave(game, saved)) {
    game._setScreen(SCREEN_PLAY);
    showOnly(null);
    game.audio.startAmbient();
    announce('Save loaded.');
    game.offerMission(game.missionIndex);
  } else {
    startNewGame();
  }
});
document.getElementById('btn-autopilot').addEventListener('click', () => {
  startNewGame();
  game.autopilot.setEnabled(true);
  announce('Autopilot playtest running.');
});
document.getElementById('btn-resume').addEventListener('click', resumeGame);
document.getElementById('btn-save').addEventListener('click', () => {
  saveGame(game);
  document.getElementById('btn-save').textContent = 'Saved!';
  setTimeout(() => { document.getElementById('btn-save').textContent = 'Save Game'; }, 1200);
});
document.getElementById('btn-quit-title').addEventListener('click', () => {
  game._setScreen(SCREEN_TITLE);
  showOnly(titleEl);
});
document.getElementById('btn-retry').addEventListener('click', () => {
  game.player.reset(LANDMARKS.hideout.x, LANDMARKS.hideout.y);
  game.player.hp = 100;
  game.police.clearHeat();
  game._setScreen(SCREEN_PLAY);
  showOnly(null);
  const idx = Math.min(game.missionIndex, MISSION_DEFS.length - 1);
  game.offerMission(idx);
});
document.getElementById('btn-over-title').addEventListener('click', () => {
  game._setScreen(SCREEN_TITLE);
  showOnly(titleEl);
});
document.getElementById('btn-accept-mission').addEventListener('click', () => game.acceptDialog());
document.getElementById('btn-decline-mission').addEventListener('click', () => game.declineDialog());

// Save line on the title screen.
const saved = loadGame();
if (saved) {
  document.getElementById('save-line').textContent =
    `Save found: $${saved.cash} · mission ${saved.missionIndex + 1}/${MISSION_DEFS.length} · ${saved.savedAt.slice(0, 10)}`;
  document.getElementById('btn-continue').hidden = false;
} else {
  document.getElementById('save-line').textContent = 'No save yet.';
  document.getElementById('btn-continue').hidden = true;
}

function handleActions() {
  const actions = input.takeActions();
  const keys = input.takePressedKeys();
  // Weapon keys 1/2/3 + Q.
  for (const k of keys) game.weapons.handleKey(k.replace('Digit', ''));
  if (actions & ACTION_CYCLE_WEAPON) game.weapons.cycle();
  if (actions & ACTION_RADIO && game.radio) {
    game.radio.cycle();
    announce(`Radio: ${game.radio.stationName}`);
  }
  if (keys.includes('KeyM')) {
    game.autopilot.setEnabled(!game.autopilot.enabled);
    announce(game.autopilot.enabled ? 'Autopilot on.' : 'Autopilot off.');
  }
  if (game.dialogOpen) {
    if (actions & (ACTION_CONFIRM | ACTION_ENTER_CAR)) game.acceptDialog();
    return;
  }
  if (actions & ACTION_PAUSE) {
    if (game.screen === SCREEN_PLAY) { game._setScreen(SCREEN_PAUSED); showOnly(pauseEl); announce('Paused.'); }
    else if (game.screen === SCREEN_PAUSED) resumeGame();
    return;
  }
  if (actions & ACTION_CONFIRM) {
    if (game.screen === SCREEN_TITLE) startNewGame();
    else if (game.screen === SCREEN_OVER) document.getElementById('btn-retry').click();
    return;
  }
  if (actions & ACTION_ENTER_CAR && game.screen === SCREEN_PLAY) {
    const p = game.player;
    // E routes through the garage FIRST (spec 3.3 contract): it opens
    // the menu inside the zone and closes it when open — before any
    // car enter/exit happens.
    const gRes = game.garage.handleKey('e', { x: p.x, y: p.y }, p.inCar, p.cash);
    if (gRes === 'opened') { announce('Fixer Garage — pick an upgrade.'); return; }
    if (gRes === 'closed') { p.cash = game.garage.cash; announce('Garage closed.'); return; }
    if (p.inCar) {
      p.exitCar();
    } else {
      p.tryEnterCar(game.allCars, game.police, game.pedestrians);
    }
  }
}

let accumulator = 0;
let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  accumulator += Math.min((now - last) / 1000, MAX_FRAME);
  last = now;
  handleActions();
  game._camera = renderer.camera;
  while (accumulator >= STEP) {
    game.stepFixed(STEP);
    accumulator -= STEP;
  }
  const view = renderer.draw(game, game.screen);
  game._camera = view.camera;
  if (game.screen === SCREEN_PLAY) hud.draw(ctx2d(), game, view.viewW, view.viewH);
  toastEl.textContent = game.toasts[game.toasts.length - 1] || '';
}
function ctx2d() {
  // The renderer owns the context transform; the HUD draws in screen space.
  const c = canvas.getContext('2d');
  const ratio = window.devicePixelRatio || 1;
  c.setTransform(ratio, 0, 0, ratio, 0, 0);
  return c;
}

if (shotName) {
  // Screenshot pose: stage the scene, paint twice, signal ready.
  game._setScreen(SCREEN_PLAY);
  const screenForShot = stageShot(shotName, game);
  game._setScreen(screenForShot === 'title' ? SCREEN_TITLE : SCREEN_PLAY);
  if (screenForShot === 'title') showOnly(titleEl);
  else showOnly(null);
  let painted = 0;
  function paint() {
    const view = renderer.draw(game, game.screen);
    if (game.screen === SCREEN_PLAY) hud.draw(ctx2d(), game, view.viewW, view.viewH);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  }
  requestAnimationFrame(paint);
} else {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden && game.screen === SCREEN_PLAY) {
      game._setScreen(SCREEN_PAUSED);
      showOnly(pauseEl);
    }
  });
  if (autoParam) {
    startNewGame();
    game.autopilot.setEnabled(true);
  }
  announce('Crescent Bay. Press Space or click New Game to start.');
  requestAnimationFrame(frame);
}

// Playtest + integration API for Builder C (read-only state + controls).
window.__game = {
  game,
  startAutopilot() { startNewGame(); game.autopilot.setEnabled(true); },
  startMission(id) { return game.startMissionById(id); },
  state() {
    return {
      screen: game.screen, x: game.player.x, y: game.player.y,
      hp: game.player.hp, cash: game.player.cash,
      stars: game.stars, heat: game.police.state.heat,
      mission: game.runner.activeDef?.id || null, stage: game.runner.stage,
      timeLeft: game.runner.timeLeft, inCar: !!game.player.inCar,
      enemies: game.combat.enemies.length, ramHits: game.ramHits,
      dialogOpen: game.dialogOpen, autopilot: game.autopilot.enabled,
    };
  },
};
