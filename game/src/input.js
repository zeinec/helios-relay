// input.js — keyboard, mouse and pointer lock for HELIOS RELAY. Plain browser APIs only.
// pressed(code) is edge-triggered: true once per physical press, consumed on read.
export function createInput(canvas, onLockChange) {
  const state = { keys: new Set(), locked: false, firing: false, aiming: false, lookX: 0, lookY: 0, wheel: 0 };
  const pressedSet = new Set();

  function onKeyDown(e) {
    if (e.code === 'Space') e.preventDefault();
    if (!state.keys.has(e.code)) pressedSet.add(e.code);
    state.keys.add(e.code);
  }
  function onKeyUp(e) { state.keys.delete(e.code); pressedSet.delete(e.code); }
  function onBlur() { state.keys.clear(); pressedSet.clear(); state.firing = false; state.aiming = false; }

  function onMouseMove(e) {
    if (!state.locked) return;
    state.lookX += e.movementX || 0;
    state.lookY += e.movementY || 0;
  }
  function onMouseDown(e) {
    if (!state.locked) return;
    if (e.button === 0) state.firing = true;
    if (e.button === 2) state.aiming = true;
  }
  function onMouseUp(e) {
    if (e.button === 0) state.firing = false;
    if (e.button === 2) state.aiming = false;
  }
  function onWheel(e) { state.wheel += Math.sign(e.deltaY || 0); }
  function onLock() {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) { state.keys.clear(); pressedSet.clear(); state.firing = false; state.aiming = false; }
    if (typeof onLockChange === 'function') onLockChange(state.locked);
  }

  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);
  document.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mousedown', onMouseDown);
  window.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('wheel', onWheel, { passive: true });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  document.addEventListener('pointerlockchange', onLock);

  function takeLook() {
    const out = { x: state.lookX, y: state.lookY };
    state.lookX = 0; state.lookY = 0;
    return out;
  }
  function pressed(code) {
    if (!pressedSet.has(code)) return false;
    pressedSet.delete(code);
    return true;
  }
  function takeWheel() {
    const w = state.wheel;
    state.wheel = 0;
    return w;
  }
  function requestLock() {
    if (document.pointerLockElement !== canvas) {
      // requestPointerLock returns a promise in Chrome; it rejects if called
      // too soon after an exit — swallow it, the user can click again.
      const p = canvas.requestPointerLock();
      if (p && typeof p.catch === 'function') p.catch(() => {});
    }
  }
  function releaseLock() {
    if (state.locked) document.exitPointerLock();
  }

  return { state, takeLook, pressed, takeWheel, requestLock, releaseLock };
}
