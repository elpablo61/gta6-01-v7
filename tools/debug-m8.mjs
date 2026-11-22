// tools/debug-m8.mjs — probe the m8 shootout: why does Rook die on foot?
// Starts m8 directly (fresh page, autopilot on) and logs every second:
// pos, hp, enemies alive + nearest enemy, autopilot walk target/route,
// current weapon + ammo, bullets in flight.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8936;
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
  g.player.cash = 5000;
  g.teleport(2200, 2200);
  g.startMissionById('m8', { silent: true });
  g.autopilot.setEnabled(true);
});
for (let t = 0; t < 90; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate(() => {
    const g = window.__game.game;
    const e = g.nearestEnemy();
    const crate = g.nearestArenaCrate ? g.nearestArenaCrate() : null;
    const ammo = g.nearestArenaAmmo ? g.nearestArenaAmmo() : null;
    return {
      screen: g.screen,
      mission: g.runner.activeDef?.id, stage: g.runner.stage,
      inCar: !!g.player.inCar,
      px: Math.round(g.player.x), py: Math.round(g.player.y),
      hp: Math.round(g.player.hp), aimDeg: Math.round(g.player.aimAngle * 180 / Math.PI),
      weapon: g.weapons.current, ammo: g.weapons.ammo[g.weapons.current],
      enemies: g.combat.enemies.length,
      nearestEnemy: e ? `${Math.round(e.x)},${Math.round(e.y)} hp${e.hp}` : null,
      enemyDist: e ? Math.round(Math.hypot(e.x - g.player.x, e.y - g.player.y)) : null,
      crate: crate ? `${crate.weaponId}@${Math.round(crate.x)},${Math.round(crate.y)}` : null,
      ammoBox: ammo ? `${Math.round(ammo.x)},${Math.round(ammo.y)}` : null,
      bullets: g.combat.bullets.length,
      completed: g.runner.completedCount,
      ap: g.autopilot.debugState(),
    };
  });
  console.log(`${t + 1}s`, JSON.stringify(s));
  if (s.screen === 'over' || s.completed >= 1) break;
}
await browser.close();
server.kill();
