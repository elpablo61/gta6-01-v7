// tools/debug-m7.mjs — one-off probe: why does m7 stage 1 (escape) stall?
// Loads the game, enables the autopilot, jumps straight to m7, and logs
// the full live state once a second for 120s: in-car?, car speed/pos,
// heat/stars, objective kind, parked cars near the player, patrol cars.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8934;
const BASE = `http://localhost:${PORT}`;

const server = spawn('node', ['serve.ts', '--port', String(PORT)], { cwd: process.cwd(), stdio: 'ignore' });
for (let i = 0; i < 50; i++) {
  try { const r = await fetch(`${BASE}/`); if (r.ok) break; } catch {}
  await new Promise((r) => setTimeout(r, 200));
}
const browser = await chromium.launch({
  executablePath: SHELL,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));
await page.goto(`${BASE}/?seed=7&autopilot=1`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const g = window.__game.game;
  g.startMissionById('m7', { silent: true });
  g.autopilot.setEnabled(true);
});
for (let t = 0; t < 120; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate(() => {
    const g = window.__game.game;
    const px = g.player.x, py = g.player.y;
    const parked = g.traffic.parked
      .map((c) => ({ d: Math.round(Math.hypot(c.x - px, c.y - py)), top: c.topSpeed }))
      .filter((c) => c.d < 600).sort((a, b) => a.d - b.d).slice(0, 3);
    const car = g.player.inCar;
    return {
      mission: g.runner.activeDef?.id, stage: g.runner.stage,
      obj: g.runner.activeDef ? g.runner.currentObjective(g.missionCtx()).kind : null,
      inCar: !!car, carSpeed: car ? Math.round(car.speed) : null,
      carXY: car ? `${Math.round(car.x)},${Math.round(car.y)}` : null,
      px: Math.round(px), py: Math.round(py),
      heat: Math.round(g.police.state.heat), stars: g.stars,
      patrol: g.police.state.patrolCars.length,
      footCops: g.police.state.footCops.length,
      heli: g.helicopter.state, dialog: g.dialogOpen,
      parkedNear: JSON.stringify(parked),
      completed: g.runner.completedCount,
    };
  });
  console.log(`${t + 1}s`, JSON.stringify(s));
  if (s.completed >= 1 || s.mission !== 'm7') { console.log('m7 finished / left'); break; }
}
await browser.close();
server.kill();
