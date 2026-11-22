// garage.js — Fixer Garage upgrades (Act 2, spec section 3.3).
//
// Behaviour, in plain terms:
//  * The Fixer Garage (the mission-giver location) is a real garage.
//    Drive into the garage zone and press E (or the menu button) to
//    open the upgrade menu — a DOM overlay that pauses the world
//    while it is open.
//  * Spend cash on four upgrade tracks, each with levels:
//      Engine  (3 levels, +top speed each) — 800 / 1,500 / 2,500
//      Armor   (3 levels, damage resistance) — 500 / 900 / 1,500
//      Tires   (2 levels, better handling/turning) — 400 / 800
//      Brakes  (2 levels, shorter stopping distance) — 300 / 600
//    Prices rise per level. A level can only be bought once, in order.
//  * Upgrades apply to the player's CURRENT car and stay on that car
//    (stored per car, keyed by the car's id). Switching cars means
//    the new car starts un-upgraded. Paint is per car too.
//  * Paint: 6 colours for a small flat fee (visual only). This is
//    separate from the Spray Shop, which still only clears heat.
//  * The menu shows the current level of every track, the car's paint,
//    and the player's cash. Buying with too little cash is refused.
//  * m11 requires at least one purchase: the garage counts purchases
//    (purchaseCount()) so the mission module can compare the count
//    before and after the garage visit.
//  * Autopilot garage step (spec section 4): drive to the garage,
//    open the menu, buy the cheapest available upgrade, close, drive on.
//
// Integration: the base owns one Garage, created with the garage
// location (default matches ACT2_LOCATIONS.garage). Every frame the
// base calls update(playerPos) for the zone prompt, and routes the E
// key through handleKey() BEFORE the car enter/exit branch (E opens
// the garage when the player is inside the zone). While garage.isOpen
// is true the base pauses the world simulation. The base calls
// open(car, cash) / close() and reads close()'s return value to sync
// cash back. The base asks statsFor(car) each frame (or when the car
// changes) and applies the returned bonuses to that car's physics.
// draw(ctx, camera) paints the garage zone + prompt in the render pass.
// No other module is imported; the class is standalone. DOM overlay
// code is guarded so the file also loads in plain Node (no document).

export const GARAGE_ZONE_RADIUS = 120;
export const GARAGE_DEFAULT_LOCATION = { x: 1400, y: 1000 }; // = ACT2_LOCATIONS.garage
export const PAINT_FEE = 150;

export const UPGRADE_DEFS = {
  engine: {
    id: 'engine', name: 'Engine', maxLevel: 3,
    prices: [800, 1500, 2500],
    blurb: '+top speed',
    // Top-speed bonus per level (added to the car's top speed).
    topSpeedBonusPerLevel: 55,
  },
  armor: {
    id: 'armor', name: 'Armor', maxLevel: 3,
    prices: [500, 900, 1500],
    blurb: 'damage resistance',
    // Damage taken multiplier at each level (level 0 = 1.0).
    damageMultiplierPerLevel: [1.0, 0.85, 0.7, 0.55],
  },
  tires: {
    id: 'tires', name: 'Tires', maxLevel: 2,
    prices: [400, 800],
    blurb: 'better handling',
    handlingMultiplierPerLevel: [1.0, 1.25, 1.5],
  },
  brakes: {
    id: 'brakes', name: 'Brakes', maxLevel: 2,
    prices: [300, 600],
    blurb: 'shorter stopping',
    brakingMultiplierPerLevel: [1.0, 1.3, 1.6],
  },
};

export const UPGRADE_ORDER = ['engine', 'armor', 'tires', 'brakes'];

export const PAINT_COLORS = [
  { id: 'midnight', name: 'Midnight Black', hex: '#14161a' },
  { id: 'crescent', name: 'Crescent Blue', hex: '#2d7dff' },
  { id: 'sunset', name: 'Sunset Red', hex: '#e5484d' },
  { id: 'taxi', name: 'Taxi Yellow', hex: '#f7c948' },
  { id: 'mint', name: 'Mint Green', hex: '#3ddc97' },
  { id: 'pearl', name: 'Pearl White', hex: '#f2f2f2' },
];

export class Garage {
  constructor(options = {}) {
    const loc = options.location || GARAGE_DEFAULT_LOCATION;
    this.x = loc.x;
    this.y = loc.y;
    this.zoneRadius = options.zoneRadius || GARAGE_ZONE_RADIUS;
    // Per-car state: Map<carKey, { upgrades: {engine, armor, tires, brakes}, paint }>
    this.cars = new Map();
    this.carKeyCounter = 0;
    // Menu state.
    this.isOpen = false;
    this.currentCar = null;
    this.cash = 0;
    this.sessionPurchases = 0; // purchases made while this menu visit is open
    this.purchaseCountTotal = 0; // all purchases ever (m11 compares before/after)
    this.playerNear = false;
    this.overlay = null; // DOM element, created lazily
    this.onPurchase = null; // optional callback(result) after each purchase
  }

  // ---- per-car bookkeeping ---------------------------------------------

  carKey(car) {
    if (!car) return 'no-car';
    if (car.id !== undefined && car.id !== null) return `id:${car.id}`;
    if (!car.garageId) {
      this.carKeyCounter += 1;
      car.garageId = `car-${this.carKeyCounter}`;
    }
    return `key:${car.garageId}`;
  }

  ensureCar(car) {
    const key = this.carKey(car);
    if (!this.cars.has(key)) {
      this.cars.set(key, {
        upgrades: { engine: 0, armor: 0, tires: 0, brakes: 0 },
        paint: null, // null = factory colour
      });
    }
    return this.cars.get(key);
  }

  getUpgrades(car) {
    return { ...this.ensureCar(car).upgrades };
  }

  getPaint(car) {
    return this.ensureCar(car).paint;
  }

  // Derived physics bonuses for a car. The base applies these to the
  // car's driving: topSpeed += topSpeedBonus, damage *= damageMultiplier,
  // turn rate *= handlingMultiplier, braking *= brakingMultiplier.
  statsFor(car) {
    const u = this.ensureCar(car).upgrades;
    const engine = UPGRADE_DEFS.engine;
    const armor = UPGRADE_DEFS.armor;
    const tires = UPGRADE_DEFS.tires;
    const brakes = UPGRADE_DEFS.brakes;
    return {
      topSpeedBonus: u.engine * engine.topSpeedBonusPerLevel,
      damageMultiplier: armor.damageMultiplierPerLevel[u.armor],
      handlingMultiplier: tires.handlingMultiplierPerLevel[u.tires],
      brakingMultiplier: brakes.brakingMultiplierPerLevel[u.brakes],
      paint: this.ensureCar(car).paint,
      levels: { ...u },
    };
  }

  // ---- prices / buying --------------------------------------------------

  priceFor(category, level) {
    const def = UPGRADE_DEFS[category];
    if (!def) return null;
    if (level >= def.maxLevel) return null; // already maxed
    return def.prices[level];
  }

  nextLevel(category, car) {
    const u = this.ensureCar(car).upgrades;
    const def = UPGRADE_DEFS[category];
    if (!def) return null;
    if (u[category] >= def.maxLevel) return null;
    return u[category] + 1;
  }

  // Buy the next level of a track. cash is the player's current cash.
  // Returns { ok, category, level, cost, cashLeft } or
  // { ok: false, reason } with reason 'unknown-track' | 'maxed' |
  // 'not-enough-cash' | 'no-car'.
  buyUpgrade(category, car, cash) {
    if (!car) return { ok: false, reason: 'no-car' };
    const def = UPGRADE_DEFS[category];
    if (!def) return { ok: false, reason: 'unknown-track' };
    const state = this.ensureCar(car);
    const level = state.upgrades[category];
    if (level >= def.maxLevel) return { ok: false, reason: 'maxed' };
    const cost = def.prices[level];
    if (cash < cost) return { ok: false, reason: 'not-enough-cash', cost };
    state.upgrades[category] = level + 1;
    this.sessionPurchases += 1;
    this.purchaseCountTotal += 1;
    const result = {
      ok: true, kind: 'upgrade', category,
      level: level + 1, cost, cashLeft: cash - cost,
    };
    if (this.onPurchase) this.onPurchase(result);
    this.refreshMenu();
    return result;
  }

  // Repaint the car. Visual only. Returns { ok, color, cost, cashLeft }
  // or { ok: false, reason }.
  buyPaint(colorId, car, cash) {
    if (!car) return { ok: false, reason: 'no-car' };
    const color = PAINT_COLORS.find((c) => c.id === colorId);
    if (!color) return { ok: false, reason: 'unknown-color' };
    if (cash < PAINT_FEE) return { ok: false, reason: 'not-enough-cash', cost: PAINT_FEE };
    this.ensureCar(car).paint = colorId;
    this.sessionPurchases += 1;
    this.purchaseCountTotal += 1;
    const result = {
      ok: true, kind: 'paint', color: colorId, cost: PAINT_FEE,
      cashLeft: cash - PAINT_FEE,
    };
    if (this.onPurchase) this.onPurchase(result);
    this.refreshMenu();
    return result;
  }

  // Cheapest upgrade the player can still buy for this car (any track,
  // lowest next price first). Returns { category, level, cost } or null
  // when everything is maxed or nothing is affordable at this cash.
  cheapestAvailable(car, cash) {
    let best = null;
    for (const category of UPGRADE_ORDER) {
      const u = this.ensureCar(car).upgrades;
      const def = UPGRADE_DEFS[category];
      const level = u[category];
      if (level >= def.maxLevel) continue;
      const cost = def.prices[level];
      if (cash < cost) continue;
      if (!best || cost < best.cost) best = { category, level: level + 1, cost };
    }
    return best;
  }

  // Autopilot garage step: buy the cheapest available upgrade.
  // Returns the buyUpgrade result (or { ok:false, reason:'nothing-to-buy' }).
  buyCheapest(car, cash) {
    const cheapest = this.cheapestAvailable(car, cash);
    if (!cheapest) return { ok: false, reason: 'nothing-to-buy' };
    return this.buyUpgrade(cheapest.category, car, cash);
  }

  // Total purchases ever made through this garage (m11 snapshot).
  purchaseCount() {
    return this.purchaseCountTotal;
  }

  // ---- zone / menu open-close -------------------------------------------

  isInZone(pos) {
    if (!pos) return false;
    return Math.hypot(pos.x - this.x, pos.y - this.y) <= this.zoneRadius;
  }

  // Called every frame by the base so the prompt can show/hide.
  update(playerPos) {
    this.playerNear = this.isInZone(playerPos);
  }

  // Open the menu. The base passes the player's current car and cash;
  // the world pauses while isOpen is true. Returns true when opened.
  open(car, cash) {
    if (this.isOpen) return false;
    this.isOpen = true;
    this.currentCar = car || null;
    this.cash = typeof cash === 'number' ? cash : 0;
    this.sessionPurchases = 0;
    this.buildMenu();
    this.refreshMenu();
    return true;
  }

  // Close the menu and hand the (possibly changed) cash back to the
  // base, plus whether anything was bought during this visit.
  // Returns { cash, purchased, sessionPurchases }.
  close() {
    if (!this.isOpen) return { cash: this.cash, purchased: false, sessionPurchases: 0 };
    this.isOpen = false;
    const result = {
      cash: this.cash,
      purchased: this.sessionPurchases > 0,
      sessionPurchases: this.sessionPurchases,
    };
    this.currentCar = null;
    this.hideMenu();
    return result;
  }

  // E opens the garage when the player is inside the zone; E or Escape
  // closes it when open. The base must call this BEFORE the car
  // enter/exit branch so E does not also yank Rook out of the car.
  // Returns 'opened' | 'closed' | null.
  handleKey(key, playerPos, car, cash) {
    const k = String(key).toLowerCase();
    if (this.isOpen) {
      if (k === 'e' || k === 'escape') {
        // Sync cash from any purchases made via the DOM buttons.
        if (typeof this.cash === 'number') this.close();
        return 'closed';
      }
      return null;
    }
    if (k === 'e' && this.isInZone(playerPos)) {
      this.open(car, cash);
      return 'opened';
    }
    return null;
  }

  // ---- DOM overlay (guarded: no-ops when there is no document) ----------

  buildMenu() {
    if (typeof document === 'undefined') return;
    if (this.overlay) return;
    const el = document.createElement('div');
    el.id = 'garage-menu';
    el.className = 'garage-menu';
    el.style.cssText = [
      'position:fixed', 'inset:0', 'display:flex', 'align-items:center',
      'justify-content:center', 'background:rgba(8,10,24,0.72)', 'z-index:40',
    ].join(';');
    el.innerHTML = [
      '<div class="garage-panel" style="width:520px;max-width:92vw;background:#141a2e;color:#eef2ff;border:2px solid #3a4a7a;border-radius:12px;padding:20px 22px;font-family:sans-serif">',
      '<h2 style="margin:0 0 4px">Fixer Garage</h2>',
      '<p id="garage-cash" style="margin:0 0 14px;color:#9fe870;font-weight:700"></p>',
      '<div id="garage-upgrades"></div>',
      '<h3 style="margin:16px 0 8px">Paint — $' + PAINT_FEE + '</h3>',
      '<div id="garage-paint" style="display:flex;gap:8px;flex-wrap:wrap"></div>',
      '<p id="garage-message" style="min-height:20px;margin:12px 0 0;color:#ffd166"></p>',
      '<button id="garage-close" type="button" style="margin-top:14px;padding:10px 18px;background:#2d7dff;color:#fff;border:0;border-radius:8px;font-weight:700;cursor:pointer">Close (E)</button>',
      '</div>',
    ].join('');
    el.querySelector('#garage-close').addEventListener('click', () => this.close());
    el.querySelector('#garage-upgrades').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-upgrade]');
      if (!btn || !this.currentCar) return;
      const res = this.buyUpgrade(btn.dataset.upgrade, this.currentCar, this.cash);
      if (res.ok) this.cash = res.cashLeft;
      this.showMessage(res.ok
        ? `${UPGRADE_DEFS[res.category].name} → level ${res.level} ($${res.cost})`
        : this.reasonText(res));
    });
    el.querySelector('#garage-paint').addEventListener('click', (ev) => {
      const btn = ev.target.closest('[data-paint]');
      if (!btn || !this.currentCar) return;
      const res = this.buyPaint(btn.dataset.paint, this.currentCar, this.cash);
      if (res.ok) this.cash = res.cashLeft;
      this.showMessage(res.ok
        ? `Painted ${PAINT_COLORS.find((c) => c.id === res.color).name} ($${res.cost})`
        : this.reasonText(res));
    });
    document.body.appendChild(el);
    this.overlay = el;
  }

  reasonText(res) {
    if (res.reason === 'not-enough-cash') return `Not enough cash (need $${res.cost}).`;
    if (res.reason === 'maxed') return 'Already at max level.';
    return 'Cannot buy that right now.';
  }

  showMessage(text) {
    if (!this.overlay) return;
    const m = this.overlay.querySelector('#garage-message');
    if (m) m.textContent = text;
  }

  // Rebuild the menu rows from current levels + cash.
  refreshMenu() {
    if (!this.overlay || !this.isOpen) return;
    const cashEl = this.overlay.querySelector('#garage-cash');
    if (cashEl) cashEl.textContent = `Cash: $${this.cash}`;
    const list = this.overlay.querySelector('#garage-upgrades');
    if (list && this.currentCar) {
      const u = this.ensureCar(this.currentCar).upgrades;
      list.innerHTML = UPGRADE_ORDER.map((category) => {
        const def = UPGRADE_DEFS[category];
        const level = u[category];
        const maxed = level >= def.maxLevel;
        const cost = maxed ? null : def.prices[level];
        const dots = '●'.repeat(level) + '○'.repeat(def.maxLevel - level);
        const btn = maxed
          ? '<span style="color:#888">MAX</span>'
          : `<button type="button" data-upgrade="${category}" style="padding:8px 14px;background:#2d7dff;color:#fff;border:0;border-radius:8px;font-weight:700;cursor:pointer">Buy $${cost}</button>`;
        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #2a3558">`
          + `<span><b>${def.name}</b> <span style="color:#9fe870">${dots}</span> <span style="color:#aab4d4">${def.blurb}</span></span>${btn}</div>`;
      }).join('');
    }
    const paintEl = this.overlay.querySelector('#garage-paint');
    if (paintEl && this.currentCar) {
      const current = this.ensureCar(this.currentCar).paint;
      paintEl.innerHTML = PAINT_COLORS.map((c) => {
        const active = current === c.id;
        return `<button type="button" data-paint="${c.id}" title="${c.name}" style="width:44px;height:44px;border-radius:8px;border:${active ? '3px solid #fff' : '2px solid #555'};background:${c.hex};cursor:pointer">${active ? '✓' : ''}</button>`;
      }).join('');
    }
  }

  hideMenu() {
    if (this.overlay) this.overlay.style.display = 'none';
  }

  showMenu() {
    if (this.overlay) this.overlay.style.display = 'flex';
  }

  // ---- canvas drawing ----------------------------------------------------

  // Draw the garage zone + prompt. camera is {x, y} (top-left of view).
  draw(ctx, camera) {
    if (!ctx) return;
    const sx = this.x - camera.x;
    const sy = this.y - camera.y;
    // Zone: dashed amber circle + building block.
    ctx.save();
    ctx.strokeStyle = 'rgba(247, 201, 72, 0.9)';
    ctx.lineWidth = 3;
    ctx.setLineDash([10, 8]);
    ctx.beginPath();
    ctx.arc(sx, sy, this.zoneRadius, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.fillStyle = 'rgba(247, 201, 72, 0.12)';
    ctx.beginPath();
    ctx.arc(sx, sy, this.zoneRadius, 0, Math.PI * 2);
    ctx.fill();
    // Garage building: grey block with a roller door.
    ctx.fillStyle = '#3d4457';
    ctx.fillRect(sx - 56, sy - 34, 112, 68);
    ctx.fillStyle = '#232838';
    ctx.fillRect(sx - 44, sy - 18, 88, 36);
    ctx.fillStyle = '#f7c948';
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('FIXER GARAGE', sx, sy - 44);
    // Prompt when the player is close.
    if (this.playerNear && !this.isOpen) {
      ctx.fillStyle = 'rgba(8, 10, 24, 0.85)';
      const label = 'Press E — Garage upgrades';
      const w = ctx.measureText(label).width + 24;
      ctx.fillRect(sx - w / 2, sy + 44, w, 30);
      ctx.fillStyle = '#f7c948';
      ctx.font = 'bold 14px sans-serif';
      ctx.fillText(label, sx, sy + 64);
    }
    ctx.restore();
  }

  // ---- serialisation (for the 3-slot save system) ------------------------

  toJSON() {
    const cars = {};
    for (const [key, state] of this.cars.entries()) {
      cars[key] = { upgrades: { ...state.upgrades }, paint: state.paint };
    }
    return { cars, purchaseCountTotal: this.purchaseCountTotal };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    this.cars.clear();
    if (data.cars && typeof data.cars === 'object') {
      for (const [key, state] of Object.entries(data.cars)) {
        if (!state || typeof state !== 'object') continue;
        const upgrades = { engine: 0, armor: 0, tires: 0, brakes: 0 };
        for (const id of UPGRADE_ORDER) {
          const v = state.upgrades?.[id];
          if (typeof v === 'number') {
            upgrades[id] = Math.max(0, Math.min(UPGRADE_DEFS[id].maxLevel, Math.floor(v)));
          }
        }
        this.cars.set(key, { upgrades, paint: typeof state.paint === 'string' ? state.paint : null });
      }
    }
    if (typeof data.purchaseCountTotal === 'number') {
      this.purchaseCountTotal = Math.max(0, Math.floor(data.purchaseCountTotal));
    }
  }
}

// ---- scripted check -------------------------------------------------------
// Runs in Node (no DOM needed) and in the browser console. Exercises the
// purchase flow the way m11 + the autopilot use it: buy engine level 1,
// refuse a purchase with too little cash, buy paint, find the cheapest
// upgrade, and confirm upgrades stick to one car only.
// Returns { passed, checks: [{ name, ok, detail }] }.
export function garageScriptedCheck() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });
  const g = new Garage();
  const carA = { id: 'car-a' };
  const carB = { id: 'car-b' };

  check('garage zone contains its centre', g.isInZone({ x: 1400, y: 1000 }));
  check('garage zone rejects far away point', !g.isInZone({ x: 200, y: 200 }));

  const buy1 = g.buyUpgrade('engine', carA, 1000);
  check('engine level 1 buys for $800', buy1.ok && buy1.level === 1 && buy1.cost === 800 && buy1.cashLeft === 200,
    JSON.stringify(buy1));
  check('engine level is now 1 on car A', g.getUpgrades(carA).engine === 1);
  check('top speed bonus is +55 after engine 1', g.statsFor(carA).topSpeedBonus === 55);

  const broke = g.buyUpgrade('engine', carA, 100);
  check('purchase refused when cash is too low', !broke.ok && broke.reason === 'not-enough-cash');

  const paint = g.buyPaint('sunset', carA, 500);
  check('paint buys for $150', paint.ok && paint.cost === PAINT_FEE && g.getPaint(carA) === 'sunset',
    JSON.stringify(paint));

  const cheapest = g.cheapestAvailable(carA, 1000);
  check('cheapest available is brakes $300', cheapest && cheapest.category === 'brakes' && cheapest.cost === 300,
    JSON.stringify(cheapest));
  const auto = g.buyCheapest(carA, 1000);
  check('autopilot buyCheapest buys brakes', auto.ok && auto.category === 'brakes' && auto.level === 1,
    JSON.stringify(auto));

  check('upgrades do not leak to another car', g.getUpgrades(carB).engine === 0 && g.getPaint(carB) === null);
  check('purchase count tracks all buys', g.purchaseCount() === 3, `count=${g.purchaseCount()}`);

  const before = g.purchaseCount();
  g.open(carA, 5000);
  check('menu opens and pauses (isOpen)', g.isOpen === true);
  const closed = g.close();
  check('close returns cash + purchased flag', closed.cash === 5000 && closed.purchased === false,
    JSON.stringify(closed));

  const roundTrip = new Garage();
  roundTrip.fromJSON(g.toJSON());
  check('save round-trip keeps engine level', roundTrip.getUpgrades(carA).engine === 1);
  check('save round-trip keeps paint', roundTrip.getPaint(carA) === 'sunset');

  const maxed = g.buyUpgrade('tires', carA, 100000);
  g.buyUpgrade('tires', carA, 100000);
  const over = g.buyUpgrade('tires', carA, 100000);
  check('tires maxes at level 2', maxed.ok && over.ok === false && over.reason === 'maxed');

  const passed = checks.every((c) => c.ok);
  return { passed, checks };
}
