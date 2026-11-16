// Single game-state store for HELIOS RELAY. Every module reads/writes
// through the object createState() returns; no other state lives here.

const MAX_FEED = 6;

export function createState() {
  return {
    phase: 'start',
    round: 1,
    scoreVan: 0,
    scoreSen: 0,
    timer: 100,
    freeze: 15,
    money: 800,
    kills: 0,
    deaths: 0,
    spike: { status: 'none', site: null, progress: 0, fuse: 0, defuse: 0 },
    winner: null,
    reason: '',
    matchOver: false,
    feed: [],
    lossStreak: 0,
  };
}

export function resetForRound(state) {
  state.timer = 100;
  state.freeze = 15;
  state.spike = { status: 'none', site: null, progress: 0, fuse: 0, defuse: 0 };
  state.phase = 'freeze';
  state.winner = null;
  state.reason = '';
}

export function addFeed(state, text) {
  state.feed.push({ text, at: performance.now() });
  // Trim in place so any module holding state.feed keeps the same array.
  if (state.feed.length > MAX_FEED) state.feed.splice(0, state.feed.length - MAX_FEED);
}
