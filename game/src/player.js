// player.js — Rook on foot and in a car. On foot: WASD/arrows move,
// mouse aim, click shoot, Shift sprint. Driving: E enter/exit, steal
// parked cars, carjack traffic cars (the driver flees).

import { PLAYER_FOOT_SPEED, PLAYER_SPRINT_SPEED, PLAYER_HP, WORLD_SIZE } from './config.js';
import { nearestRoadPoint } from './world.js';

// Factory: returns the state object itself with methods attached.
export function makePlayer(world, startX, startY) {
  const state = {
    x: startX ?? 600, y: startY ?? 600, angle: 0, aimAngle: 0,
    vx: 0, vy: 0, hp: PLAYER_HP, cash: 200,
    inCar: null, dead: false, caught: false,
  };
  state.updateOnFoot = (dt, move, aimAngle, sprint) => {
    state.aimAngle = aimAngle;
    const len = Math.hypot(move.x, move.y);
    const speed = sprint ? PLAYER_SPRINT_SPEED : PLAYER_FOOT_SPEED;
    if (len > 0) {
      state.vx = (move.x / len) * speed;
      state.vy = (move.y / len) * speed;
      state.angle = Math.atan2(move.y, move.x);
    } else { state.vx = 0; state.vy = 0; }
    const fixed = world.collideCircle(state.x + state.vx * dt, state.y + state.vy * dt, 14);
    state.x = Math.max(12, Math.min(WORLD_SIZE - 12, fixed.x));
    state.y = Math.max(12, Math.min(WORLD_SIZE - 12, fixed.y));
    if (state.x > 3052) state.x = 3052;
  };
  state.tryEnterCar = (cars, police, pedestrians, preferred = null) => {
    let best = null, bestD = 70;
    // A caller that already chose a specific car (the autopilot
    // stealing a faster parked car) must get THAT car: picking the
    // nearest car instead re-enters the slow car the player just
    // exited — exit -> re-enter -> exit forever, the car never
    // drives (m5 arc stall). The preferred car only wins inside the
    // normal 70u enter radius.
    if (preferred && Math.hypot(preferred.x - state.x, preferred.y - state.y) < 70) {
      best = preferred;
    } else {
      for (const c of cars) {
        const d = Math.hypot(c.x - state.x, c.y - state.y);
        if (d < bestD) { best = c; bestD = d; }
      }
    }
    if (!best) return null;
    const wasParked = best.parked;
    const wasTraffic = !!best.isTraffic;
    state.inCar = best;
    best.parked = false; best.stolen = true;
    // A new driver gets a fresh route: a patrol car (or any car
    // carrying a stale route) would otherwise drive to its old
    // destination, "arrive" there, and never follow the new target.
    best.route = null; best.routeIndex = 0; best.routeDest = null;
    best.stuckTimer = 0; best.reverseTimer = 0; best.lastX = best.x; best.lastY = best.y;
    if (wasTraffic) {
      if (pedestrians) pedestrians.scare(best.x, best.y, 120);
      if (police) police.addHeat(8);
    } else if (wasParked) {
      if (police) police.addHeat(6);
    }
    state.x = best.x; state.y = best.y;
    return best;
  };
  state.exitCar = () => {
    if (!state.inCar) return null;
    const car = state.inCar;
    state.inCar = null;
    car.speed = 0;
    // A car Rook steps out of is parked at the roadside again: it must
    // stay findable by the parked-car search (otherwise the autopilot
    // can strand itself on foot next to its own car — the m7 stall,
    // where every nearby car had already been stolen once).
    // Parked cars never move on their own (traffic.update), so this
    // cannot make the car drive away.
    car.parked = true;
    const side = car.angle + Math.PI / 2;
    const fixed = world.collideCircle(car.x + Math.cos(side) * 30, car.y + Math.sin(side) * 30, 14);
    state.x = fixed.x; state.y = fixed.y;
    return car;
  };
  state.damage = (amount) => { state.hp = Math.max(0, state.hp - amount); if (state.hp <= 0) state.dead = true; };
  state.heal = (amount) => { state.hp = Math.min(PLAYER_HP, state.hp + amount); };
  state.reset = (x, y) => { state.x = x; state.y = y; state.hp = PLAYER_HP; state.dead = false; state.caught = false; state.inCar = null; };
  return state;
}
