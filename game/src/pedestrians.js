// pedestrians.js — people on the sidewalks. They walk along the roads,
// vary in colour and speed (some in pairs), and flee when scared
// (gunfire, a speeding car, or a wanted chase nearby).

import { roadCoord, nearestRoadPoint } from './world.js';

const SHIRT_COLORS = ['#d94f4f', '#4f7fd9', '#4fd98a', '#d9b84f', '#9b59d9', '#e07b39', '#39c0d9', '#e5e5e5'];

export function createPedestrians(rng, world) {
  const peds = [];
  function spawnOne(x, y) {
    const rp = nearestRoadPoint(x ?? roadCoord(Math.floor(rng() * 8)), y ?? roadCoord(Math.floor(rng() * 8)));
    peds.push({
      x: rp.x + (rng() - 0.5) * 90, y: rp.y + (rng() - 0.5) * 90,
      angle: rng() * Math.PI * 2, speed: 42 + rng() * 38,
      color: SHIRT_COLORS[Math.floor(rng() * SHIRT_COLORS.length)],
      fleeing: false, fleeTimer: 0, targetAngle: rng() * Math.PI * 2,
      retargetTimer: 1 + rng() * 3,
    });
  }
  for (let n = 0; n < 46; n++) spawnOne();
  // A few pairs walk together.
  for (let n = 0; n < 6; n++) {
    const a = peds[Math.floor(rng() * peds.length)];
    if (a) spawnOne(a.x + 18, a.y + 10);
  }

  function scare(x, y, radius) {
    for (const p of peds) {
      if (Math.hypot(p.x - x, p.y - y) < radius) {
        p.fleeing = true; p.fleeTimer = 2.5 + rng() * 2;
      }
    }
  }

  function update(dt, player, playerCar) {
    for (const p of peds) {
      if (p.fleeTimer > 0) {
        p.fleeTimer -= dt;
        if (p.fleeTimer <= 0) p.fleeing = false;
      }
      // A fast car nearby scares pedestrians.
      if (playerCar && Math.abs(playerCar.speed) > 200 &&
          Math.hypot(p.x - playerCar.x, p.y - playerCar.y) < 120) {
        p.fleeing = true; p.fleeTimer = 2;
      }
      const speed = p.fleeing ? p.speed * 2.6 : p.speed;
      p.retargetTimer -= dt;
      if (p.retargetTimer <= 0) {
        p.retargetTimer = 2 + rng() * 3;
        if (p.fleeing) {
          // Run away from the player.
          p.targetAngle = Math.atan2(p.y - player.y, p.x - player.x) + (rng() - 0.5) * 0.8;
        } else {
          // Wander along the sidewalk: pick a road direction.
          p.targetAngle = Math.floor(rng() * 4) * (Math.PI / 2);
        }
      }
      let d = p.targetAngle - p.angle;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      p.angle += Math.max(-2.4 * dt, Math.min(2.4 * dt, d));
      const nx = p.x + Math.cos(p.angle) * speed * dt;
      const ny = p.y + Math.sin(p.angle) * speed * dt;
      const fixed = world.collideCircle(nx, ny, 12);
      p.x = Math.max(10, Math.min(3190, fixed.x));
      p.y = Math.max(10, Math.min(3190, fixed.y));
      if (p.x > 3050) p.x = 3050; // stay off the water
    }
  }
  return { peds, update, scare };
}
