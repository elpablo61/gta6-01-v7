// config.js — every tuning number for Crescent Bay in one place.
// World 3200x3200, 8x8 road grid, roads at 200 + i*400, width 64.
// Canvas 2D vanilla, no libraries, no network, no external assets.

export const WORLD_SIZE = 3200;
export const ROAD_SPACING = 400;
export const ROAD_OFFSET = 200;
export const ROAD_WIDTH = 64;
export const ROAD_COUNT = 8;

export const STEP = 1 / 60;
export const SEED_DEFAULT = 20261118;

export const WANTED_THRESHOLDS = [0, 12, 30, 52, 74, 92]; // heat -> stars 0..5
export const HEAT_MAX = 100;
export const HEAT_DECAY_PER_SEC = 6;
export const HIDE_DISTANCE = 450;
export const HIDE_SECONDS = 3;

export const SPRAY_SHOP = { x: 2200, y: 2200, radius: 150, drainPerSec: 50 };

export const PLAYER_FOOT_SPEED = 210;
export const PLAYER_SPRINT_SPEED = 330;
export const PLAYER_HP = 100;

export const CAR_TYPES = {
  sedan:   { name: 'Sedan',   topSpeed: 380, accel: 260, brake: 420, turnRadius: 95,  color: '#5b7fa6', length: 46, width: 22 },
  taxi:    { name: 'Taxi',    topSpeed: 360, accel: 250, brake: 420, turnRadius: 95,  color: '#e8b93c', length: 46, width: 22 },
  truck:   { name: 'Truck',   topSpeed: 300, accel: 170, brake: 320, turnRadius: 130, color: '#8a6f4d', length: 58, width: 26 },
  sports:  { name: 'Sports',  topSpeed: 520, accel: 380, brake: 520, turnRadius: 80,  color: '#c0392b', length: 48, width: 22 },
  police:  { name: 'Patrol',  topSpeed: 460, accel: 330, brake: 500, turnRadius: 88,  color: '#1c2733', length: 48, width: 22 },
};

export const DISTRICTS = [
  { name: 'Northside',  x0: 0,    y0: 0,    x1: 3200, y1: 800,  style: 'houses' },
  { name: 'Old Town',   x0: 0,    y0: 800,  x1: 1600, y1: 1800, style: 'brick' },
  { name: 'Downtown',   x0: 1600, y0: 800,  x1: 3060, y1: 1800, style: 'glass' },
  { name: 'Waterfront', x0: 0,    y0: 1800, x1: 3060, y1: 2600, style: 'sand' },
  { name: 'South Docks',x0: 0,    y0: 2600, x1: 3200, y1: 3200, style: 'industrial' },
];

export const PALETTE = {
  grass: '#3f7a44', road: '#33373f', roadLine: '#d8c95a', sidewalk: '#6b6f78',
  beach: '#d9c48a', water: '#2a6d8f', buildingRoof: '#7a6a58', buildingSide: '#4a3f33',
  shadow: 'rgba(40, 30, 90, 0.35)', text: '#eef1f5', muted: '#9aa3b2',
  hudBg: 'rgba(10, 12, 18, 0.72)', accent: '#ffd34d',
};

export const FONT = 'system-ui, -apple-system, "Segoe UI", sans-serif';
export const SAVE_KEY = 'crescent-bay.save.v1';
export const SAVE_VERSION = 1;
