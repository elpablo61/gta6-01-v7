// weapons.js — pistol / SMG / shotgun (Act 2, spec section 3.2).
//
// Behaviour, in plain terms:
//  * Three weapons on keys 1/2/3; Q cycles to the next OWNED weapon.
//    Switching is instant — no animation lock, on foot or (for the HUD)
//    while driving, though firing itself is on foot only.
//  * Pistol: the starting weapon, 18 damage, medium rate, 48 ammo.
//    SMG: fast fire, 10 damage, large ammo pool. Shotgun: slow, 5
//    pellets of 8 damage each, wide spread, short range.
//  * Each weapon tracks its own ammo. The HUD shows the current weapon
//    name + ammo (see hudText()).
//  * Weapon crates sit at fixed spots (gun store, docks, hideout) and
//    inside the m10/m12 shootout arenas. Walking over a crate picks the
//    weapon up and adds its ammo. Ammo pickups sit in shootout arenas;
//    the autopilot grabs one when its current weapon is at 6 ammo or less.
//  * Enemies use the pistol only — this module never gives an enemy a
//    better weapon; the base combat code asks enemyWeapon() for that.
//  * fire() is pure about the shot itself: it returns the pellets
//    (angle offsets + damage) and deducts one ammo. The base combat code
//    turns pellets into bullets / hit tests. Rate limiting lives here so
//    the SMG cannot be fired faster than its fire interval.
//
// Integration: the base owns one WeaponInventory for the player, calls
// handleKey(key) on keydown, update(dt) every frame (cooldowns), and
// checkPickups(playerPos) when the player moves. Crates are created by
// makeWorldCrates() for free roam and makeArenaCrates(arena) for a
// shootout; the mission module owns the arena crates' lifetime.

export const WEAPON_DEFS = {
  pistol: {
    id: 'pistol', name: 'Pistol', key: '1',
    damage: 18, pellets: 1, spread: 0.02, range: 520,
    fireInterval: 0.28, startAmmo: 48, crateAmmo: 48,
  },
  smg: {
    id: 'smg', name: 'SMG', key: '2',
    damage: 10, pellets: 1, spread: 0.06, range: 420,
    fireInterval: 0.09, startAmmo: 0, crateAmmo: 120,
  },
  shotgun: {
    id: 'shotgun', name: 'Shotgun', key: '3',
    damage: 8, pellets: 5, spread: 0.22, range: 260,
    fireInterval: 0.85, startAmmo: 0, crateAmmo: 24,
  },
};

export const WEAPON_ORDER = ['pistol', 'smg', 'shotgun'];
export const PICKUP_RADIUS = 46;
export const AMMO_LOW_THRESHOLD = 6; // autopilot grabs arena ammo at or below this

export function enemyWeapon() {
  return 'pistol'; // enemies use the pistol only, always
}

export class WeaponInventory {
  constructor() {
    this.owned = { pistol: true, smg: false, shotgun: false };
    this.ammo = { pistol: WEAPON_DEFS.pistol.startAmmo, smg: 0, shotgun: 0 };
    this.current = 'pistol';
    this.cooldown = 0;
  }

  currentDef() {
    return WEAPON_DEFS[this.current];
  }

  hudText() {
    const def = this.currentDef();
    return `${def.name}  ${this.ammo[this.current]}`;
  }

  has(id) {
    return !!this.owned[id];
  }

  // Instant switch, no lock. Returns true if the switch happened.
  switchTo(id) {
    if (!this.owned[id] || !WEAPON_DEFS[id]) return false;
    this.current = id;
    return true;
  }

  cycle() {
    const ownedList = WEAPON_ORDER.filter((id) => this.owned[id]);
    if (ownedList.length < 2) return this.current;
    const idx = ownedList.indexOf(this.current);
    this.current = ownedList[(idx + 1) % ownedList.length];
    return this.current;
  }

  // Keys 1/2/3 select, Q cycles. Returns the new current weapon id
  // (or null when the key is not a weapon key).
  handleKey(key) {
    const k = String(key).toLowerCase();
    if (k === 'q') return this.cycle();
    for (const id of WEAPON_ORDER) {
      if (WEAPON_DEFS[id].key === k) {
        return this.switchTo(id) ? id : this.current;
      }
    }
    return null;
  }

  update(dt) {
    if (this.cooldown > 0) this.cooldown -= dt;
  }

  canFire() {
    return this.cooldown <= 0 && this.ammo[this.current] > 0;
  }

  // Fires one shot. aimAngle is the player's aim direction in radians.
  // Returns null when it cannot fire (cooldown or no ammo), otherwise
  // { weapon, pellets: [{angle, damage, range}], ammoLeft }.
  fire(aimAngle) {
    if (!this.canFire()) return null;
    const def = this.currentDef();
    this.ammo[this.current] -= 1;
    this.cooldown = def.fireInterval;
    const pellets = [];
    for (let i = 0; i < def.pellets; i += 1) {
      // Spread fans the pellets symmetrically around the aim angle.
      const offset = def.pellets === 1
        ? (Math.random() - 0.5) * def.spread
        : (i / (def.pellets - 1) - 0.5) * def.spread * 2;
      pellets.push({ angle: aimAngle + offset, damage: def.damage, range: def.range });
    }
    return { weapon: this.current, pellets, ammoLeft: this.ammo[this.current] };
  }

  // Picking up a crate grants the weapon (if new) plus its ammo.
  // Returns the weapon id granted, or null for an unknown id.
  addWeapon(id) {
    const def = WEAPON_DEFS[id];
    if (!def) return null;
    this.owned[id] = true;
    this.ammo[id] += def.crateAmmo;
    return id;
  }

  addAmmo(id, amount) {
    if (!WEAPON_DEFS[id]) return 0;
    this.ammo[id] += amount;
    return this.ammo[id];
  }

  // Serialisable snapshot for saves.
  toJSON() {
    return { owned: { ...this.owned }, ammo: { ...this.ammo }, current: this.current };
  }

  fromJSON(data) {
    if (!data || typeof data !== 'object') return;
    for (const id of WEAPON_ORDER) {
      if (typeof data.owned?.[id] === 'boolean') this.owned[id] = data.owned[id];
      if (typeof data.ammo?.[id] === 'number') this.ammo[id] = Math.max(0, data.ammo[id]);
    }
    if (data.current && this.owned[data.current]) this.current = data.current;
  }
}

// A weapon crate lying in the world. taken flips once collected.
export class WeaponCrate {
  constructor(x, y, weaponId) {
    this.x = x;
    this.y = y;
    this.weaponId = weaponId;
    this.taken = false;
    this.bobPhase = Math.random() * Math.PI * 2;
  }

  // Returns the weapon id when the player walks over it, else null.
  tryPickup(playerPos) {
    if (this.taken) return null;
    const d = Math.hypot(playerPos.x - this.x, playerPos.y - this.y);
    if (d <= PICKUP_RADIUS) {
      this.taken = true;
      return this.weaponId;
    }
    return null;
  }
}

// A loose ammo pickup (arena only). Grants ammo for the given weapon.
export class AmmoPickup {
  constructor(x, y, weaponId, amount) {
    this.x = x;
    this.y = y;
    this.weaponId = weaponId;
    this.amount = amount;
    this.taken = false;
  }

  tryPickup(playerPos) {
    if (this.taken) return null;
    const d = Math.hypot(playerPos.x - this.x, playerPos.y - this.y);
    if (d <= PICKUP_RADIUS) {
      this.taken = true;
      return { weaponId: this.weaponId, amount: this.amount };
    }
    return null;
  }
}

// Fixed world crates: SMG at the gun store, shotgun at the docks,
// SMG again at the hideout (so a player who missed the first still
// finds one before the late missions). Coordinates are the Act 2
// landmark defaults; the integrator may pass overrides.
export function makeWorldCrates(locations) {
  return [
    new WeaponCrate(locations.gunStore.x, locations.gunStore.y, 'smg'),
    new WeaponCrate(locations.docks.x + 120, locations.docks.y - 80, 'shotgun'),
    new WeaponCrate(locations.hideout.x - 100, locations.hideout.y + 60, 'smg'),
  ];
}

// Arena crates for a shootout. The SMG crate sits near the arena
// entrance and the shotgun crate along the natural approach path, so
// the autopilot walks over one without detouring (spec fix for m10).
// arena is { entrance: {x,y}, approach: {x,y}, center: {x,y} }.
export function makeArenaCrates(arena) {
  const crates = [new WeaponCrate(arena.entrance.x, arena.entrance.y, 'smg')];
  if (arena.approach) crates.push(new WeaponCrate(arena.approach.x, arena.approach.y, 'shotgun'));
  return crates;
}

// Arena ammo pickups: two pistol-ammo and two SMG-ammo boxes spread
// around the arena centre so one is always within a short walk.
export function makeArenaAmmo(arena) {
  const c = arena.center;
  return [
    new AmmoPickup(c.x - 90, c.y - 60, 'pistol', 24),
    new AmmoPickup(c.x + 90, c.y + 60, 'smg', 60),
    new AmmoPickup(c.x - 60, c.y + 90, 'smg', 60),
    new AmmoPickup(c.x + 60, c.y - 90, 'pistol', 24),
  ];
}

// One call the base makes when the player moves: collect every crate /
// ammo box within reach and apply it to the inventory. Returns a list
// of human-readable pickup events (for HUD toasts / sound triggers).
export function checkPickups(inventory, crates, ammoBoxes, playerPos) {
  const events = [];
  for (const crate of crates) {
    const got = crate.tryPickup(playerPos);
    if (got) {
      inventory.addWeapon(got);
      events.push({ type: 'weapon', weapon: got });
    }
  }
  for (const box of ammoBoxes) {
    const got = box.tryPickup(playerPos);
    if (got) {
      inventory.addAmmo(got.weaponId, got.amount);
      events.push({ type: 'ammo', weapon: got.weaponId, amount: got.amount });
    }
  }
  return events;
}
