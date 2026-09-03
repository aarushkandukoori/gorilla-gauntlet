/* policy.js — tiny MLP policies for the gorilla and the humans + brain wrappers for env.js.
 * A "brain" is (obs, sim, actor) → action id. Neural brains ignore sim/actor and act on the
 * observation vector only. Shared between Node (training) and the browser (inference).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GorillaPolicy = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const HUMAN_NET = [27, 32, 32, 8];
  const GORILLA_NET = [24, 32, 32, 7];

  function MLP(sizes) {
    let n = 0; for (let l = 1; l < sizes.length; l++) n += sizes[l - 1] * sizes[l] + sizes[l];
    const bufs = sizes.map(s => new Float64Array(s));
    function forward(params, x) {
      let a = x, off = 0;
      for (let l = 1; l < sizes.length; l++) {
        const nin = sizes[l - 1], nout = sizes[l], out = bufs[l];
        for (let j = 0; j < nout; j++) {
          let s = params[off + nin * nout + j];
          const wo = off + j * nin;
          for (let i = 0; i < nin; i++) s += params[wo + i] * a[i];
          out[j] = l < sizes.length - 1 ? Math.tanh(s) : s;
        }
        off += nin * nout + nout; a = out;
      }
      return a; // logits
    }
    return { sizes, nParams: n, forward };
  }
  const HUMAN_MLP = MLP(HUMAN_NET), GORILLA_MLP = MLP(GORILLA_NET);

  function randn(rng) { let u = 0, v = 0; while (u === 0) u = rng(); while (v === 0) v = rng(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }
  function initParams(mlp, rng, scale) {
    const p = new Float64Array(mlp.nParams); let off = 0;
    for (let l = 1; l < mlp.sizes.length; l++) { const nin = mlp.sizes[l - 1], nout = mlp.sizes[l], s = (scale || 1) / Math.sqrt(nin); for (let i = 0; i < nin * nout; i++) p[off + i] = randn(rng) * s; off += nin * nout + nout; }
    return p;
  }
  function argmax(a) { let b = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[b]) b = i; return b; }
  function policyFn(mlp, params) { const P = params instanceof Float64Array ? params : Float64Array.from(params); return function (obs) { return argmax(mlp.forward(P, obs)); }; }
  function brainsFromParams(humanParams, gorillaParams, fallback) {
    return {
      human: humanParams ? policyFn(HUMAN_MLP, humanParams) : fallback.human,
      gorilla: gorillaParams ? policyFn(GORILLA_MLP, gorillaParams) : fallback.gorilla,
    };
  }
  return { HUMAN_NET, GORILLA_NET, HUMAN_MLP, GORILLA_MLP, MLP, randn, initParams, argmax, policyFn, brainsFromParams };
});
