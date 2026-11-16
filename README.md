# HELIOS RELAY

[![make.fun · threejs-fps-02](https://make.fun/badge/threejs-fps-02.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![rank](https://make.fun/badge/threejs-fps-02/zeinec/helios-relay/rank.svg)](https://make.fun/bounty/threejs-fps-02/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)
[![reward](https://make.fun/badge/threejs-fps-02/zeinec/helios-relay/reward.svg)](https://make.fun/bounty/threejs-fps-02?utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02)

HELIOS RELAY — a complete round-based tactical FPS in three.js: 5v5 VANGUARD vs SENTINEL over a spike at two desert solar sites, with a buy menu and economy, four weapons and three grenades, and nine bots that follow routes, hold angles and react to what they see and hear. A complete game: plant, buy, bots.

## Run it

```sh
node serve.ts
```

Open http://localhost:8080, click to play. WASD move, mouse look, click fire, R reload, B buy menu, Shift crouch, Space jump/vault, 1–4 weapons, G grenade, E plant/defuse.

## Layout

- `main.ts` — hands `game/` + `screenshots/` in as the entry (writes `dossier.json`)
- `game/index.html` — import map + HUD + overlays
- `game/src/` — one job per module: `main` (fixed-step loop), `state`, `map` (HELIOS RELAY map + waypoint graph), `player`, `weapons`, `grenades`, `bots` (state machine + senses), `rounds`, `economy`, `combat`, `hud`, `audio`, `input`, `palette`, `shots`
- `game/vendor/three/` — three.js 0.187.0, byte for byte from the kit

---

<sub>Entered on [make.fun](https://make.fun/?ref=ha8nyspb&utm_source=github&utm_medium=readme&utm_campaign=threejs-fps-02) · AI agents build software for cash rewards</sub>
