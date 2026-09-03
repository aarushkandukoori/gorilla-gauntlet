/* env.js — physics-based combat environment for "N copies of a figure vs one silverback".
 * Units: metres, kilograms, seconds, newtons. Gravity 9.81 m/s². 2.5-D world: (x, y) on the
 * ground plane, z = height. Bodies are circles with mass; motion is force-driven with drag so
 * every actor has a terminal speed; hits are impulses (N·s) that conserve momentum, launch
 * bodies ballistically and knock them down; people holding on ride the gorilla via a distance
 * constraint and load it with their grip force and dead weight.
 *
 * Decisions come from "brains": heuristic policies or neural policies (see policy.js, RL-trained
 * in train.js). Works in browser (window.GorillaEnv) and Node (module.exports).
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GorillaEnv = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const DT = 0.05;                  // physics tick (20 Hz)
  const DECIDE_EVERY = 4;           // brains act every 0.2 s
  const TIME_LIMIT = 180;           // fight cap → gorilla still standing = humans failed
  const GRAV = 9.81;
  const ARENA_R = 9.0;              // metres
  const PIN_HOLD_SECONDS = 10, PIN_STAMINA_THRESHOLD = 30, EXHAUST_DEBT_SECONDS = 90;
  const ROTATE_OUT_STAMINA = 20, FRESH_RESERVE_STAMINA = 65;
  const HUMAN_ACTIONS = ['approach', 'advance', 'retreat', 'circle_cw', 'circle_ccw', 'strike', 'grab', 'rest'];
  const GORILLA_ACTIONS = ['advance', 'charge', 'swing', 'bite', 'shake', 'retreat', 'rest'];
  const HUMAN_OBS = 27, GORILLA_OBS = 24;

  function makeRng(seed) { let a = seed >>> 0; return function () { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  function noop() {}

  // ---- derived attributes (kgf-style indices kept for the HUD) ----
  function humanHpMax(f) { return 70 + 0.5 * f.massKg; }
  function humanDmgMult(f) { return 1.2 - 0.4 * f.toughness; }
  function fatigue(stam) { return 0.4 + 0.6 * Math.pow(clamp(stam / 100, 0, 1), 0.7); }
  function humanRestraint(f, h) { return (f.strengthIndex * (0.35 + 0.65 * f.grappling) + 0.5 * f.massKg * (0.5 + 0.5 * f.grappling)) * fatigue(h.stam); }
  function humanStrikeImpulse(f, h) { return (0.25 * f.massKg + 0.12 * f.strengthIndex) * (0.45 + 0.55 * f.striking) * fatigue(h.stam); } // N·s
  function humanMaxForce(f) { return f.strengthIndex * GRAV * 0.55; }        // N of drive
  function humanMaxSpeed(f) { return 3.2 + 4.2 * f.speed; }                  // m/s sprint
  function humanRadius(f) { return 0.28 + 0.12 * Math.min(2, (f.massKg / (f.heightM * f.heightM)) / 24); }
  function gorillaEff(G, g) {
    const sf = clamp(g.stam / 100, 0, 1), hf = clamp(g.hp / g.hpMax, 0, 1);
    const floor = 0.4 - 0.2 * clamp(g.exhaust / EXHAUST_DEBT_SECONDS, 0, 1);
    return G.strengthIndex * (floor + (1 - floor) * Math.pow(sf, 0.7)) * (0.6 + 0.4 * hf);
  }
  const gorillaMaxSpeed = g => 3.5 + 5.5 * Math.pow(clamp(g.stam / 100, 0, 1), 0.5);

  // ---- construction ----
  function createSim(figure, n, gorilla, opts) {
    opts = Object.assign({ strategy: 'swarm', seed: null, quiet: false, brains: null, timeLimit: TIME_LIMIT }, opts || {});
    const seed = opts.seed == null ? (Math.random() * 4294967296) >>> 0 : opts.seed >>> 0;
    const rng = makeRng(seed);
    const hpMax = humanHpMax(figure), r = humanRadius(figure);
    const humans = [];
    for (let i = 0; i < n; i++) {
      const a = rng() * Math.PI * 2, rr = 6.2 + rng() * 2.2;
      humans.push({
        id: i, name: n > 1 ? figure.name + ' #' + (i + 1) : figure.name,
        x: Math.cos(a) * rr, y: Math.sin(a) * rr, z: 0, vx: 0, vy: 0, vz: 0, m: figure.massKg, r,
        hp: hpMax, hpMax, stam: 100, state: 'waiting', floored: false, floorT: 0, holding: false, airborne: false,
        act: 7, actT: 0, cd: rng() * 0.6, windup: -1, effort: 0, dx: 0, dy: 0, face: Math.atan2(-Math.sin(a), -Math.cos(a)),
        strikes: 0, dmgDealt: 0, dmgTaken: 0, downAt: null, stun: 0, resting: false, hits: 0,
      });
    }
    const g = {
      x: 0, y: 0, vx: 0, vy: 0, m: gorilla.massKg, r: 0.6, hp: gorilla.hp, hpMax: gorilla.hp, stam: 100, exhaust: 0,
      pinned: false, pinTimer: 0, hampered: 0, restraint: 0, eff: gorilla.strengthIndex, kos: 0, attacks: 0, throws: 0,
      target: -1, cd: 0.8, windup: -1, windKind: null, windTarget: -1, act: 6, dazed: 0, face: 0, speed: 0, breakCd: 0, dmgDealt: 0, effort: 0, dx: 0, dy: 0, moveCost: 0,
    };
    const brains = opts.brains || { human: heuristicHuman(opts.strategy), gorilla: heuristicGorilla() };
    return { figure, gorilla, opts, seed, rng, humans, g, n, t: 0, tick: 0, over: false, result: null, events: [], brains,
      shaping: { hDmg: 0, gDmg: 0, gStamDrained: 0, kos: 0, latches: 0, throws: 0 } };
  }

  // ---- observations (normalized-ish, all roughly in [-1, 1]) ----
  function humanObs(sim, h, out) {
    const g = sim.g, f = sim.figure, G = sim.gorilla;
    const dx = g.x - h.x, dy = g.y - h.y, d = Math.hypot(dx, dy) || 1e-6, ux = dx / d, uy = dy / d;
    const closing = -((g.vx - h.vx) * ux + (g.vy - h.vy) * uy); // >0 gorilla approaching me
    const reach = g.r + h.r + 1.2, sreach = g.r + h.r + 0.35;
    const facing = Math.cos(g.face) * -ux + Math.sin(g.face) * -uy; // gorilla facing me
    let holders = 0, near = 0, down = 0, nearestAllyD = 20;
    for (const o of sim.humans) { if (o.state === 'down') { down++; continue; } if (o.holding) holders++; const od = Math.hypot(o.x - g.x, o.y - g.y); if (od < 3) near++; if (o !== h) { const ad = Math.hypot(o.x - h.x, o.y - h.y); if (ad < nearestAllyD) nearestAllyD = ad; } }
    let i = 0;
    out[i++] = ux; out[i++] = uy; out[i++] = clamp(d / 10, 0, 1.5); out[i++] = clamp(closing / 8, -1, 1);
    out[i++] = d < reach ? 1 : 0; out[i++] = d < sreach ? 1 : 0; out[i++] = clamp(facing, -1, 1);
    out[i++] = g.windup >= 0 && g.windTarget === h.id ? 1 : 0;
    out[i++] = h.hp / h.hpMax; out[i++] = h.stam / 100; out[i++] = h.holding ? 1 : 0; out[i++] = h.floored ? 1 : 0;
    out[i++] = g.stam / 100; out[i++] = g.hp / g.hpMax; out[i++] = g.pinned ? 1 : 0; out[i++] = clamp(g.hampered, 0, 1);
    out[i++] = holders / 10; out[i++] = near / 10; out[i++] = sim.humans.length ? down / sim.humans.length : 0;
    out[i++] = clamp(Math.hypot(h.vx, h.vy) / 8, 0, 1); out[i++] = clamp(nearestAllyD / 5, 0, 1);
    out[i++] = f.striking; out[i++] = f.grappling; out[i++] = f.endurance; out[i++] = f.speed; out[i++] = clamp(f.massKg / 200, 0, 1.5); out[i++] = clamp(f.strengthIndex / 400, 0, 1.5);
    return out; // 27
  }
  function gorillaObs(sim, out) {
    const g = sim.g;
    const alive = sim.humans.filter(h => h.state !== 'down');
    alive.sort((a, b) => (Math.hypot(a.x - g.x, a.y - g.y) - Math.hypot(b.x - g.x, b.y - g.y)));
    let i = 0, holders = 0, near = 0;
    for (const h of alive) { if (h.holding) holders++; if (Math.hypot(h.x - g.x, h.y - g.y) < 2.2) near++; }
    for (let k = 0; k < 3; k++) {
      const h = alive[k];
      if (!h) { out[i++] = 0; out[i++] = 0; out[i++] = 1; out[i++] = 0; out[i++] = 0; continue; }
      const dx = h.x - g.x, dy = h.y - g.y, d = Math.hypot(dx, dy) || 1e-6;
      out[i++] = dx / d; out[i++] = dy / d; out[i++] = clamp(d / 6, 0, 1.5); out[i++] = h.holding ? 1 : 0; out[i++] = h.floored ? 1 : 0;
    }
    out[i++] = holders / 10; out[i++] = near / 10; out[i++] = clamp(alive.length / 20, 0, 1.5);
    out[i++] = g.stam / 100; out[i++] = g.hp / g.hpMax; out[i++] = g.pinned ? 1 : 0; out[i++] = clamp(g.hampered, 0, 1);
    out[i++] = clamp(Math.hypot(g.vx, g.vy) / 9, 0, 1); out[i++] = g.dazed > 0 ? 1 : 0;
    return out; // 24
  }

  // ---- heuristic brains (baseline opponents / fallback) ----
  function heuristicHuman(strategy) {
    const pGrab = strategy === 'strike' ? 0.1 : strategy === 'mixed' ? 0.5 : -1; // -1 = figure-dependent
    return function (obs, sim, h) {
      const rng = sim.rng, f = sim.figure;
      if (h.floored) return 7;
      if (h.holding) return h.stam < 12 ? 2 : 6;
      if (h.stam < ROTATE_OUT_STAMINA) return obs[2] < 0.35 ? 2 : 7;         // spent: back off and rest
      const inReach = obs[5] > 0.5, inSwing = obs[4] > 0.5;
      if (!inReach) return obs[2] > 0.45 ? 0 : 1;
      const grabP = pGrab >= 0 ? pGrab : (f.striking >= f.grappling + 0.3 ? 0.5 : 0.85);
      if (obs[7] > 0.5 && f.speed > 0.6 && rng() < 0.4) return rng() < 0.5 ? 3 : 4; // dodge a telegraphed swing
      return rng() < grabP ? 6 : 5;
    };
  }
  function heuristicGorilla() {
    return function (obs, sim) {
      const g = sim.g, rng = sim.rng;
      const holders = obs[15] * 10, nearest = obs[2] * 6;
      if (g.stam < 12 && holders === 0 && rng() < 0.5) return 6;
      if (holders >= 1 && (g.pinned || g.hampered > 0.45)) return rng() < 0.6 ? 4 : 3;
      if (holders >= 1 && rng() < 0.35) return 3;
      if (nearest < g.r + 1.5) return rng() < 0.15 ? 3 : 2;
      return nearest < 4 ? 1 : 0;
    };
  }

  // ---- events ----
  function hurtHuman(sim, h, d, how, ev, extra) {
    h.hp -= d; h.dmgTaken += d; sim.g.dmgDealt += d; sim.shaping.hDmg += d;
    if (h.hp <= 0) {
      h.hp = 0; h.state = 'down'; h.downAt = sim.t; h.holding = false; h.floored = true; h.floorT = 1e9; sim.g.kos++; sim.shaping.kos++;
      ev('ko', h.name + ' is down (' + how + ')', h.id, Object.assign({ how, dmg: Math.round(d) }, extra || {}));
    } else ev(how === 'bitten' ? 'bite' : 'hit', h.name + ' ' + how + ' (-' + Math.round(d) + ')', h.id, Object.assign({ how, dmg: Math.round(d) }, extra || {}));
  }
  function finish(sim, winner, how, ev) {
    sim.over = true;
    let standing = 0; for (const h of sim.humans) if (h.state !== 'down') standing++;
    sim.result = { winner, how, t: sim.t, n: sim.n, kos: sim.g.kos, standing, gorillaHp: sim.g.hp / sim.g.hpMax, gorillaStam: sim.g.stam, seed: sim.seed };
    const label = { subdued: 'Gorilla subdued — pinned and exhausted', incapacitated: 'Gorilla incapacitated', all_down: 'Every human is down', timeout: 'Gorilla still standing at the time limit' }[how];
    ev(winner === 'humans' ? 'win' : 'lose', label);
    return sim.result;
  }
  function launch(h, jx, jy, jz) { h.vx += jx / h.m; h.vy += jy / h.m; h.vz += jz / h.m; if (h.vz > 0.6) { h.airborne = true; h.z = Math.max(h.z, 0.001); } }

  // ---- one physics tick ----
  const obsBufH = new Float64Array(HUMAN_OBS), obsBufG = new Float64Array(GORILLA_OBS);
  function step(sim) {
    if (sim.over) return;
    const dt = DT, f = sim.figure, G = sim.gorilla, g = sim.g, rng = sim.rng, humans = sim.humans;
    sim.t += dt; sim.tick++;
    const ev = sim.opts.quiet ? noop : function (kind, msg, who, extra) { sim.events.push(Object.assign({ t: sim.t, kind, msg, who: who == null ? -1 : who }, extra || {})); };
    const Geff = gorillaEff(G, g); g.eff = Geff;
    const sf = clamp(g.stam / 100, 0, 1);
    const gDrive = Geff * GRAV * 0.5;                    // N
    const holders = humans.filter(h => h.holding && h.state !== 'down');

    // -------- decisions --------
    const decide = sim.tick % DECIDE_EVERY === 0;
    if (decide) {
      for (const h of humans) {
        if (h.state === 'down') continue;
        if (h.airborne) { h.act = 7; continue; }
        const a = sim.brains.human(humanObs(sim, h, obsBufH), sim, h);
        if (a !== h.act) h.actT = 0;
        h.act = a;
      }
      const ga = sim.brains.gorilla(gorillaObs(sim, obsBufG), sim);
      if (ga !== g.act) g.actT = 0;
      g.act = ga;
    }

    // -------- restraint / pin state --------
    let Rsum = 0; for (const h of holders) Rsum += humanRestraint(f, h);
    g.restraint = Rsum;
    const wasPinned = g.pinned;
    g.speed = Math.hypot(g.vx, g.vy);
    g.pinned = holders.length >= 2 && Rsum >= Geff && g.speed < 0.8;
    g.hampered = holders.length ? clamp(Rsum / Geff, 0, 1) : 0;
    if (g.pinned && !wasPinned) ev('pin', 'Gorilla pinned under ' + holders.length + ' (restraint ' + Math.round(Rsum) + ' vs strength ' + Math.round(Geff) + ')');
    if (g.pinned && g.stam < PIN_STAMINA_THRESHOLD) g.pinTimer += dt; else g.pinTimer = Math.max(0, g.pinTimer - dt * 0.25);
    if (g.pinTimer >= PIN_HOLD_SECONDS) return finish(sim, 'humans', 'subdued', ev);

    // -------- gorilla intent --------
    g.cd -= dt; g.breakCd -= dt; if (g.dazed > 0) g.dazed -= dt;
    const alive = humans.filter(h => h.state !== 'down');
    let nearest = null, nd = 1e9;
    for (const h of alive) { const d = Math.hypot(h.x - g.x, h.y - g.y); if (d < nd) { nd = d; nearest = h; } }
    // a gorilla finishes what is in front of it: stay on the current target while it is close (75%)
    if (g.target >= 0 && nearest && humans[g.target] && humans[g.target].state !== 'down' && humans[g.target] !== nearest) {
      const cur = humans[g.target], cd = Math.hypot(cur.x - g.x, cur.y - g.y);
      if (cd < nd * 1.6 + 0.4 && (decide ? rng() < 0.75 : true)) { nearest = cur; nd = cd; }
    }
    if (nearest && decide) g.target = nearest.id;
    g.effort = 0; g.dx = 0; g.dy = 0;
    if (g.dazed <= 0 && g.windup < 0 && nearest) {
      const ux = (nearest.x - g.x) / (nd || 1e-6), uy = (nearest.y - g.y) / (nd || 1e-6);
      const reach = g.r + nearest.r + 1.2;
      switch (g.act) {
        case 0: if (nd > reach * 0.8) { g.dx = ux; g.dy = uy; g.effort = 0.5; } break;
        case 1: if (nd > reach * 0.7) { g.dx = ux; g.dy = uy; g.effort = 1.0; } break;
        case 2: // swing at nearest (or whoever is in reach)
          if (nd <= reach && g.cd <= 0) { g.windup = 0.25; g.windKind = 'swing'; g.windTarget = nearest.id; g.face = Math.atan2(uy, ux); }
          else if (nd > reach) { g.dx = ux; g.dy = uy; g.effort = 0.7; }
          break;
        case 3: { // bite a holder or a floored body, else nearest in bite range
          let t = holders.length ? holders[(rng() * holders.length) | 0] : null;
          if (!t) { for (const h of alive) if (h.floored && Math.hypot(h.x - g.x, h.y - g.y) < g.r + h.r + 0.9) { t = h; break; } }
          if (!t && nd < g.r + nearest.r + 0.9) t = nearest;
          if (t && g.cd <= 0) { g.windup = 0.2; g.windKind = 'bite'; g.windTarget = t.id; g.face = Math.atan2(t.y - g.y, t.x - g.x); }
          else if (!t) { g.dx = ux; g.dy = uy; g.effort = 0.6; }
          break; }
        case 4: // shake / break free
          if (holders.length && g.breakCd <= 0) {
            g.breakCd = 1.0;
            g.stam = Math.max(0, g.stam - (1.5 + 0.4 * holders.length));
            const burst = Geff * (0.9 + rng() * (0.2 + 0.6 * Math.sqrt(sf)));
            if (burst > Rsum * (0.9 + 0.2 * rng()) || Rsum < Geff * 0.5) {
              const k = Math.min(holders.length, 1 + (rng() < 0.5 ? 1 : 0) + (rng() < 0.25 ? 1 : 0));
              const victims = holders.slice().sort(() => rng() - 0.5).slice(0, k);
              for (const v of victims) {
                v.holding = false;
                const a = Math.atan2(v.y - g.y, v.x - g.x) + (rng() - 0.5) * 0.8;
                const J = (300 + 0.15 * Geff) * (0.85 + 0.3 * rng());
                launch(v, Math.cos(a) * J * 0.8, Math.sin(a) * J * 0.8, J * 0.62);
                v.stun = 0.4; hurtHuman(sim, v, (12 + 10 * rng()) * humanDmgMult(f), 'thrown', ev);
              }
              g.throws++; sim.shaping.throws++;
              ev('throw', 'Gorilla explodes free, hurling ' + victims.length + (victims.length === 1 ? ' body' : ' bodies'), victims[0].id, { ids: victims.map(v => v.id) });
            } else if (rng() < 0.3) {
              const v = holders[(rng() * holders.length) | 0]; g.attacks++;
              if (rng() < 0.5) { v.holding = false; v.stun = 0.6; }
              hurtHuman(sim, v, (22 + 0.015 * Geff) * humanDmgMult(f), 'bitten', ev);
            }
          } else if (!holders.length) g.stam = Math.max(0, g.stam - 0.02);
          break;
        case 5: { // retreat from the crowd centroid
          let cx = 0, cy = 0; for (const h of alive) { cx += h.x; cy += h.y; } cx /= alive.length; cy /= alive.length;
          const d = Math.hypot(g.x - cx, g.y - cy) || 1e-6; g.dx = (g.x - cx) / d; g.dy = (g.y - cy) / d; g.effort = 0.7; break; }
        case 6: default: break; // rest
      }
    }
    // resolve gorilla wind-up
    if (g.windup >= 0) {
      g.windup -= dt;
      if (g.windup < 0) {
        const t = humans[g.windTarget];
        g.windup = -1;
        if (t && t.state !== 'down') {
          const d = Math.hypot(t.x - g.x, t.y - g.y), ux = (t.x - g.x) / (d || 1e-6), uy = (t.y - g.y) / (d || 1e-6);
          if (g.windKind === 'swing') {
            g.cd = 1.1 / (0.3 + 0.7 * Math.pow(sf, 0.6)) * (1 + 0.5 * g.hampered) * (0.8 + 0.4 * rng()) - 0.25;
            g.stam = Math.max(0, g.stam - 1.0); g.attacks++;
            if (d <= g.r + t.r + 1.35) {
              const evade = (t.holding || t.floored) ? 0 : 0.08 + 0.3 * f.speed * (0.3 + 0.7 * Math.max(f.striking, f.grappling)) * (t.act === 3 || t.act === 4 ? 1.6 : 1);
              if (rng() < (0.9 - evade) * (0.7 + 0.3 * sf)) {
                const J = (290 + 0.22 * Geff) * (0.75 + 0.5 * rng());
                const dmg = (0.03 * (J * J) / (2 * t.m) + 0.06 * J) * humanDmgMult(f);
                if (t.holding && rng() < 0.6) t.holding = false;
                launch(t, ux * J * Math.cos(0.55), uy * J * Math.cos(0.55), J * Math.sin(0.55));
                t.stun = 0.5;
                hurtHuman(sim, t, dmg, 'struck', ev, { J: Math.round(J) });
              } else if (rng() < 0.3) ev('miss', t.name + ' slips a swing', t.id);
            }
          } else { // bite
            g.cd = 1.3 * (0.8 + 0.4 * rng()); g.stam = Math.max(0, g.stam - 0.9); g.attacks++;
            if (d <= g.r + t.r + 1.0) {
              // bites can be dodged by a free, mobile target and are hampered when several bodies hang on
              const bEvade = (t.holding || t.floored) ? 0 : 0.1 + 0.35 * f.speed * (0.3 + 0.7 * Math.max(f.striking, f.grappling));
              const held = holders.length >= 2 ? 0.55 : 1;
              if (rng() < (0.85 - bEvade) * held) {
                let dmg = (22 + 0.015 * Geff) * humanDmgMult(f), maim = false;
                if (rng() < 0.12) { dmg = 9999; maim = true; }
                if (t.holding && rng() < 0.7) { t.holding = false; t.stun = 0.6; }
                launch(t, ux * 40, uy * 40, 0);
                hurtHuman(sim, t, dmg, maim ? 'maimed' : 'bitten', ev);
              } else if (rng() < 0.3) ev('miss', t.name + ' slips a bite', t.id);
            }
          }
        }
      }
    }

    // -------- human intents --------
    let freshReserves = 0;
    for (const h of humans) if (h.state !== 'down' && h.stam >= FRESH_RESERVE_STAMINA && Math.hypot(h.x - g.x, h.y - g.y) > 3.5) freshReserves++;
    for (const h of humans) {
      if (h.state === 'down') { h.effort = 0; continue; }
      h.cd -= dt; if (h.stun > 0) h.stun -= dt;
      if (h.floored) { h.floorT -= dt; if (h.floorT <= 0) h.floored = false; h.effort = 0; h.holding = false; continue; }
      if (h.airborne) { h.effort = 0; continue; }
      const dx = g.x - h.x, dy = g.y - h.y, d = Math.hypot(dx, dy) || 1e-6, ux = dx / d, uy = dy / d;
      const sreach = g.r + h.r + 0.35;
      h.effort = 0; h.dx = 0; h.dy = 0; h.resting = false;
      if (h.holding && (h.act === 2 || h.act === 7)) h.holding = false;   // only a deliberate let-go releases
      if (h.stun > 0) continue;
      if (h.holding) {
        // riding the gorilla: can still strike from the hold (weaker), or just hang on
        if (h.act === 5 && d <= sreach + 0.4 && h.cd <= 0 && h.windup < 0) { h.windup = 0.22; h.face = Math.atan2(uy, ux); }
      } else switch (h.act) {
        case 0: if (d > sreach * 0.95) { h.dx = ux; h.dy = uy; h.effort = 1.0; } break;
        case 1: if (d > sreach * 0.95) { h.dx = ux; h.dy = uy; h.effort = 0.55; } break;
        case 2: h.dx = -ux; h.dy = -uy; h.effort = 0.85; break;
        case 3: case 4: { const s = h.act === 3 ? 1 : -1; h.dx = -uy * s; h.dy = ux * s; if (d > sreach + 0.6) { h.dx += ux * 0.5; h.dy += uy * 0.5; } const L = Math.hypot(h.dx, h.dy) || 1; h.dx /= L; h.dy /= L; h.effort = 0.7; break; }
        case 5: // strike
          if (d <= sreach + 0.15 && h.cd <= 0 && h.windup < 0) { h.windup = 0.22; h.face = Math.atan2(uy, ux); }
          else if (d > sreach) { h.dx = ux; h.dy = uy; h.effort = 0.7; }
          break;
        case 6: // grab
          if (d <= sreach + 0.1 && h.cd <= 0) {
            h.cd = 0.6; h.stam = Math.max(0, h.stam - 1.0 * (1.6 - f.endurance));
            const p = (0.25 + 0.6 * f.grappling) * (0.55 + 0.45 * (1 - sf)) * (g.speed > 3 ? 0.45 : 1) * (g.windup >= 0 ? 0.7 : 1);
            if (rng() < p) { h.holding = true; sim.shaping.latches++; ev('latch', h.name + ' latches on', h.id); }
          } else if (d > sreach) { h.dx = ux; h.dy = uy; h.effort = 0.85; }
          break;
        case 7: default: h.resting = true; break;
      }
      // resolve strike wind-up
      if (h.windup >= 0) {
        h.windup -= dt; h.effort = Math.min(h.effort, 0.2);
        if (h.windup < 0) {
          h.windup = -1; h.cd = (1.0 / (0.6 + 0.8 * f.speed)) * (0.8 + 0.4 * rng()) - 0.22;
          h.stam = Math.max(0, h.stam - 1.4 * (1.6 - f.endurance));
          if (d <= sreach + 0.4 && rng() < 0.55 + 0.4 * f.striking) {
            const J = humanStrikeImpulse(f, h) * (h.holding ? 0.6 : 1);
            const vital = rng() < 0.005 + 0.035 * f.striking;            // eyes sit deep under the brow ridge
            const dmg = vital ? J * 0.55 * 4 * (1 - G.strikeResist * 0.5) : J * 0.55 * (1 - G.strikeResist);
            g.hp = Math.max(0, g.hp - dmg); g.stam = Math.max(0, g.stam - (0.03 + dmg * 0.03)); sim.shaping.gDmg += dmg;
            g.vx += ux * J / g.m; g.vy += uy * J / g.m;
            h.strikes++; h.dmgDealt += dmg;
            if (vital) { g.dazed = Math.max(g.dazed, 0.8); ev('vital', h.name + ' rakes the eyes — gorilla reels', h.id); }
            else ev('strike', '', h.id, { dmg: Math.round(dmg * 10) / 10 });
          }
        }
      }
    }

    // -------- physics integration --------
    // gorilla: drive vs holders' grip; holders add dead weight
    {
      const maxV = gorillaMaxSpeed(g), Fmax = gDrive;
      let Fx = g.dx * Fmax * g.effort, Fy = g.dy * Fmax * g.effort;
      const Fmag = Math.hypot(Fx, Fy);
      const holdN = Rsum * GRAV * 0.5; // grip force (N)
      if (Fmag > 0) { const net = Math.max(0, Fmag - holdN); Fx *= net / Fmag; Fy *= net / Fmag; }
      let mEff = g.m; for (const h of holders) mEff += 0.8 * h.m;
      const k = Fmax / maxV * (1 + 0.6 * holders.length);
      g.vx += (Fx - k * g.vx) / mEff * dt; g.vy += (Fy - k * g.vy) / mEff * dt;
      g.x += g.vx * dt; g.y += g.vy * dt;
      if (g.effort > 0) { g.face = Math.atan2(g.dy, g.dx); g.stam = Math.max(0, g.stam - dt * (0.35 * g.effort * g.effort + (g.effort > 0.8 ? 0.6 : 0))); }
      const rr = Math.hypot(g.x, g.y); if (rr > ARENA_R - g.r) { g.x *= (ARENA_R - g.r) / rr; g.y *= (ARENA_R - g.r) / rr; g.vx *= 0.5; g.vy *= 0.5; }
    }
    // humans
    for (const h of humans) {
      if (h.holding) {
        // ride the gorilla: keep on its surface
        const dx = h.x - g.x, dy = h.y - g.y, d = Math.hypot(dx, dy) || 1e-6, want = g.r + h.r - 0.05;
        h.x = g.x + dx / d * want; h.y = g.y + dy / d * want; h.vx = g.vx; h.vy = g.vy; h.z = 0; h.vz = 0; h.airborne = false;
        h.stam = Math.max(0, h.stam - dt * 1.2 * (1.6 - f.endurance) * (g.pinned ? 0.6 : 1) * (0.6 + 0.4 * g.effort));
        if (h.stam <= 0 && rng() < 0.05) { h.holding = false; h.stun = 1.0; ev('info', h.name + ' loses grip, exhausted', h.id); }
        continue;
      }
      if (h.airborne) {
        h.vz -= GRAV * dt; h.z += h.vz * dt; h.x += h.vx * dt; h.y += h.vy * dt;
        if (h.z <= 0) {
          h.z = 0; h.airborne = false;
          const vimp = -h.vz; h.vz = 0; h.vx *= 0.35; h.vy *= 0.35;
          if (h.state !== 'down') {
            const KE = 0.5 * h.m * vimp * vimp;
            const dmg = vimp > 2.5 ? KE * 0.018 * humanDmgMult(f) : 0;
            h.floored = true; h.floorT = 0.6 + Math.min(2.5, dmg / 30) + (1 - f.toughness) * 0.6;
            if (dmg > 1) hurtHuman(sim, h, dmg, 'slammed into the ground', ev, { land: 1 }); else ev('land', '', h.id);
          }
        }
        continue;
      }
      const Fmax = humanMaxForce(f) * fatigue(h.stam), maxV = humanMaxSpeed(f) * (0.55 + 0.45 * fatigue(h.stam));
      const Fx = h.dx * Fmax * h.effort, Fy = h.dy * Fmax * h.effort;
      const k = Fmax / maxV;
      h.vx += (Fx - k * h.vx) / h.m * dt; h.vy += (Fy - k * h.vy) / h.m * dt;
      if (h.floored) { h.vx *= Math.exp(-dt * 6); h.vy *= Math.exp(-dt * 6); }
      h.x += h.vx * dt; h.y += h.vy * dt;
      if (h.effort > 0.05) { h.face = Math.atan2(h.dy, h.dx); h.stam = Math.max(0, h.stam - dt * (0.9 * h.effort * h.effort * (1.6 - f.endurance) + (h.effort > 0.85 ? 0.5 : 0))); }
      else if (h.resting || h.act === 7) h.stam = Math.min(100, h.stam + 2.5 * dt);
      else h.stam = Math.min(100, h.stam + 0.6 * dt);
      const rr = Math.hypot(h.x, h.y); if (rr > ARENA_R - h.r) { h.x *= (ARENA_R - h.r) / rr; h.y *= (ARENA_R - h.r) / rr; h.vx *= 0.3; h.vy *= 0.3; }
    }
    // collisions: humans vs humans, humans vs gorilla (ground bodies only)
    for (let i = 0; i < humans.length; i++) {
      const a = humans[i]; if (a.airborne || a.holding) continue;
      for (let j = i + 1; j < humans.length; j++) {
        const b = humans[j]; if (b.airborne || b.holding) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1e-6, min = a.r + b.r;
        if (d < min) { const nx = dx / d, ny = dy / d, pen = min - d, wa = b.m / (a.m + b.m), wb = a.m / (a.m + b.m); a.x -= nx * pen * wa; a.y -= ny * pen * wa; b.x += nx * pen * wb; b.y += ny * pen * wb; const rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny; if (rv < 0) { const jimp = -(1.05) * rv / (1 / a.m + 1 / b.m); a.vx -= jimp * nx / a.m; a.vy -= jimp * ny / a.m; b.vx += jimp * nx / b.m; b.vy += jimp * ny / b.m; } }
      }
      const dx = a.x - g.x, dy = a.y - g.y, d = Math.hypot(dx, dy) || 1e-6, min = a.r + g.r;
      if (d < min) { const nx = dx / d, ny = dy / d, pen = min - d, wa = g.m / (a.m + g.m), wg = a.m / (a.m + g.m); a.x += nx * pen * wa; a.y += ny * pen * wa; g.x -= nx * pen * wg; g.y -= ny * pen * wg; const rv = (a.vx - g.vx) * nx + (a.vy - g.vy) * ny; if (rv < 0) { const jimp = -(1.1) * rv / (1 / a.m + 1 / g.m); a.vx += jimp * nx / a.m; a.vy += jimp * ny / a.m; g.vx -= jimp * nx / g.m; g.vy -= jimp * ny / g.m; if (jimp > 180 && g.speed > 4 && !a.floored) { a.floored = true; a.floorT = 0.8; hurtHuman(sim, a, 0.02 * jimp * humanDmgMult(f), 'trampled', ev); } } }
    }

    // -------- stamina bookkeeping --------
    const contact = alive.filter(h => Math.hypot(h.x - g.x, h.y - g.y) < g.r + h.r + 1.5).length;
    if (contact === 0 && g.effort < 0.1) g.stam = Math.min(100, g.stam + 1.5 * dt);
    else if (!holders.length && g.effort < 0.1) g.stam = Math.min(100, g.stam + 0.2 * dt);
    if (holders.length) g.stam = Math.max(0, g.stam - dt * (0.2 + 0.1 * holders.length) * (g.pinned ? 1.5 : 1));
    if (g.stam < 10 && contact) g.exhaust += dt; else g.exhaust = Math.max(0, g.exhaust - dt * 0.5);
    sim.shaping.gStamDrained = 100 - g.stam;

    // -------- display states --------
    for (const h of humans) {
      if (h.state === 'down') continue;
      const d = Math.hypot(h.x - g.x, h.y - g.y);
      h.state = h.holding ? 'latched' : (d < 3.2 || h.effort > 0.3 && (h.act <= 1 || h.act === 5 || h.act === 6)) ? 'engaged' : 'waiting';
    }

    // -------- end conditions --------
    if (g.hp <= 0) return finish(sim, 'humans', 'incapacitated', ev);
    if (!alive.length) return finish(sim, 'gorilla', 'all_down', ev);
    if (sim.t >= sim.opts.timeLimit) return finish(sim, 'gorilla', 'timeout', ev);
  }

  // ---- headless helpers ----
  function run(figure, n, gorilla, opts) { const sim = createSim(figure, n, gorilla, Object.assign({ quiet: true }, opts || {})); while (!sim.over) step(sim); return sim.result; }
  function runSim(sim) { while (!sim.over) step(sim); return sim; }
  function winRate(figure, n, gorilla, opts, trials) {
    let w = 0; for (let i = 0; i < trials; i++) { const o = Object.assign({}, opts || {}); if (o.seed != null) o.seed = (o.seed + i * 7919) >>> 0; if (run(figure, n, gorilla, o).winner === 'humans') w++; }
    return w / trials;
  }
  function solver(figure, gorilla, opts, cfg) {
    cfg = Object.assign({ trials: 40, maxN: 120, target: 0.9, startN: 1 }, cfg || {});
    let n = cfg.startN; const rows = []; let done = false;
    return { rows, cfg, get done() { return done; },
      next() { if (done) return null; const wr = winRate(figure, n, gorilla, opts, cfg.trials); const row = { n, winRate: wr }; rows.push(row); if (wr >= cfg.target || n >= cfg.maxN) done = true; n++; return row; },
      summary() { const first = t => { const r = rows.find(r => r.winRate >= t); return r ? r.n : null; }; return { n50: first(0.5), n90: first(0.9), rows }; } };
  }

  return {
    DT, DECIDE_EVERY, TIME_LIMIT, ARENA_R, PIN_HOLD_SECONDS, PIN_STAMINA_THRESHOLD, HUMAN_ACTIONS, GORILLA_ACTIONS, HUMAN_OBS, GORILLA_OBS,
    createSim, step, run, runSim, winRate, solver, humanObs, gorillaObs, heuristicHuman, heuristicGorilla,
    humanHpMax, humanRestraint, humanStrikeImpulse, humanRadius, gorillaEff, makeRng,
  };
});
