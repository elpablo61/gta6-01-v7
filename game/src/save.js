// save.js — versioned localStorage save + autosave when a mission
// completes. Single slot is the default active slot; the Act 2 saves
// module (Builder B-2, saves3.js) extends this to 3 slots by calling
// the same serialize/deserialize helpers with its own keys.

import { SAVE_KEY, SAVE_VERSION } from './config.js';

export function serialize(game) {
  return {
    version: SAVE_VERSION,
    savedAt: new Date().toISOString(),
    cash: Math.floor(game.player.cash),
    missionIndex: game.missionIndex || 0,
    highestUnlocked: game.runner ? game.runner.highestUnlocked : 0,
    player: { x: game.player.x, y: game.player.y, hp: game.player.hp },
    weapons: game.weapons ? game.weapons.toJSON() : null,
    heat: game.police ? game.police.state.heat : 0,
    timeOfDay: game.timeOfDay || 0,
  };
}

export function deserialize(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.version !== SAVE_VERSION) return null; // corrupt / old: never crash
  return data;
}

export function saveGame(game, key = SAVE_KEY) {
  try {
    window.localStorage.setItem(key, JSON.stringify(serialize(game)));
    return true;
  } catch { return false; }
}

export function loadGame(key = SAVE_KEY) {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    return deserialize(JSON.parse(raw));
  } catch { return null; } // corrupt slot: caller shows it as corrupt
}

export function applySave(game, data) {
  if (!data) return false;
  game.player.cash = data.cash ?? game.player.cash;
  game.player.x = data.player?.x ?? game.player.x;
  game.player.y = data.player?.y ?? game.player.y;
  game.player.hp = data.player?.hp ?? game.player.hp;
  game.missionIndex = data.missionIndex ?? 0;
  if (data.weapons && game.weapons) game.weapons.fromJSON(data.weapons);
  if (game.police) game.police.setHeat(data.heat ?? 0);
  if (typeof data.timeOfDay === 'number') game.timeOfDay = data.timeOfDay;
  return true;
}

export function autosave(game) { return saveGame(game); }
