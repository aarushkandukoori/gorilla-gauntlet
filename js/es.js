/* es.js — evolution-strategies policy search (OpenAI-ES style: antithetic Gaussian
 * perturbations, rank-shaped fitness, Adam step) with alternating self-play between the
 * human policy and the gorilla policy. Shared by train.js (Node) and trainer-worker.js (browser).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./env.js'), require('./policy.js'));
  else root.GorillaES = factory(root.GorillaEnv, root.GorillaPolicy);
})(typeof self !== 'undefined' ? self : this, function (E, P) {
  'use strict';

  function episodeReward(result, sim, side) {
    const sh = sim.shaping, n = sim.n, hpMaxH = sim.humans[0].hpMax;
    const win = result.winner === 'humans';
    const tFrac = result.t / sim.opts.timeLimit;
    // humans (team)
    let rH = (win ? 1 : -1) + 0.25 * (sh.gStamDrained / 100) + 0.25 * (sh.gDmg / sim.g.hpMax) - 0.35 * (sh.kos / n) - 0.15 * Math.min(1, sh.hDmg / (n * hpMaxH)) + (win ? 0.25 * (1 - tFrac) : 0) + 0.02 * Math.min(4, sh.latches / n);
    // gorilla
    let rG = (win ? -1 : 1) + 0.5 * (sh.kos / n) - 0.25 * (sh.gStamDrained / 100) - 0.25 * (sh.gDmg / sim.g.hpMax) + (!win && result.how === 'all_down' ? 0.25 * (1 - tFrac) : 0) + 0.15 * Math.min(1, sh.hDmg / (n * hpMaxH));
    return side === 'human' ? rH : rG;
  }

  // Evaluate one policy (as params) for `side` against an opponent brain, over a fixed set of scenarios.
  function evaluate(params, side, oppBrain, scenarios, cfg) {
    const brains = side === 'human'
      ? { human: P.policyFn(P.HUMAN_MLP, params), gorilla: oppBrain }
      : { human: oppBrain, gorilla: P.policyFn(P.GORILLA_MLP, params) };
    let total = 0, wins = 0;
    for (const sc of scenarios) {
      const sim = E.createSim(sc.figure, sc.n, cfg.gorilla, { seed: sc.seed, quiet: true, brains, timeLimit: cfg.timeLimit });
      E.runSim(sim);
      total += episodeReward(sim.result, sim, side);
      if (sim.result.winner === 'humans') wins++;
    }
    return { fitness: total / scenarios.length, winRate: wins / scenarios.length };
  }

  function makeScenarios(rng, cfg, k) {
    const out = [];
    for (let i = 0; i < k; i++) {
      const figure = cfg.roster[(rng() * cfg.roster.length) | 0];
      const lo = cfg.nRange[0], hi = cfg.nRange[1];
      const n = lo + Math.floor(rng() * (hi - lo + 1));
      out.push({ figure, n, seed: (rng() * 4294967296) >>> 0 });
    }
    return out;
  }

  function adam(dim, lr) {
    const m = new Float64Array(dim), v = new Float64Array(dim); let t = 0;
    return function (params, grad) { t++; const b1 = 0.9, b2 = 0.999, e = 1e-8; const a = lr * Math.sqrt(1 - Math.pow(b2, t)) / (1 - Math.pow(b1, t)); for (let i = 0; i < dim; i++) { m[i] = b1 * m[i] + (1 - b1) * grad[i]; v[i] = b2 * v[i] + (1 - b2) * grad[i] * grad[i]; params[i] += a * m[i] / (Math.sqrt(v[i]) + e); } };
  }

  // One ES generation for `side`. Returns stats.
  function generation(state, side, cfg) {
    const mlp = side === 'human' ? P.HUMAN_MLP : P.GORILLA_MLP;
    const theta = side === 'human' ? state.human : state.gorilla;
    const oppParams = side === 'human' ? state.gorilla : state.human;
    // opponent mix: current policy, a past snapshot (avoids chasing cycles), or a scripted opponent (keeps
    // both sides honest against strategies self-play might never produce, e.g. pure grapplers)
    const arch = side === 'human' ? state.archive.gorilla : state.archive.human;
    const u = state.rng();
    let oppBrain;
    if (u < cfg.scriptedOppProb) oppBrain = side === 'human' ? E.heuristicGorilla() : E.heuristicHuman(['swarm', 'mixed', 'strike'][(state.rng() * 3) | 0]);
    else {
      const oppP = arch.length && u < cfg.scriptedOppProb + 0.2 ? arch[(state.rng() * arch.length) | 0] : oppParams;
      oppBrain = oppP ? (side === 'human' ? P.policyFn(P.GORILLA_MLP, oppP) : P.policyFn(P.HUMAN_MLP, oppP)) : (side === 'human' ? E.heuristicGorilla() : E.heuristicHuman('swarm'));
    }
    const scenarios = makeScenarios(state.rng, cfg, cfg.episodes);
    const dim = mlp.nParams, pop = cfg.popSize;
    const eps = [], fit = new Float64Array(2 * pop); let wr = 0;
    const cand = new Float64Array(dim);
    for (let i = 0; i < pop; i++) {
      const e = new Float64Array(dim); for (let j = 0; j < dim; j++) e[j] = P.randn(state.rng); eps.push(e);
      for (let s = 0; s < 2; s++) {
        const sign = s === 0 ? 1 : -1;
        for (let j = 0; j < dim; j++) cand[j] = theta[j] + sign * cfg.sigma * e[j];
        const r = evaluate(cand, side, oppBrain, scenarios, cfg);
        fit[2 * i + s] = r.fitness; wr += r.winRate;
      }
    }
    // rank shaping → centered ranks in [-0.5, 0.5]
    const idx = Array.from(fit.keys()).sort((a, b) => fit[a] - fit[b]);
    const ranks = new Float64Array(2 * pop); idx.forEach((k, r) => ranks[k] = r / (2 * pop - 1) - 0.5);
    const grad = new Float64Array(dim);
    for (let i = 0; i < pop; i++) { const w = ranks[2 * i] - ranks[2 * i + 1]; const e = eps[i]; for (let j = 0; j < dim; j++) grad[j] += w * e[j]; }
    for (let j = 0; j < dim; j++) grad[j] /= (pop * cfg.sigma);
    // weight decay toward 0 keeps the net well-conditioned
    for (let j = 0; j < dim; j++) grad[j] -= cfg.weightDecay * theta[j];
    (side === 'human' ? state.adamH : state.adamG)(theta, grad);
    let mean = 0, best = -1e9; for (let i = 0; i < 2 * pop; i++) { mean += fit[i]; if (fit[i] > best) best = fit[i]; }
    mean /= 2 * pop;
    // evaluate the updated mean policy on the same scenarios
    const cur = evaluate(theta, side, oppBrain, scenarios, cfg);
    return { side, mean, best, current: cur.fitness, humanWinRate: side === 'human' ? cur.winRate : cur.winRate, popWinRate: wr / (2 * pop) };
  }

  function createState(cfg, init) {
    const rng = E.makeRng(cfg.seed || 1234);
    const human = init && init.human ? Float64Array.from(init.human) : P.initParams(P.HUMAN_MLP, rng, 0.5);
    const gorilla = init && init.gorilla ? Float64Array.from(init.gorilla) : P.initParams(P.GORILLA_MLP, rng, 0.5);
    return { rng, human, gorilla, gen: 0, archive: { human: [], gorilla: [] }, adamH: adam(human.length, cfg.lr), adamG: adam(gorilla.length, cfg.lr), history: [] };
  }

  // Run `gens` generations, alternating sides every cfg.phaseLen. onGen(stats) after each.
  function trainSteps(state, cfg, gens, onGen) {
    for (let k = 0; k < gens; k++) {
      const side = cfg.onlySide || (Math.floor(state.gen / cfg.phaseLen) % 2 === 0 ? 'human' : 'gorilla');
      const st = generation(state, side, cfg);
      st.gen = state.gen; state.gen++;
      if (state.gen % cfg.phaseLen === 0) { const a = side === 'human' ? state.archive.human : state.archive.gorilla; a.push(Float64Array.from(side === 'human' ? state.human : state.gorilla)); if (a.length > 6) a.shift(); }
      state.history.push(st);
      if (onGen) onGen(st, state);
    }
    return state;
  }

  const DEFAULTS = { popSize: 32, sigma: 0.08, lr: 0.03, episodes: 5, phaseLen: 5, weightDecay: 0.005, timeLimit: 90, nRange: [3, 16], seed: 1234, scriptedOppProb: 0.3 };
  return { DEFAULTS, createState, trainSteps, generation, evaluate, makeScenarios, episodeReward };
});
