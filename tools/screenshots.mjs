// tools/screenshots.mjs — Crescent Bay screenshot runner (Builder C, fresh).
//
// Reads shots.json (4 poses: cover, mission, night, start), stages each
// pose in the live game (?shot=<name>&seed=7), waits for
// window.__shotReady, and saves a JPEG (quality 80) into screenshots/.
// Every file must be <= 200 KiB; the dossier builder refuses more than
// 4 screenshots. Port 8932 (playtest uses 8931).

import { spawn } from 'node:child_process';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { chromium } from 'playwright';

const SHELL = `${process.env.HOME}/.cache/ms-playwright/chromium_headless_shell-1255/chrome-headless-shell-linux64/chrome-headless-shell`;
const PORT = 8932;
const BASE = `http://localhost:${PORT}`;
const SHOTS = JSON.parse(readFileSync('shots.json', 'utf8'));
const MAX_BYTES = 200 * 1024;

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

const browser = await chromium.launch({
  executablePath: SHELL,
  args: ['--no-sandbox', '--disable-gpu', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'],
});
const errors = [];
try {
  await startServer();
  for (const shot of SHOTS) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on('console', (m) => { if (m.type() === 'error') errors.push(`${shot.name}: ${m.text()}`); });
    page.on('pageerror', (e) => errors.push(`${shot.name}: ${e.message}`));
    await page.goto(`${BASE}/${shot.query}`, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__shotReady === true, { timeout: 30000 });
    await page.waitForTimeout(400);
    const buf = await page.screenshot({ type: 'jpeg', quality: 80 });
    writeFileSync(`screenshots/${shot.name}`, buf);
    const size = statSync(`screenshots/${shot.name}`).size;
    console.log(`${size <= MAX_BYTES ? 'PASS' : 'FAIL'}  ${shot.name} — ${size} bytes (limit ${MAX_BYTES})`);
    await page.close();
  }
} finally {
  await browser.close();
  if (server) server.kill();
}
if (errors.length) {
  console.log('console errors:', errors.join(' | '));
  process.exitCode = 1;
}
console.log('screenshots done.');
