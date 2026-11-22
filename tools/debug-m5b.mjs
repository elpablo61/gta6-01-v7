// tools/debug-m5b.mjs — test the car-swap loop theory: put Rook in a TRUCK
// at the hideout with a faster parked sports car 54u away, m5 active.
// If the swap loops (exit truck -> re-enter the SAME truck forever),
// the car never drives and the position freezes, as in the arc.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8940;
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
  g.missionIndex = 4;
  g.player.cash = 3300;
  // Park a fast sports car 54u east of the hideout (like the arc).
  const sports = g.traffic.parked.find((c) => c.topSpeed >= 520);
  if (sports) { sports.x = 656; sports.y = 2588; sports.parked = true; }
  g.teleport(602, 2588);
  g.giveCar('truck');
  g.startMissionById('m5', { silent: true });
  g.autopilot.setEnabled(true);
});
for (let t = 0; t < 30; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate(() => {
    const g = window.__game.game;
    const car = g.player.inCar;
    const near = g.traffic.parked
      .map((c) => ({ d: Math.round(Math.hypot(c.x - g.player.x, c.y - g.player.y)), top: c.topSpeed, parked: !!c.parked, type: c.type }))
      .filter((c) => c.d < 400).sort((a, b) => a.d - b.d).slice(0, 3);
    return {
      mission: g.runner.activeDef?.id, stage: g.runner.stage,
      inCar: !!car, carType: car ? car.type : null, carTop: car ? car.topSpeed : null,
      carSpeed: car ? Math.round(car.speed) : null,
      px: Math.round(g.player.x), py: Math.round(g.player.y),
      completed: g.runner.completedCount, near: JSON.stringify(near),
      targetCar: g.autopilot.debugState().targetCar,
    };
  });
  console.log(`${t + 1}s`, JSON.stringify(s));
  if (s.completed >= 1) { console.log('m5 done'); break; }
}
await browser.close();
server.kill();
