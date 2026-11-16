import * as THREE from 'three';
import { PALETTE } from './palette.js';

// HELIOS RELAY — grenades: flash / smoke / HE with fuses, bounce and blast.
export const GRENADES = {
  flash: { name: 'Flash', price: 200 },
  smoke: { name: 'Smoke', price: 300 },
  he: { name: 'HE', price: 300 },
};

const FUSE = { flash: 1.6, smoke: 1.2, he: 1.4 };
const GRAVITY = 12, HE_RADIUS = 5, SMOKE_RADIUS = 4.5, SMOKE_LIFE = 12;

export function createGrenades(scene, colliders) {
  const grenadeGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const grenadeMat = new THREE.MeshStandardMaterial({ color: 0x1f1a16, roughness: 0.7, metalness: 0.3 });
  const smokeGeo = new THREE.SphereGeometry(1, 16, 12);
  const smokeMat = new THREE.MeshBasicMaterial({ color: PALETTE.muted, transparent: true, opacity: 0.5, depthWrite: false });

  const live = []; // { kind, mesh, vel, fuse, impacted }
  const smokes = []; // { pos, radius, expires, mesh }
  const _ab = new THREE.Vector3(), _ap = new THREE.Vector3(), _c = new THREE.Vector3();
  let now = 0, flashLevelValue = 0;

  // Slab test: does segment a->b touch the box?
  function segmentHitsBox(ax, ay, az, bx, by, bz, c) {
    let tmin = 0, tmax = 1;
    const a = [ax, ay, az], b = [bx, by, bz], mn = [c.min.x, c.min.y, c.min.z], mx = [c.max.x, c.max.y, c.max.z];
    for (let i = 0; i < 3; i++) {
      const d = b[i] - a[i];
      if (Math.abs(d) < 1e-8) { if (a[i] < mn[i] || a[i] > mx[i]) return false; }
      else {
        let t1 = (mn[i] - a[i]) / d, t2 = (mx[i] - a[i]) / d;
        if (t1 > t2) { const t = t1; t1 = t2; t2 = t; }
        if (t1 > tmin) tmin = t1;
        if (t2 < tmax) tmax = t2;
        if (tmin > tmax) return false;
      }
    }
    return true;
  }

  function segmentBlocked(ax, ay, az, bx, by, bz) {
    for (let i = 0; i < colliders.length; i++) {
      if (segmentHitsBox(ax, ay, az, bx, by, bz, colliders[i])) return true;
    }
    return false;
  }

  function insideBox(p) {
    for (let i = 0; i < colliders.length; i++) {
      const c = colliders[i];
      if (p.x > c.min.x && p.x < c.max.x && p.y > c.min.y && p.y < c.max.y && p.z > c.min.z && p.z < c.max.z) return true;
    }
    return false;
  }

  function throwGrenade(kind, origin, dir, power) {
    if (!GRENADES[kind]) return null;
    const mesh = new THREE.Mesh(grenadeGeo, grenadeMat);
    mesh.position.copy(origin);
    scene.add(mesh);
    const vel = dir.clone().normalize().multiplyScalar(power);
    vel.y += power * 0.25 + 2; // upward arc
    const g = { kind, mesh, vel, fuse: FUSE[kind], impacted: false };
    live.push(g);
    return g;
  }

  // Emit one grenade event to main.js. main passes a single function that
  // accepts an event object ({ type, strength, position }); an object with
  // per-kind methods (flash/smokeAt/explode) is also accepted.
  function emit(onEvent, kind, pos, strength) {
    if (typeof onEvent === 'function') {
      onEvent({ type: kind, strength: strength ?? 0, position: pos ? pos.clone() : null });
      return;
    }
    if (!onEvent) return;
    if (kind === 'flash' && onEvent.flash) onEvent.flash(strength ?? 1, pos.clone());
    else if (kind === 'smoke' && onEvent.smokeAt) onEvent.smokeAt(pos.clone());
    else if (kind === 'explode' && onEvent.explode) onEvent.explode(pos.clone());
  }

  function detonate(g, actors, onEvent) {
    const pos = g.mesh.position;
    if (g.kind === 'flash') {
      flashLevelValue = 1;
      emit(onEvent, 'flash', pos, 1);
    } else if (g.kind === 'smoke') {
      const mesh = new THREE.Mesh(smokeGeo, smokeMat);
      mesh.position.copy(pos);
      mesh.scale.setScalar(SMOKE_RADIUS);
      scene.add(mesh);
      smokes.push({ pos: pos.clone(), radius: SMOKE_RADIUS, expires: now + SMOKE_LIFE, mesh });
      emit(onEvent, 'smoke', pos, 0);
    } else if (g.kind === 'he') {
      emit(onEvent, 'explode', pos, 0);
      for (let i = 0; i < actors.length; i++) {
        const a = actors[i];
        // Actors arrive as { pos, damage } (main normalises player + bots);
        // accept a raw { position } shape too.
        const p = a.pos || a.position;
        if (!p || typeof p.distanceTo !== 'function') continue;
        const dist = p.distanceTo(pos);
        if (dist > HE_RADIUS) continue;
        let dmg = 90 - 70 * (dist / HE_RADIUS); // 90 centre -> 20 edge
        if (segmentBlocked(pos.x, pos.y, pos.z, p.x, p.y, p.z)) dmg *= 0.5;
        if (typeof a.damage === 'function') a.damage(dmg);
      }
    }
  }

  function step(dt, actors, onEvent) {
    dt = Math.min(dt, 0.05); // long frames must not tunnel grenades or skip fuses
    now += dt;
    if (flashLevelValue > 0) flashLevelValue = Math.max(0, flashLevelValue - dt * 0.9);
    const list = actors || [];
    for (let i = live.length - 1; i >= 0; i--) {
      const g = live[i];
      g.fuse -= dt;
      g.vel.y -= GRAVITY * dt;
      g.mesh.position.addScaledVector(g.vel, dt);
      const p = g.mesh.position;
      if (p.y < 0.09) { // ground bounce
        p.y = 0.09;
        g.vel.y = Math.abs(g.vel.y) > 0.8 ? -g.vel.y * 0.45 : 0;
        g.vel.x *= 0.7; g.vel.z *= 0.7;
        g.impacted = true;
      } else if (insideBox(p)) { // wall / crate bounce
        p.addScaledVector(g.vel, -dt);
        g.vel.multiplyScalar(0.4);
        g.vel.y = Math.abs(g.vel.y) * 0.4 + 0.5;
        g.impacted = true;
      }
      if ((g.kind === 'flash' && g.impacted) || g.fuse <= 0) {
        detonate(g, list, onEvent);
        scene.remove(g.mesh);
        live.splice(i, 1);
      }
    }
    for (let i = smokes.length - 1; i >= 0; i--) {
      if (now >= smokes[i].expires) {
        scene.remove(smokes[i].mesh);
        smokes.splice(i, 1);
      }
    }
  }

  // True when segment a->b passes through any live smoke sphere.
  function smokeBlocks(ax, ay, az, bx, by, bz) {
    _ab.set(bx - ax, by - ay, bz - az);
    const len2 = _ab.lengthSq();
    for (let i = 0; i < smokes.length; i++) {
      const s = smokes[i];
      _ap.set(s.pos.x - ax, s.pos.y - ay, s.pos.z - az);
      const t = len2 > 0 ? Math.max(0, Math.min(1, _ap.dot(_ab) / len2)) : 0;
      _c.set(ax, ay, az).addScaledVector(_ab, t);
      if (_c.distanceToSquared(s.pos) < s.radius * s.radius) return true;
    }
    return false;
  }

  function clear() {
    for (let i = 0; i < live.length; i++) scene.remove(live[i].mesh);
    for (let i = 0; i < smokes.length; i++) scene.remove(smokes[i].mesh);
    live.length = 0; smokes.length = 0;
    flashLevelValue = 0;
  }

  return {
    throwGrenade, step, smokes, smokeBlocks, clear,
    get flashLevel() { return flashLevelValue; },
  };
}
