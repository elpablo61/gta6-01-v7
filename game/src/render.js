// render.js — drawing only. The static city is pre-rendered once onto a
// 1600x1600 offscreen canvas (repainting the whole 3200x3200 city every
// frame stalls software rendering); each frame draws only the visible
// slice plus the dynamic entities. 2.5D buildings: roof + darker
// south/east sides, blue-purple shadows to the south-east (sun from the
// north-west). Day/night overlay, headlights, street-lamp light pools.

import { WORLD_SIZE, ROAD_COUNT, ROAD_WIDTH, PALETTE, FONT } from './config.js';
import { roadCoord, districtAt } from './world.js';
import { SPRAY_SHOP } from './config.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';
export const SCREEN_OVER = 'over';

const STATIC_SCALE = 0.5; // 3200 -> 1600

export function createRenderer(canvas, world) {
  const ctx = canvas.getContext('2d');
  const camera = { x: 0, y: 0 };
  let viewW = 1280, viewH = 720;

  // ---- static layer, drawn once ----
  const staticCanvas = document.createElement('canvas');
  staticCanvas.width = WORLD_SIZE * STATIC_SCALE;
  staticCanvas.height = WORLD_SIZE * STATIC_SCALE;
  buildStatic();

  function buildStatic() {
    const s = staticCanvas.getContext('2d');
    s.scale(STATIC_SCALE, STATIC_SCALE);
    s.fillStyle = PALETTE.grass;
    s.fillRect(0, 0, WORLD_SIZE, WORLD_SIZE);
    // District tints.
    for (let gx = 0; gx < 7; gx++) for (let gy = 0; gy < 7; gy++) {
      const d = districtAt(gx * 400 + 200, gy * 400 + 200);
      if (d.style === 'sand') { s.fillStyle = '#c9b183'; s.fillRect(gx * 400 + 232, gy * 400 + 232, 336, 336); }
      if (d.style === 'industrial') { s.fillStyle = '#4a4a42'; s.fillRect(gx * 400 + 232, gy * 400 + 232, 336, 336); }
    }
    // Beach + water east (x>3060).
    s.fillStyle = PALETTE.beach;
    s.fillRect(3000, 0, 60, WORLD_SIZE);
    s.fillStyle = PALETTE.water;
    s.fillRect(3060, 0, 140, WORLD_SIZE);
    // Marina / pier east.
    s.fillStyle = '#8a7a5e';
    s.fillRect(3000, 1760, 120, 26);
    s.fillRect(3060, 1700, 16, 160);
    // Roads + sidewalks.
    for (let i = 0; i < ROAD_COUNT; i++) {
      const c = roadCoord(i);
      s.fillStyle = PALETTE.sidewalk;
      s.fillRect(0, c - ROAD_WIDTH / 2 - 14, WORLD_SIZE, ROAD_WIDTH + 28);
      s.fillRect(c - ROAD_WIDTH / 2 - 14, 0, ROAD_WIDTH + 28, WORLD_SIZE);
      s.fillStyle = PALETTE.road;
      s.fillRect(0, c - ROAD_WIDTH / 2, WORLD_SIZE, ROAD_WIDTH);
      s.fillRect(c - ROAD_WIDTH / 2, 0, ROAD_WIDTH, WORLD_SIZE);
      // Centre dashes.
      s.fillStyle = PALETTE.roadLine;
      for (let d = 0; d < WORLD_SIZE; d += 80) {
        s.fillRect(d, c - 2, 40, 4);
        s.fillRect(c - 2, d, 4, 40);
      }
    }
    // Buildings: shadow to the south-east, darker south/east sides, roof.
    for (const b of world.buildings) {
      s.fillStyle = PALETTE.shadow;
      s.fillRect(b.x + 12, b.y + 12, b.w, b.h);
      s.fillStyle = '#3d332a'; // south side
      s.fillRect(b.x, b.y + b.h - 10, b.w, 10);
      s.fillStyle = '#453a2e'; // east side
      s.fillRect(b.x + b.w - 10, b.y, 10, b.h);
      s.fillStyle = b.hue; // roof
      s.fillRect(b.x, b.y, b.w - 10, b.h - 10);
      s.fillStyle = 'rgba(255,255,255,0.12)';
      s.fillRect(b.x + 6, b.y + 6, b.w - 22, 8);
    }
    // District labels.
    s.font = `700 44px ${FONT}`;
    s.fillStyle = 'rgba(255,255,255,0.35)';
    s.textAlign = 'center';
    s.fillText('NORTHSIDE', 1600, 120);
    s.fillText('OLD TOWN', 700, 1300);
    s.fillText('DOWNTOWN', 2300, 1300);
    s.fillText('WATERFRONT', 1500, 2300);
    s.fillText('SOUTH DOCKS', 1500, 3050);
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    viewW = window.innerWidth; viewH = window.innerHeight;
    canvas.width = Math.round(viewW * ratio);
    canvas.height = Math.round(viewH * ratio);
    canvas.style.width = viewW + 'px';
    canvas.style.height = viewH + 'px';
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  }
  window.addEventListener('resize', resize);
  resize();

  function drawCar(c, isPlayerCar) {
    const x = c.x - camera.x, y = c.y - camera.y;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(c.angle);
    ctx.fillStyle = 'rgba(20,16,60,0.35)';
    ctx.fillRect(-c.def.length / 2 + 6, -c.def.width / 2 + 6, c.def.length, c.def.width);
    ctx.fillStyle = c.paint || c.color;
    ctx.fillRect(-c.def.length / 2, -c.def.width / 2, c.def.length, c.def.width);
    ctx.fillStyle = '#1d2733'; // windshield + rear window
    ctx.fillRect(c.def.length / 2 - 16, -c.def.width / 2 + 3, 8, c.def.width - 6);
    ctx.fillRect(-c.def.length / 2 + 6, -c.def.width / 2 + 3, 8, c.def.width - 6);
    if (c.type === 'police' || c.isPolice) {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(-6, -c.def.width / 2, 12, c.def.width);
      const blink = Math.floor(performance.now() / 300) % 2 === 0;
      ctx.fillStyle = blink ? '#ff2d2d' : '#2d7dff';
      ctx.fillRect(-4, -c.def.width / 2 - 2, 8, 5);
    }
    if (isPlayerCar) {
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 2;
      ctx.strokeRect(-c.def.length / 2 - 3, -c.def.width / 2 - 3, c.def.length + 6, c.def.width + 6);
    }
    ctx.restore();
  }

  function drawPerson(x, y, color, angle, radius = 12) {
    const sx = x - camera.x, sy = y - camera.y;
    ctx.fillStyle = 'rgba(20,16,60,0.35)';
    ctx.beginPath(); ctx.ellipse(sx + 4, sy + 5, radius, radius * 0.6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(sx, sy, radius, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#222';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(angle) * (radius + 6), sy + Math.sin(angle) * (radius + 6)); ctx.stroke();
  }

  function draw(game, screen) {
    const player = game.player;
    const focus = player.inCar || player;
    camera.x = Math.max(0, Math.min(WORLD_SIZE - viewW, focus.x - viewW / 2));
    camera.y = Math.max(0, Math.min(WORLD_SIZE - viewH, focus.y - viewH / 2));
    ctx.fillStyle = '#0c0e14';
    ctx.fillRect(0, 0, viewW, viewH);
    // Static slice.
    ctx.drawImage(staticCanvas,
      camera.x * STATIC_SCALE, camera.y * STATIC_SCALE, viewW * STATIC_SCALE, viewH * STATIC_SCALE,
      0, 0, viewW, viewH);
    const inView = (x, y, m = 80) => x > camera.x - m && x < camera.x + viewW + m && y > camera.y - m && y < camera.y + viewH + m;

    // Spray Shop zone.
    if (inView(SPRAY_SHOP.x, SPRAY_SHOP.y, 200)) {
      const sx = SPRAY_SHOP.x - camera.x, sy = SPRAY_SHOP.y - camera.y;
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.arc(sx, sy, SPRAY_SHOP.radius, 0, Math.PI * 2); ctx.stroke();
      ctx.setLineDash([]);
      ctx.font = `700 20px ${FONT}`;
      ctx.fillStyle = '#ffd34d';
      ctx.textAlign = 'center';
      ctx.fillText('SPRAY SHOP', sx, sy - SPRAY_SHOP.radius - 8);
    }
    // Fixer Garage zone + prompt (spec 3.3).
    if (game.garage) game.garage.draw(ctx, camera);
    // Objective marker (pulsing).
    const obj = game.objective;
    if (obj && inView(obj.x, obj.y, 100)) {
      const pulse = 1 + Math.sin(performance.now() / 250) * 0.15;
      const ox = obj.x - camera.x, oy = obj.y - camera.y;
      ctx.strokeStyle = '#ffd34d';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(ox, oy, 26 * pulse, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath(); ctx.arc(ox, oy, 6, 0, Math.PI * 2); ctx.fill();
    }
    // Weapon crates + ammo.
    for (const crate of game.crates || []) {
      if (crate.taken || !inView(crate.x, crate.y)) continue;
      const cx = crate.x - camera.x, cy = crate.y - camera.y;
      ctx.fillStyle = '#2e7d32';
      ctx.fillRect(cx - 14, cy - 14, 28, 28);
      ctx.fillStyle = '#fff';
      ctx.font = `700 16px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText(crate.weaponId === 'smg' ? 'SMG' : 'SG', cx, cy + 5);
    }
    for (const box of game.ammoBoxes || []) {
      if (box.taken || !inView(box.x, box.y)) continue;
      const bx = box.x - camera.x, by = box.y - camera.y;
      ctx.fillStyle = '#c9a227';
      ctx.fillRect(bx - 10, by - 10, 20, 20);
      ctx.fillStyle = '#222';
      ctx.font = `700 12px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('AMMO', bx, by + 4);
    }
    // Health packs in the arena (green cross boxes).
    for (const hp of game.healthPacks || []) {
      if (hp.taken || !inView(hp.x, hp.y)) continue;
      const hx = hp.x - camera.x, hy = hp.y - camera.y;
      ctx.fillStyle = '#2e7d32';
      ctx.fillRect(hx - 12, hy - 12, 24, 24);
      ctx.fillStyle = '#fff';
      ctx.fillRect(hx - 2, hy - 8, 4, 16);
      ctx.fillRect(hx - 8, hy - 2, 16, 4);
    }
    // Cars.
    for (const c of game.allCars || []) {
      if (inView(c.x, c.y)) drawCar(c, c === player.inCar);
    }
    // Pedestrians, foot cops, enemies.
    for (const p of game.peds || []) if (inView(p.x, p.y)) drawPerson(p.x, p.y, p.color, p.angle, 11);
    for (const cop of game.footCops || []) if (inView(cop.x, cop.y)) drawPerson(cop.x, cop.y, '#1c2733', 0, 12);
    for (const e of game.enemies || []) {
      if (!inView(e.x, e.y)) continue;
      drawPerson(e.x, e.y, '#b03030', e.angle, 13);
      ctx.fillStyle = '#222';
      ctx.fillRect(e.x - camera.x - 16, e.y - camera.y - 26, 32, 5);
      ctx.fillStyle = '#e5534b';
      ctx.fillRect(e.x - camera.x - 16, e.y - camera.y - 26, 32 * (e.hp / 36), 5);
    }
    // Bullets.
    ctx.fillStyle = '#ffe08a';
    for (const b of game.bullets || []) {
      if (!inView(b.x, b.y)) continue;
      ctx.beginPath(); ctx.arc(b.x - camera.x, b.y - camera.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    // Rook on foot.
    if (!player.inCar) {
      drawPerson(player.x, player.y, '#4fc3f7', player.aimAngle, 13);
      // Aim line.
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(player.x - camera.x, player.y - camera.y);
      ctx.lineTo(player.x - camera.x + Math.cos(player.aimAngle) * 40, player.y - camera.y + Math.sin(player.aimAngle) * 40);
      ctx.stroke();
    }
    // Helicopter (own draw: spotlight, shadow, rotor).
    if (game.helicopter) game.helicopter.draw(ctx, camera);

    // Night: darkness overlay + headlights + street-lamp pools.
    const night = game.nightFactor || 0;
    if (night > 0) {
      ctx.fillStyle = `rgba(8, 10, 30, ${0.55 * night})`;
      ctx.fillRect(0, 0, viewW, viewH);
      // Lamp pools at junctions.
      for (let i = 0; i < ROAD_COUNT; i++) for (let j = 0; j < ROAD_COUNT; j++) {
        const lx = roadCoord(i) - camera.x, ly = roadCoord(j) - camera.y;
        if (lx < -80 || lx > viewW + 80 || ly < -80 || ly > viewH + 80) continue;
        const g = ctx.createRadialGradient(lx, ly, 4, lx, ly, 90);
        g.addColorStop(0, `rgba(255, 220, 130, ${0.28 * night})`);
        g.addColorStop(1, 'rgba(255, 220, 130, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(lx, ly, 90, 0, Math.PI * 2); ctx.fill();
      }
      // Headlights for the player's car.
      const car = player.inCar;
      if (car) {
        const hx = car.x - camera.x, hy = car.y - camera.y;
        const g = ctx.createRadialGradient(hx, hy, 10, hx, hy, 260);
        g.addColorStop(0, `rgba(255, 240, 180, ${0.22 * night})`);
        g.addColorStop(1, 'rgba(255, 240, 180, 0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(hx + Math.cos(car.angle) * 90, hy + Math.sin(car.angle) * 90, 260, 0, Math.PI * 2); ctx.fill();
      }
    }
    return { camera, viewW, viewH };
  }

  return { draw, get camera() { return camera; }, get viewW() { return viewW; }, get viewH() { return viewH; } };
}
