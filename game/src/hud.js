// hud.js — canvas HUD: wanted stars (>=36px), objective banner (>=28px
// bold over a dark scrim, lower-left), minimap (>=180px, upper-right),
// thick health bar, big cash / speed / ammo. DOM overlays (title, pause,
// game over, mission dialog, controls) live in index.html.

import { FONT, PALETTE, WANTED_THRESHOLDS } from './config.js';

export function createHud() {
  function text(ctx, value, x, y, size, color, align = 'left', bold = false) {
    ctx.font = `${bold ? '700 ' : ''}${size}px ${FONT}`;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    ctx.fillText(value, x, y);
  }

  function drawStars(ctx, stars, x, y) {
    for (let i = 0; i < 5; i++) {
      ctx.font = '36px ' + FONT;
      ctx.fillStyle = i < stars ? '#ffd34d' : 'rgba(255,255,255,0.25)';
      ctx.textAlign = 'left';
      ctx.fillText('★', x + i * 40, y);
    }
  }

  function drawMinimap(ctx, game, size, x, y) {
    const scale = size / 3200;
    ctx.save();
    ctx.fillStyle = 'rgba(8, 10, 16, 0.85)';
    ctx.fillRect(x, y, size, size);
    ctx.strokeStyle = '#5a6272';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, size, size);
    // Roads.
    ctx.strokeStyle = '#8a8f9a';
    ctx.lineWidth = 2;
    for (let i = 0; i < 8; i++) {
      const c = (200 + i * 400) * scale;
      ctx.beginPath(); ctx.moveTo(x + c, y); ctx.lineTo(x + c, y + size); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x, y + c); ctx.lineTo(x + size, y + c); ctx.stroke();
    }
    // Water east.
    ctx.fillStyle = '#2a6d8f';
    ctx.fillRect(x + 3060 * scale, y, size - 3060 * scale, size);
    // Objective marker.
    const obj = game.objective;
    if (obj) {
      ctx.fillStyle = '#ffd34d';
      ctx.beginPath();
      ctx.arc(x + obj.x * scale, y + obj.y * scale, 7, 0, Math.PI * 2);
      ctx.fill();
    }
    // Player arrow.
    const p = game.player;
    const px = x + (p.inCar ? p.inCar.x : p.x) * scale;
    const py = y + (p.inCar ? p.inCar.y : p.y) * scale;
    ctx.fillStyle = '#4fc3f7';
    ctx.beginPath();
    ctx.arc(px, py, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  function draw(ctx, game, viewW, viewH) {
    const player = game.player;
    const car = player.inCar;
    // Wanted stars, top-left, >=36px.
    drawStars(ctx, game.stars, 20, 52);
    text(ctx, game.timeLabel || '', 20, 92, 22, PALETTE.text);
    // Health bar, thick, under the stars.
    const barW = 220, barH = 18;
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(20, 100, barW, barH);
    ctx.fillStyle = player.hp > 50 ? '#3fce6c' : player.hp > 25 ? '#e8b93c' : '#e5534b';
    ctx.fillRect(20, 100, barW * (player.hp / 100), barH);
    text(ctx, `HP ${Math.ceil(player.hp)}`, 230, 116, 20, PALETTE.text);
    // Cash + weapon/ammo, big, top-left under health.
    text(ctx, `$${Math.floor(player.cash)}`, 20, 158, 30, PALETTE.accent, 'left', true);
    text(ctx, game.weapons.hudText(), 20, 196, 26, PALETTE.text, 'left', true);
    // Speed, big, bottom-right.
    if (car) text(ctx, `${Math.round(Math.abs(car.speed) * 0.36)} km/h`, viewW - 24, viewH - 24, 30, PALETTE.text, 'right', true);
    // Minimap, >=180px, upper-right.
    drawMinimap(ctx, game, 190, viewW - 210, 16);
    // Radio station name + animated equalizer under the minimap.
    if (game.radio) game.radio.drawEqualizer(ctx, viewW - 210, 232);
    else if (game.radioStation) text(ctx, `♪ ${game.radioStation}`, viewW - 210, 232, 20, PALETTE.text);
    // Objective banner, >=28px bold over a dark scrim, lower-left.
    if (game.objective) {
      const label = game.objective.label;
      ctx.font = `700 28px ${FONT}`;
      const w = ctx.measureText(label).width + 32;
      ctx.fillStyle = 'rgba(8, 10, 16, 0.78)';
      ctx.fillRect(16, viewH - 96, w, 52);
      text(ctx, label, 32, viewH - 60, 28, '#ffffff', 'left', true);
      const timer = game.missionTimeLeft;
      if (timer !== null && timer !== undefined) {
        text(ctx, `${Math.ceil(timer)}s`, 32, viewH - 110, 22, timer < 30 ? '#ff6b6b' : PALETTE.text, 'left', true);
      }
    }
    // Toasts.
    let ty = 240;
    for (const t of game.toasts || []) {
      text(ctx, t, 20, ty, 22, '#ffffff');
      ty += 30;
    }
  }

  return { draw, drawStars, drawMinimap };
}
