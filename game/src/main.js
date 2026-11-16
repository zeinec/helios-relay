import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { createState, addFeed } from './state.js';
import { createMap } from './map.js';
import { createPlayer } from './player.js';
import { WEAPONS, createWeapon } from './weapons.js';
import { createGrenades } from './grenades.js';
import { createCombat } from './combat.js';
import { createBots } from './bots.js';
import { createRounds } from './rounds.js';
import { SHOP, createEconomy, shopItem } from './economy.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';
import { createInput } from './input.js';
import { runShot } from './shots.js';

const FIXED_STEP = 1 / 60;
const ORDER = ['pistol', 'smg', 'rifle', 'sniper'];
const GRENADE_KEYS = { Digit5: 'flash', Digit6: 'smoke', Digit7: 'he' };

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const params = new URLSearchParams(location.search);
const shot = params.get('shot');
const seed = parseInt(params.get('seed') || '1', 10) || 1;
const random = shot ? mulberry32(seed) : Math.random;

// --- boot: renderer / scene / camera ---
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(PALETTE.canvas, 18, 90);
scene.background = new THREE.Color(PALETTE.canvas);
const camera = new THREE.PerspectiveCamera(74, window.innerWidth / window.innerHeight, 0.05, 140);
camera.rotation.order = 'YXZ';
scene.add(camera);

// --- module state ---
let playerHealth = 100;
let playerArmor = 0;
let playerAlive = true;
let started = false;
let time = 0;
let spikeDefused = false;
let flashBlindUntil = -1;
let flashTimer = 0;
let lastPlantBeep = 0;
let stepSndTimer = 0;
let dryFired = false;
let lastFov = 74;
let selectedGrenade = 'flash';
let ownedGrenades = { flash: 0, smoke: 0, he: 0 };
let botCalls = [];
let sounds = [];

const state = createState();
const map = createMap(scene);
const player = createPlayer(map.colliders);
const weapon = createWeapon(camera);
const grenades = createGrenades(scene, map.colliders);
const combat = createCombat(scene);
const bots = createBots(scene, map, random);
const economy = createEconomy();
const audio = createAudio();

// Player proxy: invisible to the eye but raycastable (visible=false skips raycast).
const proxyMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
const playerProxy = new THREE.Mesh(new THREE.BoxGeometry(0.7, 1.7, 0.7), proxyMat);
playerProxy.userData.target = { isPlayer: true };
playerProxy.userData.part = 'torso';
scene.add(playerProxy);
const shootables = [...map.shootables, ...bots.hitMeshes, playerProxy];

// Temp vectors / one raycaster (no per-frame allocation in hot loops).
const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();
const _dir = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3(0, 1, 0);
const losRay = new THREE.Raycaster();

function losBlocked(ax, ay, az, bx, by, bz) {
  _v1.set(ax, ay, az);
  _v2.set(bx - ax, by - ay, bz - az);
  const len = _v2.length();
  if (len < 0.01) return false;
  losRay.set(_v1, _v2.normalize());
  losRay.far = len - 0.3;
  const hits = losRay.intersectObjects(map.shootables, false);
  return hits.length > 0 && hits[0].distance < len - 0.3;
}

function keyDown(code) {
  const k = input.state.keys;
  return k ? (typeof k.has === 'function' ? k.has(code) : !!k[code]) : false;
}

function damagePlayer(amount) {
  if (!playerAlive) return;
  const absorbed = Math.min(playerArmor, amount * 0.5);
  playerArmor -= absorbed;
  playerHealth -= (amount - absorbed);
  if (playerHealth <= 0) {
    playerHealth = 0;
    playerAlive = false;
    state.deaths += 1;
    input.releaseLock();
    hud.setHint('You were eliminated — spectating your squad');
    const carrier = bots.list.find((b) => b.team === 'van' && b.alive);
    if (carrier) carrier.isCarrier = true;
  }
}

function respawnPlayer() {
  const s = map.spawns.van[0];
  player.state.position.set(s[0], 0, s[1]);
  if (player.state.velocity) player.state.velocity.set(0, 0, 0);
  player.state.yaw = 0;
  player.state.pitch = 0;
  playerAlive = true;
  playerHealth = 100;
}

function aimAt(x, y, z) {
  const p = player.state.position;
  const ex = p.x, ey = p.y + (player.state.eye || 1.6), ez = p.z;
  const dx = x - ex, dy = y - ey, dz = z - ez;
  player.state.yaw = Math.atan2(-dx, -dz);
  player.state.pitch = Math.atan2(dy, Math.hypot(dx, dz));
}

function syncCamera() {
  camera.position.copy(player.state.position);
  camera.position.y += player.state.eye || 1.6;
  camera.rotation.y = player.state.yaw;
  camera.rotation.x = player.state.pitch;
  camera.rotation.z = 0;
  playerProxy.position.copy(player.state.position);
  playerProxy.position.y += 0.85;
}

// --- player shooting (shared by live input and shots.js shootOnce) ---
function fireShot(zeroSpread, holdMs) {
  if (!weapon.takeRound()) return null;
  camera.getWorldDirection(_dir);
  if (!zeroSpread) {
    const sp = weapon.spread(player.groundSpeed());
    _dir.x += (random() - 0.5) * sp;
    _dir.y += (random() - 0.5) * sp;
    _dir.z += (random() - 0.5) * sp;
    _dir.normalize();
  }
  const origin = camera.position;
  const hit = combat.shoot(origin, _dir, shootables);
  camera.getWorldDirection(_fwd);
  _right.crossVectors(_fwd, _up).normalize();
  _v1.copy(origin).addScaledVector(_fwd, 0.5).addScaledVector(_right, 0.2);
  _v1.y -= 0.15;
  const cur = weapon.current() || WEAPONS[weapon.state.id];
  if (hit) {
    combat.tracer(_v1, hit.point, PALETTE.vanguard);
    const t = hit.target;
    if (t && typeof t.health === 'number') {
      const dmg = combat.damageFor(cur, hit.part, hit.distance);
      const killed = bots.damage(t, dmg, hit.part);
      if (killed) {
        economy.awardKill();
        state.kills += 1;
        hud.killFeed('You ▸ ' + t.name);
      }
      hud.hitMarker(killed, holdMs);
      audio.hit();
    } else if (t && !t.isPlayer) {
      combat.impact(hit.point, hit.normal);
    }
  } else {
    _v2.copy(origin).addScaledVector(_dir, 60);
    combat.tracer(_v1, _v2, PALETTE.vanguard);
  }
  weapon.pullTrigger();
  const kick = 0.8 + random() * 0.4;
  player.recoil(cur.recoilPitch * kick, cur.recoilYaw * kick);
  audio.shot(weapon.state.id);
  hud.setAmmo(weapon.state.mag, weapon.state.reserve);
  sounds.push({ x: origin.x, z: origin.z, kind: 'shot', range: 28 });
  return hit;
}

function shootOnce(holdMs) {
  syncCamera();
  return fireShot(true, holdMs);
}

function botShoot(bot) {
  const eye = _v1.copy(bot.group.position);
  eye.y += 1.5;
  _dir.copy(bot.aimPos).sub(eye).normalize();
  const sp = 0.01 + 0.01 * random();
  _dir.x += (random() - 0.5) * sp;
  _dir.y += (random() - 0.5) * sp;
  _dir.z += (random() - 0.5) * sp;
  _dir.normalize();
  const hit = combat.shoot(eye, _dir, shootables);
  const color = bot.team === 'van' ? PALETTE.vanguard : PALETTE.sentinel;
  if (hit) {
    combat.tracer(eye, hit.point, color);
    const t = hit.target;
    if (t && t.isPlayer) {
      if (playerAlive) {
        const dmg = combat.damageFor(WEAPONS.rifle, hit.part, hit.distance);
        damagePlayer(dmg);
        hud.damageDir(Math.atan2(bot.group.position.x - player.state.position.x,
          bot.group.position.z - player.state.position.z) - player.state.yaw);
        hud.flashVignette();
      }
    } else if (t && typeof t.health === 'number') {
      if (t.team !== bot.team) {
        const dmg = combat.damageFor(WEAPONS.rifle, hit.part, hit.distance);
        bots.damage(t, dmg, hit.part);
      }
      // Same team: no friendly fire, tracer only.
    } else {
      combat.impact(hit.point, hit.normal);
    }
  } else {
    _v2.copy(eye).addScaledVector(_dir, 60);
    combat.tracer(eye, _v2, color);
  }
  sounds.push({ x: eye.x, z: eye.z, kind: 'shot', range: 28 });
  bot.cooldown = 0.09;
  bot.wantFire = false;
}

function handleGrenadeEvent(type, a, b) {
  // Accept both ('flash', strength, pos) and ({type:'flash',...}) shapes.
  let kind = type, strength = a, pos = b;
  if (type && typeof type === 'object') {
    kind = type.type || type.kind; strength = type.strength; pos = type.position || type.pos;
  }
  if (kind === 'flash') {
    const p = pos || _v3;
    camera.getWorldDirection(_fwd);
    _v2.set(p.x - camera.position.x, p.y - camera.position.y, p.z - camera.position.z);
    const dist = _v2.length();
    if (dist < 30 && _v2.normalize().dot(_fwd) > 0) {
      hud.flashVignette();
      flashTimer = 1.2;
      flashBlindUntil = time + 1.5;
    }
    audio.pop();
  } else if (kind === 'explode') {
    audio.explode();
    const p = pos || _v3;
    sounds.push({ x: p.x, z: p.z, kind: 'explosion', range: 40 });
  }
  // smokeAt: bots see smoke via smokeBlocks; nothing to push.
}

function processBotCalls() {
  for (const c of botCalls) {
    const type = c.type || c.kind;
    const data = c.data || {};
    if (type === 'planted' || type === 'plant') {
      if (type === 'planted') {
        state.spike.status = 'planted';
        state.spike.fuse = 35;
        if (data.site) state.spike.site = data.site;
        hud.killFeed('Spike planted at ' + (data.site || state.spike.site || ''));
      }
    } else if (type === 'defused') {
      spikeDefused = true;
      state.spike.status = 'defused';
    }
  }
  botCalls = [];
}

// --- rounds hooks ---
const hooks = {
  onPhase(phase) {
    if (phase === 'live') {
      hud.hideBuy();
      hud.setHint('');
    } else if (phase === 'freeze') {
      ownedGrenades = { flash: 0, smoke: 0, he: 0 };
      spikeDefused = false;
      state.spike.progress = 0;
      hud.hideBanner();
      if (state.spike.status !== 'planted') state.spike.status = 'carried';
      weapon.refill();
      playerArmor = 0;
      respawnPlayer();
      bots.reset(state.round);
      hud.showBuy(SHOP, economy.money);
      hud.setHint('B — buy menu (freeze time)');
      audio.horn();
    }
  },
  onRoundEnd(winner, reason) {
    const reasonText = reason === 'elimination' ? 'Enemy team eliminated'
      : reason === 'time' ? 'Time expired — spike never planted'
      : reason === 'detonation' ? 'Spike detonated'
      : reason === 'defuse' ? 'Spike defused' : String(reason || '');
    hud.showBanner(winner === 'van' ? 'VANGUARD wins the round' : 'SENTINEL wins the round', reasonText);
    if (winner === 'van') audio.win(); else audio.lose();
    addFeed(state, (winner === 'van' ? 'VANGUARD' : 'SENTINEL') + ' wins the round — ' + reasonText);
  },
  onMatchEnd(winner) {
    hud.showOverlay('end', {
      title: winner === 'van' ? 'VANGUARD takes the match' : 'SENTINEL takes the match',
      copy: 'Final score ' + state.scoreVan + ' — ' + state.scoreSen + '.',
    });
    input.releaseLock();
  },
};

const rounds = createRounds(state, economy, hooks);

// --- hud (callbacks close over rounds / input / audio, created later) ---
const hud = createHud({
  onPlay() {
    audio.ensure();
    if (state.matchOver) rounds.startMatch();
    else if (state.phase === 'start') rounds.startMatch();
    // Start the sim even if pointer lock is refused (headless / denied):
    // the lock callback still hides the overlay once lock engages.
    started = true;
    input.requestLock();
  },
  onBuy(id) {
    if (state.phase !== 'freeze') { hud.setHint('Buying is only available during freeze time'); return; }
    const item = shopItem(id);
    if (!item) return;
    if (item.kind === 'weapon' && economy.owned.has(id)) return;
    if (item.kind === 'gear' && id === 'kit') { hud.setHint('Defuse kits are for defenders'); return; }
    if (item.kind === 'grenade' && ownedGrenades[id] >= 1) { hud.setHint('One ' + id + ' per round'); return; }
    if (economy.buy(item)) {
      if (item.kind === 'weapon') weapon.equip(id);
      else if (id === 'kevlar') playerArmor = 100;
      else if (item.kind === 'grenade') ownedGrenades[id] += 1;
      audio.click();
      hud.setBuyMoney(economy.money);
      hud.setMoney(economy.money);
      hud.setAmmo(weapon.state.mag, weapon.state.reserve);
    }
  },
  onRematch() { rounds.startMatch(); },
  onCloseBuy() { hud.hideBuy(); },
});

const input = createInput(renderer.domElement, (locked) => {
  if (shot) return;
  if (locked) {
    started = true;
    hud.hideOverlay();
    if (!state.matchOver && state.phase === 'start') {
      rounds.startMatch();
    }
  } else if (!state.matchOver) {
    hud.showOverlay(started ? 'paused' : 'start');
  }
});

// --- one fixed step ---
function step(dt) {
  if (!started || state.phase === 'matchEnd') return;
  time += dt;
  const freeze = state.phase === 'freeze';

  // Look always works, even in freeze.
  const look = input.takeLook ? input.takeLook() : { x: input.state.lookX || 0, y: input.state.lookY || 0 };
  if (look && (look.x || look.y)) player.look(look.x, look.y);
  if (!freeze && playerAlive) player.step(dt, input.state.keys);
  weapon.step(dt);

  // Grenades: player (when alive) + living bots as actors, normalised to
  // the { pos, damage } shape grenades.js expects.
  const actors = [];
  if (playerAlive) actors.push({ pos: player.state.position, damage: (d) => damagePlayer(d) });
  for (const b of bots.list) if (b.alive) actors.push({ pos: b.group.position, damage: (d) => bots.damage(b, d, 'torso') });
  grenades.step(dt, actors, handleGrenadeEvent);

  // Bots.
  const ctx = {
    time, random,
    playerPos: player.state.position,
    playerAlive, playerCrouch: !!player.state.crouching,
    spike: state.spike,
    sounds,
    losBlocked,
    smokeBlocks: (ax, ay, az, bx, by, bz) => grenades.smokeBlocks(ax, ay, az, bx, by, bz),
    onCall: (type, data) => botCalls.push({ type, data }),
    onSpotted: () => {},
    calls: botCalls,
    blinded: time < flashBlindUntil,
  };
  bots.step(dt, ctx);
  processBotCalls();
  // Sounds from this frame's shooting are heard by bots NEXT frame: clear
  // the heard set only after the bots have read it, not before or after.
  sounds = [];

  // Player shooting.
  if (playerAlive && input.state.firing && !freeze) {
    if (weapon.ready()) {
      if (weapon.state.mag > 0) { fireShot(false); dryFired = false; }
      else if (!dryFired) { audio.dry(); dryFired = true; }
    }
  } else if (!input.state.firing) dryFired = false;

  // Bot shooting (main performs it; bots only decide).
  for (const bot of bots.list) {
    if (bot.alive && bot.wantFire && bot.cooldown <= 0 && bot.aimPos) botShoot(bot);
  }

  // Reload, switching, grenades.
  if (input.pressed('KeyR')) { weapon.reload(); audio.reload(); }
  ['Digit1', 'Digit2', 'Digit3', 'Digit4'].forEach((code, i) => {
    if (input.pressed(code) && economy.owned.has(ORDER[i])) weapon.equip(ORDER[i]);
  });
  const wheel = input.takeWheel ? input.takeWheel() : 0;
  if (wheel) {
    const owned = ORDER.filter((id) => economy.owned.has(id));
    if (owned.length > 1) {
      const idx = (owned.indexOf(weapon.state.id) + (wheel > 0 ? 1 : -1) + owned.length) % owned.length;
      weapon.equip(owned[idx]);
    }
  }
  for (const code of Object.keys(GRENADE_KEYS)) if (input.pressed(code)) selectedGrenade = GRENADE_KEYS[code];
  if (input.pressed('KeyG') && ownedGrenades[selectedGrenade] > 0 && playerAlive && !freeze) {
    camera.getWorldDirection(_fwd);
    _v1.copy(camera.position).addScaledVector(_fwd, 0.6);
    grenades.throwGrenade(selectedGrenade, _v1, _fwd, 14);
    ownedGrenades[selectedGrenade] -= 1;
  }

  // Plant: player is the VANGUARD carrier while alive.
  if (playerAlive && !freeze && state.phase === 'live' &&
    (state.spike.status === 'carried' || state.spike.status === 'planting')) {
    let nearSite = null;
    for (const site of ['A', 'B']) {
      const s = map.sites[site];
      const dx = player.state.position.x - s.plantX, dz = player.state.position.z - s.plantZ;
      if (dx * dx + dz * dz < 6.25) { nearSite = site; break; }
    }
    if (nearSite && keyDown('KeyE')) {
      state.spike.progress += dt / 3;
      state.spike.site = nearSite;
      state.spike.status = 'planting';
      hud.setPlantProgress(state.spike.progress);
      if (time - lastPlantBeep > 0.5) { audio.plantBeep(); lastPlantBeep = time; }
      if (state.spike.progress >= 1) {
        state.spike.status = 'planted';
        state.spike.fuse = 35;
        state.spike.progress = 1;
        hud.killFeed('Spike planted at ' + nearSite);
        audio.plantBeep(); audio.plantBeep();
        botCalls.push({ type: 'plant', data: { site: nearSite } });
      }
    } else if (state.spike.progress > 0) {
      state.spike.progress = Math.max(0, state.spike.progress - dt / 3);
      if (state.spike.progress === 0) state.spike.status = 'carried';
      hud.setPlantProgress(state.spike.progress);
    }
  }

  // Buy menu toggle during freeze.
  if (input.pressed('KeyB') && freeze) hud.showBuy(SHOP, economy.money);

  // Sniper scope.
  const scoped = !!(input.state.aiming && weapon.state.id === 'sniper');
  const targetFov = scoped ? 74 / 3.2 : 74;
  if (targetFov !== lastFov) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
    lastFov = targetFov;
  }
  hud.setScoped(scoped);

  // Footsteps.
  if (playerAlive && player.state.onGround && player.groundSpeed() > 0.5) {
    stepSndTimer += dt;
    const interval = player.state.crouching ? 0.5 : 0.35;
    if (stepSndTimer >= interval) {
      stepSndTimer = 0;
      audio.stepSnd();
      sounds.push({ x: player.state.position.x, z: player.state.position.z, kind: 'step', range: 8 });
    }
  }

  combat.step(dt);
  if (flashTimer > 0) flashTimer -= dt;

  const vanAlive = bots.aliveCount('van') + (playerAlive ? 1 : 0);
  const senAlive = bots.aliveCount('sen');
  rounds.step(dt, {
    vanAlive, senAlive,
    spikePlanted: state.spike.status === 'planted',
    spikeDefused,
  });

  syncCamera();
}

function settle(n) {
  for (let i = 0; i < n; i++) step(FIXED_STEP);
}

function setSpikePlanted(site) {
  state.spike.status = 'planted';
  state.spike.site = site;
  state.spike.fuse = 20;
  state.spike.progress = 1;
}

function syncHud() {
  hud.setHealth(Math.max(0, Math.ceil(playerHealth)), playerArmor);
  const cur = weapon.current() || WEAPONS[weapon.state.id];
  hud.setAmmo(weapon.state.mag, weapon.state.reserve, cur ? cur.name : '');
  hud.setMoney(economy.money);
  hud.setTimer(state.phase === 'freeze' ? state.freeze
    : state.spike.status === 'planted' ? state.spike.fuse : state.timer);
  hud.setScore(state.scoreVan, state.scoreSen, state.round);
  hud.setAlive(bots.aliveCount('van') + (playerAlive ? 1 : 0), bots.aliveCount('sen'), 5, 5);
  hud.setSpike(state.spike.status, state.spike.fuse, state.spike.progress);
  hud.setCrosshair(6 + weapon.spread(player.groundSpeed()) * 900);
  if (state.spike.status === 'planting') hud.setPlantProgress(state.spike.progress);
}

// --- main loop: fixed 60 Hz sim, render at display rate ---
let last = performance.now();
let acc = 0;
function animate(now) {
  requestAnimationFrame(animate);
  let frameDt = (now - last) / 1000;
  last = now;
  if (frameDt > 0.25) frameDt = 0.25;
  acc += frameDt;
  let n = 0;
  while (acc >= FIXED_STEP && n < 5) { step(FIXED_STEP); acc -= FIXED_STEP; n += 1; }
  if (n === 5) acc = 0;
  syncHud();
  renderer.render(scene, camera);
}

function setBanner(title, sub) { hud.showBanner(title, sub); }

// Minimal debug handle for headless play-testing (round-flow verification).
window.__helios = { state, playerHealth: () => playerHealth, bots, rounds, player, aimAt, shootOnce, settle };

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// --- shot mode: no loop, no pointer lock; script, render twice, freeze ---
if (shot) {
  started = true;
  hud.hideOverlay();
  rounds.startMatch();
  const api = {
    player, bots, state, hud, weapons: WEAPONS, weapon, combat,
    camera, scene, map, rounds, economy,
    aimAt, shootOnce, settle, setBanner, rng: random, setSpikePlanted,
  };
  runShot(shot, api);
  syncCamera();
  syncHud();
  renderer.render(scene, camera);
  renderer.render(scene, camera);
  window.__shotReady = true;
} else {
  hud.showOverlay('start');
  syncCamera();
  requestAnimationFrame(animate);
}
