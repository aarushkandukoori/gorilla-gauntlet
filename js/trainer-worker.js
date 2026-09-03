/* trainer-worker.js — runs the evolution-strategies self-play trainer off the main thread. */
importScripts('env.js', 'roster.js', 'policy.js', 'es.js');
let running = false, state = null, cfg = null;
self.onmessage = function (e) {
  const m = e.data;
  if (m.type === 'stop') { running = false; return; }
  if (m.type === 'start') {
    try {
      cfg = Object.assign({}, GorillaES.DEFAULTS, { roster: GorillaRoster.FIGURES, gorilla: GorillaRoster.GORILLA, seed: (Math.random() * 4294967295) >>> 0 }, m.cfg || {});
      state = GorillaES.createState(cfg, m.init);
      if (m.init && m.init.meta) state.gen = m.init.meta.generations || 0;
      running = true;
      loop();
    } catch (err) { self.postMessage({ type: 'error', message: err.message }); }
  }
};
function loop() {
  if (!running) return;
  try {
    GorillaES.trainSteps(state, cfg, 1, (st) => { self.postMessage({ type: 'gen', stats: st }); });
    if (state.gen % 3 === 0) self.postMessage({ type: 'params', gen: state.gen, human: Array.from(state.human), gorilla: Array.from(state.gorilla) });
  } catch (err) { self.postMessage({ type: 'error', message: err.message }); running = false; return; }
  setTimeout(loop, 0);
}
