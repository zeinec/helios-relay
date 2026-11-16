import * as THREE from 'three';
import { SHOP } from './economy.js';

// Deterministic screenshot scenes. api is assembled by main.js:
// { player, bots, state, hud, weapons, combat, camera, scene, map,
//   rounds, economy, aimAt, shootOnce, settle, setBanner, rng,
//   setSpikePlanted }. Only the seeded rng is used; no Math.random here.
function placePlayer(api, x, z) {
  const p = api.player.state;
  p.position.set(x, 0, z);
  if (p.velocity) p.velocity.set(0, 0, 0);
  p.pitch = 0;
}

function torsoOf(bot) {
  if (bot.torso && bot.torso.getWorldPosition) {
    return bot.torso.getWorldPosition(new THREE.Vector3());
  }
  const g = bot.group.position;
  return { x: g.x, y: g.y + 1.2, z: g.z };
}

function aimAtBot(api, bot) {
  if (!bot) return;
  const t = torsoOf(bot);
  api.aimAt(t.x, t.y, t.z);
}

export function runShot(name, api) {
  const { map, state, hud, economy } = api;
  if (name === 'start') {
    // Spawn van[4]: the other four van spawns are taken by teammate bots,
    // and van[0] would put Rook's head right in the camera.
    const s = map.spawns.van[4];
    placePlayer(api, s[0], s[1]);
    api.aimAt(0, 1.5, -6);
    api.settle(20);
    hud.hideOverlay();
    hud.showBuy(SHOP, economy.money);
    return;
  }
  if (name === 'play') {
    // Mid-fight, not freeze: hide the buy menu the freeze hook opened.
    hud.hideBuy();
    hud.setHint('');
    state.phase = 'live';
    placePlayer(api, 0, 2);
    // Shoot early, while the defenders are still near their spawns: the
    // peek window in the mid wall is only 1.2 m wide, so a shot is clear
    // only when its line crosses z = 0 inside the window. Rank targets by
    // that crossing x, not by |x| — a bot at |x| = 5, z = -15 crosses at
    // x = 0.64 and clips the wall edge. Short settles also keep the
    // VANGUARD bots from killing the target before the player shoots.
    const crossing = (b) => Math.abs(b.group.position.x * 2 / (2 - b.group.position.z));
    const clearest = () => api.bots.list
      .filter((b) => b.team === 'sen' && b.alive)
      .sort((a, b) => crossing(a) - crossing(b))[0];
    api.settle(5);
    let target = clearest();
    aimAtBot(api, target);
    api.shootOnce();
    api.settle(4);
    target = clearest();
    aimAtBot(api, target);
    api.shootOnce();
    api.settle(4);
    target = clearest();
    aimAtBot(api, target);
    api.shootOnce(30000); // long hold: under slow software rendering the two
    // final renders can eat most of a 5 s hitmarker window before capture
    api.settle(2); // short: the tracer (0.08 s life) must still be visible
    aimAtBot(api, target);
    return;
  }
  if (name === 'plant') {
    api.setSpikePlanted('B');
    hud.hideBuy();
    hud.setHint('');
    state.phase = 'planted';
    // Stand west of the dome, on the defenders' rotation path to B, and
    // look east across the site: the dome and plant spot are in frame and
    // the rotating defenders walk through the foreground. Longer settle so
    // the rotation is actually under way. (From south of B the dome itself
    // blocks the sightline to the rotating defenders.)
    placePlayer(api, 6, -13);
    api.aimAt(18, 1.5, -9);
    api.settle(120);
    return;
  }
  if (name === 'end') {
    hud.hideBuy();
    hud.setHint('');
    const s = map.sites.A;
    placePlayer(api, s.plantX + 2, s.plantZ + 2);
    api.aimAt(s.plantX - 6, 1.5, s.plantZ - 10);
    api.settle(20);
    api.setBanner('VANGUARD wins the round', 'Spike detonated');
    return;
  }
  // Unknown shot name: leave a static spawn view.
  const s = map.spawns.van[0];
  placePlayer(api, s[0], s[1]);
  api.aimAt(0, 1.5, -6);
  api.settle(10);
}
