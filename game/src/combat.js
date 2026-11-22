// combat.js — bullets and shootout enemies. Enemies use the pistol only
// (18 damage is the player's pistol; enemies hit for 6). A shootout needs
// a cop perimeter (police hold a ring — see police.js). Enemies spawn on
// roads, never inside building blocks.

import { makeArenaCrates, makeArenaAmmo } from './weapons.js';
import { nearestRoadPoint } from './world.js';

export const ENEMY_HP = 36;

export function createCombat(world) {
  const bullets = []; // {x,y,angle,speed,range,damage,fromPlayer,life}
  const enemies = []; // {x,y,hp,fireTimer,angle,arena}

  function fireBullet(x, y, angle, damage, range, fromPlayer) {
    bullets.push({ x, y, angle, speed: 900, range, damage, fromPlayer, travelled: 0 });
  }

  function spawnEnemy(x, y, arena) {
    // Never inside a building: snap to the nearest road point.
    const rp = nearestRoadPoint(x, y);
    enemies.push({ x: rp.x, y: rp.y, hp: ENEMY_HP, fireTimer: 1 + Math.random(), angle: 0, arena: arena || null });
    return enemies[enemies.length - 1];
  }

  function spawnArena(center, count, radius = 260) {
    const made = [];
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + 0.4;
      const x = center.x + Math.cos(a) * radius;
      const y = center.y + Math.sin(a) * radius;
      made.push(spawnEnemy(x, y, center));
    }
    return made;
  }

  // Step bullets + enemies. Returns events: {playerHit, enemiesKilled}.
  function update(dt, player, playerCar, onPlayerDamage, helicopter) {
    const events = { playerHit: 0, enemiesKilled: 0 };
    const px = playerCar ? playerCar.x : player.x;
    const py = playerCar ? playerCar.y : player.y;
    for (const b of bullets) {
      b.x += Math.cos(b.angle) * b.speed * dt;
      b.y += Math.sin(b.angle) * b.speed * dt;
      b.travelled += b.speed * dt;
    }
    // Hit tests.
    for (const b of bullets) {
      if (b.travelled > b.range) continue;
      if (b.fromPlayer) {
        for (const e of enemies) {
          if (e.hp > 0 && Math.hypot(e.x - b.x, e.y - b.y) < 20) {
            e.hp -= b.damage; b.travelled = b.range + 1;
            if (e.hp <= 0) events.enemiesKilled += 1;
            break;
          }
        }
        if (b.travelled <= b.range && helicopter && helicopter.isUp) {
          // Player bullets near the helicopter's ground position damage it.
          if (Math.hypot(helicopter.x - b.x, helicopter.y - b.y) < 70) {
            helicopter.damage(b.damage);
            b.travelled = b.range + 1;
          }
        }
        if (b.travelled <= b.range && world.pointInBuilding(b.x, b.y)) b.travelled = b.range + 1;
      } else if (!playerCar && Math.hypot(player.x - b.x, player.y - b.y) < 16) {
        onPlayerDamage(b.damage);
        events.playerHit += b.damage;
        b.travelled = b.range + 1;
      }
    }
    for (let i = bullets.length - 1; i >= 0; i--) if (bullets[i].travelled > bullets[i].range) bullets.splice(i, 1);
    // Enemies shoot the player (pistol only) when in range and line of
    // sight is clear of buildings.
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const d = Math.hypot(player.x - e.x, player.y - e.y);
      e.fireTimer -= dt;
      if (d < 460 && !playerCar && e.fireTimer <= 0) {
        e.fireTimer = 0.9 + Math.random() * 0.5;
        const a = Math.atan2(player.y - e.y, player.x - e.x) + (Math.random() - 0.5) * 0.16;
        fireBullet(e.x, e.y, a, 6, 460, false);
      }
      // Enemies shuffle sideways a little so they are not static targets.
      e.angle += dt * 0.6;
    }
    for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].hp <= 0) enemies.splice(i, 1);
    return events;
  }

  function clearArena() { enemies.length = 0; bullets.length = 0; }

  return { bullets, enemies, fireBullet, spawnEnemy, spawnArena, update, clearArena };
}

// Arena setup helper for missions: crates + ammo around an arena centre.
export function arenaSupplies(center) {
  const arena = { entrance: { x: center.x - 160, y: center.y }, approach: { x: center.x - 80, y: center.y + 120 }, center };
  return { crates: makeArenaCrates(arena), ammo: makeArenaAmmo(arena) };
}
