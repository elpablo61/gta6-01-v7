// input.js — keyboard + mouse. Held keys steer; one-shot presses are
// queued as bit flags and taken once by the loop, so a press between
// frames is never lost and never counted twice.

export const ACTION_CONFIRM = 1; // Space / Enter / click (accept dialog, start)
export const ACTION_PAUSE = 2;   // P / Escape
export const ACTION_ENTER_CAR = 4; // E
export const ACTION_RADIO = 8;   // R (handled by the radio module when present)
export const ACTION_CYCLE_WEAPON = 16; // Q

const MOVE_KEYS = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
};

export function createInput(canvas) {
  const held = { up: false, down: false, left: false, right: false, shift: false };
  let actions = 0;
  const pressedKeys = new Set(); // one-shot keydown queue for weapon keys etc.
  let mouseX = 0, mouseY = 0, mouseDown = false;

  window.addEventListener('keydown', (event) => {
    const mv = MOVE_KEYS[event.code];
    if (mv) { held[mv] = true; event.preventDefault(); return; }
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') { held.shift = true; return; }
    if (event.repeat) return;
    if (event.code === 'Space' || event.code === 'Enter') { actions |= ACTION_CONFIRM; event.preventDefault(); }
    else if (event.code === 'KeyP' || event.code === 'Escape') actions |= ACTION_PAUSE;
    else if (event.code === 'KeyE') actions |= ACTION_ENTER_CAR;
    else if (event.code === 'KeyR') actions |= ACTION_RADIO;
    else if (event.code === 'KeyQ') actions |= ACTION_CYCLE_WEAPON;
    else pressedKeys.add(event.code);
  });
  window.addEventListener('keyup', (event) => {
    const mv = MOVE_KEYS[event.code];
    if (mv) held[mv] = false;
    if (event.code === 'ShiftLeft' || event.code === 'ShiftRight') held.shift = false;
  });
  window.addEventListener('blur', () => {
    held.up = held.down = held.left = held.right = held.shift = false;
    mouseDown = false;
  });
  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
  });
  canvas.addEventListener('pointerdown', (e) => {
    const r = canvas.getBoundingClientRect();
    mouseX = e.clientX - r.left; mouseY = e.clientY - r.top;
    mouseDown = true;
    actions |= ACTION_CONFIRM;
  });
  window.addEventListener('pointerup', () => { mouseDown = false; });

  return {
    held,
    takeActions() { const t = actions; actions = 0; return t; },
    takePressedKeys() { const t = [...pressedKeys]; pressedKeys.clear(); return t; },
    mouse() { return { x: mouseX, y: mouseY, down: mouseDown }; },
    moveVector() {
      const x = (held.right ? 1 : 0) - (held.left ? 1 : 0);
      const y = (held.down ? 1 : 0) - (held.up ? 1 : 0);
      return { x, y };
    },
  };
}
