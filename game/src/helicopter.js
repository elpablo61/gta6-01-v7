// helicopter.js — police helicopter (Act 2, spec section 3.1).
//
// Behaviour, in plain terms:
//  * Appears when wanted is 3 stars or more (or when a mission script
//    asks for it, e.g. m9 / m12). Faster than any car, so Rook cannot
//    outrun it — only outlast it or shoot it down.
//  * Shadows Rook from above, keeping a small hover offset so it never
//    sits exactly on top of the player sprite.
//  * Paints a visible spotlight circle on the ground that follows Rook.
//    While the spotlight is on Rook, wanted heat does NOT decay —
//    hiding under it is impossible, so the only answer is keep moving.
//  * Never shoots. Rook can shoot it: enough damage makes it smoke and
//    retreat for 20 seconds; it comes back if wanted is still 3+.
//  * Leaves for good when wanted drops below 3 stars.
//  * Drawn with a ground shadow plus a spinning rotor blur.
//
// Integration: the base main loop owns one PoliceHelicopter, calls
// update(dt, player, wantedStars) every frame, asks blocksHeatDecay()
// before decaying heat, and calls draw(ctx, camera) in the render pass.
// Shooting it goes through damage(amount) — the base combat code calls
// that when a player bullet's line passes near the helicopter's ground
// position. No other module is imported; the class is standalone.

export const HELICOPTER_MIN_WANTED = 3;
export const HELICOPTER_SPEED = 720; // faster than any car (cars top out ~520)
export const HELICOPTER_RETREAT_SECONDS = 20;
export const HELICOPTER_DAMAGE_TO_RETREAT = 60; // ~4 pistol hits / 6 SMG hits
export const HELICOPTER_SPOTLIGHT_RADIUS = 130;
export const HELICOPTER_HOVER_OFFSET_X = -48;
export const HELICOPTER_HOVER_OFFSET_Y = -72;

export class PoliceHelicopter {
  constructor() {
    this.state = 'inactive'; // inactive | shadowing | retreating | leaving
    this.x = 0;
    this.y = 0;
    this.z = 220; // visual height only; ground pos is x/y
    this.rotorAngle = 0;
    this.damageTaken = 0;
    this.retreatTimer = 0;
    this.spotX = 0;
    this.spotY = 0;
    this.smoking = false;
    this.active = false;
  }

  get isUp() {
    return this.state === 'shadowing' || this.state === 'retreating';
  }

  // The spotlight counts as "on Rook" while shadowing; while retreating
  // the light is off (it has pulled away) so heat may decay again.
  blocksHeatDecay() {
    return this.state === 'shadowing';
  }

  spotlightPosition() {
    return { x: this.spotX, y: this.spotY };
  }

  spawnNear(player) {
    // Arrive from off-screen north-west so the player sees it come in.
    this.x = player.x - 500;
    this.y = player.y - 500;
    this.state = 'shadowing';
    this.active = true;
    this.damageTaken = 0;
    this.smoking = false;
    this.retreatTimer = 0;
    this.spotX = player.x;
    this.spotY = player.y;
  }

  // Mission scripts (m9, m12) force the helicopter up even if the
  // wanted level was just set by the mission itself.
  forceSpawn(player) {
    if (this.state === 'inactive' || this.state === 'leaving') this.spawnNear(player);
  }

  damage(amount) {
    if (this.state !== 'shadowing') return false;
    this.damageTaken += amount;
    if (this.damageTaken >= HELICOPTER_DAMAGE_TO_RETREAT) {
      this.state = 'retreating';
      this.retreatTimer = HELICOPTER_RETREAT_SECONDS;
      this.smoking = true;
      return true; // it is now smoking and pulling away
    }
    return false;
  }

  update(dt, player, wantedStars) {
    this.rotorAngle += dt * 28;
    if (this.state === 'inactive') return;

    if (wantedStars < HELICOPTER_MIN_WANTED && this.state !== 'retreating') {
      // Wanted fell: fly away and switch off.
      this.state = 'leaving';
    }

    if (this.state === 'shadowing') {
      // Chase the hover point above Rook; faster than any car.
      const tx = player.x + HELICOPTER_HOVER_OFFSET_X;
      const ty = player.y + HELICOPTER_HOVER_OFFSET_Y;
      const dx = tx - this.x;
      const dy = ty - this.y;
      const dist = Math.hypot(dx, dy);
      const step = Math.min(dist, HELICOPTER_SPEED * dt);
      if (dist > 0.01) {
        this.x += (dx / dist) * step;
        this.y += (dy / dist) * step;
      }
      // Spotlight lags slightly behind the helicopter and tracks Rook.
      this.spotX += (player.x - this.spotX) * Math.min(1, dt * 6);
      this.spotY += (player.y - this.spotY) * Math.min(1, dt * 6);
    } else if (this.state === 'retreating') {
      // Pull away from Rook while smoking, then either come back or go.
      const dx = this.x - player.x;
      const dy = this.y - player.y;
      const dist = Math.hypot(dx, dy) || 1;
      this.x += (dx / dist) * HELICOPTER_SPEED * 0.9 * dt;
      this.y += (dy / dist) * HELICOPTER_SPEED * 0.9 * dt;
      this.retreatTimer -= dt;
      if (this.retreatTimer <= 0) {
        this.smoking = false;
        this.damageTaken = 0;
        if (wantedStars >= HELICOPTER_MIN_WANTED) {
          this.state = 'shadowing';
        } else {
          this.state = 'leaving';
        }
      }
    } else if (this.state === 'leaving') {
      // Fly north-west off the map, then switch off.
      this.x -= HELICOPTER_SPEED * dt;
      this.y -= HELICOPTER_SPEED * dt;
      if (this.x < -600 || this.y < -600) {
        this.state = 'inactive';
        this.active = false;
        this.smoking = false;
        this.damageTaken = 0;
      }
    }
  }

  // Draw with a plain 2D context. camera is {x, y} (top-left of view).
  // Everything is drawn relative to the world position minus camera.
  draw(ctx, camera) {
    if (this.state === 'inactive') return;
    const sx = this.x - camera.x;
    const sy = this.y - camera.y;
    const groundX = this.x - camera.x;
    const groundY = this.y - camera.y + 26; // shadow sits slightly below

    // Spotlight cone on the ground while shadowing.
    if (this.state === 'shadowing') {
      const spx = this.spotX - camera.x;
      const spy = this.spotY - camera.y;
      const grad = ctx.createRadialGradient(spx, spy, 8, spx, spy, HELICOPTER_SPOTLIGHT_RADIUS);
      grad.addColorStop(0, 'rgba(255, 250, 200, 0.55)');
      grad.addColorStop(1, 'rgba(255, 250, 200, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(spx, spy, HELICOPTER_SPOTLIGHT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
      // Beam from helicopter down to the spotlight.
      ctx.strokeStyle = 'rgba(255, 250, 200, 0.18)';
      ctx.lineWidth = 10;
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(spx, spy);
      ctx.stroke();
    }

    // Ground shadow (dark ellipse, offset south-east: sun from north-west).
    ctx.fillStyle = 'rgba(20, 16, 60, 0.35)';
    ctx.beginPath();
    ctx.ellipse(groundX + 18, groundY + 14, 34, 16, 0, 0, Math.PI * 2);
    ctx.fill();

    // Smoke while retreating.
    if (this.smoking) {
      ctx.fillStyle = 'rgba(120, 120, 120, 0.5)';
      ctx.beginPath();
      ctx.arc(sx - 14 + Math.sin(this.rotorAngle * 2) * 4, sy + 10, 9, 0, Math.PI * 2);
      ctx.arc(sx - 22, sy + 18, 12, 0, Math.PI * 2);
      ctx.fill();
    }

    // Body: dark fuselage with a tail boom and skids.
    ctx.fillStyle = '#1c2733';
    ctx.beginPath();
    ctx.ellipse(sx, sy, 26, 13, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#1c2733';
    ctx.fillRect(sx + 20, sy - 4, 26, 8);
    ctx.fillStyle = '#31465c';
    ctx.beginPath();
    ctx.ellipse(sx - 8, sy - 3, 10, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    // Red/blue police light bar (the only red-blue flashing light in the game).
    const blink = Math.sin(this.rotorAngle * 3) > 0;
    ctx.fillStyle = blink ? '#ff2d2d' : '#2d7dff';
    ctx.fillRect(sx - 6, sy - 14, 12, 5);
    // Rotor blur: two long translucent blades rotating.
    ctx.strokeStyle = 'rgba(220, 230, 240, 0.55)';
    ctx.lineWidth = 3;
    const a = this.rotorAngle;
    ctx.beginPath();
    ctx.moveTo(sx - Math.cos(a) * 40, sy - Math.sin(a) * 40);
    ctx.lineTo(sx + Math.cos(a) * 40, sy + Math.sin(a) * 40);
    ctx.moveTo(sx - Math.cos(a + 1.57) * 40, sy - Math.sin(a + 1.57) * 40);
    ctx.lineTo(sx + Math.cos(a + 1.57) * 40, sy + Math.sin(a + 1.57) * 40);
    ctx.stroke();
  }
}
