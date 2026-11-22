// autopilot.js — drives the playtest + screenshot poses and must complete
// m1–m8 end to end. On foot it walks via the road graph (memoized walk
// target, recompute only when the target moves >120). It leaves a slow
// car for a much faster parked car nearby (current top speed <350 for
// go-to / <430 for chase, faster parked car within 200/320). Chase:
// cruise 520 vs courier 380, ram within 70 at speed >120, each hit cuts
// the courier cruise to 55%. Escape: drive to the Spray Shop. Shootout:
// walk to the nearest enemy, aimed bursts every 0.45s, arena ammo at
// ammo <= 6, pick up a better weapon crate in the arena (m10). Garage
// (m11): drive to the garage, open the menu, buy the cheapest upgrade,
// close, continue. Helicopter: never stop under the spotlight — keep
// moving toward the objective.

import { followRoute, ensureRoute, driveToward, recoverToRoad } from './vehicles.js';
import { findRoute, nearestRoadPoint, nearestJunction, isOnRoad } from './world.js';
import { AMMO_LOW_THRESHOLD } from './weapons.js';
import { SPRAY_SHOP } from './config.js';
import { LANDMARKS } from './world.js';

export function createAutopilot(game) {
  const ap = {
    enabled: false,
    walkTarget: null, walkTargetFor: null,
    walkRoute: null, walkRouteIndex: 0, targetCar: null,
    fireTimer: 0, dialogCooldown: 0,
  };

  function memoWalkTarget(target) {
    if (!ap.walkTargetFor || Math.hypot(target.x - ap.walkTargetFor.x, target.y - ap.walkTargetFor.y) > 120) {
      ap.walkTarget = { x: target.x, y: target.y };
      ap.walkTargetFor = { x: target.x, y: target.y };
      // Recompute the walk route ONCE per target (sticky index below);
      // re-scanning the route every frame oscillates at the waypoint
      // radius boundary (player steps in, waypoint flips, steps back).
      ap.walkRoute = null;
      ap.walkRouteIndex = 0;
    }
    return ap.walkTarget;
  }

  function nearestParkedFaster(x, y, minTopSpeed, maxDist) {
    // Cache the chosen car: re-picking every frame flips the target
    // between two near cars and the walk route resets each time.
    if (ap.targetCar && ap.targetCar.parked && ap.targetCar.topSpeed > minTopSpeed &&
        Math.hypot(ap.targetCar.x - x, ap.targetCar.y - y) < maxDist + 200) {
      return ap.targetCar;
    }
    let best = null, bestD = maxDist;
    for (const c of game.traffic.parked) {
      if (!c.parked) continue;
      if (c.topSpeed <= minTopSpeed) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) { best = c; bestD = d; }
    }
    ap.targetCar = best;
    return best;
  }

  // Returns a virtual input for this frame: {move, aimAngle, fire, enterCar,
  // exitCar, confirm, steerTarget}.
  function step(dt, objective) {
    const g = game;
    const out = { move: { x: 0, y: 0 }, aimAngle: g.player.aimAngle, fire: false, enterCar: false, exitCar: false, confirm: false, drive: null, garageAction: false };
    ap.dialogCooldown -= dt;
    ap.fireTimer -= dt;

    // Dialog first: the autopilot must be able to press E to accept a
    // mission before any car search runs (m2 freeze fix).
    if (g.dialogOpen) {
      if (ap.dialogCooldown <= 0) { out.confirm = true; ap.dialogCooldown = 0.5; }
      return out;
    }
    if (!objective) return out;

    const player = g.player;
    const car = player.inCar;
    if (car) ap.targetCar = null; // no longer hunting a parked car
    const kind = objective.kind;

    // --- Shootout: on foot, walk to the nearest enemy, aimed bursts.
    if (kind === 'shootout') {
      if (car) { out.exitCar = true; return out; }
      const enemy = g.nearestEnemy();
      // Arena ammo at <= 6, better weapon crate in the arena (m10).
      const ammo = g.weapons.ammo[g.weapons.current];
      const arenaAmmo = g.nearestArenaAmmo && ammo <= AMMO_LOW_THRESHOLD ? g.nearestArenaAmmo() : null;
      const crate = g.nearestArenaCrate ? g.nearestArenaCrate() : null;
      let target = null;
      if (arenaAmmo) target = arenaAmmo;
      else if (crate && !g.weapons.has(crate.weaponId)) target = crate;
      else if (enemy) target = enemy;
      else target = { x: objective.x, y: objective.y };
      walkTo(out, target, dt);
      if (enemy) {
        const d = Math.hypot(enemy.x - player.x, enemy.y - player.y);
        out.aimAngle = Math.atan2(enemy.y - player.y, enemy.x - player.x);
        if (d < 480 && ap.fireTimer <= 0) { out.fire = true; ap.fireTimer = 0.45; }
      }
      return out;
    }

    // --- Ram chase (m2): cruise 520 vs courier 380.
    if (kind === 'ram') {
      const courier = g.courier;
      if (!courier) return out;
      if (!car) {
        const parked = nearestParkedFaster(player.x, player.y, 0, 400);
        if (parked) { walkTo(out, parked, dt); if (Math.hypot(parked.x - player.x, parked.y - player.y) < 60) out.enterCar = true; return out; }
        walkTo(out, nearestRoadPoint(courier.x, courier.y), dt);
        return out;
      }
      if (car.topSpeed < 430) {
        const faster = nearestParkedFaster(car.x, car.y, car.topSpeed, 320);
        if (faster) { out.exitCar = true; return out; }
      }
      out.drive = { x: courier.x, y: courier.y, cruise: 520, chase: true };
      return out;
    }

    // --- Escape (m7): drive to the Spray Shop.
    if (kind === 'escape') {
      if (!car) {
        const parked = nearestParkedFaster(player.x, player.y, 0, 400);
        if (parked) { walkTo(out, parked, dt); if (Math.hypot(parked.x - player.x, parked.y - player.y) < 60) out.enterCar = true; return out; }
        // No car nearby (every car here was already stolen once):
        // walk to the Spray Shop on foot — never stand still under
        // wanted stars. Rook on foot (210) outwalks a foot cop (165),
        // and the shop radius drains heat even on foot.
        walkTo(out, SPRAY_SHOP, dt);
        return out;
      }
      out.drive = { x: SPRAY_SHOP.x, y: SPRAY_SHOP.y, cruise: car.topSpeed, arrive: 60 };
      return out;
    }

    // --- Garage step (m11): drive to the garage, open the menu, buy the
    // cheapest upgrade, close, continue. The garage module (Builder B-2)
    // registers itself on game.garage; until then the step waits at the door.
    if (kind === 'garage') {
      if (!car) {
        const parked = nearestParkedFaster(player.x, player.y, 0, 400);
        if (parked) { walkTo(out, parked, dt); if (Math.hypot(parked.x - player.x, parked.y - player.y) < 60) out.enterCar = true; return out; }
        // No car nearby: walk to the garage on foot — never stand still.
        walkTo(out, LANDMARKS.garage, dt);
        return out;
      }
      const d = Math.hypot(LANDMARKS.garage.x - car.x, LANDMARKS.garage.y - car.y);
      if (d > 70) { out.drive = { x: LANDMARKS.garage.x, y: LANDMARKS.garage.y, cruise: car.topSpeed, arrive: 60 }; return out; }
      // In the zone: the main loop opens the menu, buys the cheapest
      // upgrade and closes it (garage.buyCheapest with car + cash).
      out.garageAction = true;
      return out;
    }

    // --- Go-to (goto / checkpoints / collect / default): drive if far.
    const dist = Math.hypot(objective.x - player.x, objective.y - player.y);
    if (!car && dist > 320) {
      const parked = nearestParkedFaster(player.x, player.y, 0, 400);
      if (parked) {
        walkTo(out, parked, dt);
        if (Math.hypot(parked.x - player.x, parked.y - player.y) < 60) out.enterCar = true;
        return out;
      }
      walkTo(out, objective, dt);
      return out;
    }
    if (car) {
      // Prefer a much faster parked car nearby over a slow current car.
      if (car.topSpeed < 350) {
        const faster = nearestParkedFaster(car.x, car.y, car.topSpeed, 200);
        if (faster) { out.exitCar = true; return out; }
      }
      if (dist < 70) { out.exitCar = true; return out; }
      out.drive = { x: objective.x, y: objective.y, cruise: car.topSpeed, arrive: 46 };
      return out;
    }
    // On foot, close in.
    walkTo(out, objective, dt);
    return out;
  }

  // Walk toward a target via the road graph: first to the nearest road
  // point, then along roads, final leg on foot. Memoized (spec §1).
  function walkTo(out, target, dt) {
    const player = game.player;
    const t = memoWalkTarget(target);
    const d = Math.hypot(t.x - player.x, t.y - player.y);
    if (d < 18) { out.move = { x: 0, y: 0 }; return; }
    let dest = t;
    if (!isOnRoad(player.x, player.y) && d > 120) {
      dest = nearestRoadPoint(player.x, player.y);
    } else if (d > 160) {
      // Route along the graph to the target's junction, then the last leg.
      // Sticky index: advance only when a waypoint is reached, never
      // re-pick the "first far waypoint" every frame.
      if (!ap.walkRoute) {
        ap.walkRoute = findRoute(player.x, player.y, t.x, t.y);
        ap.walkRouteIndex = 0;
      }
      while (ap.walkRouteIndex < ap.walkRoute.length &&
             Math.hypot(ap.walkRoute[ap.walkRouteIndex].x - player.x, ap.walkRoute[ap.walkRouteIndex].y - player.y) < 30) {
        ap.walkRouteIndex += 1;
      }
      if (ap.walkRouteIndex < ap.walkRoute.length) dest = ap.walkRoute[ap.walkRouteIndex];
    }
    const dx = dest.x - player.x, dy = dest.y - player.y;
    const len = Math.hypot(dx, dy) || 1;
    out.move = { x: dx / len, y: dy / len };
    out.aimAngle = Math.atan2(dy, dx);
  }

  // NOTE: `enabled` is a live getter — a spread snapshot would freeze it
  // at false forever and the main loop would never run the autopilot.
  // debugState() exposes the autopilot's caches for playtest probes
  // (memoized walk target, sticky route index, cached target car).
  function debugState() {
    return {
      enabled: ap.enabled,
      walkTarget: ap.walkTarget ? { ...ap.walkTarget } : null,
      walkTargetFor: ap.walkTargetFor ? { ...ap.walkTargetFor } : null,
      walkRouteLength: ap.walkRoute ? ap.walkRoute.length : null,
      walkRouteIndex: ap.walkRouteIndex,
      targetCar: ap.targetCar
        ? { x: Math.round(ap.targetCar.x), y: Math.round(ap.targetCar.y),
            parked: !!ap.targetCar.parked, topSpeed: ap.targetCar.topSpeed }
        : null,
    };
  }
  return { get enabled() { return ap.enabled; }, step, setEnabled(v) { ap.enabled = v; }, debugState };
}
