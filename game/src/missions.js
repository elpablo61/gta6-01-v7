// missions.js — the mission arc. m1–m8 live here, written from spec §2.
// m9–m12 are registered by the Act 2 module through registerMission().
// Objectives are conditions ("reach the marker", "escape the police"),
// never kill counts. A failed mission restarts from stage 0.
// Each mission: fixer, spoken hook, cash reward, generous time limit.

import { LANDMARKS } from './world.js';
import { SPRAY_SHOP } from './config.js';
import { ARRIVAL_RADIUS } from './act2-locations.js';

export const MISSION_DEFS = [
  {
    id: 'm1', name: 'First Job', fixer: 'Mara',
    hook: 'Mara: "Rook. Package at the market, drop it downtown. Easy money. Don\'t make it complicated."',
    reward: 400, timeLimit: 300,
    stages: [
      { type: 'goto', label: 'Pick up the package at the Market', target: () => LANDMARKS.market },
      { type: 'goto', label: 'Deliver the package Downtown', target: () => LANDMARKS.downtown },
    ],
  },
  {
    id: 'm2', name: 'Tail Chase', fixer: 'Mara',
    hook: 'Mara: "A courier is skimming my cut. Ram his car four times. Hard. He\'ll get the message."',
    reward: 700, timeLimit: 300,
    stages: [
      { type: 'ram', label: 'Ram the courier car 4 times', hitsNeeded: 4 },
    ],
  },
  {
    id: 'm3', name: 'Hot Wheels', fixer: 'Dex',
    hook: 'Dex: "Three checkpoints, one clock. Club, marina, airport. Show me what that engine can do."',
    reward: 900, timeLimit: 240,
    stages: [
      { type: 'checkpoints', label: 'Hit the checkpoints: Club, Marina, Airport',
        points: () => [LANDMARKS.club, LANDMARKS.marina, LANDMARKS.airport] },
    ],
  },
  {
    id: 'm4', name: 'Dockside', fixer: 'Mara',
    hook: 'Mara: "Crate at the marina, hideout drop. The docks are hot tonight — keep moving."',
    reward: 1100, timeLimit: 360,
    stages: [
      { type: 'goto', label: 'Pick up the crate at the Marina', target: () => LANDMARKS.marina },
      { type: 'goto', label: 'Deliver the crate to the Hideout', target: () => LANDMARKS.hideout },
    ],
  },
  {
    id: 'm5', name: 'Midnight Run', fixer: 'Dex',
    hook: 'Dex: "Night run. Club pickup, docks drop. Headlights on, mouth shut."',
    reward: 1400, timeLimit: 300, night: true,
    stages: [
      { type: 'goto', label: 'Pick up at the Club', target: () => LANDMARKS.club },
      { type: 'goto', label: 'Drop at the South Docks', target: () => LANDMARKS.docks },
    ],
  },
  {
    id: 'm6', name: 'Collector', fixer: 'Mara',
    hook: 'Mara: "Five drops scattered around the city. Collect them all, then come home."',
    reward: 1800, timeLimit: 420,
    stages: [
      { type: 'collect', label: 'Collect 5 money drops',
        points: () => [
          { x: 600, y: 1800, label: 'Drop 1' }, { x: 2200, y: 600, label: 'Drop 2' },
          { x: 2600, y: 1400, label: 'Drop 3' }, { x: 1000, y: 2600, label: 'Drop 4' },
          { x: 1800, y: 1000, label: 'Drop 5' },
        ] },
      { type: 'goto', label: 'Return to the Hideout', target: () => LANDMARKS.hideout },
    ],
  },
  {
    id: 'm7', name: 'Highway Heat', fixer: 'Dex',
    hook: 'Dex: "Airport run — and the whole city is watching. Lose them at the Spray Shop."',
    reward: 4600, timeLimit: 420, wantedCover: 58,
    stages: [
      { type: 'goto', label: 'Drive to the Airport', target: () => LANDMARKS.airport },
      { type: 'escape', label: 'Escape the police — lose the heat', target: () => SPRAY_SHOP },
    ],
  },
  {
    id: 'm8', name: 'Crescent Job', fixer: 'Mara',
    hook: 'Mara: "Three of them guarding the yard downtown. Clear it, then vanish. This is the big one, Rook."',
    reward: 6200, timeLimit: 600,
    stages: [
      { type: 'shootout', label: 'Clear the yard Downtown', arena: () => ({ x: 1800, y: 1800 }), enemies: 3 },
      { type: 'goto', label: 'Escape to the Hideout', target: () => LANDMARKS.hideout },
    ],
  },
];

// Act 2 (Builder B-2) registers m9–m12 here with the same shape.
export function registerMission(def) {
  if (!def || !def.id || MISSION_DEFS.some((m) => m.id === def.id)) return false;
  MISSION_DEFS.push(def);
  return true;
}

export function missionById(id) {
  return MISSION_DEFS.find((m) => m.id === id) || null;
}

// Runner: owns the active mission's stage, timer and per-stage progress.
// ctx (supplied by main.js each frame): { player, playerCar, courier,
// courierHits, enemiesAlive, heat, ramHits, onEvent }.
export function createMissionRunner() {
  const r = {
    active: null, stageIndex: 0, timeLeft: 0, stageState: null,
    completedCount: 0, highestUnlocked: 0,
  };

  function stageDef() {
    if (!r.active) return null;
    return r.active.stages[r.stageIndex] || null;
  }

  function beginStage(ctx) {
    const st = stageDef();
    r.stageState = { hits: 0, pointsHit: 0, collected: 0, points: null, arenaSpawned: false };
    if (!st) return;
    if (st.type === 'checkpoints' || st.type === 'collect') r.stageState.points = st.points();
    if (st.type === 'shootout') {
      const arena = st.arena();
      r.stageState.arena = arena;
      if (ctx.spawnArena) ctx.spawnArena(arena, st.enemies);
      r.stageState.arenaSpawned = true;
    }
    if (st.type === 'ram' && ctx.spawnCourier) ctx.spawnCourier();
    // Garage stage (m11): snapshot the purchase count at stage start;
    // the stage only completes after a purchase (see update()).
    if (st.type === 'garage' && ctx.garageStageSnapshot) {
      r.stageState.garageSnapshot = ctx.garageStageSnapshot(ctx.garage);
    }
    if (ctx.onEvent) ctx.onEvent({ type: 'stage', label: st.label });
  }

  function start(def, ctx) {
    r.active = def;
    r.stageIndex = 0;
    r.timeLeft = def.timeLimit;
    r.stageState = null;
    beginStage(ctx);
    // Wanted cover (m7) is set AFTER the mission starts.
    if (def.wantedCover && ctx.setHeat) ctx.setHeat(def.wantedCover);
    if (ctx.onEvent) ctx.onEvent({ type: 'start', mission: def });
    return def;
  }

  function fail(ctx) {
    const def = r.active;
    r.active = null; r.stageIndex = 0; r.stageState = null;
    if (ctx.onEvent) ctx.onEvent({ type: 'fail', mission: def });
    return def;
  }

  function complete(ctx) {
    const def = r.active;
    r.active = null; r.stageIndex = 0; r.stageState = null;
    r.completedCount += 1;
    r.highestUnlocked = Math.max(r.highestUnlocked, MISSION_DEFS.indexOf(def) + 1);
    if (ctx.onEvent) ctx.onEvent({ type: 'complete', mission: def });
    return def;
  }

  function advance(ctx) {
    r.stageIndex += 1;
    if (r.stageIndex >= r.active.stages.length) return complete(ctx);
    beginStage(ctx);
    return null;
  }

  function posOf(ctx) {
    return ctx.playerCar ? { x: ctx.playerCar.x, y: ctx.playerCar.y } : { x: ctx.player.x, y: ctx.player.y };
  }
  function arrived(target, ctx, radius = ARRIVAL_RADIUS) {
    const p = posOf(ctx);
    return Math.hypot(p.x - target.x, p.y - target.y) < radius;
  }

  // Current objective for the HUD + autopilot: {x, y, label, kind}.
  function currentObjective(ctx) {
    const st = stageDef();
    if (!st) return null;
    if (st.type === 'goto' || st.type === 'escape') {
      const t = st.target();
      return { x: t.x, y: t.y, label: st.label, kind: st.type };
    }
    if (st.type === 'checkpoints' || st.type === 'collect') {
      const pts = r.stageState?.points;
      const next = pts ? pts[r.stageState.pointsHit] : null;
      if (!next) return { x: posOf(ctx).x, y: posOf(ctx).y, label: st.label, kind: st.type };
      return { x: next.x, y: next.y, label: `${st.label} (${r.stageState.pointsHit + 1}/${pts.length})`, kind: st.type };
    }
    if (st.type === 'ram') {
      const c = ctx.courier;
      if (!c) return { x: posOf(ctx).x, y: posOf(ctx).y, label: st.label, kind: 'ram' };
      return { x: c.x, y: c.y, label: `${st.label} (${r.stageState.hits}/${st.hitsNeeded})`, kind: 'ram' };
    }
    if (st.type === 'shootout') {
      const arena = r.stageState?.arena || st.arena();
      const e = ctx.nearestEnemy ? ctx.nearestEnemy() : null;
      if (e) return { x: e.x, y: e.y, label: st.label, kind: 'shootout' };
      return { x: arena.x, y: arena.y, label: st.label, kind: 'shootout' };
    }
    if (st.type === 'garage') {
      const loc = st.location();
      return { x: loc.x, y: loc.y, label: st.label, kind: 'garage' };
    }
    return null;
  }

  function update(dt, ctx) {
    if (!r.active) return null;
    r.timeLeft -= dt;
    if (r.timeLeft <= 0) return fail(ctx);
    const st = stageDef();
    const s = r.stageState;
    if (st.type === 'goto') {
      if (arrived(st.target(), ctx)) return advance(ctx);
    } else if (st.type === 'escape') {
      if (ctx.heat < 12) return advance(ctx);
    } else if (st.type === 'checkpoints' || st.type === 'collect') {
      const pts = s.points;
      const next = pts[s.pointsHit];
      if (next && arrived(next, ctx, st.type === 'collect' ? 50 : ARRIVAL_RADIUS)) {
        s.pointsHit += 1;
        if (ctx.onEvent) ctx.onEvent({ type: 'checkpoint', index: s.pointsHit, total: pts.length });
        if (s.pointsHit >= pts.length) return advance(ctx);
      }
    } else if (st.type === 'ram') {
      s.hits = ctx.ramHits || 0;
      if (s.hits >= st.hitsNeeded) return advance(ctx);
    } else if (st.type === 'shootout') {
      if ((ctx.enemiesAlive ?? 1) === 0 && s.arenaSpawned) return advance(ctx);
    } else if (st.type === 'garage') {
      // m11: advances ONLY after a purchase since the stage began
      // (snapshot taken in beginStage) — never a free pass.
      if (ctx.isGarageStageComplete
        && ctx.isGarageStageComplete(s.garageSnapshot ?? 0, ctx.garage, st.purchasesRequired || 1)) {
        return advance(ctx);
      }
    }
    return null;
  }

  return { start, fail, complete, advance, update, currentObjective, stageDef,
    get activeDef() { return r.active; }, get stage() { return r.stageIndex; },
    get timeLeft() { return r.timeLeft; }, get completedCount() { return r.completedCount; },
    get highestUnlocked() { return r.highestUnlocked; } };
}
