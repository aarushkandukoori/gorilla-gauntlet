/* model.js — headless combat model for "N copies of a figure vs one silverback".
 * Works in the browser (window.GorillaModel) and in Node (module.exports) so the
 * same code drives the animated arena and the Monte Carlo solver / calibration.
 *
 * Units: mass kg, distance m, time s. "strengthIndex" is a kgf-equivalent max
 * exertion figure (≈ (best squat + deadlift + bench) / 3 for lifters).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GorillaModel = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DT = 0.1;                 // seconds per tick
  const TIME_LIMIT = 600;         // 10 min cap → gorilla still standing = humans failed
  const CONTACT_SLOTS = 10;       // bodies that can physically be on/around a gorilla at once
  const LATCH_WEIGHTS = [1, 1, 1, 1, 0.8, 0.8, 0.6, 0.6, 0.6, 0.6]; // diminishing returns for a dogpile
  const PIN_HOLD_SECONDS = 10;    // continuous pin needed while gorilla is exhausted
  const PIN_STAMINA_THRESHOLD = 30;
  const EXHAUST_DEBT_SECONDS = 90; // seconds at redline for the strength floor to fall 0.40 → 0.20
  const ROTATE_OUT_STAMINA = 20;   // a spent human tags out if a fresh reserve exists
  const FRESH_RESERVE_STAMINA = 65;

  // mulberry32 — seedable so Monte Carlo runs are reproducible
  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function clamp(x, a, b) { return x < a ? a : x > b ? b : x; }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) { const j = (rng() * (i + 1)) | 0; const t = arr[i]; arr[i] = arr[j]; arr[j] = t; }
    return arr;
  }
  function noop() {}

  // ---- derived attributes -------------------------------------------------
  function humanHpMax(f) { return 70 + 0.5 * f.massKg; }
  function humanDmgMult(f) { return 1.2 - 0.4 * f.toughness; }          // damage taken multiplier
  function humanEff(h) { return 0.4 + 0.6 * Math.pow(clamp(h.stam / 100, 0, 1), 0.7); }
  // Pinning is grip strength plus dead weight: strength term + body-mass term, both fatigue-scaled.
  function humanRestraint(f, h) { return (f.strengthIndex * (0.35 + 0.65 * f.grappling) + 0.5 * f.massKg * (0.5 + 0.5 * f.grappling)) * humanEff(h); }
  function humanStrikeRaw(f, h) { return (0.12 * f.massKg + 0.05 * f.strengthIndex) * (0.35 + 0.65 * f.striking) * humanEff(h); }

  // Strength falls with stamina; a gorilla redlining for minutes (exhaust debt) keeps weakening.
  function gorillaEff(G, g) {
    const sf = clamp(g.stam / 100, 0, 1), hf = clamp(g.hp / g.hpMax, 0, 1);
    const floor = 0.4 - 0.2 * clamp((g.exhaust || 0) / EXHAUST_DEBT_SECONDS, 0, 1);
    return G.strengthIndex * (floor + (1 - floor) * Math.pow(sf, 0.7)) * (0.6 + 0.4 * hf);
  }
  function gorillaSwing(Geff) { return 18 + 0.05 * Geff; }

  function grabPreference(f, strategy) {
    if (strategy === 'strike') return 0.1;
    if (strategy === 'mixed') return 0.5;
    return f.striking >= f.grappling + 0.3 ? 0.5 : 0.85; // swarm: specialists still throw hands
  }

  // ---- sim construction ----------------------------------------------------
  function createSim(figure, n, gorilla, opts) {
    opts = Object.assign({ strategy: 'swarm', seed: null, quiet: false }, opts || {});
    const seed = opts.seed == null ? (Math.random() * 4294967296) >>> 0 : opts.seed >>> 0;
    const rng = makeRng(seed);
    const hpMax = humanHpMax(figure);
    const humans = [];
    for (let i = 0; i < n; i++) {
      humans.push({
        id: i, name: n > 1 ? figure.name + ' #' + (i + 1) : figure.name,
        hp: hpMax, hpMax: hpMax, stam: 100, state: 'waiting', stun: 0, engageDelay: 0,
        cd: rng() * 0.8, grabCd: rng() * 0.5, strikes: 0, dmgDealt: 0, dmgTaken: 0, downAt: null,
      });
    }
    const g = {
      hp: gorilla.hp, hpMax: gorilla.hp, stam: 100, cd: 0.8, breakCd: 0, dazed: 0, freeWindow: 0,
      pinTimer: 0, pinned: false, hampered: 0, restraint: 0, eff: gorilla.strengthIndex, exhaust: 0, target: -1,
      kos: 0, dmgDealt: 0, attacks: 0, throws: 0,
    };
    return { figure, gorilla, opts, seed, rng, humans, g, n, t: 0, tick: 0, over: false, result: null, events: [] };
  }

  function hurt(sim, h, d, how, ev) {
    h.hp -= d; h.dmgTaken += d; sim.g.dmgDealt += d;
    if (h.hp <= 0) {
      h.hp = 0; h.state = 'down'; h.downAt = sim.t; sim.g.kos++;
      ev('ko', h.name + ' is down (' + how + ')', h.id, { how, dmg: Math.round(d) });
    } else {
      ev(how === 'bitten' ? 'bite' : 'hit', h.name + ' ' + how + ' (-' + Math.round(d) + ')', h.id, { how, dmg: Math.round(d) });
    }
  }

  function finish(sim, winner, how, ev) {
    sim.over = true;
    let standing = 0; for (const h of sim.humans) if (h.state !== 'down') standing++;
    sim.result = {
      winner, how, t: sim.t, n: sim.n, kos: sim.g.kos, standing,
      gorillaHp: sim.g.hp / sim.g.hpMax, gorillaStam: sim.g.stam, seed: sim.seed,
    };
    const label = {
      subdued: 'Gorilla subdued — pinned and exhausted',
      incapacitated: 'Gorilla incapacitated',
      all_down: 'Every human is down',
      timeout: 'Gorilla still standing after 10 minutes',
    }[how];
    ev(winner === 'humans' ? 'win' : 'lose', label);
    return sim.result;
  }

  // ---- one 0.1 s tick -------------------------------------------------------
  function step(sim) {
    if (sim.over) return;
    const dt = DT, f = sim.figure, G = sim.gorilla, g = sim.g, rng = sim.rng;
    sim.t += dt; sim.tick++;
    const ev = sim.opts.quiet ? noop : function (kind, msg, who, extra) { sim.events.push(Object.assign({ t: sim.t, kind, msg, who: who == null ? -1 : who }, extra || {})); };

    // timers
    for (const h of sim.humans) {
      h.cd -= dt; h.grabCd -= dt;
      if (h.stun > 0) h.stun -= dt;
      if (h.engageDelay > 0) h.engageDelay -= dt;
    }
    g.cd -= dt; g.breakCd -= dt;
    if (g.dazed > 0) g.dazed -= dt;
    if (g.freeWindow > 0) g.freeWindow -= dt;

    // rotation: spent bodies tag out when a fresh reserve is available
    let freshReserves = 0;
    for (const h of sim.humans) if (h.state === 'waiting' && h.stam >= FRESH_RESERVE_STAMINA) freshReserves++;
    for (const h of sim.humans) {
      if (freshReserves <= 0) break;
      if ((h.state === 'engaged' || h.state === 'latched') && h.stam < ROTATE_OUT_STAMINA && h.stun <= 0) {
        h.state = 'waiting'; freshReserves--;
        ev('info', h.name + ' tags out, spent', h.id);
      }
    }
    // fill contact slots from the waiting pool (fresh first, then anyone)
    const contact = [];
    for (const h of sim.humans) if (h.state === 'engaged' || h.state === 'latched') contact.push(h);
    if (contact.length < CONTACT_SLOTS) {
      for (let pass = 0; pass < 2 && contact.length < CONTACT_SLOTS; pass++) {
        for (const h of sim.humans) {
          if (contact.length >= CONTACT_SLOTS) break;
          if (h.state === 'waiting' && (pass === 1 || h.stam >= FRESH_RESERVE_STAMINA)) {
            h.state = 'engaged'; h.engageDelay = 0.5 + rng() * 0.8; contact.push(h);
          }
        }
      }
    }

    // restraint vs effective strength
    const Geff = gorillaEff(G, g);
    const latched = contact.filter(h => h.state === 'latched');
    let Rsum = 0;
    for (let i = 0; i < latched.length; i++) Rsum += LATCH_WEIGHTS[Math.min(i, LATCH_WEIGHTS.length - 1)] * humanRestraint(f, latched[i]);
    g.eff = Geff; g.restraint = Rsum;
    const wasPinned = g.pinned;
    g.pinned = latched.length >= 2 && Rsum >= Geff;
    g.hampered = latched.length ? clamp(Rsum / Geff, 0, 1) : 0;
    if (g.pinned && !wasPinned) ev('pin', 'Gorilla pinned under ' + latched.length + ' (restraint ' + Math.round(Rsum) + ' vs strength ' + Math.round(Geff) + ')');

    if (g.pinned && g.stam < PIN_STAMINA_THRESHOLD) g.pinTimer += dt;
    else g.pinTimer = Math.max(0, g.pinTimer - dt * 0.25);
    if (g.pinTimer >= PIN_HOLD_SECONDS) return finish(sim, 'humans', 'subdued', ev);

    // ---- gorilla acts ----
    if (g.dazed <= 0) {
      if (g.pinned) {
        if (g.breakCd <= 0) {
          g.breakCd = 1.0;
          g.stam = Math.max(0, g.stam - (2.5 + 0.6 * latched.length));
          const sfB = clamp(g.stam / 100, 0, 1);
          const burst = Geff * (0.9 + rng() * (0.2 + 0.6 * Math.sqrt(sfB))); // exhausted gorillas can't explode
          if (burst > Rsum * (0.9 + 0.2 * rng())) {
            const k = 1 + (rng() < 0.5 ? 1 : 0) + (rng() < 0.25 ? 1 : 0);
            const victims = shuffle(latched.slice(), rng).slice(0, k);
            for (const v of victims) {
              hurt(sim, v, (20 + 25 * rng()) * humanDmgMult(f), 'thrown', ev);
              if (v.state !== 'down') { v.state = 'engaged'; v.stun = 1.5 + rng(); }
            }
            g.freeWindow = 1.5; g.throws++;
            ev('throw', 'Gorilla explodes free, hurling ' + victims.length + (victims.length === 1 ? ' body' : ' bodies'), victims[0].id, { ids: victims.map(v => v.id) });
          } else if (rng() < 0.3) {
            const v = latched[(rng() * latched.length) | 0];
            g.attacks++;
            hurt(sim, v, (22 + 0.015 * Geff) * humanDmgMult(f), 'bitten', ev);
          }
        }
      } else if (g.cd <= 0) {
        const targets = contact.filter(h => h.state !== 'down' && h.engageDelay <= 0);
        if (targets.length) {
          // a gorilla finishes what is in front of it: keep mauling the current target 75% of the time
          let target = targets.find(h => h.id === g.target && rng() < 0.75) || null;
          if (!target) {
            const latchedT = targets.filter(h => h.state === 'latched');
            target = (latchedT.length && rng() < 0.7) ? latchedT[(rng() * latchedT.length) | 0] : targets[(rng() * targets.length) | 0];
          }
          g.target = target.id;
          const sf = clamp(g.stam / 100, 0, 1);
          const interval = 1.1 / (0.3 + 0.7 * Math.pow(sf, 0.6)) * (1 + 0.5 * g.hampered);
          g.cd = interval * (0.8 + 0.4 * rng());
          g.stam = Math.max(0, g.stam - 1.2);
          g.attacks++;
          const bite = rng() < (target.state === 'latched' ? 0.35 : 0.15);
          const evade = target.state === 'latched' ? 0 : 0.08 + 0.3 * f.speed * (0.3 + 0.7 * Math.max(f.striking, f.grappling));
          const acc = (0.9 - evade) * (0.7 + 0.3 * sf);
          if (rng() < acc) {
            let d, maim = false;
            if (bite) { d = 30 + 0.02 * Geff; if (rng() < 0.12) { d = 9999; maim = true; } }
            else d = gorillaSwing(Geff) * (0.7 + 0.6 * rng());
            d *= humanDmgMult(f);
            const wasLatched = target.state === 'latched';
            hurt(sim, target, d, maim ? 'maimed' : bite ? 'bitten' : 'struck', ev);
            if (target.state !== 'down' && wasLatched && rng() < 0.5) { target.state = 'engaged'; target.stun = 0.8; }
          } else if (rng() < 0.25) {
            ev('miss', target.name + ' slips a ' + (bite ? 'bite' : 'swing'), target.id);
          }
        }
      }
    }

    // gorilla stamina: a burst animal that recovers only when left alone
    if (contact.length === 0) g.stam = Math.min(100, g.stam + 1.5 * dt);
    else if (!latched.length) g.stam = Math.min(100, g.stam + 0.2 * dt);
    else g.stam = Math.max(0, g.stam - dt * (0.2 + 0.1 * latched.length) * (g.pinned ? 1.5 : 1));
    if (g.stam < 10 && contact.length) g.exhaust += dt; else g.exhaust = Math.max(0, g.exhaust - dt * 0.5);

    // ---- humans act ----
    const pGrab = grabPreference(f, sim.opts.strategy);
    const drain = 1.6 - f.endurance;
    for (const h of contact) {
      if (h.state === 'down' || h.stun > 0 || h.engageDelay > 0) continue;
      if (h.state === 'latched') {
        h.stam = Math.max(0, h.stam - dt * 1.2 * drain * (g.pinned ? 0.6 : 1));
        if (h.stam <= 0 && rng() < 0.05) { h.state = 'engaged'; h.stun = 1.0; ev('info', h.name + ' loses grip, exhausted', h.id); }
        continue;
      }
      if (h.grabCd <= 0 && rng() < pGrab) {
        h.grabCd = 0.6;
        if (latched.length < CONTACT_SLOTS) {
          const sf = clamp(g.stam / 100, 0, 1);
          const p = (0.25 + 0.6 * f.grappling) * (0.55 + 0.45 * (1 - sf)) * (g.freeWindow > 0 ? 0.3 : 1);
          h.stam = Math.max(0, h.stam - 1.0 * drain);
          if (rng() < p) { h.state = 'latched'; latched.push(h); ev('latch', h.name + ' latches on', h.id); }
        }
      } else if (h.cd <= 0) {
        h.cd = (1.0 / (0.6 + 0.8 * f.speed)) * (0.8 + 0.4 * rng());
        h.stam = Math.max(0, h.stam - 1.4 * drain);
        const raw = humanStrikeRaw(f, h);
        if (rng() < 0.55 + 0.4 * f.striking) {
          const vital = rng() < 0.02 + 0.08 * f.striking;
          const d = vital ? raw * 4 * (1 - G.strikeResist * 0.5) : raw * (1 - G.strikeResist);
          g.hp = Math.max(0, g.hp - d);
          g.stam = Math.max(0, g.stam - d * 0.08);
          h.strikes++; h.dmgDealt += d;
          if (vital) { g.dazed = Math.max(g.dazed, 0.8); ev('vital', h.name + ' rakes the eyes — gorilla reels', h.id); }
          else ev('strike', '', h.id);
        }
      }
    }
    for (const h of sim.humans) if (h.state === 'waiting') h.stam = Math.min(100, h.stam + 2.5 * dt);

    // ---- end conditions ----
    if (g.hp <= 0) return finish(sim, 'humans', 'incapacitated', ev);
    let standing = 0; for (const h of sim.humans) if (h.state !== 'down') standing++;
    if (!standing) return finish(sim, 'gorilla', 'all_down', ev);
    if (sim.t >= TIME_LIMIT) return finish(sim, 'gorilla', 'timeout', ev);
  }

  // ---- headless helpers -----------------------------------------------------
  function run(figure, n, gorilla, opts) {
    const sim = createSim(figure, n, gorilla, Object.assign({ quiet: true }, opts || {}));
    while (!sim.over) step(sim);
    return sim.result;
  }
  function winRate(figure, n, gorilla, opts, trials) {
    let w = 0;
    for (let i = 0; i < trials; i++) {
      const o = Object.assign({}, opts || {});
      if (o.seed != null) o.seed = (o.seed + i * 7919) >>> 0;
      if (run(figure, n, gorilla, o).winner === 'humans') w++;
    }
    return w / trials;
  }
  // Incremental solver: call next() repeatedly; each call evaluates one N.
  function solver(figure, gorilla, opts, cfg) {
    cfg = Object.assign({ trials: 40, maxN: 120, target: 0.9, startN: 1 }, cfg || {});
    let n = cfg.startN; const rows = []; let done = false;
    return {
      rows, cfg,
      get done() { return done; },
      next() {
        if (done) return null;
        const wr = winRate(figure, n, gorilla, opts, cfg.trials);
        const row = { n, winRate: wr }; rows.push(row);
        if (wr >= cfg.target || n >= cfg.maxN) done = true;
        n++;
        return row;
      },
      summary() {
        const first = t => { const r = rows.find(r => r.winRate >= t); return r ? r.n : null; };
        return { n50: first(0.5), n90: first(0.9), rows };
      },
    };
  }

  return {
    DT, TIME_LIMIT, CONTACT_SLOTS, PIN_HOLD_SECONDS, PIN_STAMINA_THRESHOLD,
    createSim, step, run, winRate, solver,
    humanHpMax, humanRestraint, humanStrikeRaw, gorillaEff, gorillaSwing, makeRng,
  };
});
