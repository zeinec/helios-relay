// rounds.js — HELIOS RELAY round flow: freeze -> live -> planted -> roundEnd -> matchEnd.
// Reads state.spike only; planting progress itself is owned by main.js / bots.js.

import { resetForRound } from './state.js';

export const FREEZE_SECONDS = 15;
export const ROUND_SECONDS = 100;
export const FUSE_SECONDS = 35;
export const WIN_ROUNDS = 7;
export const ROUND_END_SECONDS = 4;

export function createRounds(state, economy, hooks = {}) {
  let endTimer = 0;

  const onPhase = (phase) => hooks.onPhase?.(phase);

  function startMatch() {
    state.scoreVan = 0;
    state.scoreSen = 0;
    state.round = 1;
    state.matchOver = false;
    economy.reset();
    startRound(1);
  }

  function startRound(n) {
    state.round = n;
    resetForRound(state); // phase 'freeze', timer 100, freeze 15, spike fresh
    onPhase('freeze');
  }

  // Scores, pays out, and opens the 4 s round-end window.
  function endRound(winner, reason) {
    state.winner = winner;
    state.reason = reason;
    state.phase = 'roundEnd';
    if (winner === 'van') state.scoreVan += 1;
    else state.scoreSen += 1;
    economy.awardRound(winner === 'van');
    endTimer = ROUND_END_SECONDS;
    hooks.onRoundEnd?.(winner, reason);
    onPhase('roundEnd');
  }

  // info: { vanAlive, senAlive, spikePlanted, spikeDefused } — all optional.
  function step(dt, info = {}) {
    const { vanAlive = 0, senAlive = 0, spikePlanted = false, spikeDefused = false } = info;

    if (state.phase === 'freeze') {
      state.freeze = Math.max(0, state.freeze - dt);
      if (state.freeze <= 0) {
        state.phase = 'live';
        onPhase('live');
      }
      return;
    }

    if (state.phase === 'live') {
      state.timer = Math.max(0, state.timer - dt);
      if (senAlive === 0) return endRound('van', 'elimination');
      if (vanAlive === 0) return endRound('sen', 'elimination');
      if (spikePlanted) {
        state.phase = 'planted';
        onPhase('planted');
        return;
      }
      if (state.timer <= 0) endRound('sen', 'time');
      return;
    }

    if (state.phase === 'planted') {
      state.spike.fuse = Math.max(0, state.spike.fuse - dt);
      if (spikeDefused) return endRound('sen', 'defuse');
      if (state.spike.fuse <= 0) return endRound('van', 'detonation');
      if (senAlive === 0) return endRound('van', 'elimination');
      if (vanAlive === 0) return endRound('sen', 'elimination');
      return;
    }

    if (state.phase === 'roundEnd') {
      endTimer -= dt;
      if (endTimer > 0) return;
      const winner =
        state.scoreVan >= WIN_ROUNDS ? 'van' : state.scoreSen >= WIN_ROUNDS ? 'sen' : null;
      if (winner) {
        state.matchOver = true;
        state.phase = 'matchEnd';
        hooks.onMatchEnd?.(winner);
      } else {
        startRound(state.round + 1);
      }
    }
  }

  return { step, startMatch, startRound };
}
