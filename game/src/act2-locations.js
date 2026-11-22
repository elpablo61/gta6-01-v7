// act2-locations.js — shared landmark coordinates for the Act 2 systems.
//
// Crescent Bay is 3200x3200. Roads run at 200 + i*400 (200, 600, 1000,
// 1400, 1800, 2200, 2600, 3000). Every landmark below sits ON a road
// junction so cars can drive straight to it and on-foot legs stay short.
// These are the Act 2 defaults: Builder C wires them to the base game's
// real landmark positions if the base uses different spots for the same
// named places (hideout, bank, airport, garage, docks). Nothing here
// reads any other module; every Act 2 module takes its locations from
// this table (or from an override passed in by the integrator).

export const WORLD_SIZE = 3200;

export const ACT2_LOCATIONS = {
  // Fixer Garage — garage upgrades (m11) and the paint/repair stop.
  garage: { x: 1400, y: 1000 },
  // Rook's hideout — m9 escape destination.
  hideout: { x: 600, y: 2600 },
  // Gun store — fixed SMG crate in the world.
  gunStore: { x: 1000, y: 600 },
  // South Docks — m10 shootout arena + fixed shotgun crate.
  docks: { x: 2600, y: 2600 },
  // Downtown bank — m12 shootout arena + loot marker.
  bank: { x: 1800, y: 1400 },
  // Airport — m12 escape destination + plane marker.
  airport: { x: 2600, y: 600 },
  // Airport plane marker (end of m12, on the runway apron by the road).
  plane: { x: 2800, y: 600 },
  // Marina / pier — m11 timed checkpoint.
  marina: { x: 3000, y: 1800 },
  // Club — m11 timed checkpoint.
  club: { x: 1400, y: 2200 },
  // Market — spare pickup point used by free-roam crate spawns.
  market: { x: 600, y: 1000 },
};

// How close Rook must get for an arrival to count (tight on purpose:
// v6's m9 completed from ~400 units away, which made the escape fake).
export const ARRIVAL_RADIUS = 60;
// Radius inside which walking over a weapon crate / ammo pickup collects it.
export const PICKUP_RADIUS = 46;
