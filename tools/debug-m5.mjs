// tools/debug-m5.mjs — probe the m5 car stall: start at m5 (as in the arc),
// and every second log what autopilot.step() itself returns for the live
// objective (drive? exitCar? move?), plus the car's angle/route/speed.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8938;
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
page.on('console', (m) => { if (m.type() === 'error') console.log('CONSOLE-ERROR:', m.text()); });
await page.goto(`${BASE}/?seed=7&autopilot=1`, { waitUntil: 'load' });
await new Promise((r) => setTimeout(r, 1500));
await page.evaluate(() => {
  const g = window.__game.game;
  g.missionIndex = 4;
  g.player.cash = 3300;
  g.startMissionById('m5', { silent: true });
  g.autopilot.setEnabled(true);
});
for (let t = 0; t < 75; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate(() => {
    const g = window.__game.game;
    const car = g.player.inCar;
    let out = null;
    try {
      const obj = g.runner.activeDef ? g.runner.currentObjective(g.missionCtx()) : null;
      // Call step() once extra for diagnosis (timers advance a touch
      // faster in this probe only) and capture what it returns.
      out = g.autopilot.step(1 / 60, obj);
      out = { drive: out.drive, exitCar: out.exitCar, enterCar: out.enterCar,
        move: out.move, garageAction: out.garageAction, confirm: out.confirm };
    } catch (e) {
      out = { error: `${e.message} :: ${(e.stack || '').split('\n').slice(0, 3).join(' | ')}` };
    }
    return {
      screen: g.screen,
      mission: g.runner.activeDef?.id, stage: g.runner.stage,
      obj: g.runner.activeDef ? g.runner.currentObjective(g.missionCtx()).kind : null,
      inCar: !!car,
      carSpeed: car ? Math.round(car.speed) : null,
      carAngle: car ? Math.round(car.angle * 180 / Math.PI) : null,
      carXY: car ? `${Math.round(car.x)},${Math.round(car.y)}` : null,
      route: car && car.route ? `len${car.route.length} idx${car.routeIndex} dest${Math.round(car.routeDest?.x || 0)},${Math.round(car.routeDest?.y || 0)}` : null,
      stuckTimer: car ? car.stuckTimer.toFixed(2) : null,
      reverseTimer: car ? car.reverseTimer.toFixed(2) : null,
      px: Math.round(g.player.x), py: Math.round(g.player.y),
      hp: Math.round(g.player.hp), dialog: g.dialogOpen,
      completed: g.runner.completedCount, out,
    };
  });
  console.log(`${t + 1}s`, JSON.stringify(s));
  if (s.completed >= 1 || s.screen === 'over') break;
}
await browser.close();
server.kill();
