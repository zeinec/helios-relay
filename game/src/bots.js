// HELIOS RELAY — bots.js
// 9 bots: 4 VANGUARD teammates, 5 SENTINEL enemies. State machine + senses + teamwork.
// One difficulty knob: DIFFICULTY scales reaction time and aim error.
import * as THREE from 'three';
import { PALETTE } from './palette.js';
import { findPath, nearestWaypoint, waypointById } from './map.js';

const DIFFICULTY = 1.0;
const EYE = 1.5, SPEED = 4.2, SLOW = 3.0, RADIUS = 0.34, HEIGHT = 1.72;
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _box = new THREE.Box3();
const _names = { van: ['Rook', 'Havoc', 'Sable', 'Juno'], sen: ['Vex', 'Onyx', 'Bram', 'Kite', 'Sol'] };
const _skills = { Rook: 0.82, Havoc: 0.74, Sable: 0.88, Juno: 0.7, Vex: 0.9, Onyx: 0.78, Bram: 0.66, Kite: 0.84, Sol: 0.72 };

function makeSprite(name, color) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = 'bold 34px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,0.85)'; g.strokeText(name, 128, 32);
  g.fillStyle = color; g.fillText(name, 128, 32);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false }));
  s.scale.set(1.5, 0.375, 1); s.position.y = 2.05; return s;
}

function makeBot(scene, team, name, id, skill) {
  const col = team === 'van' ? PALETTE.vanguard : PALETTE.sentinel;
  const dark = new THREE.Color(col).multiplyScalar(0.55);
  const g = new THREE.Group();
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.52, 0.78, 0.3),
    new THREE.MeshStandardMaterial({ color: dark, roughness: 0.85 }));
  torso.position.y = 1.05;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.155, 12, 10),
    new THREE.MeshStandardMaterial({ color: col, roughness: 0.6 }));
  head.position.y = 1.62;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, 0.62),
    new THREE.MeshStandardMaterial({ color: 0x1a1512, roughness: 0.5, metalness: 0.4 }));
  gun.position.set(0.22, 1.18, 0.32);
  const legMat = new THREE.MeshStandardMaterial({ color: 0x241c16, roughness: 0.9 });
  const l1 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.62, 0.24), legMat); l1.position.set(-0.14, 0.31, 0);
  const l2 = l1.clone(); l2.position.x = 0.14;
  const sprite = makeSprite(name, col);
  g.add(torso, head, gun, l1, l2, sprite);
  scene.add(g);
  const bot = { id, name, team, group: g, head, torso, health: 100, alive: true,
    state: 'advance', site: 'A', path: [], pathIndex: 0, yaw: 0, speed: SPEED,
    skill, reaction: 0, burstLeft: 0, burstGap: 0, aimPos: null, wantFire: false,
    cooldown: 0, lastSeen: null, lastSeenAt: -99, hearPos: null, holdUntil: 0,
    stateUntil: 0, plantProgress: 0, defuseProgress: 0, isCarrier: false,
    fallT: 0, _changed: -9, _strafe: 0, _sawPlayer: false };
  torso.userData.target = bot; torso.userData.part = 'torso';
  head.userData.target = bot; head.userData.part = 'head';
  bot._hit = [torso, head];
  return bot;
}

export function createBots(scene, map, randomFn) {
  const list = [];
  let n = 0;
  for (const team of ['van', 'sen'])
    for (const name of _names[team])
      list.push(makeBot(scene, team, name, 'bot-' + (n++), _skills[name]));
  const hitMeshes = list.flatMap(b => b._hit);
  const byIdMap = new Map(list.map(b => [b.id, b]));
  let latestCtx = null, rushRoll = 0;

  // Seeded RNG when the caller passes one (deterministic ?shot= captures);
  // otherwise the live context's RNG, else Math.random.
  const rnd = () => (typeof randomFn === 'function' ? randomFn()
    : (latestCtx && latestCtx.random ? latestCtx.random() : Math.random()));
  const wpByTag = tag => map.waypoints.find(w => (w.tags || []).includes(tag));
  const siteTag = (bot, kind) => kind === 'plant' ? (bot.site === 'A' ? 'plantA' : 'plantB')
    : kind === 'hold' ? (bot.site === 'A' ? 'aHold' : 'bHold') : null;
  const canChange = (b, now) => now >= b.stateUntil && now - b._changed >= 0.8;
  function setState(b, s, now, dur = 0) {
    b.state = s; b.stateUntil = now + dur; b._changed = now;
    if (s !== 'plant') b.plantProgress = 0;
    if (s !== 'defuse') b.defuseProgress = 0;
  }
  function pathTo(b, target) {
    if (!target) return;
    const from = nearestWaypoint(map.waypoints, b.group.position.x, b.group.position.z);
    b.path = findPath(map.waypoints, from ? from.id : target.id, target.id) || [target];
    b.pathIndex = 0;
  }
  function pathToSite(b, kind) { pathTo(b, wpByTag(siteTag(b, kind))); }
  // Axis-separated move with a lifted box probe so the floor never blocks.
  function tryMove(b, dx, dz) {
    const p = b.group.position;
    _box.min.set(p.x + dx - RADIUS, 0.12, p.z - RADIUS);
    _box.max.set(p.x + dx + RADIUS, 0.12 + HEIGHT, p.z + RADIUS);
    for (const c of map.colliders) if (_box.intersectsBox(c)) return false;
    p.x += dx; p.z += dz; return true;
  }
  function moveToward(b, tx, tz, dt, speed) {
    const p = b.group.position;
    _v1.set(tx - p.x, 0, tz - p.z); const d = _v1.length();
    if (d < 0.05) return true;
    _v1.multiplyScalar(1 / d);
    // Strafe: perpendicular offset while turning toward the next waypoint.
    const nx = b.path[b.pathIndex + 1];
    if (nx) { _v2.set(nx.x - tx, 0, nx.z - tz).normalize(); b._strafe += (((_v1.x * _v2.z - _v1.z * _v2.x) > 0 ? 1 : -1) - b._strafe) * dt * 4; }
    const px = -_v1.z * b._strafe * 0.35, pz = _v1.x * b._strafe * 0.35;
    const step = Math.min(d, speed * dt);
    if (!tryMove(b, _v1.x * step + px * dt, 0)) tryMove(b, 0, _v1.z * step + pz * dt);
    else tryMove(b, 0, _v1.z * step + pz * dt);
    b.yaw = Math.atan2(_v1.x, _v1.z);
    return d < 0.6;
  }
  function followPath(b, dt, speed) {
    if (!b.path.length || b.pathIndex >= b.path.length) return true;
    const w = b.path[b.pathIndex];
    if (moveToward(b, w.x, w.z, dt, speed)) b.pathIndex++;
    return b.pathIndex >= b.path.length;
  }
  function nearestLiving(team, x, z) {
    let best = null, bd = 1e9;
    for (const o of list) if (o.team === team && o.alive) {
      const d = (o.group.position.x - x) ** 2 + (o.group.position.z - z) ** 2;
      if (d < bd) { bd = d; best = o; }
    }
    return best;
  }

  function reset(round) {
    const r = rnd(); rushRoll = r;
    const senA = ['Vex', 'Onyx', 'Bram'], senB = ['Kite', 'Sol'];
    list.forEach((b, i) => {
      const spawns = b.team === 'van' ? map.spawns.van : map.spawns.sen;
      const s = spawns[Math.min(i % 5, spawns.length - 1)] || [0, 0];
      b.group.position.set(s[0], 0, s[1]);
      b.group.rotation.set(0, 0, 0); b.group.visible = true;
      b.health = 100; b.alive = true; b.fallT = 0; b.yaw = 0;
      b.lastSeen = null; b.lastSeenAt = -99; b.hearPos = null; b.aimPos = null;
      b.wantFire = false; b.burstLeft = 0; b.cooldown = 0; b.reaction = 0;
      b.plantProgress = 0; b.defuseProgress = 0; b.stateUntil = 0; b._changed = -9;
      if (b.team === 'sen') b.site = senA.includes(b.name) ? 'A' : 'B';
      // VANGUARD: 2 to A / 2 to B, or a 4-bot rush on A in 25% of rounds.
      else b.site = rushRoll < 0.25 ? 'A' : (i < 2 ? 'A' : 'B');
      b.isCarrier = false;
      setState(b, 'advance', 0, 0);
      pathToSite(b, b.team === 'van' ? 'plant' : 'hold');
    });
    // Carrier: first living VANGUARD bot (human carrier handled by main.js).
    const carrier = list.find(b => b.team === 'van' && b.alive);
    if (carrier) carrier.isCarrier = true;
  }

  function damage(bot, amount, part) {
    if (!bot.alive) return false;
    bot.health -= amount;
    if (bot.health > 0) return false;
    bot.health = 0; bot.alive = false; bot.wantFire = false; bot.fallT = 0;
    if (latestCtx && latestCtx.onCall) latestCtx.onCall('death', { pos: bot.group.position.clone(), by: part });
    return true;
  }

  function scanVision(b, ctx, now) {
    const p = b.group.position;
    _v1.set(Math.sin(b.yaw), 0, Math.cos(b.yaw)); // facing
    let best = null, bd = 1e9, bestPos = null, isPlayer = false;
    const consider = (pos, target, player) => {
      _v2.set(pos.x - p.x, 0, pos.z - p.z); const d = _v2.length();
      if (d > 35 || d < 0.01) return;
      if (_v2.multiplyScalar(1 / d).dot(_v1) < 0.643) return; // ~100 deg cone
      if (ctx.losBlocked && ctx.losBlocked(p.x, EYE, p.z, pos.x, 1.2, pos.z)) return;
      if (ctx.smokeBlocks && ctx.smokeBlocks(p.x, EYE, p.z, pos.x, 1.2, pos.z)) return;
      if (d < bd) { bd = d; best = target; bestPos = pos; isPlayer = player; }
    };
    for (const o of list) if (o.team !== b.team && o.alive)
      consider(o.group.position, o, false);
    // The human player is a VANGUARD ally: only SENTINEL bots target them.
    if (b.team === 'sen' && ctx.playerAlive && ctx.playerPos) consider(ctx.playerPos, null, true);
    if (!bestPos) { if (b.reaction > 0) b.reaction = 0; return; }
    const first = !b.lastSeen || now - b.lastSeenAt > 1.2;
    b.lastSeen = bestPos.clone ? bestPos.clone() : new THREE.Vector3(bestPos.x, bestPos.y, bestPos.z);
    b.lastSeenAt = now;
    if (first) {
      b.reaction = (0.25 + rnd() * 0.35) * (1.6 - b.skill) * DIFFICULTY;
      if (isPlayer) {
        if (ctx.onSpotted) ctx.onSpotted(b, b.lastSeen.clone());
        if (ctx.onCall) ctx.onCall('spotted', { pos: b.lastSeen.clone(), by: b.id });
      }
    }
    if (b.reaction > 0) return; // reaction timer ticks down in step(); no firing yet
    // Aim with error growing with distance, target speed and own movement.
    const moving = b.state === 'advance' || b.state === 'peek' || b.state === 'hunt';
    const err = (0.1 + bd * 0.011 + (moving ? 0.22 : 0) + (isPlayer && ctx.playerCrouch ? -0.04 : 0)) * DIFFICULTY;
    if (!b.aimPos) b.aimPos = new THREE.Vector3();
    b.aimPos.set(b.lastSeen.x + (rnd() - 0.5) * 2 * err, 1.25 + (rnd() - 0.5) * err, b.lastSeen.z + (rnd() - 0.5) * 2 * err);
    if (b.cooldown > 0) return;
    if (b.burstLeft <= 0) { b.burstLeft = 3 + Math.floor(rnd() * 3); b.burstGap = 0; }
    if (b.burstGap <= 0) {
      b.wantFire = true; b.burstLeft--; b.burstGap = 0.09;
      if (b.burstLeft <= 0) b.cooldown = 0.5 + rnd() * 0.4;
    }
  }

  function step(dt, ctx) {
    latestCtx = ctx; const now = ctx.time || 0;
    // Teammate calls re-delivered by main.js.
    if (ctx.calls) for (const c of ctx.calls) {
      if (c.type === 'plant') for (const b of list)
        if (b.team === 'sen' && b.alive && canChange(b, now)) { b.site = c.data.site || b.site; setState(b, 'rotate', now, 0.5); pathToSite(b, 'hold'); }
      if (c.type === 'death' && c.data && c.data.pos) {
        const t = nearestLiving(c.data.team || 'van', c.data.pos.x, c.data.pos.z);
        if (t && canChange(t, now)) { t.hearPos = new THREE.Vector3(c.data.pos.x, 0, c.data.pos.z); t.lastSeen = t.hearPos.clone(); t.lastSeenAt = now; setState(t, 'peek', now, 1.6); }
      }
    }
    for (const b of list) {
      const p = b.group.position;
      if (!b.alive) { // fall over over 0.4 s
        if (b.fallT < 0.4) { b.fallT += dt; b.group.rotation.x = -1.45 * Math.min(1, b.fallT / 0.4); }
        continue;
      }
      b.wantFire = false;
      if (b.burstGap > 0) b.burstGap -= dt;
      if (b.cooldown > 0) b.cooldown -= dt;
      if (b.reaction > 0) b.reaction -= dt;
      // Hearing: gunshots 25 m, footsteps 8 m, explosions 40 m.
      if (ctx.sounds) for (const s of ctx.sounds) {
        const range = s.kind === 'shot' ? 25 : s.kind === 'explosion' ? 40 : 8;
        const d = Math.hypot(s.x - p.x, s.z - p.z);
        if (d < range) { b.hearPos = new THREE.Vector3(s.x, 0, s.z); break; }
      }
      const spike = ctx.spike || {};
      const planted = spike.status === 'planted';
      // --- state transitions ---
      if (b.health < 30 && b.state !== 'retreat' && canChange(b, now)) {
        setState(b, 'retreat', now, 0); pathTo(b, wpByTag(b.team === 'van' ? 'vanSpawn' : 'senSpawn'));
      } else if (planted && b.team === 'sen' && b.state !== 'defuse' && b.state !== 'retreat' && canChange(b, now)) {
        setState(b, 'rotate', now, 0.5); b.site = spike.site || b.site; pathToSite(b, 'hold');
      } else if (!planted && b.team === 'van' && b.isCarrier && b.state === 'advance' && b.pathIndex >= b.path.length && canChange(b, now)) {
        setState(b, 'plant', now, 0);
      } else if (planted && b.team === 'sen' && b.state === 'advance' && b.pathIndex >= b.path.length && canChange(b, now)) {
        setState(b, 'defuse', now, 0);
      } else if (b.state === 'advance' && b.pathIndex >= b.path.length && canChange(b, now)) {
        setState(b, 'hold', now, 2 + rnd() * 3);
      } else if (b.state === 'hold' && now >= b.stateUntil && canChange(b, now)) {
        if (b.hearPos) { pathTo(b, nearestWaypoint(map.waypoints, b.hearPos.x, b.hearPos.z)); setState(b, 'peek', now, 1.6); }
        else setState(b, 'hold', now, 2 + rnd() * 3); // stay holding, fresh sway window
      } else if (b.state === 'peek' && now >= b.stateUntil && canChange(b, now)) {
        setState(b, 'hold', now, 2 + rnd() * 2);
      } else if (b.state === 'rotate' && b.pathIndex >= b.path.length && canChange(b, now)) {
        setState(b, 'hold', now, 2 + rnd() * 3);
      } else if (b.state === 'retreat' && b.pathIndex >= b.path.length && b.health >= 30 && canChange(b, now)) {
        setState(b, 'advance', now, 0); pathToSite(b, b.team === 'van' ? 'plant' : 'hold');
      } else if (b.state !== 'hunt' && now - b.lastSeenAt > 6 && b.lastSeen && b.alive && canChange(b, now)) {
        // One enemy left and nothing seen for 6 s: hunt the last known spot.
        const foes = list.filter(o => o.team !== b.team && o.alive).length + (b.team === 'sen' && ctx.playerAlive ? 1 : 0);
        if (foes <= 1) { setState(b, 'hunt', now, 0); pathTo(b, nearestWaypoint(map.waypoints, b.lastSeen.x, b.lastSeen.z)); }
      }
      // --- senses + fire ---
      scanVision(b, ctx, now);
      if (b.aimPos && (b.burstLeft > 0 || b.wantFire)) b.yaw = Math.atan2(b.aimPos.x - p.x, b.aimPos.z - p.z);
      // --- per-state behaviour ---
      switch (b.state) {
        case 'advance': case 'rotate': case 'hunt':
          followPath(b, dt, SPEED); break;
        case 'retreat': followPath(b, dt, SPEED); break;
        case 'peek': {
          if (b.lastSeen) moveToward(b, b.lastSeen.x, b.lastSeen.z, dt, SLOW);
          b.yaw += Math.sin(now * 1.4) * 0.004; break;
        }
        case 'hold': b.yaw += Math.sin(now * 0.7 + b.id.charCodeAt(4)) * 0.15 * dt; break;
        case 'plant': {
          b.plantProgress += dt;
          if (b.plantProgress >= 3) {
            b.plantProgress = 0;
            if (ctx.onCall) ctx.onCall('planted', { site: b.site });
            setState(b, 'retreat', now, 0); pathTo(b, wpByTag(b.team === 'van' ? 'vanSpawn' : 'senSpawn'));
          }
          break;
        }
        case 'defuse': {
          b.defuseProgress += dt;
          if (b.defuseProgress >= 5) {
            b.defuseProgress = 0;
            if (ctx.onCall) ctx.onCall('defused', {});
            setState(b, 'hold', now, 2);
          }
          break;
        }
      }
      // Face movement direction, or aimPos while firing (yaw already set above).
      b.group.rotation.y = b.yaw;
    }
  }

  function aliveCount(team) { return list.filter(b => b.team === team && b.alive).length; }
  return { list, hitMeshes, step, reset, damage, aliveCount, byId: id => byIdMap.get(id) };
}
