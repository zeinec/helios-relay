// HELIOS RELAY — desert solar relay station at dusk, 48 x 36 m.
// Attackers spawn south (z +15), defenders north (z -15).
// Site A "Array Field" west, site B "Relay Dome" east, mid lane between.
import * as THREE from 'three';
import { PALETTE } from './palette.js';

// [id, x, z, tags, neighbour ids] — hand-authored, fully connected:
// both spawns reach both sites; mid feeds both connectors + tunnel.
const WP = [
  ['van0', -8, 15, ['vanSpawn'], ['van1', 'aLane1']],
  ['van1', -4, 15, ['vanSpawn'], ['van0', 'van2', 'midS']],
  ['van2', 0, 15, ['vanSpawn'], ['van1', 'van3', 'midS']],
  ['van3', 4, 15, ['vanSpawn'], ['van2', 'van4', 'midS']],
  ['van4', 8, 15, ['vanSpawn'], ['van3', 'bLane0']],
  ['sen0', -8, -15, ['senSpawn'], ['sen1', 'aHold1']],
  ['sen1', -4, -15, ['senSpawn'], ['sen0', 'sen2']],
  ['sen2', 0, -15, ['senSpawn'], ['sen1', 'sen3', 'mid3']],
  ['sen3', 4, -15, ['senSpawn'], ['sen2', 'sen4', 'mid3']],
  ['sen4', 8, -15, ['senSpawn'], ['sen3', 'bHold']],
  ['midS', 0, 12, ['mid'], ['van1', 'van2', 'van3', 'mid2', 'bLane0']],
  ['mid2', 0, 4, ['mid'], ['midS', 'aShort', 'midE']],
  ['midE', 5, 4, ['mid'], ['mid2', 'mid3']],
  ['mid3', 0, -6, ['mid'], ['midE', 'midS2', 'sen2', 'sen3', 'bHold']],
  ['midS2', 0, -2, ['mid'], ['mid3', 'tun1']],
  ['aShort', -4, 6, ['connector'], ['mid2', 'aLane1']],
  ['aLane1', -12, 6, ['aLane'], ['aShort', 'van0', 'aLane3', 'walk']],
  ['aLane3', -16, -2, ['aLane', 'aSite'], ['aLane1', 'plantA']],
  ['plantA', -16, -5, ['aSite', 'plantA'], ['aLane3', 'walk']],
  ['aSite', -19, -12.5, ['aSite'], ['aHold1']],
  ['aHold1', -12.5, -12.5, ['aHold'], ['sen0', 'aSite']],
  ['walk', -20.5, -5, ['walkway', 'aSite'], ['plantA', 'aLane1']],
  ['bLane0', 12, 12, ['bLane', 'connector'], ['van4', 'midS', 'bLane3']],
  ['bLane3', 14, 2, ['bLane'], ['bLane0', 'bSite0']],
  ['bSite0', 16, -2, ['bSite'], ['bLane3', 'bSite1', 'tun3']],
  ['bSite1', 19, -2, ['bSite'], ['bSite0', 'bSite2']],
  ['bSite2', 22, -8, ['bSite'], ['bSite1', 'plantB']],
  ['plantB', 22, -10, ['bSite', 'plantB'], ['bSite2']],
  ['tun1', 4, -2, ['tunnel'], ['midS2', 'tun3']],
  ['tun3', 10, -2, ['tunnel'], ['tun1', 'bSite0']],
  ['bHold', 10, -13, ['bHold'], ['sen4', 'mid3']],
];

const SITES = {
  A: { x: -16, z: -10, plantX: -16, plantZ: -5 },
  B: { x: 16, z: -10, plantX: 22, plantZ: -10 },
};

const mats = new Map();
function mat(color) {
  let m = mats.get(color);
  if (!m) { m = new THREE.MeshStandardMaterial({ color }); mats.set(color, m); }
  return m;
}

function skyMesh() {
  const geo = new THREE.SphereGeometry(80, 24, 12);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color(0xe8703a); // dusk orange at the horizon
  const high = new THREE.Color(0x2a1a30); // dark brown-purple at the zenith
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const t = THREE.MathUtils.clamp(pos.getY(i) / 80, 0, 1);
    c.copy(low).lerp(high, Math.pow(t, 0.7));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
    vertexColors: true, side: THREE.BackSide, fog: false,
  }));
}

export function createMap(scene) {
  const group = new THREE.Group();
  const solids = []; // meshes that block movement
  const props = []; // meshes bullets can hit (solids + thin/rail props)

  function box(w, h, d, x, y, z, color, solid = true, rx = 0, ry = 0) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    mesh.position.set(x, y, z);
    mesh.rotation.x = rx; mesh.rotation.y = ry;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); props.push(mesh);
    if (solid) solids.push(mesh);
    return mesh;
  }

  function cyl(rt, rb, h, x, y, z, color, solid = true, rz = 0, rx = 0) {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 12), mat(color));
    mesh.position.set(x, y, z);
    mesh.rotation.z = rz; mesh.rotation.x = rx;
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh); props.push(mesh);
    if (solid) solids.push(mesh);
    return mesh;
  }

  // Lighting + atmosphere
  scene.fog = new THREE.Fog(0x2b1a14, 20, 60);
  group.add(new THREE.HemisphereLight(0xffd9a0, 0x241812, 0.55));
  const sun = new THREE.DirectionalLight(0xffb36b, 1.6);
  sun.position.set(-28, 14, 6); // low from the west
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 24, bottom: -24, near: 1, far: 90 });
  sun.shadow.bias = -0.0005;
  group.add(sun); group.add(sun.target);
  const fill = new THREE.DirectionalLight(0x7a9cc6, 0.35); // cool dim fill
  fill.position.set(28, 12, -6);
  group.add(fill);
  group.add(skyMesh());

  // Ground
  const ground = new THREE.Mesh(new THREE.BoxGeometry(48, 0.2, 36), mat(PALETTE.sand));
  ground.position.y = -0.1;
  ground.receiveShadow = true;
  group.add(ground); props.push(ground);

  // Perimeter walls, 4.6 m high
  box(49.2, 4.6, 0.6, 0, 2.3, -18.3, PALETTE.surface);
  box(49.2, 4.6, 0.6, 0, 2.3, 18.3, PALETTE.surface);
  box(0.6, 4.6, 36, -24.3, 2.3, 0, PALETTE.surface);
  box(0.6, 4.6, 36, 24.3, 2.3, 0, PALETTE.surface);

  // --- Site A: Array Field — 3 rows of tilted panels, sightline down z
  const tilt = THREE.MathUtils.degToRad(25);
  for (const px of [-19, -16.5, -14]) {
    for (const pz of [-14, -10.5, -7]) {
      box(2.0, 0.08, 1.4, px, 0.95, pz, PALETTE.canvas, true, tilt);
      box(0.12, 0.7, 0.12, px, 0.35, pz, PALETTE.rust, false); // support leg
    }
  }
  // Raised maintenance walkway overlooking the plant spot, with rails
  box(2.5, 0.3, 6, -21.5, 1.05, -10, PALETTE.surface);
  box(0.3, 0.9, 0.3, -22.5, 0.45, -12.5, PALETTE.rust);
  box(0.3, 0.9, 0.3, -20.5, 0.45, -7.5, PALETTE.rust);
  box(0.08, 0.9, 6, -22.7, 1.65, -10, PALETTE.rust, false); // west rail
  box(2.5, 0.08, 0.08, -21.5, 2.1, -13, PALETTE.rust, false); // north rail

  // --- Site B: Relay Dome — flattened half-sphere, crate ring, pipes
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(5, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2),
    mat(PALETTE.rust));
  dome.scale.y = 0.7;
  dome.position.set(16, 0, -10);
  dome.castShadow = true; dome.receiveShadow = true;
  group.add(dome); props.push(dome); solids.push(dome);
  for (const [cx, cz] of [[9.8, -14.2], [9.8, -5.8], [22, -14.2], [22, -5.8], [12.5, -3.6], [19.5, -3.6]]) {
    box(1.1, 1.1, 1.1, cx, 0.55, cz, PALETTE.muted);
  }
  cyl(0.25, 0.25, 12, 16, 0.6, -4.2, PALETTE.rust, true, Math.PI / 2); // conduit ring pipe
  // Antenna mast with crossbars near B
  cyl(0.12, 0.16, 9, 22.3, 4.5, -16.3, PALETTE.ink);
  box(1.2, 0.08, 0.08, 22.3, 6, -16.3, PALETTE.ink, false);
  box(0.08, 0.08, 1.2, 22.3, 7.5, -16.3, PALETTE.ink, false);
  box(1.2, 0.08, 0.08, 22.3, 8.6, -16.3, PALETTE.ink, false);

  // Service tunnel: roofed corridor from mid to B (roof is overhead only,
  // so it stays shootable but is not a movement collider)
  box(9, 2.6, 0.4, 7.5, 1.3, -3.2, PALETTE.surface);
  box(9, 2.6, 0.4, 7.5, 1.3, -0.8, PALETTE.surface);
  box(9, 0.3, 3.2, 7.5, 2.75, -2, PALETTE.surface, false);

  // --- Mid: broken wall with a peek window (1.2 m gap at eye height)
  box(3.4, 3, 0.5, -2.3, 1.5, 0, PALETTE.surface);
  box(3.4, 3, 0.5, 2.3, 1.5, 0, PALETTE.surface);
  box(1.2, 1, 0.5, 0, 2.5, 0, PALETTE.surface); // lintel above window
  box(1.2, 0.9, 0.5, 0, 0.45, 0, PALETTE.surface); // sill below window
  // Stack of two shipping containers for vertical play
  box(2.4, 2.6, 6, 6, 1.3, -8, PALETTE.rust);
  box(2.4, 2.6, 6, 6, 3.9, -8, PALETTE.muted);

  // --- Scattered props: crates, sandbags, pipes, barriers
  for (const [cx, cz, col] of [
    [-2, 10.5, PALETTE.surface], [14, 12, PALETTE.muted], [-10, 4.5, PALETTE.muted],
    [14, 4.5, PALETTE.surface], [-10, -2, PALETTE.surface], [12, -13, PALETTE.muted],
  ]) box(1.1, 1.1, 1.1, cx, 0.55, cz, col);
  box(1.8, 0.5, 0.8, -6, 0.25, 10, PALETTE.sand); // sandbags
  box(1.8, 0.5, 0.8, 6, 0.25, 10, PALETTE.sand);
  box(2, 1.1, 0.6, -2, 0.55, -8, PALETTE.muted); // concrete barriers
  box(2, 1.1, 0.6, 2, 0.55, -8, PALETTE.muted);
  cyl(0.3, 0.3, 5, -9.5, 0.4, 1.5, PALETTE.rust, true, 0, Math.PI / 2); // west pipe
  cyl(0.3, 0.3, 6, 10.5, 0.4, 5, PALETTE.rust, true, 0, Math.PI / 2); // east pipe

  scene.add(group);
  group.updateMatrixWorld(true);
  const colliders = solids.map((m) => new THREE.Box3().setFromObject(m));
  const shootables = props;
  const waypoints = WP.map(([id, x, z, tags, neighbors]) => ({ id, x, z, tags, neighbors }));

  return {
    group, colliders, shootables, waypoints, sites: SITES,
    spawns: {
      van: [[-8, 15], [-4, 15], [0, 15], [4, 15], [8, 15]],
      sen: [[-8, -15], [-4, -15], [0, -15], [4, -15], [8, -15]],
    },
    buyZones: {
      van: { minX: -10, maxX: 10, minZ: 12, maxZ: 17 },
      sen: { minX: -10, maxX: 10, minZ: -17, maxZ: -12 },
    },
  };
}

export function waypointById(waypoints, id) {
  for (const w of waypoints) if (w.id === id) return w;
  return null;
}

export function nearestWaypoint(waypoints, x, z) {
  let best = null, bestD = Infinity;
  for (const w of waypoints) {
    const dx = w.x - x, dz = w.z - z, d = dx * dx + dz * dz;
    if (d < bestD) { bestD = d; best = w; }
  }
  return best;
}

// Dijkstra over the neighbour lists; start..goal inclusive, [] if unreachable.
export function findPath(waypoints, fromId, toId) {
  const start = waypointById(waypoints, fromId);
  const goal = waypointById(waypoints, toId);
  if (!start || !goal) return [];
  const dist = new Map([[fromId, 0]]);
  const prev = new Map();
  const done = new Set();
  for (;;) {
    let cur = null, curD = Infinity;
    for (const [id, d] of dist) {
      if (!done.has(id) && d < curD) { cur = id; curD = d; }
    }
    if (cur === null) return [];
    if (cur === toId) break;
    done.add(cur);
    const node = waypointById(waypoints, cur);
    for (const nb of node.neighbors) {
      const nd = curD + 1; // uniform edge cost
      if (nd < (dist.get(nb) ?? Infinity)) { dist.set(nb, nd); prev.set(nb, cur); }
    }
  }
  const path = [];
  for (let id = toId; id !== undefined; id = prev.get(id)) {
    path.push(waypointById(waypoints, id));
    if (id === fromId) break;
  }
  return path.reverse();
}
