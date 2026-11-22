// vehicles.js — cars. Radius-based steering so a car can turn inside a
// 64-wide road; a turn sharper than ~52 degrees stops the car fully and
// rotates it in place, then it drives straight (a moving turning circle
// is wider than the road). Wall hits slide along the wall; wall damage
// ticks at most once per 0.5s. U-turns crawl at speed 60.

import { CAR_TYPES, WORLD_SIZE } from './config.js';
import { findRoute, nearestJunction, nearestRoadPoint } from './world.js';

export const SHARP_TURN_RADIANS = 0.9; // ~52 degrees
export const U_TURN_SPEED = 60;

export function angleDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export function makeCar(typeId, x, y, angle = 0) {
  const def = CAR_TYPES[typeId] || CAR_TYPES.sedan;
  return {
    id: Math.random().toString(36).slice(2, 9),
    type: typeId, def,
    x, y, angle, speed: 0,
    topSpeed: def.topSpeed, accel: def.accel,
    color: def.color, parked: false, driver: null,
    route: null, routeIndex: 0, routeDest: null,
    cruise: def.topSpeed, stuckTimer: 0, lastX: x, lastY: y,
    wallDamageTimer: 0, upgrades: { engine: 0, armor: 0, tires: 0, brakes: 0 },
    paint: null, reversing: false, reverseTimer: 0,
  };
}

export function applyUpgrades(car) {
  const u = car.upgrades || { engine: 0, armor: 0, tires: 0, brakes: 0 };
  car.topSpeed = car.def.topSpeed * (1 + 0.12 * u.engine);
  car.accel = car.def.accel * (1 + 0.1 * u.engine);
}

// Drive the car toward a target point. Returns nothing; mutates car.
// Handles: sharp-turn stop+rotate, braking before sharp turns, crawl
// U-turns, reversing to unwedge when stuck, and low-speed turn authority.
export function driveToward(car, tx, ty, dt, world, opts = {}) {
  const dx = tx - car.x, dy = ty - car.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 6) return true; // arrived
  const targetAngle = Math.atan2(dy, dx);
  const diff = angleDiff(car.angle, targetAngle);
  const absDiff = Math.abs(diff);

  // Stuck detection: barely moving while trying to drive.
  const moved = Math.hypot(car.x - car.lastX, car.y - car.lastY);
  if (Math.abs(car.speed) > 40 && moved < 2 * dt * 60 * 0.2) car.stuckTimer += dt;
  else car.stuckTimer = Math.max(0, car.stuckTimer - dt);
  car.lastX = car.x; car.lastY = car.y;
  if (car.stuckTimer > 1.2 && car.reverseTimer <= 0) {
    car.reverseTimer = 0.9; car.stuckTimer = 0;
  }
  if (car.reverseTimer > 0) {
    car.reverseTimer -= dt;
    car.speed = Math.max(car.speed - car.accel * dt, -140);
    moveCar(car, dt, world);
    return false;
  }

  // Sharp turn: stop fully, rotate in place, then drive straight.
  if (absDiff > SHARP_TURN_RADIANS && Math.abs(car.speed) > 30) {
    car.speed = approach(car.speed, 0, (opts.brake || car.def.brake) * dt * 1.6);
    moveCar(car, dt, world);
    return false;
  }
  if (absDiff > SHARP_TURN_RADIANS) {
    const turnRate = 3.2; // radians per second while rotating in place
    car.angle += Math.sign(diff) * Math.min(absDiff, turnRate * dt);
    car.speed = 0;
    return false;
  }

  // Brake ahead of a sharp turn that is coming up (next waypoint angle).
  let desired = opts.cruise ?? car.cruise ?? car.topSpeed;
  if (opts.nextAngle !== undefined) {
    const nextDiff = Math.abs(angleDiff(car.angle, opts.nextAngle));
    if (nextDiff > 0.6) desired = Math.min(desired, 140);
  }
  if (absDiff > 0.45) desired = Math.min(desired, 180);
  // U-turn crawl.
  if (absDiff > 2.6) desired = Math.min(desired, U_TURN_SPEED);

  if (car.speed < desired) car.speed = Math.min(desired, car.speed + car.accel * dt);
  else car.speed = Math.max(desired, car.speed - (opts.brake || car.def.brake) * dt);

  // Radius-based steering: turn rate = speed / turn radius, with a
  // guaranteed minimum turn authority even at low speed (crawl turns).
  const radius = Math.max(40, car.def.turnRadius * (1 - 0.15 * (car.upgrades?.tires || 0)));
  const maxTurn = Math.max(0.9, Math.abs(car.speed) / radius) * dt;
  car.angle += Math.sign(diff) * Math.min(absDiff, maxTurn);
  moveCar(car, dt, world);
  return dist < 14;
}

function approach(v, target, step) {
  if (v < target) return Math.min(target, v + step);
  if (v > target) return Math.max(target, v - step);
  return v;
}

// Integrate position, clamp to the world, slide along buildings/walls.
export function moveCar(car, dt, world) {
  const nx = car.x + Math.cos(car.angle) * car.speed * dt;
  const ny = car.y + Math.sin(car.angle) * car.speed * dt;
  // Try full move; if blocked, slide along one axis.
  const r = Math.max(car.def.length, car.def.width) / 2 - 4;
  const full = world.collideCircle(nx, ny, r);
  const blockedX = Math.abs(full.x - nx) > 0.5, blockedY = Math.abs(full.y - ny) > 0.5;
  if (!blockedX && !blockedY) { car.x = full.x; car.y = full.y; }
  else {
    const slideX = world.collideCircle(nx, car.y, r);
    const slideY = world.collideCircle(car.x, ny, r);
    if (Math.abs(slideX.x - nx) < Math.abs(slideY.y - ny)) { car.x = slideX.x; }
    else car.y = slideY.y;
    // Wall scrape: damage ticks at most once per 0.5s, 3/s per car.
    car.wallDamageTimer -= dt;
    if (car.wallDamageTimer <= 0 && Math.abs(car.speed) > 60) {
      car.wallDamageTimer = 0.5;
      car.wallDamage = (car.wallDamage || 0) + 1.5;
    }
  }
  car.x = Math.max(20, Math.min(WORLD_SIZE - 20, car.x));
  car.y = Math.max(20, Math.min(WORLD_SIZE - 20, car.y));
}

// Route following: route[0] is always the FIRST junction from the car's
// position. Rebuild only when the destination moved >100 from the
// recorded destination (never every frame).
export function ensureRoute(car, tx, ty) {
  if (!car.route || !car.routeDest ||
      Math.hypot(tx - car.routeDest.x, ty - car.routeDest.y) > 100) {
    car.route = findRoute(car.x, car.y, tx, ty);
    car.routeIndex = 0;
    car.routeDest = { x: tx, y: ty };
  }
  return car.route;
}

// Follow the route to (tx, ty); final leg drives straight to the target.
// Returns true when within `arrive` of the target.
export function followRoute(car, tx, ty, dt, world, opts = {}) {
  const route = ensureRoute(car, tx, ty);
  // Skip waypoints already reached.
  while (car.routeIndex < route.length) {
    const wp = route[car.routeIndex];
    if (Math.hypot(wp.x - car.x, wp.y - car.y) < 26) car.routeIndex += 1;
    else break;
  }
  let target, nextAngle;
  if (car.routeIndex < route.length) {
    target = route[car.routeIndex];
    const next = route[Math.min(car.routeIndex + 1, route.length - 1)];
    nextAngle = Math.atan2(next.y - target.y, next.x - target.x);
  } else {
    // Final leg: off the graph, straight to the target (clamped on-road
    // recovery: if off-road, head for the nearest road point first).
    target = { x: tx, y: ty };
    nextAngle = undefined;
  }
  const distToTarget = Math.hypot(tx - car.x, ty - car.y);
  if (distToTarget < (opts.arrive ?? 40)) return true;
  driveToward(car, target.x, target.y, dt, world, { ...opts, nextAngle });
  return false;
}

// Off-road recovery: head for the nearest road point, then the nearest
// junction — never aim at a centreline point outside the world edge.
export function recoverToRoad(car, dt, world) {
  const rp = nearestRoadPoint(car.x, car.y);
  const j = nearestJunction(rp.x, rp.y);
  if (Math.hypot(rp.x - car.x, rp.y - car.y) > 30) {
    driveToward(car, rp.x, rp.y, dt, world, { cruise: 160 });
    return false;
  }
  return Math.hypot(j.x - car.x, j.y - car.y) < 40;
}
