// traffic.js — ambient traffic + parked cars. Traffic follows the road
// graph, picks a new random junction destination when it arrives, and
// slows behind the car ahead. Parked cars line the roads for stealing.

import { makeCar, followRoute, ensureRoute } from './vehicles.js';
import { roadCoord, nearestJunction } from './world.js';
import { createRandom } from './random.js';

const TRAFFIC_TYPES = ['sedan', 'sedan', 'taxi', 'truck', 'sports'];

export function createTraffic(rng, world) {
  const cars = [];
  const parked = [];

  function randomJunctionPoint() {
    const i = Math.floor(rng() * 8), j = Math.floor(rng() * 8);
    return { x: roadCoord(i), y: roadCoord(j) };
  }
  function spawnTrafficCar() {
    const p = randomJunctionPoint();
    const car = makeCar(TRAFFIC_TYPES[Math.floor(rng() * TRAFFIC_TYPES.length)], p.x, p.y, rng() * Math.PI * 2);
    car.cruise = car.topSpeed * (0.45 + rng() * 0.2);
    car.dest = randomJunctionPoint();
    car.route = null; car.routeDest = null;
    car.isTraffic = true;
    cars.push(car);
    return car;
  }
  function spawnParked() {
    const i = Math.floor(rng() * 8), j = Math.floor(rng() * 8);
    const along = roadCoord(i) + (rng() - 0.5) * 300;
    const side = rng() < 0.5 ? 46 : -46;
    const horizontal = rng() < 0.5;
    const x = horizontal ? along : roadCoord(i) + side;
    const y = horizontal ? roadCoord(j) + side : along;
    if (world.pointInBuilding(x, y)) return;
    const type = TRAFFIC_TYPES[Math.floor(rng() * TRAFFIC_TYPES.length)];
    const car = makeCar(type, x, y, horizontal ? (side > 0 ? 0 : Math.PI) : (side > 0 ? Math.PI / 2 : -Math.PI / 2));
    car.parked = true;
    parked.push(car);
    return car;
  }

  for (let n = 0; n < 14; n++) spawnTrafficCar();
  for (let n = 0; n < 22; n++) spawnParked();

  function carAhead(car, all) {
    // Nearest car roughly ahead within 90 units and a narrow cone.
    let best = null, bestD = 90;
    for (const o of all) {
      if (o === car) continue;
      const dx = o.x - car.x, dy = o.y - car.y, d = Math.hypot(dx, dy);
      if (d < 12 || d > bestD) continue;
      const ang = Math.atan2(dy, dx);
      let diff = ang - car.angle;
      while (diff > Math.PI) diff -= Math.PI * 2;
      while (diff < -Math.PI) diff += Math.PI * 2;
      if (Math.abs(diff) < 0.5) { best = o; bestD = d; }
    }
    return best;
  }

  function update(dt, playerCar, extraCars) {
    const all = [...cars, ...parked.filter((c) => !c.parked || c.stolen), ...(extraCars || [])];
    if (playerCar) all.push(playerCar);
    for (const car of cars) {
      if (Math.hypot(car.dest.x - car.x, car.dest.y - car.y) < 50) {
        car.dest = randomJunctionPoint();
        car.route = null; car.routeDest = null;
      }
      const ahead = carAhead(car, all);
      const cruise = ahead ? Math.min(car.cruise, 60) : car.cruise;
      followRoute(car, car.dest.x, car.dest.y, dt, world, { cruise, arrive: 40 });
    }
    // Parked cars never move on their own.
    return cars;
  }

  function nearestParked(x, y, maxDist) {
    let best = null, bestD = maxDist;
    for (const c of parked) {
      if (!c.parked) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bestD) { best = c; bestD = d; }
    }
    return best;
  }

  return {
    cars, parked, spawnTrafficCar, spawnParked, update, nearestParked,
    allCars() { return [...cars, ...parked]; },
  };
}
