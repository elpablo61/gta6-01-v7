// tools/playtest.mjs — Crescent Bay playtest runner (Builder C, fresh).
//
// Modes (node tools/playtest.mjs --mode <mode>):
//   cold  — 10 load/boot checks: title screen, canvas, autopilot start,
//             first mission offered + accepted, player moves, radio on
//             Bay FM, 3 save slots listed, 0 console errors.
//   edge  — 14 behaviour checks in the live page: radio cycles all 3
//             stations, save slots write/load all 3, garage purchase
//             opens the m11 gate (and the gate stays shut without one),
//             helicopter spawns at 3 stars, weapon keys do not crash,
//             Spray Shop drains heat, fail restarts from stage 0.
//   arc   — full autopilot run m1–m12 end to end (or one mission with
//             --mission m9). Progress lands in /tmp/arc-progress.txt,
//             one state line every 2s, so a kill never loses the story.
//   fps   — frames per second during a wanted chase (10s sample).
//   all   — cold + edge + fps, then arc (arc is long; run it alone
//             when iterating).
//
// Ports: playtest 8931. Headless shell executable is pinned explicitly
// (Playwright 1.49+ expects chromium_headless_shell-1255, cached here).

import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { MISSION_DEFS, createMissionRunner, missionById } from '../game/src/missions.js';
import { registerAct2Missions } from '../game/src/act2-missions.js';
import { SPRAY_SHOP } from '../game/src/config.js';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8931;
const BASE = `http://localhost:${PORT}`;
const PROGRESS = '/tmp/arc-progress.txt';

const argv = process.argv.slice(2);
function flagValue(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}
const modeArg = flagValue('--mode') || 'all';
const missionFilter = flagValue('--mission');

const errors = [];
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
}

let server = null;
async function startServer() {
  server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`${BASE}/`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('serve.ts did not come up on port ' + PORT);
}

async function newPage(browser) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return page;
}

async function state(page) {
  return page.evaluate(() => {
    const g = window.__game.game;
    const px = g.player.x, py = g.player.y;
    let parkedNear = 0, parkedNearD = null;
    for (const c of g.traffic.parked) {
      const d = Math.hypot(c.x - px, c.y - py);
      if (d < 400) { parkedNear += 1; if (parkedNearD === null || d < parkedNearD) parkedNearD = Math.round(d); }
    }
    const car = g.player.inCar;
    return {
      screen: g.screen, x: Math.round(g.player.x), y: Math.round(g.player.y),
      hp: Math.round(g.player.hp), cash: Math.floor(g.player.cash),
      stars: g.stars, heat: Math.round(g.police.state.heat),
      mission: g.runner.activeDef?.id || null, stage: g.runner.stage,
      missionIndex: g.missionIndex, completed: g.runner.completedCount,
      timeLeft: g.runner.timeLeft ? Math.round(g.runner.timeLeft) : null,
      inCar: !!car, carSpeed: car ? Math.round(car.speed) : null,
      enemies: g.combat.enemies.length, ramHits: g.ramHits,
      dialogOpen: g.dialogOpen, autopilot: g.autopilot.enabled,
      radio: g.radioStation, heli: g.helicopter.state,
      garagePurchases: g.garage.purchaseCount(),
      parkedNear, parkedNearD,
      slots: g.saveSlots.listSlots().map((s) => `${s.slot}:${s.status}`).join(','),
    };
  });
}

async function sleep(ms) { await new Promise((r) => setTimeout(r, ms)); }

// ---------------- cold ----------------
async function runCold(browser) {
  console.log('\n== cold ==');
  const page = await newPage(browser);
  await page.goto(`${BASE}/?seed=7`, { waitUntil: 'load' });
  await sleep(1500);
  check('page loads, title screen visible',
    await page.evaluate(() => !document.getElementById('title-screen').hidden));
  check('canvas present', await page.evaluate(() => !!document.getElementById('game')));
  check('3 save slots listed on title',
    (await page.$$eval('#save-slots .save-slot', (els) => els.length)) === 3);
  check('slot labels say Empty on a fresh profile',
    (await page.$$eval('#save-slots .save-slot', (els) => els.map((e) => e.textContent).join('|'))).includes('Empty'));
  check('radio defaults to Bay FM', (await state(page)).radio === 'Bay FM');
  registerAct2Missions();
  check('arc is 12 missions (m1–m12 in order)',
    MISSION_DEFS.length === 12 && MISSION_DEFS.map((m) => m.id).join(',') === 'm1,m2,m3,m4,m5,m6,m7,m8,m9,m10,m11,m12',
    MISSION_DEFS.map((m) => m.id).join(','));
  await page.click('#btn-autopilot');
  await sleep(2500);
  let s = await state(page);
  check('autopilot starts the game (screen play)', s.screen === 'play', `screen=${s.screen}`);
  check('first mission offered and accepted (m1 active)', s.mission === 'm1' || s.missionIndex >= 1,
    `mission=${s.mission} idx=${s.missionIndex}`);
  const p0 = { x: s.x, y: s.y };
  await sleep(5000);
  s = await state(page);
  check('player moves under autopilot', Math.hypot(s.x - p0.x, s.y - p0.y) > 20,
    `moved ${Math.round(Math.hypot(s.x - p0.x, s.y - p0.y))}u`);
  check('no console errors during cold load + m1 start', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------- edge ----------------
async function runEdge(browser) {
  console.log('\n== edge ==');
  const page = await newPage(browser);
  await page.goto(`${BASE}/?seed=7`, { waitUntil: 'load' });
  await sleep(1200);

  // Radio: R cycles all three stations, name changes every time.
  // Accept the m1 offer first — the world waits while a dialog is open.
  await page.click('#btn-new-game');
  await sleep(500);
  await page.click('#btn-accept-mission');
  await sleep(800);
  await page.keyboard.press('KeyR'); await sleep(200);
  let s = await state(page);
  check('radio R cycles to Harbor Jazz', s.radio === 'Harbor Jazz', `radio=${s.radio}`);
  await page.keyboard.press('KeyR'); await sleep(200);
  s = await state(page);
  check('radio R cycles to Crescent Rock', s.radio === 'Crescent Rock', `radio=${s.radio}`);
  await page.keyboard.press('KeyR'); await sleep(200);
  s = await state(page);
  check('radio R wraps back to Bay FM', s.radio === 'Bay FM', `radio=${s.radio}`);

  // Save slots: write all 3, load each back, corrupt one safely.
  const slotRes = await page.evaluate(() => {
    const g = window.__game.game;
    const out = {};
    g.player.cash = 2400; g.missionIndex = 4;
    out.w1 = g.saveSlots.saveToSlot(g, 1);
    g.player.cash = 800; g.missionIndex = 1;
    out.w2 = g.saveSlots.saveToSlot(g, 2);
    g.player.cash = 150; g.missionIndex = 0;
    out.w3 = g.saveSlots.saveToSlot(g, 3);
    out.l1 = g.saveSlots.loadSlot(1)?.cash;
    out.l2 = g.saveSlots.loadSlot(2)?.cash;
    out.l3 = g.saveSlots.loadSlot(3)?.cash;
    out.list = g.saveSlots.listSlots().map((x) => x.status).join(',');
    g.saveSlots.setActiveSlot(2);
    out.active = g.saveSlots.getActiveSlot();
    g.player.cash = 9100; g.missionIndex = 9;
    out.auto = g.saveSlots.autosaveToActive(g);
    out.l2b = g.saveSlots.loadSlot(2)?.cash;
    return out;
  });
  check('save slots: all 3 write', slotRes.w1 && slotRes.w2 && slotRes.w3, JSON.stringify(slotRes));
  check('save slots: each loads its own cash back',
    slotRes.l1 === 2400 && slotRes.l2 === 800 && slotRes.l3 === 150,
    `l1=${slotRes.l1} l2=${slotRes.l2} l3=${slotRes.l3}`);
  check('save slots: all list ok; autosave follows the active slot',
    slotRes.list === 'ok,ok,ok' && slotRes.active === 2 && slotRes.auto && slotRes.l2b === 9100,
    JSON.stringify(slotRes));

  // Helicopter spawns at 3 stars and shadows the player.
  await page.evaluate(() => { window.__game.game.police.setHeat(58); });
  await sleep(1500);
  s = await state(page);
  check('helicopter spawns at 3 stars', s.heli !== 'inactive', `heli=${s.heli}`);
  check('wanted shows 3 stars at heat 58', s.stars === 3, `stars=${s.stars}`);

  // Weapon keys never crash (pistol owned; SMG/shotgun locked until picked up).
  await page.keyboard.press('Digit2'); await sleep(150);
  await page.keyboard.press('Digit3'); await sleep(150);
  await page.keyboard.press('KeyQ'); await sleep(150);
  s = await state(page);
  check('weapon keys 2/3/Q do not crash the loop', s.screen === 'play' && s.hp > 0);

  // m11 garage gate, live through the real runner: waits with no
  // purchase, advances after one purchase.
  const gate = await page.evaluate(async () => {
    const g = window.__game.game;
    const sleep2 = (ms) => new Promise((r) => setTimeout(r, ms));
    g.player.cash = 5000;
    g.teleport(1400, 1000);
    g.giveCar('sports');
    g.startMissionById('m11', { silent: true });
    await sleep2(1500);
    const before = { stage: g.runner.stage, mission: g.runner.activeDef?.id };
    const car = g.player.inCar;
    const res = g.garage.buyCheapest(car, g.player.cash);
    if (res.ok) g.player.cash = res.cashLeft;
    await sleep2(500);
    return { before, after: g.runner.stage, bought: res.ok ? res.category : null,
      purchases: g.garage.purchaseCount() };
  });
  check('m11 waits at the garage stage with no purchase', gate.before.stage === 0,
    JSON.stringify(gate.before));
  check('m11 advances after one garage purchase',
    gate.after === 1 && !!gate.bought, JSON.stringify(gate));

  // Spray Shop drains heat (escape path).
  await page.evaluate((shop) => {
    const g = window.__game.game;
    g.police.setHeat(80);
    g.teleport(shop.x, shop.y);
  }, SPRAY_SHOP);
  await sleep(100);
  const heatBefore = (await state(page)).heat;
  await sleep(4000);
  const heatAfter = (await state(page)).heat;
  check('Spray Shop area drains heat', heatAfter < heatBefore, `${heatBefore} -> ${heatAfter}`);

  // Fail restarts from stage 0 (real runner, Node side — the runner's
  // timeLeft is a read-only getter, so the clock is run out by stepping
  // the real update loop with a fake ctx).
  const failProbe = (() => {
    const runner = createMissionRunner();
    const ctx = {
      player: { x: 0, y: 0 }, playerCar: null, courier: null, ramHits: 0,
      enemiesAlive: 0, heat: 0, nearestEnemy: () => null,
      spawnArena: () => {}, spawnCourier: () => {}, setHeat: () => {},
      onEvent: () => {}, garage: null,
      garageStageSnapshot: () => 0, isGarageStageComplete: () => false,
    };
    const def = missionById('m3');
    runner.start(def, ctx);
    for (let t = 0; t < def.timeLimit + 1; t += 1 / 60) runner.update(1 / 60, ctx);
    const failed = runner.activeDef === null;
    runner.start(def, ctx);
    return { failed, stage: runner.stage };
  })();
  check('failed mission restarts from stage 0', failProbe.failed && failProbe.stage === 0,
    JSON.stringify(failProbe));

  check('no console errors during edge suite', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------- arc ----------------
async function runArc(browser) {
  console.log('\n== arc ==');
  writeFileSync(PROGRESS, `arc start ${new Date().toISOString()} filter=${missionFilter || 'all'}\n`);
  const page = await newPage(browser);
  await page.goto(`${BASE}/?seed=7&autopilot=1`, { waitUntil: 'load' });
  await sleep(1000);
  // Single-mission filter: jump straight to that mission with cash.
  if (missionFilter) {
    await page.evaluate((id) => {
      const g = window.__game.game;
      g.player.cash = 9000;
      g.startMissionById(id, { silent: true });
      g.autopilot.setEnabled(true);
    }, missionFilter);
  }
  const t0 = Date.now();
  const OVERALL_MS = 1500 * 1000; // 25 minutes max for the full arc
  const PER_MISSION_MS = 320 * 1000;
  const seen = new Map(); // mission id -> { start, done }
  let lastMission = null;
  let lastMissionStart = Date.now();
  let done = false;
  let failed = null;
  while (Date.now() - t0 < OVERALL_MS) {
    await sleep(2000);
    const s = await state(page).catch(() => null);
    if (!s) break;
    const line = `${Math.round((Date.now() - t0) / 1000)}s mission=${s.mission} stage=${s.stage} idx=${s.missionIndex} completed=${s.completed} hp=${s.hp} cash=${s.cash} stars=${s.stars} x=${s.x} y=${s.y} dialog=${s.dialogOpen} screen=${s.screen} inCar=${s.inCar} carSpeed=${s.carSpeed} parkedNear=${s.parkedNear}/${s.parkedNearD}`;
    appendFileSync(PROGRESS, line + '\n');
    if (s.screen === 'over') { failed = `game over (${s.hp}hp) at ${line}`; break; }
    const cur = s.mission || `idx${s.missionIndex}`;
    if (cur !== lastMission) {
      if (lastMission && s.completed > (seen.get(lastMission)?.completed ?? -1)) {
        seen.set(lastMission, { done: true, at: Math.round((Date.now() - t0) / 1000) });
        console.log(`MISSION DONE ${lastMission} at ${Math.round((Date.now() - t0) / 1000)}s (completed=${s.completed})`);
      }
      lastMission = cur;
      lastMissionStart = Date.now();
    }
    if (Date.now() - lastMissionStart > PER_MISSION_MS) {
      failed = `mission ${cur} stuck > ${PER_MISSION_MS / 1000}s at ${line}`;
      break;
    }
    if (!missionFilter && s.completed >= 12) { done = true; break; }
    if (missionFilter && s.completed >= 1) { done = true; break; }
  }
  const s = await state(page).catch(() => null);
  const elapsed = Math.round((Date.now() - t0) / 1000);
  appendFileSync(PROGRESS, `arc end ${elapsed}s done=${done} failed=${failed} completed=${s?.completed}\n`);
  check(`arc ${missionFilter || 'm1–m12'} completes by autopilot`, done && !failed,
    failed || `completed=${s?.completed} in ${elapsed}s`);
  check('no console errors during arc', errors.length === 0, errors.join(' | '));
  console.log(`arc: completed=${s?.completed} elapsed=${elapsed}s`);
  await page.close();
}

// ---------------- fps ----------------
async function runFps(browser) {
  console.log('\n== fps ==');
  const page = await newPage(browser);
  await page.goto(`${BASE}/?seed=7&autopilot=1`, { waitUntil: 'load' });
  await sleep(2000);
  await page.evaluate(() => {
    const g = window.__game.game;
    g.teleport(2000, 2000);
    g.giveCar('sports');
    g.police.setHeat(58);
  });
  await sleep(1000);
  const fps = await page.evaluate(() => new Promise((resolve) => {
    let frames = 0;
    const start = performance.now();
    function tick() {
      frames += 1;
      if (performance.now() - start < 10000) requestAnimationFrame(tick);
      else resolve(frames / 10);
    }
    requestAnimationFrame(tick);
  }));
  check('FPS >= 50 during a wanted chase', fps >= 50, `fps=${fps.toFixed(1)}`);
  console.log(`fps: ${fps.toFixed(1)}`);
  check('no console errors during fps sample', errors.length === 0, errors.join(' | '));
  await page.close();
}

// ---------------- main ----------------
const browser = await chromium.launch({
  executablePath: SHELL,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
try {
  await startServer();
  if (modeArg === 'cold' || modeArg === 'all') await runCold(browser);
  if (modeArg === 'edge' || modeArg === 'all') await runEdge(browser);
  if (modeArg === 'fps' || modeArg === 'all') await runFps(browser);
  if (modeArg === 'arc' || modeArg === 'all') await runArc(browser);
} finally {
  await browser.close();
  if (server) server.kill();
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n== ${modeArg}: ${passed}/${results.length} passed, ${errors.length} console errors ==`);
if (passed !== results.length || errors.length) process.exitCode = 1;
