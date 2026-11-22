// tools/debug-freeze.mjs — probe the post-m1 freeze: after m1 completes,
// is stepFixed throwing every frame? Captures page errors, then calls
// stepFixed directly in a try/catch and reports the exception + state.

import { spawn } from 'node:child_process';
import { chromium } from 'playwright';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8937;
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
for (let t = 0; t < 60; t++) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await page.evaluate(() => {
    const g = window.__game.game;
    let stepTest = 'not-tested';
    try {
      g.stepFixed(1 / 60);
      stepTest = 'ok';
    } catch (e) {
      stepTest = `THROW: ${e.message} :: ${(e.stack || '').split('\n').slice(0, 4).join(' | ')}`;
    }
    return {
      mission: g.runner.activeDef?.id || null, completed: g.runner.completedCount,
      idx: g.missionIndex, px: Math.round(g.player.x), py: Math.round(g.player.y),
      inCar: !!g.player.inCar, dialog: g.dialogOpen, screen: g.screen,
      apEnabled: g.autopilot.enabled,
      ap: g.autopilot.debugState(),
      stepTest,
    };
  });
  console.log(`${t + 1}s`, JSON.stringify(s));
  if (s.completed >= 1 && t > 25) break;
}
await browser.close();
server.kill();
