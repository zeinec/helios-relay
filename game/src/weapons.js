import * as THREE from 'three';
import { PALETTE } from './palette.js';

// HELIOS RELAY — weapons: stats table + first-person view-model + firing state.
export const WEAPONS = {
  pistol: { name: 'Sidewinder', price: 0, damage: 26, headMult: 2, fireGap: 0.16, auto: false, mag: 12, reserve: 48, reloadTime: 1.2, spreadStill: 0.003, spreadMove: 0.02, bloom: 0.002, recoilPitch: 0.006, recoilYaw: 0.003, zoom: 1 },
  smg: { name: 'Hornet', price: 1500, damage: 22, headMult: 2, fireGap: 0.075, auto: true, mag: 32, reserve: 96, reloadTime: 1.7, spreadStill: 0.006, spreadMove: 0.032, bloom: 0.004, recoilPitch: 0.007, recoilYaw: 0.004, zoom: 1 },
  rifle: { name: 'Longbow', price: 2700, damage: 34, headMult: 4, fireGap: 0.096, auto: true, mag: 30, reserve: 90, reloadTime: 1.9, spreadStill: 0.0022, spreadMove: 0.028, bloom: 0.003, recoilPitch: 0.009, recoilYaw: 0.004, zoom: 1 },
  sniper: { name: 'Meridian', price: 4750, damage: 95, headMult: 2, fireGap: 1.1, auto: false, mag: 5, reserve: 15, reloadTime: 2.6, spreadStill: 0.0012, spreadMove: 0.06, bloom: 0.001, recoilPitch: 0.03, recoilYaw: 0.008, zoom: 3.2 },
};

// View-model proportions per weapon: receiver / barrel / stock lengths (m).
const PROPS = {
  pistol: { recv: 0.26, barrel: 0.16, stock: 0 },
  smg: { recv: 0.34, barrel: 0.26, stock: 0.12 },
  rifle: { recv: 0.42, barrel: 0.48, stock: 0.18 },
  sniper: { recv: 0.46, barrel: 0.72, stock: 0.22 },
};
const BASE_POS = { x: 0.22, y: -0.22, z: -0.45 };

export function createWeapon(camera) {
  const group = new THREE.Group();
  const unitBox = new THREE.BoxGeometry(1, 1, 1);
  const metal = new THREE.MeshStandardMaterial({ color: 0x35302a, roughness: 0.55, metalness: 0.65 });
  const accent = new THREE.MeshStandardMaterial({ color: PALETTE.rust, roughness: 0.5, metalness: 0.4 });
  const gripMat = new THREE.MeshStandardMaterial({ color: PALETTE.surface, roughness: 0.8, metalness: 0.2 });

  const receiver = new THREE.Mesh(unitBox, metal);
  const barrel = new THREE.Mesh(unitBox, accent);
  const stock = new THREE.Mesh(unitBox, gripMat);
  const flash = new THREE.Mesh(
    new THREE.PlaneGeometry(0.2, 0.2),
    new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
  );
  const light = new THREE.PointLight(0xffa040, 0, 4, 2);
  group.add(receiver, barrel, stock, flash, light);
  group.position.set(BASE_POS.x, BASE_POS.y, BASE_POS.z);
  camera.add(group);

  const state = {
    id: 'rifle', mag: WEAPONS.rifle.mag, reserve: WEAPONS.rifle.reserve,
    cooldown: 0, reloadLeft: 0, flash: 0, kick: 0, bloomShots: 0,
  };
  let reloadTotal = 0;

  function applyProps(id) {
    const p = PROPS[id];
    receiver.scale.set(0.09, 0.13, p.recv);
    receiver.position.set(0, 0, 0);
    barrel.scale.set(0.05, 0.05, p.barrel);
    barrel.position.set(0, 0.02, -(p.recv / 2 + p.barrel / 2 - 0.04));
    stock.scale.set(0.08, 0.11, p.stock);
    stock.position.set(0, -0.01, p.recv / 2 + p.stock / 2 - 0.02);
    stock.visible = p.stock > 0;
    const tipZ = -(p.recv / 2 + p.barrel - 0.04);
    flash.position.set(0, 0.02, tipZ - 0.02);
    light.position.set(0, 0.02, tipZ);
  }
  applyProps(state.id);

  function current() { return WEAPONS[state.id]; }

  function step(dt) {
    if (state.cooldown > 0) state.cooldown = Math.max(0, state.cooldown - dt);
    if (state.flash > 0) state.flash = Math.max(0, state.flash - dt);
    state.kick *= Math.max(0, 1 - 10 * dt);
    if (state.cooldown <= 0 && state.bloomShots > 0) {
      state.bloomShots = Math.max(0, state.bloomShots - dt * 5);
    }
    flash.visible = state.flash > 0;
    if (state.flash > 0) flash.material.opacity = 0.9 * (state.flash / 0.06);
    light.intensity = state.flash > 0 ? 2.5 * (state.flash / 0.06) : 0;
    // View-model kick + reload dip.
    group.position.z = BASE_POS.z + state.kick * 0.05;
    if (state.reloadLeft > 0) {
      state.reloadLeft -= dt;
      const prog = 1 - Math.max(0, state.reloadLeft) / reloadTotal;
      const dip = Math.sin(Math.min(1, prog) * Math.PI) * 0.09;
      group.position.y = BASE_POS.y - dip;
      group.rotation.x = dip * 0.6;
      if (state.reloadLeft <= 0) {
        state.reloadLeft = 0;
        const w = current();
        const need = w.mag - state.mag, take = Math.min(need, state.reserve);
        state.mag += take; state.reserve -= take;
        group.position.y = BASE_POS.y; group.rotation.x = 0;
      }
    }
  }

  function ready() {
    return state.mag > 0 && state.cooldown <= 0 && state.reloadLeft <= 0;
  }

  function pullTrigger() {
    if (!ready()) return false;
    state.cooldown = current().fireGap;
    state.flash = 0.06;
    flash.rotation.z = Math.random() * Math.PI; // fresh flash shape each shot
    state.kick = Math.min(1, state.kick + 0.35);
    state.bloomShots += 1;
    return true;
  }

  function takeRound() {
    if (state.mag <= 0) return false;
    state.mag -= 1;
    return true;
  }

  function reload() {
    const w = current();
    if (state.reloadLeft > 0 || state.mag >= w.mag || state.reserve <= 0) return false;
    state.reloadLeft = w.reloadTime;
    reloadTotal = w.reloadTime;
    return true;
  }

  function spread(speed) {
    const w = current();
    const moveFactor = Math.min(1, speed / 5.2);
    return w.spreadStill + moveFactor * w.spreadMove + state.bloomShots * w.bloom;
  }

  function refill() {
    const w = current();
    state.mag = w.mag; state.reserve = w.reserve;
  }

  function equip(id) {
    if (!WEAPONS[id]) return false;
    state.id = id;
    applyProps(id);
    refill();
    state.cooldown = 0.35; // brief draw delay
    state.reloadLeft = 0; state.flash = 0; state.kick = 0; state.bloomShots = 0;
    group.position.set(BASE_POS.x, BASE_POS.y, BASE_POS.z);
    group.rotation.x = 0;
    return true;
  }

  function damageAt(distance) {
    const d = current().damage;
    if (distance <= 15) return d;
    if (distance >= 40) return d * 0.6;
    return d * (1 - 0.4 * (distance - 15) / 25);
  }

  return { state, group, step, ready, pullTrigger, takeRound, reload, spread, refill, equip, current, damageAt };
}
