// tools/debug-m7b.mjs — probe the m7 stage-1 stall with autopilot internals.
// Starts at m6 (missionIndex 5, as in the real arc), lets the autopilot
// finish m6 and roll into m7, then logs every second: inCar, pos, heat,
// objective kind, autopilot caches (walkTarget, walkRoute, targetCar),
// parked cars near the player. Stops when m7 completes or 240s pass.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8935;
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
  g.missionIndex = 5;
  g.player.cash = 6500;
  g.startMissionById('m6', { silent: true });
  g.autopilot.setEnabled(true);
});
let lastPos = null;
let frozenSince = null;
for (let t = 0; t < 240; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate(() => {
    const g = window.__game.game;
    const px = g.player.x, py = g.player.y;
    const parked = g.traffic.parked
      .map((c) => ({ d: Math.round(Math.hypot(c.x - px, c.y - py)), top: c.topSpeed }))
      .filter((c) => c.d < 400).sort((a, b) => a.d - b.d).slice(0, 3);
    return {
      screen: g.screen,
      mission: g.runner.activeDef?.id, stage: g.runner.stage,
      obj: g.runner.activeDef ? g.runner.currentObjective(g.missionCtx()).kind : null,
      inCar: !!g.player.inCar,
      carSpeed: g.player.inCar ? Math.round(g.player.inCar.speed) : null,
      px: Math.round(px), py: Math.round(py),
      heat: Math.round(g.police.state.heat), stars: g.stars,
      dialog: g.dialogOpen, completed: g.runner.completedCount,
      parkedNear: JSON.stringify(parked),
      ap: g.autopilot.debugState(),
    };
  });
  const posKey = `${s.px},${s.py}`;
  if (posKey === lastPos) { frozenSince = frozenSince ?? t; } else { frozenSince = null; }
  lastPos = posKey;
  // Log every second during m7 stage 1, every 5s otherwise.
  if (s.mission === 'm7' || t % 5 === 0) {
    console.log(`${t + 1}s frozen=${frozenSince === null ? 0 : t - frozenSince + 1}s`, JSON.stringify(s));
  }
  if (s.screen === 'over') { console.log('GAME OVER'); break; }
  if (s.completed >= 2) { console.log('m6+m7 done'); break; }
}
await browser.close();
server.kill();
