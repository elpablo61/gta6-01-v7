// act2-missions.js — Act 2 missions m9–m12 (spec section 2).
//
// Behaviour, in plain terms (all 12 missions share one linear arc;
// objectives are conditions — "reach the marker", "escape the
// police" — never kill counts; a failed mission restarts from stage 0):
//
//  m9 Sky Watch (escape, $2,000, 420s, Dex): wanted starts at 3 stars
//    (heat 58) and the police helicopter shadows Rook. Reach the
//    hideout while the helicopter is overhead. Shooting the helicopter
//    enough makes it smoke and retreat for 20 seconds (it returns if
//    wanted is still 3+); the spotlight blocks heat decay, so hiding
//    under it never works — keep moving. Arrival is TIGHT (60 units):
//    v6's m9 completed from ~400 units away, which made the escape
//    fake. This module never widens that radius.
//  m10 Full Auto (shootout, $2,500, 420s, Mara): dockside shootout
//    against 5 enemies. The arena holds weapon crates (SMG + shotgun)
//    and ammo — the autopilot picks up a better weapon, uses it,
//    clears the arena, then reaches the exit marker north of the docks.
//  m11 Tune-Up (garage + timed delivery, $3,000, 420s, Dex): drive to
//    the Fixer Garage, buy at least one upgrade, then a timed delivery
//    of 3 checkpoints (marina, club, airport) in the upgraded car.
//    The mission completes ONLY after a purchase AND all 3 checkpoints.
//  m12 Bay Finale (multi-stage, $8,000, 600s, Mara): (a) shootout at
//    the bank — 4 enemies plus the helicopter overhead at 4 stars;
//    (b) grab the loot at the bank marker; (c) escape to the airport
//    while the helicopter and roadblocks pursue; (d) reach the plane
//    marker. Biggest reward in the game. Death or capture restarts
//    from stage (a).
//
// Integration: this module registers the four defs through
// registerMission() (missions.js) — Builder C calls
// registerAct2Missions() once at boot, after the base m1–m8 exist.
// The defs use only stage types the runner already runs (goto,
// shootout, checkpoints) EXCEPT m11's garage stage — see the garage
// contract below. They use ACT2_LOCATIONS for every coordinate, the
// helicopter flag the main loop already honours (def.helicopter forces
// the helicopter up; def.wantedCover sets heat AFTER the mission
// starts), and the arena crates / ammo the main loop already spawns
// for shootout stages. No other module is imported besides
// missions.js + act2-locations.js; the defs are standalone data.
//
// --- m11 GARAGE STAGE CONTRACT (Builder C wiring, missions.js) --------
// The runner does not yet know a 'garage' stage. Builder C adds two
// small branches — everything else (autopilot kind 'garage', the main
// loop's garageAction open/buy-cheapest/close, the Garage class) is
// already wired:
//   * currentObjective(): a 'garage' stage returns
//     { x, y, label, kind: 'garage' } at the stage's location.
//   * beginStage(): snapshot the purchase count with
//     garageStageSnapshot(game.garage) and keep it on the stage state.
//   * update(): a 'garage' stage advances when
//     isGarageStageComplete(snapshot, game.garage) is true, i.e. the
//     player bought at least purchasesRequired upgrades since the
//     stage began (garage.purchaseCount() from garage.js).
// Until that wiring lands, m11 waits at its garage stage instead of
// completing without a purchase — it never silently passes. The
// helpers below are the exact check Builder C calls.

import { registerMission, MISSION_DEFS, createMissionRunner, missionById } from './missions.js';
import { ACT2_LOCATIONS, ARRIVAL_RADIUS } from './act2-locations.js';

// m10 exit marker: one road junction north of the docks arena, outside
// the shootout ring so reaching it means the fight is really over.
export const M10_EXIT_MARKER = { x: 2600, y: 2200 };

export const ACT2_MISSIONS = [
  {
    id: 'm9', name: 'Sky Watch', fixer: 'Dex',
    hook: 'Dex: "The helicopter is up and it is not going anywhere. Lose the spotlight, reach the hideout. Do not stop moving."',
    reward: 2000, timeLimit: 420,
    wantedCover: 58, // 3 stars, set AFTER the mission starts
    helicopter: true, // force the helicopter up for this mission
    stages: [
      {
        type: 'goto',
        label: 'Reach the Hideout while the helicopter is overhead',
        target: () => ACT2_LOCATIONS.hideout,
      },
    ],
  },
  {
    id: 'm10', name: 'Full Auto', fixer: 'Mara',
    hook: 'Mara: "Five of them at the docks. There are weapon crates in the yard — take the SMG, take the shotgun, clear it. Then get out."',
    reward: 2500, timeLimit: 420,
    stages: [
      {
        type: 'shootout',
        label: 'Clear the docks — grab a better weapon from the crates',
        arena: () => ACT2_LOCATIONS.docks, enemies: 5,
      },
      {
        type: 'goto',
        label: 'Reach the exit marker',
        target: () => M10_EXIT_MARKER,
      },
    ],
  },
  {
    id: 'm11', name: 'Tune-Up', fixer: 'Dex',
    hook: 'Dex: "That car is holding you back. Fixer Garage, buy an upgrade — any upgrade — then run my delivery: marina, club, airport. Fast."',
    reward: 3000, timeLimit: 420,
    stages: [
      {
        type: 'garage',
        label: 'Buy an upgrade at the Fixer Garage',
        location: () => ACT2_LOCATIONS.garage,
        purchasesRequired: 1,
      },
      {
        type: 'checkpoints',
        label: 'Timed delivery: Marina, Club, Airport',
        points: () => [ACT2_LOCATIONS.marina, ACT2_LOCATIONS.club, ACT2_LOCATIONS.airport],
      },
    ],
  },
  {
    id: 'm12', name: 'Bay Finale', fixer: 'Mara',
    hook: 'Mara: "The bank. Four guards, a helicopter, the whole city. Take the loot, run for the airport, and do not look back. This is the big one, Rook."',
    reward: 8000, timeLimit: 600,
    wantedCover: 74, // 4 stars, set AFTER the mission starts
    helicopter: true, // helicopter overhead for the whole finale
    stages: [
      {
        type: 'shootout',
        label: 'Clear the bank — 4 guards, helicopter overhead',
        arena: () => ACT2_LOCATIONS.bank, enemies: 4,
      },
      {
        type: 'goto',
        label: 'Grab the loot at the bank',
        target: () => ACT2_LOCATIONS.bank,
      },
      {
        // A plain goto, NOT the runner's 'escape' type: 'escape'
        // completes when heat drops below 12 and its autopilot branch
        // drives to the Spray Shop, but the finale must end at the
        // airport while still pursued. Arrival at the airport IS the
        // escape condition here.
        type: 'goto',
        label: 'Escape to the Airport',
        target: () => ACT2_LOCATIONS.airport,
      },
      {
        type: 'goto',
        label: 'Reach the plane',
        target: () => ACT2_LOCATIONS.plane,
      },
    ],
  },
];

// Register m9–m12 (idempotent: re-registering returns 0 new).
// Returns { registered: [ids newly added], total: missions now in the arc }.
export function registerAct2Missions() {
  const registered = [];
  for (const def of ACT2_MISSIONS) {
    if (registerMission(def)) registered.push(def.id);
  }
  return { registered, total: ACT2_MISSIONS.length };
}

// ---- m11 garage-stage helpers (the Builder C contract) ------------------

// Snapshot the purchase count when the garage stage begins.
export function garageStageSnapshot(garage) {
  if (!garage || typeof garage.purchaseCount !== 'function') return 0;
  return garage.purchaseCount();
}

// True once the player bought at least `required` upgrades since the
// snapshot. `required` defaults to the m11 stage's purchasesRequired.
export function isGarageStageComplete(snapshot, garage, required = 1) {
  if (!garage || typeof garage.purchaseCount !== 'function') return false;
  return garage.purchaseCount() - snapshot >= required;
}

// Tight-arrival guard, for the record: the runner's arrival test uses
// ARRIVAL_RADIUS (60). A mission that completes from hundreds of units
// away is a fake escape, not a completion.
export { ARRIVAL_RADIUS };

// ---- scripted check -------------------------------------------------------
// Runs in Node (no DOM) against the REAL mission runner with a fake
// ctx: it starts m9/m10/m12, walks the player through every stage,
// and proves the tight 60-unit arrival, the shootout counts, the
// m11 garage gate + checkpoint order, and the fail-restarts-from-
// stage-0 rule. The m11 garage stage itself is exercised through the
// contract helpers (the runner branch is Builder C wiring, documented
// above) — the check asserts the def carries the gate and the helper
// enforces it, so a build without the gate can never pass.
// Returns { passed, checks: [{ name, ok, detail }] }.
export function act2MissionsScriptedCheck() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

  const reg = registerAct2Missions();
  check('all 4 Act 2 missions register', reg.registered.length === 4,
    `registered=${reg.registered.join(',')}`);
  check('re-registering adds nothing (idempotent)',
    registerAct2Missions().registered.length === 0);
  check('arc is now 12 missions in order',
    MISSION_DEFS.length === 12 && MISSION_DEFS.map((m) => m.id).join(',') === 'm1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12',
    MISSION_DEFS.map((m) => m.id).join(','));

  const specs = {
    m9: { reward: 2000, timeLimit: 420, fixer: 'Dex', wantedCover: 58, helicopter: true },
    m10: { reward: 2500, timeLimit: 420, fixer: 'Mara' },
    m11: { reward: 3000, timeLimit: 420, fixer: 'Dex' },
    m12: { reward: 8000, timeLimit: 600, fixer: 'Mara', wantedCover: 74, helicopter: true },
  };
  for (const [id, want] of Object.entries(specs)) {
    const def = missionById(id);
    const ok = def && def.reward === want.reward && def.timeLimit === want.timeLimit
      && def.fixer === want.fixer
      && (want.wantedCover === undefined || def.wantedCover === want.wantedCover)
      && (want.helicopter === undefined || def.helicopter === want.helicopter);
    check(`${id} matches spec (reward $${want.reward}, ${want.timeLimit}s, ${want.fixer})`, !!ok,
      def ? `reward=${def.reward} time=${def.timeLimit} fixer=${def.fixer} cover=${def.wantedCover} heli=${def.helicopter}` : 'missing');
  }
  check('objectives are conditions, never kill counts',
    ACT2_MISSIONS.every((m) => m.stages.every((s) => typeof s.label === 'string' && !/kill \d/i.test(s.label)
      && !('killsNeeded' in s))));

  // Fake mission ctx, shaped like main.js missionCtx().
  function fakeCtx(playerPos) {
    const ctx = {
      player: { x: playerPos.x, y: playerPos.y },
      playerCar: null, courier: null, ramHits: 0,
      enemiesAlive: 0, heat: 0,
      nearestEnemy: () => null,
      spawnArena: (arena, count) => { ctx.arenaSpawned = { arena, count }; },
      spawnCourier: () => {},
      setHeat: (v) => { ctx.heat = v; },
      onEvent: (ev) => { (ctx.events ||= []).push(ev.type); },
      arenaSpawned: null, events: [],
    };
    return ctx;
  }
  function step(runner, ctx, seconds, dt = 1 / 60) {
    for (let t = 0; t < seconds; t += dt) {
      const ev = runner.update(dt, ctx);
      if (ev) return ev;
      if (!runner.activeDef) return null;
    }
    return null;
  }

  // --- m9: tight arrival + wanted cover + helicopter flag -----------------
  {
    const runner = createMissionRunner();
    const ctx = fakeCtx({ x: 200, y: 200 });
    runner.start(missionById('m9'), ctx);
    check('m9 sets wanted cover 58 (3 stars) on start', ctx.heat === 58, `heat=${ctx.heat}`);
    check('m9 forces the helicopter', missionById('m9').helicopter === true);
    // 100 units away from the hideout: must NOT complete (v6 lesson).
    ctx.player.x = ACT2_LOCATIONS.hideout.x + 100;
    ctx.player.y = ACT2_LOCATIONS.hideout.y;
    step(runner, ctx, 1);
    check('m9 does NOT complete from 100 units away (tight 60 radius)',
      runner.activeDef?.id === 'm9', `still active=${runner.activeDef?.id}`);
    // 30 units away: completes.
    ctx.player.x = ACT2_LOCATIONS.hideout.x + 30;
    ctx.player.y = ACT2_LOCATIONS.hideout.y;
    step(runner, ctx, 1);
    check('m9 completes at 30 units from the hideout', runner.activeDef === null
      && ctx.events.includes('complete'), `events=${ctx.events.join(',')}`);
  }

  // --- m10: shootout 5, then exit marker ----------------------------------
  {
    const runner = createMissionRunner();
    const ctx = fakeCtx({ x: 2600, y: 2400 });
    runner.start(missionById('m10'), ctx);
    check('m10 spawns 5 enemies at the docks',
      ctx.arenaSpawned?.count === 5
      && ctx.arenaSpawned.arena.x === ACT2_LOCATIONS.docks.x,
      JSON.stringify(ctx.arenaSpawned));
    ctx.enemiesAlive = 5;
    step(runner, ctx, 1);
    check('m10 does NOT advance while enemies remain', runner.stage === 0);
    ctx.enemiesAlive = 0;
    step(runner, ctx, 1);
    check('m10 advances to the exit stage once the arena is clear', runner.stage === 1);
    // Exit marker is away from the arena: standing in the docks is not enough.
    ctx.player.x = ACT2_LOCATIONS.docks.x;
    ctx.player.y = ACT2_LOCATIONS.docks.y;
    step(runner, ctx, 1);
    check('m10 does NOT complete while still standing in the docks', runner.activeDef?.id === 'm10');
    ctx.player.x = M10_EXIT_MARKER.x + 20;
    ctx.player.y = M10_EXIT_MARKER.y;
    step(runner, ctx, 1);
    check('m10 completes at the exit marker', runner.activeDef === null
      && ctx.events.includes('complete'));
  }

  // --- m11: garage gate (contract helpers) + checkpoint order -------------
  {
    const def = missionById('m11');
    const garageStage = def.stages[0];
    check('m11 stage 1 is a garage stage requiring 1 purchase',
      garageStage.type === 'garage' && garageStage.purchasesRequired === 1
      && garageStage.location().x === ACT2_LOCATIONS.garage.x,
      `type=${garageStage.type}`);
    const fakeGarage = { count: 0, purchaseCount() { return this.count; } };
    const snap = garageStageSnapshot(fakeGarage);
    check('garage gate is closed before any purchase',
      isGarageStageComplete(snap, fakeGarage, 1) === false);
    fakeGarage.count = 1; // player buys the cheapest upgrade
    check('garage gate opens after one purchase',
      isGarageStageComplete(snap, fakeGarage, 1) === true);
    check('garage gate needs exactly the required count',
      isGarageStageComplete(snap, fakeGarage, 2) === false);
    const points = def.stages[1].points();
    check('m11 delivery is marina -> club -> airport',
      points.length === 3
      && points[0].x === ACT2_LOCATIONS.marina.x
      && points[1].x === ACT2_LOCATIONS.club.x
      && points[2].x === ACT2_LOCATIONS.airport.x,
      points.map((p) => `(${p.x},${p.y})`).join(' '));
    // Prove the checkpoints stage itself advances in order through the
    // real runner, using the same points function.
    const runner = createMissionRunner();
    const probe = {
      id: 'm11-probe', name: 'probe', fixer: 'Dex', reward: 0, timeLimit: 420,
      stages: [def.stages[1]],
    };
    const ctx = fakeCtx({ x: 0, y: 0 });
    runner.start(probe, ctx);
    for (const pt of points) {
      ctx.player.x = pt.x;
      ctx.player.y = pt.y;
      step(runner, ctx, 1);
    }
    check('all 3 checkpoints complete the delivery stage',
      runner.activeDef === null && ctx.events.includes('complete'));
  }

  // --- m12: full 4-stage finale + fail restarts from stage (a) ------------
  {
    const runner = createMissionRunner();
    const ctx = fakeCtx({ x: 1800, y: 1200 });
    runner.start(missionById('m12'), ctx);
    check('m12 sets wanted cover 74 (4 stars) on start', ctx.heat === 74, `heat=${ctx.heat}`);
    check('m12 forces the helicopter', missionById('m12').helicopter === true);
    check('m12 opens with a 4-enemy bank shootout',
      ctx.arenaSpawned?.count === 4
      && ctx.arenaSpawned.arena.x === ACT2_LOCATIONS.bank.x,
      JSON.stringify(ctx.arenaSpawned));
    ctx.enemiesAlive = 4;
    step(runner, ctx, 1);
    check('m12 stays in stage (a) while guards remain', runner.stage === 0);
    ctx.enemiesAlive = 0;
    step(runner, ctx, 1);
    check('m12 advances to loot stage (b)', runner.stage === 1);
    ctx.player.x = ACT2_LOCATIONS.bank.x + 20;
    ctx.player.y = ACT2_LOCATIONS.bank.y;
    step(runner, ctx, 1);
    check('m12 advances to escape stage (c) after the loot', runner.stage === 2);
    ctx.player.x = ACT2_LOCATIONS.airport.x + 20;
    ctx.player.y = ACT2_LOCATIONS.airport.y;
    step(runner, ctx, 1);
    check('m12 advances to plane stage (d) at the airport', runner.stage === 3);
    ctx.player.x = ACT2_LOCATIONS.plane.x + 20;
    ctx.player.y = ACT2_LOCATIONS.plane.y;
    step(runner, ctx, 1);
    check('m12 completes at the plane marker', runner.activeDef === null
      && ctx.events.includes('complete'));

    // Fail restarts from stage (a): run the clock out mid-finale.
    const runner2 = createMissionRunner();
    const ctx2 = fakeCtx({ x: 1800, y: 1200 });
    runner2.start(missionById('m12'), ctx2);
    ctx2.enemiesAlive = 0;
    step(runner2, ctx2, 1); // clear stage (a)
    check('m12 restart probe reaches stage (b)', runner2.stage === 1);
    step(runner2, ctx2, 601); // clock runs out
    check('m12 fails when the clock runs out', runner2.activeDef === null
      && ctx2.events.includes('fail'));
    runner2.start(missionById('m12'), ctx2);
    check('m12 restarts from stage (a) after failure', runner2.stage === 0
      && ctx2.arenaSpawned?.count === 4);
  }

  const passed = checks.every((c) => c.ok);
  return { passed, checks };
}
