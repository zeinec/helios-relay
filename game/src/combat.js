import * as THREE from 'three';

// HELIOS RELAY — combat: raycast shooting, pooled tracers + impacts, damage math.
const TRACER_LIFE = 0.08, IMPACT_LIFE = 1.5;

export function createCombat(scene) {
  const raycaster = new THREE.Raycaster();
  raycaster.far = 90;
  const _mid = new THREE.Vector3(), _dir = new THREE.Vector3(), _to = new THREE.Vector3();

  // 24 tracers: thin stretched additive boxes, reused round-robin.
  const tracerGeo = new THREE.BoxGeometry(1, 1, 1);
  const tracers = [];
  for (let i = 0; i < 24; i++) {
    const mesh = new THREE.Mesh(tracerGeo, new THREE.MeshBasicMaterial({
      color: 0xffc861, transparent: true, opacity: 0,
      blending: THREE.AdditiveBlending, depthWrite: false,
    }));
    mesh.visible = false;
    scene.add(mesh);
    tracers.push({ mesh, life: 0 });
  }
  let tracerIdx = 0;

  // 16 impact quads: small dark planes, reused round-robin.
  const impactGeo = new THREE.PlaneGeometry(0.22, 0.22);
  const impacts = [];
  for (let i = 0; i < 16; i++) {
    const mesh = new THREE.Mesh(impactGeo, new THREE.MeshBasicMaterial({
      color: 0x1a1512, transparent: true, opacity: 0, depthWrite: false,
    }));
    mesh.visible = false;
    scene.add(mesh);
    impacts.push({ mesh, life: 0 });
  }
  let impactIdx = 0;

  function shoot(origin, dir, targets) {
    raycaster.set(origin, dir);
    const hits = raycaster.intersectObjects(targets, false);
    if (hits.length === 0) return null;
    const h = hits[0];
    // World-space face normal (object-space face.normal transformed by the
    // mesh's matrix); callers use it for impact decals. Fall back to up.
    let normal = new THREE.Vector3(0, 1, 0);
    if (h.face && h.face.normal) {
      normal = h.face.normal.clone().transformDirection(h.object.matrixWorld);
    }
    return {
      point: h.point.clone(), distance: h.distance, object: h.object,
      part: h.object.userData.part, target: h.object.userData.target, normal,
    };
  }

  function tracer(from, to, color) {
    const t = tracers[tracerIdx];
    tracerIdx = (tracerIdx + 1) % tracers.length;
    _mid.addVectors(from, to).multiplyScalar(0.5);
    _dir.subVectors(to, from);
    const len = _dir.length();
    if (len < 0.001) return;
    t.mesh.position.copy(_mid);
    t.mesh.lookAt(to);
    t.mesh.scale.set(0.02, 0.02, len);
    t.mesh.material.color.set(color);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.life = TRACER_LIFE;
  }

  function impact(point, normal) {
    const q = impacts[impactIdx];
    impactIdx = (impactIdx + 1) % impacts.length;
    _dir.copy(normal).normalize(); // callers may pass a non-unit normal
    _to.copy(point).addScaledVector(_dir, 0.02);
    q.mesh.position.copy(_to);
    _to.copy(point).add(_dir);
    q.mesh.lookAt(_to);
    q.mesh.material.opacity = 0.85;
    q.mesh.visible = true;
    q.life = IMPACT_LIFE;
  }

  function step(dt) {
    for (let i = 0; i < tracers.length; i++) {
      const t = tracers[i];
      if (t.life <= 0) continue;
      t.life -= dt;
      if (t.life <= 0) t.mesh.visible = false;
      else t.mesh.material.opacity = t.life / TRACER_LIFE;
    }
    for (let i = 0; i < impacts.length; i++) {
      const q = impacts[i];
      if (q.life <= 0) continue;
      q.life -= dt;
      if (q.life <= 0) q.mesh.visible = false;
      else q.mesh.material.opacity = 0.85 * (q.life / IMPACT_LIFE);
    }
  }

  function damageFor(weapon, part, distance) {
    // Accept either the weapon instance (damageAt + current()) or a WEAPONS row.
    const w = weapon.current ? weapon.current() : weapon;
    const base = typeof weapon.damageAt === 'function'
      ? weapon.damageAt(distance)
      : w.damage * (distance <= 15 ? 1 : distance >= 40 ? 0.6 : 1 - 0.4 * (distance - 15) / 25);
    const mult = part === 'head' ? (w.headMult || 1) : part === 'limb' ? 0.6 : 1;
    return base * mult;
  }

  return { shoot, tracer, impact, step, damageFor };
}
