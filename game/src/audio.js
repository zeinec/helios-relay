// audio.js — procedural WebAudio sounds for HELIOS RELAY. No audio files, no imports.
// Lazy AudioContext: created on first ensure() (inside a user gesture). Every method
// guards when the context is missing or suspended, so calls before unlock are safe no-ops.
export function createAudio() {
  let ctx = null, master = null, noiseBuf = null;

  function ensure() {
    try {
      if (!ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        master = ctx.createGain();
        master.gain.value = 0.35;
        master.connect(ctx.destination);
        // 1 s of white noise, reused by every burst.
        noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      }
      if (ctx.state === 'suspended') void ctx.resume();
      // resume() is async: state may still read 'suspended' here, so report
      // success once the context exists; methods re-guard via ready().
      return !!ctx;
    } catch { return false; }
  }

  // Noise burst through a low-pass filter, gain envelope decays over dur.
  function burst(dur, filterFreq, gain, when = 0) {
    if (!ctx || !noiseBuf) return;
    const t = ctx.currentTime + when;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass'; filt.frequency.value = filterFreq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  // Oscillator tone with a decaying gain envelope.
  function tone(freq, dur, type, gain, when = 0, slideTo) {
    if (!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  const ready = () => ctx && ctx.state === 'running';

  const SHOTS = {
    pistol: { dur: 0.12, freq: 1800, gain: 0.5, thump: 140 },
    smg: { dur: 0.07, freq: 2600, gain: 0.35, thump: 170 },
    rifle: { dur: 0.14, freq: 1400, gain: 0.6, thump: 110 },
    sniper: { dur: 0.25, freq: 800, gain: 0.9, thump: 70 },
  };

  function shot(kind) {
    if (!ready()) return;
    const s = SHOTS[kind] || SHOTS.rifle;
    burst(s.dur, s.freq, s.gain);
    tone(s.thump, s.dur * 1.2, 'sine', s.gain * 0.9, 0, s.thump * 0.5);
  }
  function dry() { if (ready()) tone(1400, 0.03, 'square', 0.12); }
  function reload() {
    if (!ready()) return;
    tone(900, 0.03, 'square', 0.15);
    tone(700, 0.03, 'square', 0.15, 0.15);
  }
  function stepSnd() { if (ready()) burst(0.05, 500, 0.08); }
  function plantBeep() { if (ready()) tone(880, 0.08, 'square', 0.2); }
  function defuseBeep() { if (ready()) tone(660, 0.08, 'square', 0.2); }
  function horn() {
    if (!ready()) return;
    // Two-tone low brass-ish swell: detuned saws, 0.7 s.
    for (const f of [110, 116.5]) tone(f, 0.7, 'sawtooth', 0.16);
    tone(220, 0.7, 'sawtooth', 0.08, 0.05);
  }
  function win() {
    if (!ready()) return;
    tone(523, 0.14, 'triangle', 0.25);
    tone(659, 0.14, 'triangle', 0.25, 0.14);
    tone(784, 0.3, 'triangle', 0.3, 0.28);
  }
  function lose() {
    if (!ready()) return;
    tone(392, 0.2, 'triangle', 0.25);
    tone(262, 0.4, 'triangle', 0.25, 0.2);
  }
  function hit() { if (ready()) tone(2400, 0.04, 'square', 0.15); }
  function pop() {
    if (!ready()) return;
    burst(0.1, 5000, 0.7);
    ring();
  }
  function ring() { if (ready()) tone(5200, 1.5, 'sine', 0.12); }
  function click() { if (ready()) tone(1200, 0.04, 'square', 0.12); }
  function explode() {
    if (!ready()) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf; src.loop = true;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.setValueAtTime(3000, t);
    filt.frequency.exponentialRampToValueAtTime(80, t + 0.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.0);
    src.connect(filt); filt.connect(g); g.connect(master);
    src.start(t); src.stop(t + 1.05);
    tone(55, 0.9, 'sine', 0.5, 0, 30);
  }

  return { ensure, shot, dry, reload, stepSnd, plantBeep, defuseBeep, horn, win, lose,
    hit, pop, ring, click, explode };
}
