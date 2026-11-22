// world.js — Crescent Bay: 3200x3200, 8x8 road grid, junction graph + BFS,
// districts, beach + water east (x>3060), marina/pier east, 2.5D buildings.
// Deterministic from the seeded RNG. Written fresh from the prose spec.

import { WORLD_SIZE, ROAD_COUNT, ROAD_OFFSET, ROAD_SPACING, ROAD_WIDTH, DISTRICTS } from './config.js';
import { ACT2_LOCATIONS } from './act2-locations.js';

export const LANDMARKS = {
  market: { ...ACT2_LOCATIONS.market, label: 'Market' },
  downtown: { x: 1800, y: 1800, label: 'Downtown' },
  club: { ...ACT2_LOCATIONS.club, label: 'Club' },
  marina: { ...ACT2_LOCATIONS.marina, label: 'Marina' },
  airport: { ...ACT2_LOCATIONS.airport, label: 'Airport' },
  plane: { ...ACT2_LOCATIONS.plane, label: 'Plane' },
  docks: { ...ACT2_LOCATIONS.docks, label: 'South Docks' },
  hideout: { ...ACT2_LOCATIONS.hideout, label: 'Hideout' },
  garage: { ...ACT2_LOCATIONS.garage, label: 'Fixer Garage' },
  gunStore: { ...ACT2_LOCATIONS.gunStore, label: 'Gun Store' },
  bank: { ...ACT2_LOCATIONS.bank, label: 'Bank' },
};

export function roadCoord(i) { return ROAD_OFFSET + i * ROAD_SPACING; }
export function isOnRoad(x, y) {
  for (let i = 0; i < ROAD_COUNT; i++) {
    const c = roadCoord(i);
    if (Math.abs(x - c) <= ROAD_WIDTH / 2 || Math.abs(y - c) <= ROAD_WIDTH / 2) return true;
  }
  return false;
}
export function nearestRoadPoint(x, y) {
  let bestX = x, bestY = y, bestD = Infinity;
  for (let i = 0; i < ROAD_COUNT; i++) {
    const c = roadCoord(i);
    const dV = Math.abs(x - c);
    if (dV < bestD) { bestD = dV; bestX = c; bestY = y; }
    const dH = Math.abs(y - c);
    if (dH < bestD) { bestD = dH; bestX = x; bestY = c; }
  }
  return { x: Math.max(0, Math.min(WORLD_SIZE, bestX)), y: Math.max(0, Math.min(WORLD_SIZE, bestY)) };
}
export function nearestJunction(x, y) {
  let bi = 0, bj = 0, best = Infinity;
  for (let i = 0; i < ROAD_COUNT; i++) for (let j = 0; j < ROAD_COUNT; j++) {
    const dx = roadCoord(i) - x, dy = roadCoord(j) - y, d = dx * dx + dy * dy;
    if (d < best) { best = d; bi = i; bj = j; }
  }
  return { i: bi, j: bj, x: roadCoord(bi), y: roadCoord(bj) };
}

// BFS over the 8x8 junction graph. Indexing is (col i, row j) everywhere:
// key = j * 8 + i, never transposed. Returns junction points from the start
// junction to the destination junction, inclusive — the FIRST junction is
// always the first waypoint (never cut diagonally across a block).
export function findRoute(fromX, fromY, toX, toY) {
  const start = nearestJunction(fromX, fromY);
  const goal = nearestJunction(toX, toY);
  const key = (i, j) => j * ROAD_COUNT + i;
  const prev = new Map();
  const seen = new Set([key(start.i, start.j)]);
  const queue = [{ i: start.i, j: start.j }];
  while (queue.length) {
    const cur = queue.shift();
    if (cur.i === goal.i && cur.j === goal.j) break;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const ni = cur.i + di, nj = cur.j + dj;
      if (ni < 0 || ni >= ROAD_COUNT || nj < 0 || nj >= ROAD_COUNT) continue;
      const k = key(ni, nj);
      if (seen.has(k)) continue;
      seen.add(k);
      prev.set(k, key(cur.i, cur.j));
      queue.push({ i: ni, j: nj });
    }
  }
  const path = [];
  let k = key(goal.i, goal.j);
  let guard = 0;
  while (k !== undefined && guard++ < 200) {
    const i = k % ROAD_COUNT, j = Math.floor(k / ROAD_COUNT);
    path.unshift({ x: roadCoord(i), y: roadCoord(j) });
    if (k === key(start.i, start.j)) break;
    k = prev.get(k);
  }
  if (!path.length) path.push({ x: roadCoord(start.i), y: roadCoord(start.j) });
  return path;
}

export function districtAt(x, y) {
  for (const d of DISTRICTS) if (x >= d.x0 && x < d.x1 && y >= d.y0 && y < d.y1) return d;
  return DISTRICTS[0];
}

export function createWorld(rng) {
  const buildings = [];
  for (let i = 0; i < ROAD_COUNT - 1; i++) {
    for (let j = 0; j < ROAD_COUNT - 1; j++) {
      const x0 = roadCoord(i) + ROAD_WIDTH / 2 + 24;
      const y0 = roadCoord(j) + ROAD_WIDTH / 2 + 24;
      const x1 = roadCoord(i + 1) - ROAD_WIDTH / 2 - 24;
      const y1 = roadCoord(j + 1) - ROAD_WIDTH / 2 - 24;
      if (x0 > 3040) continue;
      if (x0 > 2900 && y0 > 1600 && y0 < 2000) continue; // marina apron stays open
      const d = districtAt((x0 + x1) / 2, (y0 + y1) / 2);
      const count = d.style === 'glass' ? 1 : (rng() < 0.55 ? 2 : 1);
      for (let b = 0; b < count; b++) {
        const w = 90 + rng() * 150;
        const h = 90 + rng() * 150;
        const bx = x0 + (b * (x1 - x0)) / 2 + rng() * Math.max(1, (x1 - x0) / 2 - w);
        const by = y0 + rng() * Math.max(1, y1 - y0 - h);
        const height = d.style === 'glass' ? 46 + rng() * 40 : d.style === 'industrial' ? 16 + rng() * 14 : 20 + rng() * 22;
        buildings.push({
          x: Math.min(bx, x1 - w), y: Math.min(by, y1 - h), w, h, height,
          style: d.style, district: d.name,
          hue: d.style === 'brick' ? '#8a4a3c' : d.style === 'glass' ? '#5f7d99' : d.style === 'industrial' ? '#6e6a5e' : '#7a6a58',
        });
      }
    }
  }
  return {
    rng, buildings,
    // Circle vs building rects: push out and slide along the wall.
    collideCircle(x, y, r) {
      let nx = x, ny = y;
      for (const b of buildings) {
        const cx = Math.max(b.x, Math.min(nx, b.x + b.w));
        const cy = Math.max(b.y, Math.min(ny, b.y + b.h));
        const dx = nx - cx, dy = ny - cy, d2 = dx * dx + dy * dy;
        if (d2 < r * r) {
          if (d2 > 0.01) {
            const d = Math.sqrt(d2);
            nx = cx + (dx / d) * r; ny = cy + (dy / d) * r;
          } else {
            const pl = nx - b.x, pr = b.x + b.w - nx, pt = ny - b.y, pb = b.y + b.h - ny;
            const m = Math.min(pl, pr, pt, pb);
            if (m === pl) nx = b.x - r; else if (m === pr) nx = b.x + b.w + r;
            else if (m === pt) ny = b.y - r; else ny = b.y + b.h + r;
          }
        }
      }
      return { x: nx, y: ny };
    },
    pointInBuilding(x, y) {
      for (const b of buildings) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b;
      return null;
    },
    inWater(x) { return x > 3060; },
  };
}
