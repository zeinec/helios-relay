import * as THREE from 'three';

// HELIOS RELAY — player movement: WASD, crouch, jump, vault, axis-separated
// AABB collision against Box3 colliders ({ min, max }).
const R = 0.34; // body radius
const STAND_H = 1.72, CROUCH_H = 1.12;
const STAND_EYE = 1.6, CROUCH_EYE = 1.02;
const WALK_SPEED = 5.2, CROUCH_SPEED = 2.4;
const GROUND_ACCEL = 42, AIR_ACCEL = 9, FRICTION = 9;
const GRAVITY = 20, JUMP_SPEED = 6.2, MAX_FALL = -30;
const LIFT = 0.04; // floor never blocks horizontal moves

export function createPlayer(colliders) {
  const state = {
    position: new THREE.Vector3(0, 0, 14),
    velocity: new THREE.Vector3(),
    yaw: 0, pitch: 0,
    eye: STAND_EYE, onGround: true, crouching: false, height: STAND_H,
  };

  // First collider overlapping the player box at (x, y, z) with height h.
  function hitAt(x, y, z, h) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (x + R > c.min.x && x - R < c.max.x &&
          y + h > c.min.y && y < c.max.y &&
          z + R > c.min.z && z - R < c.max.z) return c;
    }
    return null;
  }

  // Highest collider top under the player (for landing snaps).
  function landingTop(x, z, y, h) {
    let top = -Infinity;
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (x + R > c.min.x && x - R < c.max.x &&
          z + R > c.min.z && z - R < c.max.z &&
          c.max.y <= y + 0.05 && c.min.y < y + h) {
        if (c.max.y > top) top = c.max.y;
      }
    }
    return top;
  }

  function step(dt, keys) {
    dt = Math.min(dt, 0.05);
    const p = state.position, v = state.velocity;

    // Crouch: shrink while held; standing up is refused when headroom is blocked.
    const wantCrouch = keys.has('ControlLeft') || keys.has('ControlRight') || keys.has('KeyC');
    if (wantCrouch) {
      state.crouching = true; state.height = CROUCH_H; state.eye = CROUCH_EYE;
    } else if (!hitAt(p.x, p.y, p.z, STAND_H)) {
      state.crouching = false; state.height = STAND_H; state.eye = STAND_EYE;
    }

    // Wish direction from WASD relative to yaw (yaw 0 faces -Z).
    let fx = 0, fz = 0;
    if (keys.has('KeyW')) fz -= 1;
    if (keys.has('KeyS')) fz += 1;
    if (keys.has('KeyA')) fx -= 1;
    if (keys.has('KeyD')) fx += 1;
    const sin = Math.sin(state.yaw), cos = Math.cos(state.yaw);
    let wx = -sin * -fz + cos * fx;
    let wz = -cos * -fz - sin * fx;
    const len = Math.hypot(wx, wz);
    if (len > 0) { wx /= len; wz /= len; }

    const speed = state.crouching ? CROUCH_SPEED : WALK_SPEED;
    const accel = state.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const t = 1 - Math.exp(-accel * dt);
    v.x += (wx * speed - v.x) * t;
    v.z += (wz * speed - v.z) * t;
    if (state.onGround && len === 0) {
      const f = Math.max(0, 1 - FRICTION * dt);
      v.x *= f; v.z *= f;
      if (Math.hypot(v.x, v.z) < 0.02) { v.x = 0; v.z = 0; }
    }

    const wasGround = state.onGround;
    const hh = state.height;

    // Horizontal moves, axis-separated; record the blocker for vaulting.
    let blocked = false, blocker = null;
    const nx = p.x + v.x * dt;
    if (!hitAt(nx, p.y + LIFT, p.z, hh)) p.x = nx;
    else { blocked = true; v.x = 0; blocker = hitAt(nx, p.y + LIFT, p.z, hh); }
    const nz = p.z + v.z * dt;
    if (!hitAt(p.x, p.y + LIFT, nz, hh)) p.z = nz;
    else {
      blocked = true; v.z = 0;
      if (!blocker) blocker = hitAt(p.x, p.y + LIFT, nz, hh);
    }

    // Jump, or vault onto a low blocker (top 0.4–1.15 m above the feet).
    if (keys.has('Space') && wasGround) {
      if (blocked && blocker) {
        const rise = blocker.max.y - p.y;
        if (rise >= 0.4 && rise <= 1.15) {
          p.y = blocker.max.y; v.y = 2.2; state.onGround = false;
        } else { v.y = JUMP_SPEED; state.onGround = false; }
      } else { v.y = JUMP_SPEED; state.onGround = false; }
    }

    // Gravity, then vertical move with landing snap.
    v.y -= GRAVITY * dt;
    if (v.y < MAX_FALL) v.y = MAX_FALL;
    const ny = p.y + v.y * dt;
    if (v.y <= 0) {
      if (!hitAt(p.x, ny, p.z, hh)) {
        if (ny <= 0) { p.y = 0; v.y = 0; state.onGround = true; }
        else { p.y = ny; state.onGround = false; }
      } else {
        const top = landingTop(p.x, p.z, p.y, hh);
        if (top > -Infinity) p.y = top; else p.y = ny;
        v.y = 0; state.onGround = true;
      }
    } else {
      if (!hitAt(p.x, ny, p.z, hh)) { p.y = ny; state.onGround = false; }
      else { v.y = 0; state.onGround = false; }
    }
  }

  function look(dx, dy) {
    state.yaw -= dx * 0.0022;
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch - dy * 0.0022));
  }

  function recoil(pitchKick, yawKick) {
    state.pitch = Math.max(-1.45, Math.min(1.45, state.pitch + pitchKick));
    state.yaw += yawKick;
  }

  function groundSpeed() {
    return Math.hypot(state.velocity.x, state.velocity.z);
  }

  return { state, step, look, recoil, groundSpeed };
}
