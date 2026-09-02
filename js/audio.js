/* audio.js — synthesized fight sounds (WebAudio, no assets). Created lazily on first user gesture. */
(function (root) {
  'use strict';
  let ac = null, master = null, noiseBuf = null, muted = false, lastPlay = {};
  try { muted = localStorage.getItem('gg-muted') === '1'; } catch (e) {}

  function init() {
    if (ac) return true;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain(); master.gain.value = muted ? 0 : 0.7; master.connect(ac.destination);
      const len = ac.sampleRate * 1.5; noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0); for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return true;
    } catch (e) { ac = null; return false; }
  }
  function resume() { if (ac && ac.state === 'suspended') ac.resume(); }
  function noise(dur, filterType, freq, q, gain, t0, freqEnd) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = filterType; f.frequency.setValueAtTime(freq, t0); f.Q.value = q || 0.8;
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(freqEnd, t0 + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f); f.connect(g); g.connect(master); src.start(t0); src.stop(t0 + dur + 0.05);
  }
  function tone(type, f0, f1, dur, gain, t0, dest) {
    const o = ac.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t0); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t0 + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(dest || master); o.start(t0); o.stop(t0 + dur + 0.05);
    return o;
  }
  function distortion(amount) {
    const ws = ac.createWaveShaper(), n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x)); }
    ws.curve = curve; ws.oversample = '2x'; return ws;
  }

  const SOUNDS = {
    thud(t, v) { noise(0.22, 'lowpass', 320, 0.7, 0.9 * v, t); tone('sine', 110, 42, 0.18, 0.9 * v, t); },
    ko(t, v) { noise(0.35, 'lowpass', 220, 0.7, 1.0 * v, t); tone('sine', 90, 30, 0.35, 1.0 * v, t); tone('triangle', 60, 35, 0.4, 0.5 * v, t + 0.03); },
    crunch(t, v) { noise(0.14, 'bandpass', 900, 1.2, 0.8 * v, t, 500); tone('square', 160, 70, 0.07, 0.25 * v, t); noise(0.06, 'highpass', 2500, 0.8, 0.4 * v, t + 0.04); },
    whoosh(t, v) { noise(0.28, 'bandpass', 380, 0.6, 0.45 * v, t, 1900); },
    punch(t, v) { noise(0.07, 'highpass', 900, 0.8, 0.5 * v, t); tone('sine', 190, 90, 0.06, 0.45 * v, t); },
    grab(t, v) { noise(0.1, 'highpass', 600, 0.8, 0.3 * v, t); tone('sine', 230, 150, 0.09, 0.2 * v, t); },
    land(t, v) { noise(0.25, 'lowpass', 400, 0.7, 0.7 * v, t); tone('sine', 95, 40, 0.2, 0.6 * v, t); },
    roar(t, v) {
      const dist = distortion(60), lp = ac.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.setValueAtTime(900, t); lp.frequency.exponentialRampToValueAtTime(350, t + 0.9);
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.9 * v, t + 0.08); g.gain.setValueAtTime(0.9 * v, t + 0.5); g.gain.exponentialRampToValueAtTime(0.0001, t + 1.0);
      dist.connect(lp); lp.connect(g); g.connect(master);
      const lfo = ac.createOscillator(); lfo.frequency.value = 6; const lg = ac.createGain(); lg.gain.value = 9; lfo.connect(lg);
      for (const f of [82, 124, 61]) { const o = ac.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(f, t); o.frequency.linearRampToValueAtTime(f * 0.86, t + 1.0); lg.connect(o.frequency); o.connect(dist); o.start(t); o.stop(t + 1.05); }
      lfo.start(t); lfo.stop(t + 1.05);
      noise(0.9, 'lowpass', 500, 0.7, 0.35 * v, t + 0.05);
    },
    bell(t, v) { tone('sine', 880, 870, 1.2, 0.35 * v, t); tone('sine', 1320, 1310, 0.9, 0.15 * v, t); },
    cheer(t, v) { noise(1.4, 'bandpass', 1200, 0.4, 0.25 * v, t, 900); tone('sine', 660, 990, 0.5, 0.12 * v, t); },
    dodge(t, v) { noise(0.12, 'bandpass', 1400, 1.0, 0.25 * v, t, 2600); },
  };

  function play(name, opts) {
    if (!ac || muted || !SOUNDS[name]) return;
    opts = opts || {};
    const now = performance.now(), minGap = opts.minGap == null ? 45 : opts.minGap;
    if (lastPlay[name] && now - lastPlay[name] < minGap) return;
    lastPlay[name] = now;
    resume();
    try { SOUNDS[name](ac.currentTime + 0.001, opts.vol == null ? 1 : opts.vol); } catch (e) {}
  }
  function setMuted(m) { muted = !!m; try { localStorage.setItem('gg-muted', muted ? '1' : '0'); } catch (e) {} if (master) master.gain.value = muted ? 0 : 0.7; }
  root.GAudio = { init, play, setMuted, get muted() { return muted; }, get ready() { return !!ac; } };
})(window);
