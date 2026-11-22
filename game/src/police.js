// police.js — wanted heat, stars, foot officers, patrol cars, roadblocks,
// arrest rule, and the Spray Shop. Heat 0-100; stars at [0,12,30,52,74,92].
// Heat decays while hiding (no police within 450 for 3s) unless the
// helicopter spotlight is on Rook. Arrest: a foot officer must stay
// within 30 of a slow on-foot player for 1.2s in a row; running breaks it.

import { WANTED_THRESHOLDS, HEAT_MAX, HEAT_DECAY_PER_SEC, HIDE_DISTANCE, HIDE_SECONDS, SPRAY_SHOP } from './config.js';
import { makeCar, followRoute, driveToward, angleDiff } from './vehicles.js';
import { roadCoord } from './world.js';

export function starsForHeat(heat) {
  let stars = 0;
  for (let i = 0; i < WANTED_THRESHOLDS.length; i++) if (heat >= WANTED_THRESHOLDS[i]) stars = i;
  return stars;
}

export function createPolice(world) {
  const state = {
    heat: 0, stars: 0, hideTimer: 0,
    footCops: [], patrolCars: [], roadblocks: [],
    arrestTimer: 0, spawnTimer: 0, roadblockTimer: 0,
  };

  function addHeat(amount) {
    state.heat = Math.max(0, Math.min(HEAT_MAX, state.heat + amount));
    state.stars = starsForHeat(state.heat);
  }
  function setHeat(value) {
    state.heat = Math.max(0, Math.min(HEAT_MAX, value));
    state.stars = starsForHeat(state.heat);
  }
  function clearHeat() { setHeat(0); }

  function spawnFootCopNear(x, y) {
    const a = Math.random() * Math.PI * 2;
    const d = 320 + Math.random() * 160;
    state.footCops.push({
      x: Math.max(40, Math.min(3160, x + Math.cos(a) * d)),
      y: Math.max(40, Math.min(3160, y + Math.sin(a) * d)),
      speed: 165, arrestHold: 0, hp: 30,
    });
  }
  function spawnPatrolNear(x, y) {
    const a = Math.random() * Math.PI * 2;
    const d = 420 + Math.random() * 200;
    const car = makeCar('police',
      Math.max(60, Math.min(3140, x + Math.cos(a) * d)),
      Math.max(60, Math.min(3140, y + Math.sin(a) * d)), 0);
    car.cruise = 470;
    car.isPolice = true;
    state.patrolCars.push(car);
    return car;
  }
  function makeRoadblock(x, y) {
    // Two patrol cars parked across the road ahead of the player.
    const cars = [];
    for (const off of [-40, 40]) {
      const car = makeCar('police', x + off, y, Math.PI / 2);
      car.isPolice = true; car.parked = true; car.isRoadblock = true;
      cars.push(car);
    }
    state.roadblocks.push({ x, y, cars, timer: 14 });
    return cars;
  }

  function nearestPoliceDist(x, y) {
    let best = Infinity;
    for (const c of state.footCops) best = Math.min(best, Math.hypot(c.x - x, c.y - y));
    for (const c of state.patrolCars) best = Math.min(best, Math.hypot(c.x - x, c.y - y));
    for (const rb of state.roadblocks) for (const c of rb.cars) best = Math.min(best, Math.hypot(c.x - x, c.y - y));
    return best;
  }

  // Returns 'caught' when an arrest completes, else null.
  function update(dt, player, playerCar, helicopter, opts = {}) {
    const px = playerCar ? playerCar.x : player.x;
    const py = playerCar ? playerCar.y : player.y;
    const inSprayShop = Math.hypot(px - SPRAY_SHOP.x, py - SPRAY_SHOP.y) < SPRAY_SHOP.radius;
    const spotlightBlocks = helicopter ? helicopter.blocksHeatDecay() : false;

    // Spawn pressure by stars.
    state.spawnTimer -= dt;
    const wantFoot = state.stars >= 1 ? Math.min(2 + state.stars, 6) : 0;
    const wantPatrol = state.stars >= 2 ? Math.min(state.stars, 4) : 0;
    if (state.spawnTimer <= 0) {
      state.spawnTimer = 1.2;
      if (state.footCops.length < wantFoot && state.stars >= 1) spawnFootCopNear(px, py);
      if (state.patrolCars.length < wantPatrol && state.stars >= 2) spawnPatrolNear(px, py);
    }
    if (state.stars >= 4) {
      state.roadblockTimer -= dt;
      if (state.roadblockTimer <= 0 && state.roadblocks.length < 2) {
        state.roadblockTimer = 9;
        const a = playerCar ? playerCar.angle : player.angle;
        makeRoadblock(px + Math.cos(a) * 520, py + Math.sin(a) * 520);
      }
    }
    // Trim excess when heat falls.
    while (state.footCops.length > wantFoot) state.footCops.pop();
    while (state.patrolCars.length > wantPatrol) state.patrolCars.pop();
    for (const rb of state.roadblocks) rb.timer -= dt;
    state.roadblocks = state.roadblocks.filter((rb) => rb.timer > 0 && state.stars >= 4);
    for (const rb of state.roadblocks) for (const c of rb.cars) c.parked = true;

    // Foot cops: chase on foot; hold a ring around a shootout, never pile
    // onto one spot (keep 90 units from each other by easing off).
    let caught = false;
    for (const cop of state.footCops) {
      const d = Math.hypot(player.x - cop.x, player.y - cop.y);
      const nearOther = state.footCops.some((o) => o !== cop && Math.hypot(o.x - cop.x, o.y - cop.y) < 60);
      const target = nearOther
        ? { x: cop.x + (cop.x - player.x) * 0.3, y: cop.y + (cop.y - player.y) * 0.3 }
        : { x: player.x, y: player.y };
      // Hold a ring at ~110 when the player is shooting (shootout perimeter).
      const wantDist = opts.shootout ? 110 : 0;
      const td = Math.hypot(target.x - cop.x, target.y - cop.y);
      if (td > wantDist + 20 || wantDist === 0) {
        const a = Math.atan2(target.y - cop.y, target.x - cop.x);
        cop.x += Math.cos(a) * cop.speed * dt;
        cop.y += Math.sin(a) * cop.speed * dt;
      }
      // Arrest: within 30 of a slow on-foot player for 1.2s in a row.
      if (!playerCar && d < 30 && Math.hypot(player.vx || 0, player.vy || 0) < 120) {
        cop.arrestHold += dt;
        if (cop.arrestHold >= 1.2) caught = true;
      } else cop.arrestHold = 0;
    }

    // Patrol cars: chase the player; brake + reverse within 130 of the
    // Spray Shop (they never follow Rook inside it).
    for (const car of state.patrolCars) {
      const dShop = Math.hypot(car.x - SPRAY_SHOP.x, car.y - SPRAY_SHOP.y);
      if (dShop < 130) {
        car.speed = Math.max(-120, car.speed - 400 * dt);
        car.x += Math.cos(car.angle) * car.speed * dt;
        car.y += Math.sin(car.angle) * car.speed * dt;
        continue;
      }
      // Ram the player's car; if the player is on foot, drive at them.
      const chaseCruise = playerCar ? 500 : 300;
      followRoute(car, px, py, dt, world, { cruise: chaseCruise, arrive: 26 });
      // Collision with the player's car: damage 3/s per car.
      if (playerCar && Math.hypot(car.x - playerCar.x, car.y - playerCar.y) < 44) {
        playerCar.collisionDamage = (playerCar.collisionDamage || 0) + 3 * dt;
        car.speed *= 0.9;
      }
    }

    // Heat decay while hiding — unless the spotlight is on Rook.
    if (state.heat > 0 && !spotlightBlocks) {
      if (nearestPoliceDist(px, py) > HIDE_DISTANCE) {
        state.hideTimer += dt;
        if (state.hideTimer >= HIDE_SECONDS) {
          state.heat = Math.max(0, state.heat - HEAT_DECAY_PER_SEC * dt);
          state.stars = starsForHeat(state.heat);
        }
      } else state.hideTimer = 0;
    }
    // Spray Shop: heat drains fast inside the radius.
    if (inSprayShop && state.heat > 0) {
      state.heat = Math.max(0, state.heat - SPRAY_SHOP.drainPerSec * dt);
      state.stars = starsForHeat(state.heat);
      state.hideTimer = 0;
    }
    if (state.heat <= 0 && state.stars !== 0) state.stars = 0;
    return caught ? 'caught' : null;
  }

  return { state, addHeat, setHeat, clearHeat, update, nearestPoliceDist, spawnFootCopNear, spawnPatrolNear };
}
