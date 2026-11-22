// living-city.js — living-city depth (Act 2, spec section 3.6, stretch).
//
// Behaviour, in plain terms:
//  * Pedestrian variety: a wider shirt-colour palette and a wider
//    walking-speed range (slow strollers to brisk walkers), and some
//    pedestrians walk in pairs — partners share a speed and stay near
//    each other instead of drifting apart.
//  * Parked-car colour variety: parked cars get one of 12 paint
//    colours instead of the 5 factory type colours, so a street of
//    parked cars no longer looks like a fleet.
//  * Traffic density varies by time of day: busy at midday, quiet at
//    night, in between at dawn and dusk. The controller spawns or
//    retires ambient traffic cars gradually toward the target count,
//    never in one big pop.
//
// Integration: the base owns one LivingCity and calls update(dt, game)
// once per fixed step (Builder C wiring, e.g. at the end of stepFixed
// next to the traffic / pedestrian updates). The controller only touches
// data the base already exposes — game.traffic (cars, parked,
// spawnTrafficCar), game.peds, game.timeOfDay — and it never edits the
// base files. It marks every car / pedestrian it has already varied
// (livingCityPainted / livingCityVaried) so it never re-rolls them, and
// it never repaints a car the garage already painted (garage paint is
// player-chosen and wins). Density changes are throttled to one car
// every 2 seconds so the street never visibly pops. No other module is
// imported; the class is standalone and works in plain Node with fake
// traffic / pedestrian objects for the scripted check.

export const PARKED_COLORS = [
  '#c0392b', '#2d7dff', '#3ddc97', '#f7c948', '#e07b39', '#9b59d9',
  '#39c0d9', '#e5e5e5', '#14161a', '#5b7fa6', '#8a6f4d', '#d94f8a',
];

export const PED_COLORS = [
  '#d94f4f', '#4f7fd9', '#4fd98a', '#d9b84f', '#9b59d9', '#e07b39',
  '#39c0d9', '#e5e5e5', '#2d7dff', '#3ddc97', '#f7c948', '#d94f8a',
];

// Time-of-day keyframes: [timeOfDay, multiplier]. 0 = dawn, 0.5 = noon,
// 0.75 = dusk, 0.9+ = night. Busy midday, quiet night.
export const DENSITY_KEYFRAMES = [
  [0.0, 0.55], [0.25, 0.85], [0.5, 1.3], [0.75, 0.9], [0.9, 0.4], [1.0, 0.35],
];

export const BASE_TRAFFIC_COUNT = 14; // the base game's ambient car count
export const DENSITY_ADJUST_INTERVAL = 2; // seconds between spawn/retire steps

function smoothstep(a, b, t) {
  const x = Math.max(0, Math.min(1, (t - a) / (b - a || 1)));
  return x * x * (3 - 2 * x);
}

// Pure: traffic-density multiplier for a time of day (0..1).
export function densityMultiplier(timeOfDay) {
  const t = Math.max(0, Math.min(1, timeOfDay));
  for (let i = 0; i < DENSITY_KEYFRAMES.length - 1; i++) {
    const [t0, m0] = DENSITY_KEYFRAMES[i];
    const [t1, m1] = DENSITY_KEYFRAMES[i + 1];
    if (t >= t0 && t <= t1) {
      const s = smoothstep(t0, t1, t);
      return m0 + (m1 - m0) * s;
    }
  }
  return DENSITY_KEYFRAMES[DENSITY_KEYFRAMES.length - 1][1];
}

export function targetTrafficCount(timeOfDay, baseCount = BASE_TRAFFIC_COUNT) {
  return Math.max(4, Math.round(baseCount * densityMultiplier(timeOfDay)));
}

export class LivingCity {
  constructor(options = {}) {
    this.rng = options.rng || Math.random;
    this.densityInterval = options.densityInterval ?? DENSITY_ADJUST_INTERVAL;
    this.densityTimer = 0;
    this.pairCounter = 0;
  }

  pick(list) {
    return list[Math.floor(this.rng() * list.length)];
  }

  // ---- parked-car colour variety ---------------------------------------
  // Assigns a paint colour to every parked car that has none yet. Cars
  // the garage already painted (paint set) are left alone.

  recolorParked(traffic) {
    if (!traffic || !Array.isArray(traffic.parked)) return 0;
    let painted = 0;
    for (const car of traffic.parked) {
      if (!car || car.livingCityPainted) continue;
      if (car.paint) { car.livingCityPainted = true; continue; } // garage paint wins
      car.paint = this.pick(PARKED_COLORS);
      car.livingCityPainted = true;
      painted += 1;
    }
    return painted;
  }

  // ---- pedestrian variety ----------------------------------------------
  // Wider colours + speeds (30..95, base game is 42..80), and pairs:
  // about a third of pedestrians get a partner sharing their speed.
  // Partners are nudged toward each other by updatePairs() below.

  diversifyPedestrians(peds) {
    if (!Array.isArray(peds)) return 0;
    let varied = 0;
    const fresh = [];
    for (const p of peds) {
      if (!p || p.livingCityVaried) continue;
      p.color = this.pick(PED_COLORS);
      p.speed = 30 + this.rng() * 65;
      p.livingCityVaried = true;
      varied += 1;
      fresh.push(p);
    }
    // Pair up a third of the freshly varied pedestrians.
    for (let i = 0; i + 1 < fresh.length; i += 3) {
      const a = fresh[i];
      const b = fresh[i + 1];
      if (a.pairId || b.pairId) continue;
      this.pairCounter += 1;
      const speed = Math.min(a.speed, b.speed);
      a.speed = speed;
      b.speed = speed;
      a.pairId = this.pairCounter;
      b.pairId = this.pairCounter;
      a.pairPartner = b;
      b.pairPartner = a;
    }
    return varied;
  }

  // Keep paired pedestrians together: if partners drift apart, steer
  // each one's target angle toward the other. Pure data nudge — the
  // base pedestrian update still owns movement and collision.
  updatePairs(peds) {
    if (!Array.isArray(peds)) return;
    for (const p of peds) {
      const q = p.pairPartner;
      if (!p || !q || !p.pairId) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > 46) {
        p.targetAngle = Math.atan2(q.y - p.y, q.x - p.x);
        p.speed = q.speed; // partners walk at one shared pace
      }
    }
  }

  // ---- traffic density by time of day ------------------------------------
  // One gradual step toward the target count per call (the caller
  // throttles calls through update()). Spawns use the base traffic
  // spawner; retiring removes the last ambient car.

  applyDensityStep(traffic, timeOfDay) {
    if (!traffic || !Array.isArray(traffic.cars)) return 0;
    const target = targetTrafficCount(timeOfDay);
    if (traffic.cars.length < target) {
      if (typeof traffic.spawnTrafficCar === 'function') {
        traffic.spawnTrafficCar();
        return 1;
      }
      return 0;
    }
    if (traffic.cars.length > target) {
      traffic.cars.pop();
      return -1;
    }
    return 0;
  }

  // ---- per-frame entry point (Builder C calls this) ----------------------

  update(dt, game) {
    if (!game) return;
    try {
      if (game.traffic) this.recolorParked(game.traffic);
      if (game.peds) {
        this.diversifyPedestrians(game.peds);
        this.updatePairs(game.peds);
      }
      this.densityTimer -= dt;
      if (this.densityTimer <= 0 && game.traffic) {
        this.densityTimer = this.densityInterval;
        this.applyDensityStep(game.traffic, game.timeOfDay ?? 0.25);
      }
    } catch { /* living-city depth never breaks the game loop */ }
  }
}

// ---- scripted check -------------------------------------------------------
// Runs in Node (no DOM) with fake traffic / pedestrian objects. Proves
// the density curve (busy noon, quiet night), parked-car colour
// variety, pedestrian speed/colour variety + pairing, and gradual
// density adjustment — all without touching the real base modules.
// Returns { passed, checks: [{ name, ok, detail }] }.
export function livingCityScriptedCheck() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

  // Deterministic rng for the check (tiny LCG, local to this check).
  let seed = 12345;
  const rng = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  const noon = densityMultiplier(0.5);
  const night = densityMultiplier(0.9);
  const dawn = densityMultiplier(0.0);
  check('noon is the busiest time of day', noon > 1.2 && noon <= 1.35, `noon=${noon.toFixed(2)}`);
  check('night is much quieter than noon', night < 0.5 && night < noon, `night=${night.toFixed(2)}`);
  check('dawn sits between night and noon', dawn > night && dawn < noon, `dawn=${dawn.toFixed(2)}`);
  check('target traffic: noon > night',
    targetTrafficCount(0.5) > targetTrafficCount(0.9),
    `noon=${targetTrafficCount(0.5)} night=${targetTrafficCount(0.9)}`);
  check('target traffic never drops below 4', targetTrafficCount(0.95) >= 4);

  // Fake traffic: 14 ambient cars, 22 parked cars.
  const traffic = {
    cars: Array.from({ length: 14 }, (_, i) => ({ id: `t${i}` })),
    parked: Array.from({ length: 22 }, (_, i) => ({ id: `p${i}`, paint: null })),
    spawnTrafficCar() {
      const c = { id: `spawned${this.cars.length}` };
      this.cars.push(c);
      return c;
    },
  };
  const lc = new LivingCity({ rng, densityInterval: 0 });

  const painted = lc.recolorParked(traffic);
  check('all 22 parked cars get a paint colour',
    painted === 22 && traffic.parked.every((c) => typeof c.paint === 'string'),
    `painted=${painted}`);
  const distinctPaint = new Set(traffic.parked.map((c) => c.paint)).size;
  check('parked colours vary widely (>= 8 distinct across 22 cars)',
    distinctPaint >= 8, `distinct=${distinctPaint}`);
  check('parked colours come from the 12-colour palette',
    traffic.parked.every((c) => PARKED_COLORS.includes(c.paint)));

  // A garage-painted car is never repainted.
  traffic.parked.push({ id: 'garage-car', paint: '#ff00ff' });
  lc.recolorParked(traffic);
  const kept = traffic.parked.find((c) => c.id === 'garage-car');
  check('garage paint is preserved', kept.paint === '#ff00ff');
  const repainted = lc.recolorParked(traffic);
  check('recolor is idempotent (no re-roll)', repainted === 0);

  // Fake pedestrians.
  const peds = Array.from({ length: 30 }, (_, i) => ({
    x: 100 + i * 10, y: 100, speed: 50, color: '#d94f4f', targetAngle: 0,
  }));
  const varied = lc.diversifyPedestrians(peds);
  check('all 30 pedestrians varied', varied === 30);
  const speeds = peds.map((p) => p.speed);
  check('pedestrian speeds vary widely (slow + brisk walkers)',
    Math.min(...speeds) < 45 && Math.max(...speeds) > 80,
    `min=${Math.min(...speeds).toFixed(0)} max=${Math.max(...speeds).toFixed(0)}`);
  const distinctShirts = new Set(peds.map((p) => p.color)).size;
  check('pedestrian shirt colours vary (>= 8 distinct)',
    distinctShirts >= 8, `distinct=${distinctShirts}`);
  const paired = peds.filter((p) => p.pairId);
  check('about a third of pedestrians walk in pairs',
    paired.length >= 8 && paired.length <= 22, `paired=${paired.length}`);
  check('paired partners share a speed',
    paired.every((p) => p.pairPartner && p.pairPartner.speed === p.speed
      && p.pairPartner.pairId === p.pairId));

  // Pairs drift back together: separate one pair, nudge, check angle.
  const pair = paired[0];
  const partner = pair.pairPartner;
  partner.x = pair.x + 200;
  partner.y = pair.y;
  lc.updatePairs(peds);
  check('separated partners steer toward each other',
    Math.abs(pair.targetAngle - 0) < 0.01, `angle=${pair.targetAngle.toFixed(2)}`);

  // Density: noon grows the street, night thins it, one car per step.
  const before = traffic.cars.length;
  const stepNoon = lc.applyDensityStep(traffic, 0.5);
  check('noon density step spawns a car',
    stepNoon === 1 && traffic.cars.length === before + 1);
  for (let i = 0; i < 30; i++) lc.applyDensityStep(traffic, 0.9);
  check('night density settles near the quiet target (<= 7 cars)',
    traffic.cars.length <= 7, `cars=${traffic.cars.length}`);

  // update() never throws on a partial / empty game.
  let threw = false;
  try {
    lc.update(0.016, {});
    lc.update(0.016, null);
    lc.update(0.016, { traffic, peds, timeOfDay: 0.5 });
  } catch { threw = true; }
  check('update() tolerates empty and partial game objects', !threw);

  const passed = checks.every((c) => c.ok);
  return { passed, checks };
}
