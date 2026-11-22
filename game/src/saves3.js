// saves3.js — 3 save slots (Act 2, spec section 3.5).
//
// Behaviour, in plain terms:
//  * The title screen lists 3 save slots. Each slot shows mission
//    progress (highest mission reached), cash, and date — or "Empty".
//    Continue loads the slot the player picks.
//  * Autosave after each mission writes to the active slot. Manual
//    save from the pause menu writes to the active slot.
//  * Versioned localStorage keys, one per slot:
//      crescent-bay.save.slot1.v1 / slot2.v1 / slot3.v1
//    A corrupt slot (bad JSON, wrong version, wrong shape) shows as
//    corrupt and can be overwritten — it never crashes the title
//    screen and never blocks the other slots.
//  * The single-slot save from save.js stays the default: when a
//    legacy save already exists (key crescent-bay.save.v1) and slot 1
//    has never been written, slot 1 shows that legacy save (read
//    through) and Continue loads it. The legacy key itself is never
//    deleted or overwritten by the slot system.
//
// Integration: the base owns one SaveSlots and stores it on
// game.saveSlots. Builder C wires:
//   game.saveSlots = new SaveSlots();              // in createGame (or boot)
//   game.saveSlots.listSlots()                     // title screen list
//   game.saveSlots.setActiveSlot(n)                // player picks a slot
//   game.saveSlots.saveActive(game)                // pause-menu Save button
//   game.saveSlots.autosaveToActive(game)          // on mission complete
//   const data = game.saveSlots.loadSlot(n);       // Continue
//   applySave(game, data)                          // from save.js, unchanged
// Slot payloads are the same shape save.js already writes (serialize /
// deserialize from save.js — this module reuses those helpers with its
// own keys, exactly as save.js documents). A storage object can be
// injected (new SaveSlots(storage)) for tests; otherwise window.
// localStorage is used when present, with an in-memory fallback.
// No other module is imported besides save.js + config.js for the
// legacy key; the class is standalone.

import { SAVE_KEY } from './config.js';
import { serialize, deserialize } from './save.js';

export const SLOT_COUNT = 3;
export const SLOT_VERSION = 1;
export const ACTIVE_SLOT_KEY = 'crescent-bay.save.active.v1';

export function slotKey(slot) {
  return `crescent-bay.save.slot${slot}.v${SLOT_VERSION}`;
}

export function isValidSlot(slot) {
  return Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT;
}

// Minimal localStorage-shaped store backed by a Map (tests + fallback
// when localStorage is unavailable, e.g. private mode throwing).
export function createMemoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

function defaultStorage() {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage;
  } catch { /* fall through to memory */ }
  return createMemoryStorage();
}

export class SaveSlots {
  constructor(storage = null) {
    this.storage = storage || defaultStorage();
    this.activeSlot = 1;
    try {
      const saved = this.storage.getItem(ACTIVE_SLOT_KEY);
      const n = Number.parseInt(saved ?? '', 10);
      if (isValidSlot(n)) this.activeSlot = n;
    } catch { /* keep default */ }
  }

  // ---- low-level read/write --------------------------------------------

  readRaw(slot) {
    if (!isValidSlot(slot)) return null;
    try {
      return this.storage.getItem(slotKey(slot));
    } catch { return null; }
  }

  // Parse one slot without throwing. Returns { status, data } where
  // status is 'empty' | 'ok' | 'corrupt'. Slot 1 falls back to the
  // legacy single-slot key when its own key has never been written.
  parseSlot(slot) {
    if (!isValidSlot(slot)) return { status: 'corrupt', data: null };
    let raw = this.readRaw(slot);
    if (raw === null && slot === 1) {
      try { raw = this.storage.getItem(SAVE_KEY); } catch { raw = null; }
    }
    if (raw === null || raw === undefined || raw === '') {
      return { status: 'empty', data: null };
    }
    try {
      const data = deserialize(JSON.parse(raw));
      if (!data) return { status: 'corrupt', data: null };
      return { status: 'ok', data };
    } catch {
      return { status: 'corrupt', data: null };
    }
  }

  // ---- slot list (title screen) -----------------------------------------

  slotSummary(data) {
    if (!data) return null;
    return {
      cash: data.cash ?? 0,
      missionIndex: data.missionIndex ?? 0,
      highestUnlocked: data.highestUnlocked ?? 0,
      savedAt: data.savedAt || null,
      date: (data.savedAt || '').slice(0, 10) || 'unknown date',
    };
  }

  listSlots() {
    const out = [];
    for (let slot = 1; slot <= SLOT_COUNT; slot++) {
      const { status, data } = this.parseSlot(slot);
      out.push({ slot, status, summary: this.slotSummary(data) });
    }
    return out;
  }

  // One-line display string per slot, for the title screen.
  slotLabel(info) {
    if (!info) return 'Empty';
    if (info.status === 'corrupt') return `Slot ${info.slot} — Corrupt save (can be overwritten)`;
    if (info.status === 'empty' || !info.summary) return `Slot ${info.slot} — Empty`;
    const s = info.summary;
    const mission = Math.max(s.highestUnlocked, s.missionIndex + 1);
    return `Slot ${info.slot} — Mission ${mission} · $${s.cash} · ${s.date}`;
  }

  // ---- save / load -------------------------------------------------------

  saveToSlot(game, slot) {
    if (!isValidSlot(slot)) return false;
    try {
      this.storage.setItem(slotKey(slot), JSON.stringify(serialize(game)));
      return true;
    } catch { return false; }
  }

  // Returns the save payload, or null for empty / corrupt / bad slot.
  // Never throws.
  loadSlot(slot) {
    const { status, data } = this.parseSlot(slot);
    return status === 'ok' ? data : null;
  }

  isCorrupt(slot) {
    return this.parseSlot(slot).status === 'corrupt';
  }

  isEmpty(slot) {
    return this.parseSlot(slot).status === 'empty';
  }

  // ---- active slot -------------------------------------------------------

  setActiveSlot(slot) {
    if (!isValidSlot(slot)) return false;
    this.activeSlot = slot;
    try { this.storage.setItem(ACTIVE_SLOT_KEY, String(slot)); } catch { /* memory only */ }
    return true;
  }

  getActiveSlot() {
    return this.activeSlot;
  }

  saveActive(game) {
    return this.saveToSlot(game, this.activeSlot);
  }

  loadActive() {
    return this.loadSlot(this.activeSlot);
  }

  // Autosave after a mission completes: same as a manual save, to the
  // active slot. Returns true when the write landed.
  autosaveToActive(game) {
    return this.saveActive(game);
  }

  // ---- DOM list (guarded: no-ops when there is no document) -------------
  // Renders the 3 slots as buttons inside `el`. onPick(slot, info) runs
  // when the player clicks a slot. Corrupt slots stay clickable (they
  // can be overwritten by a new game); empty slots start a new game.

  renderSlotList(el, onPick) {
    if (typeof document === 'undefined' || !el) return;
    const slots = this.listSlots();
    el.innerHTML = '';
    for (const info of slots) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.id = `save-slot-${info.slot}`;
      btn.className = 'save-slot';
      btn.textContent = this.slotLabel(info);
      if (info.slot === this.activeSlot) btn.classList.add('active-slot');
      btn.addEventListener('click', () => {
        this.setActiveSlot(info.slot);
        if (typeof onPick === 'function') onPick(info.slot, info);
      });
      el.appendChild(btn);
    }
  }
}

// ---- scripted check -------------------------------------------------------
// Runs in Node (no DOM, no localStorage) with an injected memory
// storage and a fake game object shaped like the real one. Writes all
// 3 slots, loads each back, corrupts one, proves the title list never
// throws and the corrupt slot can be overwritten, and proves the
// legacy single-slot save shows up as slot 1.
// Returns { passed, checks: [{ name, ok, detail }] }.
export function savesScriptedCheck() {
  const checks = [];
  const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

  function fakeGame(cash, missionIndex) {
    return {
      player: { x: 600, y: 2600, hp: 100, cash },
      missionIndex,
      runner: { highestUnlocked: missionIndex + 1 },
      weapons: { toJSON: () => ({ owned: { pistol: true, smg: false, shotgun: false }, ammo: { pistol: 48, smg: 0, shotgun: 0 }, current: 'pistol' }) },
      police: { state: { heat: 0 } },
      timeOfDay: 0.25,
    };
  }

  const storage = createMemoryStorage();
  const slots = new SaveSlots(storage);

  const fresh = slots.listSlots();
  check('fresh install: all 3 slots empty',
    fresh.length === 3 && fresh.every((s) => s.status === 'empty'),
    JSON.stringify(fresh.map((s) => s.status)));

  check('save slot 1 lands', slots.saveToSlot(fakeGame(2400, 4), 1) === true);
  check('save slot 2 lands', slots.saveToSlot(fakeGame(800, 1), 2) === true);
  check('save slot 3 lands', slots.saveToSlot(fakeGame(150, 0), 3) === true);

  const listed = slots.listSlots();
  check('all 3 slots list as ok after writing',
    listed.every((s) => s.status === 'ok'), JSON.stringify(listed.map((s) => s.status)));
  check('slot 1 summary shows cash + mission + date',
    listed[0].summary.cash === 2400 && listed[0].summary.missionIndex === 4
    && listed[0].summary.date.length === 10,
    JSON.stringify(listed[0].summary));

  const back1 = slots.loadSlot(1);
  check('load slot 1 returns its cash + mission',
    back1 && back1.cash === 2400 && back1.missionIndex === 4);
  const back3 = slots.loadSlot(3);
  check('load slot 3 returns its own cash (no cross-talk)',
    back3 && back3.cash === 150 && back3.missionIndex === 0);

  // Corrupt slot 2 with garbage: list must say corrupt, load null,
  // and nothing throws.
  storage.setItem(slotKey(2), '{not json at all');
  let listedAfterCorrupt = null;
  let threw = false;
  try { listedAfterCorrupt = slots.listSlots(); } catch { threw = true; }
  check('corrupt slot does not throw the title list', !threw);
  check('corrupt slot lists as corrupt, others stay ok',
    listedAfterCorrupt[1].status === 'corrupt'
    && listedAfterCorrupt[0].status === 'ok'
    && listedAfterCorrupt[2].status === 'ok',
    JSON.stringify(listedAfterCorrupt.map((s) => s.status)));
  check('loadSlot on a corrupt slot returns null', slots.loadSlot(2) === null);
  check('isCorrupt flags slot 2 only', slots.isCorrupt(2) && !slots.isCorrupt(1));
  check('corrupt slot label says corrupt + overwriteable',
    slots.slotLabel(listedAfterCorrupt[1]).includes('Corrupt'));

  // Wrong version is corrupt too.
  storage.setItem(slotKey(3), JSON.stringify({ version: 999, cash: 1 }));
  check('wrong-version payload lists as corrupt', slots.isCorrupt(3));

  // A corrupt slot can be overwritten with a good save.
  check('corrupt slot can be overwritten',
    slots.saveToSlot(fakeGame(5000, 7), 2) === true && !slots.isCorrupt(2)
    && slots.loadSlot(2).cash === 5000);

  // Invalid slot numbers are refused, never crash.
  check('saveToSlot(0) refused', slots.saveToSlot(fakeGame(1, 0), 0) === false);
  check('saveToSlot(4) refused', slots.saveToSlot(fakeGame(1, 0), 4) === false);
  check('loadSlot(4) returns null', slots.loadSlot(4) === null);

  // Active slot: autosave writes there, switching moves it.
  slots.setActiveSlot(3);
  check('autosave writes to the active slot',
    slots.autosaveToActive(fakeGame(9100, 9)) === true && slots.loadSlot(3).cash === 9100);
  check('active slot persists in storage',
    new SaveSlots(storage).getActiveSlot() === 3);
  check('setActiveSlot(5) refused', slots.setActiveSlot(5) === false);

  // Legacy single-slot save: fresh slot system, legacy key present,
  // slot 1 empty -> slot 1 shows the legacy save.
  const legacyStorage = createMemoryStorage();
  legacyStorage.setItem(SAVE_KEY, JSON.stringify({
    version: 1, savedAt: '2026-11-21T10:00:00.000Z', cash: 1234,
    missionIndex: 2, highestUnlocked: 3,
    player: { x: 600, y: 2600, hp: 90 }, weapons: null, heat: 0, timeOfDay: 0.3,
  }));
  const legacySlots = new SaveSlots(legacyStorage);
  const legacyList = legacySlots.listSlots();
  check('legacy save shows as slot 1 (default active slot)',
    legacyList[0].status === 'ok' && legacyList[0].summary.cash === 1234
    && legacyList[1].status === 'empty',
    JSON.stringify(legacyList.map((s) => s.status)));
  const legacyBack = legacySlots.loadSlot(1);
  check('legacy save loads through slot 1',
    legacyBack && legacyBack.cash === 1234 && legacyBack.missionIndex === 2);
  check('empty slot label says Empty',
    legacySlots.slotLabel(legacyList[1]).includes('Empty'));

  const passed = checks.every((c) => c.ok);
  return { passed, checks };
}
