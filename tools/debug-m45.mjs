// tools/debug-m45.mjs — reproduce the arc's m4 -> m5 transition: start at m4
// (missionIndex 3, as in the real arc), let the autopilot finish m4 and
// roll into m5, logging the autopilot's own step() output plus the car's
// angle / route / speed every second.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8939;
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
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message, (e.stack || '').split('\n').slice(0, 3).join(' | ')));
await page.goto(`${BASE}/?seed=7&autopilot=1`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const g = window.__game.game;
  g.missionIndex = 3;
  g.player.cash = 2200;
  g.startMissionById('m4', { silent: true });
  g.autopilot.setEnabled(true);
});
for (let t = 0; t < 120; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate(() => {
    const g = window.__game.game;
    const car = g.player.inCar;
    let out = null;
    try {
      const obj = g.runner.activeDef ? g.runner.currentObjective(g.missionCtx()) : null;
      const o = g.autopilot.step(1 / 60, obj);
      out = { drive: o.drive ? `${Math.round(o.drive.x)},${Math.round(o.drive.y)}@${o.drive.cruise}` : null,
        exitCar: o.exitCar, enterCar: o.enterCar, move: o.move, sprint: o.sprint };
    } catch (e) {
      out = { error: `${e.message} :: ${(e.stack || '').split('\n').slice(0, 3).join(' | ')}` };
    }
    return {
      mission: g.runner.activeDef?.id, stage: g.runner.stage,
      inCar: !!car, carSpeed: car ? Math.round(car.speed) : null,
      carAngle: car ? Math.round(car.angle * 180 / Math.PI) : null,
      carXY: car ? `${Math.round(car.x)},${Math.round(car.y)}` : null,
      carType: car ? car.type : null, carTop: car ? car.topSpeed : null,
      route: car && car.route ? `len${car.route.length} idx${car.routeIndex}` : null,
      px: Math.round(g.player.x), py: Math.round(g.player.y),
      hp: Math.round(g.player.hp), dialog: g.dialogOpen,
      completed: g.runner.completedCount, out,
    };
  });
  if (s.mission === 'm5' || t % 5 === 0) console.log(`${t + 1}s`, JSON.stringify(s));
  if (s.completed >= 2 || s.mission === 'm6') { console.log('m4+m5 done (or m6 reached)'); break; }
}
await browser.close();
server.kill();
