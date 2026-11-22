// shots.js — the 4 screenshot poses (deterministic, seed 7).
// Each pose stages a real game state through the live systems, then the
// main loop paints it twice and sets window.__shotReady.
// Poses: cover (bright daytime, waterfront, chase, wanted 3, escape
// objective), mission (on foot, shootout, fixer dialog visible),
// night (night chase, headlights, roadblock, wanted 4), start
// (title overlay over the living city).

export const SHOT_NAMES = ['cover', 'mission', 'night', 'start'];

// Stage a pose on the live game object (built by main.js). Returns the
// screen the renderer should draw behind the DOM overlay.
export function stageShot(name, game) {
  if (name === 'cover') {
    game.setTimeOfDay(0.25); // bright daytime
    game.teleport(2400, 2000); // waterfront
    game.giveCar('sports');
    game.police.setHeat(58); // wanted 3
    game.police.spawnPatrolNear(game.player.x, game.player.y);
    game.startMissionById('m7', { silent: true });
    game.autopilot.setEnabled(true);
    for (let i = 0; i < 90; i++) game.stepFixed(1 / 60); // 1.5s of chase
    return 'play';
  }
  if (name === 'mission') {
    game.setTimeOfDay(0.3);
    game.teleport(1800, 1800); // downtown yard
    game.startMissionById('m8', { silent: true });
    game.offerMission(7); // fixer dialog visible over the staged shootout
    for (let i = 0; i < 30; i++) game.stepFixed(1 / 60);
    return 'play';
  }
  if (name === 'night') {
    game.setTimeOfDay(0.85); // deep night
    game.teleport(1400, 1400);
    game.giveCar('sedan');
    game.police.setHeat(80); // wanted 4
    game.police.spawnPatrolNear(game.player.x, game.player.y);
    game.police.spawnPatrolNear(game.player.x, game.player.y);
    game.autopilot.setEnabled(true);
    for (let i = 0; i < 120; i++) game.stepFixed(1 / 60);
    return 'play';
  }
  // start: title overlay over the living city.
  game.setTimeOfDay(0.3);
  game.teleport(1400, 1400);
  for (let i = 0; i < 60; i++) game.stepFixed(1 / 60);
  return 'title';
}
