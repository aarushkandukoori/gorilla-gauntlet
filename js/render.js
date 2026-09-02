/* render.js — animated fight scene for Gorilla Gauntlet.
 * Procedurally drawn, articulated humans and a silverback on a 3/4-view jungle clearing.
 * Positions live in "world" coordinates that equal logical screen coordinates (1000×620);
 * depth is the feet y — further away = higher on screen = drawn smaller and first.
 */
(function (root) {
  'use strict';
  const W = 1000, H = 620, TAU = Math.PI * 2;
  const PXM = 66;                       // pixels per metre at depth scale 1
  const GX = 500, GY = 392;             // gorilla feet anchor
  const RING_RX = 146, RING_RY = 64;    // engaged ring
  const SLOTS = 10;
  const GSCALE = 1.22;                  // gorilla drawn a touch larger than life for presence
  // where latched humans cling to the gorilla (gorilla-relative, facing +1); z<0 = behind the body
  const ATTACH = [
    { x: 72, y: -58, z: 1 }, { x: -72, y: -58, z: 1 },
    { x: 4, y: -122, z: -1 },
    { x: 40, y: -24, z: 1 }, { x: -40, y: -24, z: 1 },
    { x: -6, y: -142, z: -1 },
    { x: 62, y: -104, z: 1 }, { x: -62, y: -104, z: 1 },
    { x: 0, y: -54, z: -1 },
    { x: 24, y: -156, z: -1 },
  ];

  const clamp = (x, a, b) => x < a ? a : x > b ? b : x;
  const lerp = (a, b, t) => a + (b - a) * t;
  const rad = d => d * Math.PI / 180;
  const depthScale = y => 0.78 + 0.5 * clamp((y - 200) / 360, 0, 1);
  function hash(i) { const x = Math.sin(i * 12.9898 + 78.233) * 43758.5453; return x - Math.floor(x); }
  function blend(cur, tgt, k) { for (const key in tgt) { const t = tgt[key]; if (Array.isArray(t)) { const c = cur[key] || (cur[key] = t.slice()); for (let i = 0; i < t.length; i++) c[i] = lerp(c[i], t[i], k); } else cur[key] = cur[key] == null ? t : lerp(cur[key], t, k); } }
  function capsule(c, x1, y1, x2, y2, w, color) { c.strokeStyle = color; c.lineWidth = w; c.lineCap = 'round'; c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); }
  function ellipse(c, x, y, rx, ry, color) { c.fillStyle = color; c.beginPath(); c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, TAU); c.fill(); }
  function shade(hex, f) { const n = parseInt(hex.slice(1), 16); let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255; r = clamp(Math.round(r * f), 0, 255); g = clamp(Math.round(g * f), 0, 255); b = clamp(Math.round(b * f), 0, 255); return `rgb(${r},${g},${b})`; }

  const SKIN = '#c49a6c', SKIN_D = '#8f6b45', HAIR = '#2b211c', SHIRT = '#2fbf85', SHIRT_D = '#1d7d57', SHORTS = '#1f2a3a', SHOE = '#151a22';

  // ---------- background (prerendered) ----------
  function makeBackground() {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    const sky = c.createLinearGradient(0, 0, 0, 260); sky.addColorStop(0, '#07100c'); sky.addColorStop(1, '#17281d');
    c.fillStyle = sky; c.fillRect(0, 0, W, 260);
    // light shafts
    for (let i = 0; i < 4; i++) { c.fillStyle = 'rgba(190,220,170,0.035)'; c.beginPath(); const x = 120 + i * 210; c.moveTo(x - 60, -20); c.lineTo(x + 40, -20); c.lineTo(x + 260, 420); c.lineTo(x + 60, 420); c.closePath(); c.fill(); }
    // far treeline
    const blobs = (y0, h, col, n, seed) => { c.fillStyle = col; for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * (W + 120) - 60, r = h * (0.7 + 0.6 * hash(seed + i)), y = y0 + 14 * hash(seed * 3 + i); c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill(); c.fillRect(x - r * 0.12, y, r * 0.24, 300 - y); } };
    blobs(150, 62, '#11201a', 12, 11); blobs(185, 74, '#0c1812', 10, 29); blobs(215, 58, '#0a130e', 16, 47);
    // mist
    const mist = c.createLinearGradient(0, 200, 0, 290); mist.addColorStop(0, 'rgba(150,180,160,0)'); mist.addColorStop(0.6, 'rgba(150,180,160,0.10)'); mist.addColorStop(1, 'rgba(150,180,160,0)');
    c.fillStyle = mist; c.fillRect(0, 200, W, 90);
    // ground
    const gnd = c.createLinearGradient(0, 245, 0, H); gnd.addColorStop(0, '#2c3a26'); gnd.addColorStop(0.25, '#3c3323'); gnd.addColorStop(1, '#1d150e');
    c.fillStyle = gnd; c.fillRect(0, 245, W, H - 245);
    // trampled arena floor
    const fl = c.createRadialGradient(500, 400, 40, 500, 400, 430); fl.addColorStop(0, '#6a5136'); fl.addColorStop(0.55, '#54402b'); fl.addColorStop(1, 'rgba(70,55,38,0)');
    c.fillStyle = fl; c.beginPath(); c.ellipse(500, 405, 470, 205, 0, 0, TAU); c.fill();
    // dirt speckle
    for (let i = 0; i < 2600; i++) { const a = hash(i) * TAU, r = Math.sqrt(hash(i + 9000)); const x = 500 + Math.cos(a) * r * 470, y = 405 + Math.sin(a) * r * 205; c.fillStyle = hash(i + 500) > 0.5 ? 'rgba(0,0,0,0.12)' : 'rgba(255,230,190,0.06)'; c.fillRect(x, y, 2 + hash(i + 77) * 2, 1 + hash(i + 88)); }
    // grass tufts at the rim and beyond
    for (let i = 0; i < 700; i++) { const a = hash(i + 3000) * TAU, r = 0.86 + hash(i + 4000) * 0.34; const x = 500 + Math.cos(a) * r * 480, y = 405 + Math.sin(a) * r * 215; if (y < 250) continue; c.strokeStyle = `rgba(${60 + hash(i) * 40},${110 + hash(i + 1) * 60},${50 + hash(i + 2) * 30},0.7)`; c.lineWidth = 1.5; for (let k = 0; k < 3; k++) { c.beginPath(); c.moveTo(x, y); c.lineTo(x + (k - 1) * 3 + hash(i + k) * 2, y - 6 - hash(i + k + 9) * 8); c.stroke(); } }
    // a few rocks
    for (let i = 0; i < 9; i++) { const a = hash(i + 700) * TAU, x = 500 + Math.cos(a) * 455, y = 405 + Math.sin(a) * 200; if (y < 260) continue; ellipse(c, x, y, 10 + hash(i) * 12, 5 + hash(i + 3) * 6, '#3d3a36'); ellipse(c, x - 3, y - 3, 6 + hash(i) * 8, 3 + hash(i + 3) * 3, '#5a5650'); }
    return cv;
  }
  function makeVignette() {
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H; const c = cv.getContext('2d');
    const g = c.createRadialGradient(500, 330, 260, 500, 330, 640); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.62)');
    c.fillStyle = g; c.fillRect(0, 0, W, H); return cv;
  }

  // ---------- human poses ----------
  // angles in degrees; arms: [shoulder, elbow] (0 = hanging, + = forward, elbow bends forward); legs: [hip, knee] (knee bends back)
  const POSES = {
    stance:    { crouch: .12, lean: 8, rot: 0, head: 0, aF: [55, 115], aB: [70, 120], lF: [18, 10], lB: [-14, 8], yoff: 0 },
    idle:      { crouch: .05, lean: 2, rot: 0, head: 0, aF: [20, 40], aB: [15, 35], lF: [8, 4], lB: [-8, 4], yoff: 0 },
    punch:     { crouch: .1, lean: 18, rot: 0, head: 4, aF: [96, 2], aB: [60, 125], lF: [28, 12], lB: [-22, 6], yoff: 0 },
    grab:      { crouch: .22, lean: 28, rot: 0, head: 8, aF: [88, 10], aB: [82, 14], lF: [30, 18], lB: [-26, 8], yoff: 0 },
    latched:   { crouch: .3, lean: 40, rot: -28, head: 10, aF: [125, 95], aB: [118, 100], lF: [55, 80], lB: [30, 70], yoff: 0 },
    hurt:      { crouch: .12, lean: -26, rot: 0, head: -22, aF: [-30, 40], aB: [-22, 50], lF: [22, 8], lB: [-30, 14], yoff: 0 },
    dodge:     { crouch: .38, lean: -8, rot: 0, head: -6, aF: [50, 110], aB: [60, 115], lF: [36, 30], lB: [-34, 22], yoff: 0 },
    thrown:    { crouch: 0, lean: 0, rot: 0, head: 10, aF: [150, 20], aB: [30, 25], lF: [35, 20], lB: [-30, 25], yoff: 0 },
    down:      { crouch: 0, lean: 0, rot: 92, head: -18, aF: [120, 25], aB: [45, 10], lF: [22, 34], lB: [-8, 12], yoff: 1 },
    tired:     { crouch: .34, lean: 36, rot: 0, head: 26, aF: [22, 24], aB: [18, 20], lF: [20, 42], lB: [-16, 40], yoff: 0 },
    celebrate: { crouch: .05, lean: -6, rot: 0, head: -14, aF: [172, 6], aB: [168, 8], lF: [10, 6], lB: [-10, 6], yoff: 0 },
    walk:      { crouch: .06, lean: 6, rot: 0, head: 0, aF: [20, 30], aB: [-20, 30], lF: [26, 10], lB: [-26, 40], yoff: 0 },
  };

  // ---------- renderer ----------
  function createRenderer(canvas) {
    const ctx = canvas.getContext('2d');
    const bg = makeBackground(), vig = makeVignette();
    const decals = document.createElement('canvas'); decals.width = W; decals.height = H; const dctx = decals.getContext('2d');
    const A = root.GAudio;
    const R = {
      timeScale: 1, figure: null, sim: null, humans: new Map(), gor: null, slots: new Array(SLOTS).fill(-1),
      particles: [], texts: [], cam: { zoom: 1, cx: 500, cy: 330, tz: 1, tcx: 500, tcy: 330, shake: 0, shx: 0, shy: 0 },
      cine: 0, cineKind: null, simClock: 0, realClock: 0, speed: 1, roundNo: 0, banner: null,
    };
    const snd = (name, opts) => { if (A && A.ready) { if (R.speed > 4 && Math.random() > 4 / R.speed) return; A.play(name, opts); } };

    function makeHuman(h, f) {
      const a = TAU * hash(h.id + 1);
      const bulk = Math.pow(clamp((f.massKg / (f.heightM * f.heightM)) / 24, 0.85, 2.05), 0.62);
      return {
        id: h.id, x: GX + Math.cos(a) * 480, y: GY + Math.sin(a) * 235, tx: GX, ty: GY, face: 1, mode: 'walk',
        pose: Object.assign({}, POSES.idle, { aF: POSES.idle.aF.slice(), aB: POSES.idle.aB.slice(), lF: POSES.idle.lF.slice(), lB: POSES.idle.lB.slice() }),
        slot: -1, attach: -1, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, rot: 0, kx: 0, ky: 0, dx: 0,
        down: false, hurtT: 0, punchT: 0, grabT: 0, dodgeT: 0, riseT: 0, lieT: 0, walkPhase: hash(h.id * 3) * TAU, celebrate: false, wasLatched: false,
        seed: hash(h.id * 7 + 3), h: f.heightM * PXM, bulk, hp: 1,
      };
    }
    function makeGorilla() {
      return { x: GX, y: GY, face: -1, armF: 22, armB: 22, elbF: 10, elbB: 10, rise: 0, prone: 0, low: 0, lean: 0, mouth: 0, headDx: 0, headDy: 0, lunge: 0, lungeDir: 0,
        swingT: -1, biteT: -1, beatT: -1, dazedT: 0, windup: 0, heave: 0, dead: 0, target: -1 };
    }

    R.reset = function (sim, figure) {
      R.sim = sim; R.figure = figure; R.humans.clear(); R.slots.fill(-1); R.particles = []; R.texts = []; R.cine = 0; R.timeScale = 1; R.banner = null;
      for (const h of sim.humans) R.humans.set(h.id, makeHuman(h, figure));
      R.gor = makeGorilla();
      dctx.clearRect(0, 0, W, H);
      Object.assign(R.cam, { zoom: 1, cx: 500, cy: 330, tz: 1, tcx: 500, tcy: 330, shake: 0 });
    };

    // ---- geometry helpers ----
    const slotAngle = i => -Math.PI / 2 + TAU * (i / SLOTS) + 0.31;
    function slotPos(i) { const a = slotAngle(i); return { x: GX + Math.cos(a) * RING_RX, y: GY + Math.sin(a) * RING_RY }; }
    function attachPos(i) {
      const g = R.gor, p = ATTACH[i % ATTACH.length], s = depthScale(GY) * GSCALE;
      let ax = p.x, ay = p.y;
      // fold toward the ground as the gorilla goes prone
      ay = lerp(ay, ay * 0.25 - 10, g.prone); ax = lerp(ax, ax * 1.3, g.prone);
      return { x: g.x + g.lungeDir * g.lunge + ax * g.face * s, y: g.y + ay * s, z: p.z };
    }
    function reservePos(rank, total) {
      const ring = Math.floor(rank / 16), idx = rank % 16, per = Math.min(16, total - ring * 16);
      const a = -Math.PI / 2 + TAU * ((idx + 0.5) / per) + ring * 0.2;
      return { x: GX + Math.cos(a) * (350 + ring * 40), y: GY + 6 + Math.sin(a) * (168 + ring * 22) };
    }
    function shakeCam(n) { R.cam.shake = Math.max(R.cam.shake, n); }
    function text(x, y, txt, color, size) { R.texts.push({ x, y, txt, color, size: size || 16, life: 1.1, life0: 1.1 }); }
    function dust(x, y, n, spread) { for (let i = 0; i < n; i++) { const a = Math.random() * TAU, sp = (0.3 + Math.random()) * (spread || 60); R.particles.push({ type: 'dust', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.4 - 25, life: 0.5 + Math.random() * 0.4, life0: 0.9, size: 5 + Math.random() * 9 }); } }
    function blood(x, y, n, dir) { for (let i = 0; i < n; i++) { const a = (dir == null ? Math.random() * TAU : dir + (Math.random() - 0.5) * 1.6); const sp = 90 + Math.random() * 200; R.particles.push({ type: 'blood', x, y: y - 40, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp * 0.5 - 120 - Math.random() * 80, floor: y + (Math.random() - 0.5) * 16, life: 1.2, life0: 1.2, size: 2 + Math.random() * 2.5 }); } }
    function spark(x, y) { for (let i = 0; i < 5; i++) { const a = Math.random() * TAU, sp = 80 + Math.random() * 160; R.particles.push({ type: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.18, life0: 0.18, size: 2 }); } R.particles.push({ type: 'flash', x, y, life: 0.09, life0: 0.09, size: 18 }); }
    function decal(x, y, rx, ry, color) { dctx.fillStyle = color; dctx.beginPath(); dctx.ellipse(x, y, rx, ry, 0, 0, TAU); dctx.fill(); }

    // ---- model events → animation ----
    R.event = function (ev, sim) {
      const v = ev.who >= 0 ? R.humans.get(ev.who) : null, g = R.gor;
      switch (ev.kind) {
        case 'hit': if (v) { gorAttack('swing', v); hurtHuman(v, ev.dmg, false); } break;
        case 'bite': if (v) { gorAttack('bite', v); hurtHuman(v, ev.dmg, true); } break;
        case 'ko': if (v) { if (ev.how === 'bitten' || ev.how === 'maimed') gorAttack('bite', v); else if (ev.how === 'struck') gorAttack('swing', v); knockout(v, ev); } break;
        case 'miss': if (v) { gorAttack('swing', v); v.dodgeT = 0.4; v.dx = 0; snd('whoosh'); snd('dodge', { vol: 0.5 }); } break;
        case 'latch': if (v) { v.grabT = 0.35; assignAttach(v); snd('grab'); dust(v.x, v.y, 4, 40); } break;
        case 'strike': if (v) { v.punchT = 0.28; const a = Math.atan2(v.y - g.y, v.x - g.x); spark(g.x + Math.cos(a) * 46, g.y - 95 + Math.sin(a) * 20); snd('punch', { vol: 0.6 }); } break;
        case 'vital': if (v) { v.punchT = 0.3; g.dazedT = 0.9; text(g.x, g.y - 190, 'EYES!', '#34d399', 22); snd('punch'); snd('crunch', { vol: 0.5 }); shakeCam(4); } break;
        case 'pin': text(g.x, g.y - 190, 'PINNED', '#34d399', 26); dust(g.x, g.y, 18, 120); shakeCam(7); snd('thud'); snd('land'); break;
        case 'throw': { g.beatT = 0; g.rise = Math.max(g.rise, 0.2); const ids = ev.ids || (v ? [v.id] : []); ids.forEach((id, i) => throwHuman(R.humans.get(id), i)); snd('roar'); shakeCam(12); dust(g.x, g.y, 26, 160); break; }
        case 'win': cinematic('win'); break;
        case 'lose': cinematic('lose'); break;
      }
    };
    function gorAttack(kind, v) {
      const g = R.gor;
      if (v) { g.face = v.x < g.x ? -1 : 1; g.target = v.id; g.lungeDir = g.face; g.lunge = (kind === 'bite' ? 34 : 24) * (v.mode === 'latched' ? 0.5 : 1); }
      if (kind === 'swing') { g.swingT = 0; g.windup = 0; snd('whoosh', { vol: 0.7 }); }
      else { g.biteT = 0; g.mouth = 1; }
    }
    function hurtHuman(v, dmg, bite) {
      const g = R.gor;
      v.hurtT = 0.38;
      const a = Math.atan2(v.y - g.y, v.x - g.x);
      const kb = bite ? 14 : 34;
      v.kx = Math.cos(a) * kb; v.ky = Math.sin(a) * kb * 0.5;
      const s = depthScale(v.y);
      spark(v.x + (Math.random() - 0.5) * 10, v.y - v.h * s * 0.7);
      dust(v.x, v.y, 5, 70);
      if (bite) { blood(v.x, v.y - v.h * s * 0.5, 9, a); snd('crunch'); } else { if (dmg > 40) blood(v.x, v.y - v.h * s * 0.6, 4, a); snd('thud'); }
      if (dmg) text(v.x, v.y - v.h * s - 10, '-' + dmg, bite ? '#f59e0b' : '#f87171', 15);
      shakeCam(bite ? 5 : 3.5);
    }
    function knockout(v, ev) {
      const g = R.gor, s = depthScale(v.y);
      if (v.attach >= 0) { const p = attachPos(v.attach); v.x = p.x + (p.z < 0 ? -g.face * 40 : g.face * 40); v.y = p.y + 40 + Math.random() * 20; v.z = 60; v.vz = -30; v.vx = g.face * 90; v.vy = 30; releaseAttach(v); }
      v.down = true; v.mode = 'falling'; v.hurtT = 0.3; v.celebrate = false;
      const a = Math.atan2(v.y - g.y, v.x - g.x);
      v.kx = Math.cos(a) * 44; v.ky = Math.sin(a) * 22;
      blood(v.x, v.y - v.h * s * 0.55, ev && ev.how === 'maimed' ? 22 : 10, a);
      decal(v.x + (Math.random() - 0.5) * 20, v.y + 4, 22 + Math.random() * 14, 7 + Math.random() * 4, 'rgba(120,20,20,0.55)');
      text(v.x, v.y - v.h * s - 14, ev && ev.how === 'maimed' ? 'MAIMED' : 'DOWN', '#f87171', 20);
      snd('ko'); shakeCam(6);
      releaseSlot(v);
    }
    function throwHuman(v, i) {
      if (!v) return;
      const g = R.gor;
      const from = v.attach >= 0 ? attachPos(v.attach) : { x: v.x, y: v.y };
      releaseAttach(v); releaseSlot(v);
      const a = Math.atan2(from.y - g.y, from.x - g.x) + (Math.random() - 0.5) * 0.9 + i * 0.7;
      const dist = 190 + Math.random() * 110, T = 0.75;
      v.x = from.x; v.y = from.y + 20; v.z = 70;
      v.vx = Math.cos(a) * dist / T; v.vy = Math.sin(a) * dist * 0.5 / T; v.vz = -(v.z / T) - 0.5 * 700 * T; // ballistic to ground
      v.spin = (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 6);
      v.mode = 'thrown'; v.lieT = 0;
      dust(from.x, from.y, 6, 60);
    }
    function cinematic(kind) {
      R.cine = 2.4; R.cineKind = kind; R.timeScale = 0.16;
      R.cam.tz = 1.42; R.cam.tcx = R.gor.x; R.cam.tcy = R.gor.y - 70;
      if (kind === 'win') { for (const v of R.humans.values()) if (!v.down) v.celebrate = true; snd('bell'); setTimeout(() => snd('cheer'), 300); R.gor.dead = 1; }
      else { R.gor.beatT = 0; R.gor.victory = true; snd('roar'); snd('bell'); }
    }

    // ---- slot / attach bookkeeping ----
    function releaseSlot(v) { if (v.slot >= 0) { R.slots[v.slot] = -1; v.slot = -1; } }
    function assignSlot(v) { if (v.slot >= 0) return; let best = -1, bd = 1e9; for (let i = 0; i < SLOTS; i++) if (R.slots[i] < 0) { const p = slotPos(i), d = (p.x - v.x) ** 2 + (p.y - v.y) ** 2; if (d < bd) { bd = d; best = i; } } if (best >= 0) { R.slots[best] = v.id; v.slot = best; } }
    function releaseAttach(v) { v.attach = -1; }
    function assignAttach(v) { if (v.attach >= 0) return; const used = new Set(); for (const o of R.humans.values()) if (o.attach >= 0) used.add(o.attach); for (let i = 0; i < ATTACH.length; i++) if (!used.has(i)) { v.attach = i; return; } v.attach = (v.id % ATTACH.length); }

    // ---- per-frame update ----
    R.update = function (dtSim, dtReal, sim, info) {
      if (!R.sim) return;
      R.speed = info.speed; R.roundNo = info.roundNo;
      R.simClock += dtSim; R.realClock += dtReal;
      const g = R.gor, mg = sim.g, f = R.figure;
      const dt = Math.min(dtSim, 0.25) || 0; // for smoothing (never blow up on burst catch-ups)
      const k = 1 - Math.exp(-dt * 14), kf = 1 - Math.exp(-dt * 30);

      // -------- gorilla --------
      const modelTarget = mg.target >= 0 ? R.humans.get(mg.target) : null;
      if (modelTarget && g.swingT < 0 && g.biteT < 0 && g.beatT < 0 && !mg.pinned) g.face = lerp(g.face, modelTarget.x < g.x ? -1 : 1, kf) ;
      g.face = g.face < 0 ? -1 : 1;
      const stam = mg.stam / 100;
      const wantProne = mg.pinned || g.dead ? 1 : 0;
      g.prone = lerp(g.prone, wantProne, 1 - Math.exp(-dt * 6));
      const wantLow = (!mg.pinned && stam < 0.3) ? (1 - stam / 0.3) : 0;
      g.low = lerp(g.low, wantLow, k);
      g.heave = 0.5 + 0.5 * Math.sin(R.simClock * (2 + 8 * (1 - stam)));
      if (g.dazedT > 0) g.dazedT -= dt;
      g.lunge = lerp(g.lunge, 0, 1 - Math.exp(-dt * 9));
      // windup anticipation from the model's cooldown
      const canAttack = !mg.pinned && g.dazedT <= 0 && g.swingT < 0 && g.biteT < 0 && g.beatT < 0 && mg.cd > 0 && mg.cd < 0.3;
      g.windup = canAttack ? 1 - mg.cd / 0.3 : lerp(g.windup, 0, kf);
      let armF = 22, armB = 22, elbF = 12, elbB = 12, rise = 0, mouth = stam < 0.3 ? 0.35 + 0.25 * g.heave : 0, headDx = 0, headDy = 0, lean = 0;
      if (g.windup > 0) { armF = lerp(22, -95, g.windup); elbF = lerp(12, 40, g.windup); lean = -6 * g.windup; }
      if (g.swingT >= 0) { g.swingT += dt; const t = g.swingT; if (t < 0.11) { armF = lerp(-95, 135, t / 0.11); elbF = 25; lean = 10; } else if (t < 0.5) { armF = lerp(135, 22, (t - 0.11) / 0.39); elbF = 14; lean = lerp(10, 0, (t - 0.11) / 0.39); } else g.swingT = -1; }
      if (g.biteT >= 0) { g.biteT += dt; const t = g.biteT; if (t < 0.45) { const p = t < 0.15 ? t / 0.15 : 1 - (t - 0.15) / 0.3; headDx = 34 * p; headDy = 18 * p; mouth = 1; lean = 12 * p; armF = lerp(22, 60, p); armB = lerp(22, 60, p); elbF = elbB = 30; } else g.biteT = -1; }
      if (g.beatT >= 0) { g.beatT += dt; const t = g.beatT; if (t < 1.25) { rise = t < 0.18 ? t / 0.18 : t > 1.05 ? 1 - (t - 1.05) / 0.2 : 1; const ph = Math.sin(t * 34); armF = 105 + 25 * ph; armB = 105 - 25 * ph; elbF = 125; elbB = 125; mouth = 1; headDy = -8; if (g.victory && t > 1.2) g.beatT = 0.5; } else g.beatT = -1; }
      if (g.dazedT > 0) { headDx += Math.sin(R.simClock * 26) * 9; mouth = Math.max(mouth, 0.4); }
      g.armF = lerp(g.armF, armF, g.swingT >= 0 || g.beatT >= 0 ? 1 - Math.exp(-dt * 40) : kf);
      g.armB = lerp(g.armB, armB, kf); g.elbF = lerp(g.elbF, elbF, kf); g.elbB = lerp(g.elbB, elbB, kf);
      g.rise = lerp(g.rise, rise, 1 - Math.exp(-dt * 12)); g.mouth = lerp(g.mouth, mouth, kf); g.headDx = lerp(g.headDx, headDx, kf); g.headDy = lerp(g.headDy, headDy, kf); g.lean = lerp(g.lean, lean, kf);

      // -------- humans --------
      const waiting = sim.humans.filter(h => h.state === 'waiting');
      const wRank = new Map(); waiting.forEach((h, i) => wRank.set(h.id, i));
      for (const h of sim.humans) {
        const v = R.humans.get(h.id); if (!v) continue;
        v.hp = h.hp / h.hpMax;
        if (v.hurtT > 0) v.hurtT -= dt; if (v.punchT > 0) v.punchT -= dt; if (v.grabT > 0) v.grabT -= dt; if (v.dodgeT > 0) v.dodgeT -= dt; if (v.riseT > 0) v.riseT -= dt;
        v.kx *= Math.exp(-dt * 6); v.ky *= Math.exp(-dt * 6);

        if (h.state === 'down' && !v.down) knockout(v, null);

        if (v.mode === 'thrown') {
          // ballistic flight in world coords, z = height
          v.x += v.vx * dt; v.y += v.vy * dt; v.vz += 700 * dt; v.z -= v.vz * dt; v.rot += v.spin * dt;
          if (v.z <= 0) { v.z = 0; v.vx = v.vy = v.vz = 0; v.mode = v.down ? 'down' : 'lying'; v.lieT = 0; dust(v.x, v.y, 10, 90); decal(v.x, v.y + 3, 26, 8, 'rgba(60,45,30,0.35)'); snd('land'); shakeCam(4); }
          continue;
        }
        if (v.mode === 'falling') { v.vz += 700 * dt; v.z = Math.max(0, v.z - v.vz * dt); v.x += v.vx * dt; v.y += v.vy * dt; if (v.z <= 0) { v.mode = 'down'; v.vx = v.vy = 0; dust(v.x, v.y, 8, 70); } continue; }
        if (v.down) { v.mode = 'down'; continue; }
        if (v.mode === 'lying') { v.lieT += dt; if (h.stun <= 0 && v.lieT > 0.4) { v.mode = 'rising'; v.riseT = 0.5; } continue; }
        if (v.mode === 'rising') { if (v.riseT <= 0) v.mode = 'walk'; continue; }

        // where should this body be?
        let target = null, arriveMode = 'stance';
        if (h.state === 'waiting') { releaseSlot(v); releaseAttach(v); const p = reservePos(wRank.get(h.id), waiting.length); target = p; arriveMode = h.stam < 60 ? 'tired' : 'idle'; }
        else if (h.state === 'latched' && !g.dead) { if (v.attach < 0) assignAttach(v); releaseSlot(v); v.mode = 'latched'; const p = attachPos(v.attach); v.x = lerp(v.x, p.x, 1 - Math.exp(-dt * 16)); v.y = lerp(v.y, p.y, 1 - Math.exp(-dt * 16)); v.wasLatched = true; v.face = p.x < g.x ? 1 : -1; continue; }
        else { // engaged (or dismounting a beaten gorilla)
          if (v.attach >= 0) { const p = attachPos(v.attach); v.x = p.x + (p.z < 0 ? -g.face : g.face) * 30; v.y = p.y + 50; releaseAttach(v); if (!g.dead) v.hurtT = Math.max(v.hurtT, 0.4); dust(v.x, v.y, 5, 50); }
          assignSlot(v);
          const p = v.slot >= 0 ? slotPos(v.slot) : reservePos(0, 1);
          target = p; arriveMode = h.stam < 25 ? 'tired' : 'stance';
        }
        // move toward target
        const dx = target.x - v.x, dy = target.y - v.y, d = Math.hypot(dx, dy);
        const spd = (120 + 110 * f.speed) * (h.stam < 25 ? 0.6 : 1);
        if (d > 4) {
          const step = Math.min(d, spd * dt);
          v.x += dx / d * step; v.y += dy / d * step;
          v.face = dx < 0 ? -1 : 1;
          v.mode = 'walk'; v.walkPhase += dt * (6 + 4 * f.speed);
          if (Math.random() < dt * 4) dust(v.x, v.y, 1, 20);
        } else {
          v.mode = arriveMode; v.face = v.x < g.x ? 1 : -1;
          if (h.state === 'waiting') v.face = v.x < g.x ? 1 : -1;
        }
        if (v.dodgeT > 0) { const side = (v.y < g.y ? -1 : 1); v.dx = lerp(v.dx, side * 26 * Math.sin(Math.PI * clamp(v.dodgeT / 0.4, 0, 1)), 0.5); } else v.dx = lerp(v.dx, 0, kf);
      }

      // -------- particles & texts (sim time) --------
      for (const p of R.particles) {
        p.life -= dt;
        if (p.type === 'dust') { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; p.size += 26 * dt; }
        else if (p.type === 'blood') { p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 900 * dt; if (p.y >= p.floor) { decal(p.x, p.floor, 2 + Math.random() * 3, 1 + Math.random() * 1.5, 'rgba(140,18,18,0.7)'); p.life = 0; } }
        else if (p.type === 'spark') { p.x += p.vx * dt; p.y += p.vy * dt; }
      }
      R.particles = R.particles.filter(p => p.life > 0);
      for (const t of R.texts) { t.life -= dt; t.y -= 26 * dt; }
      R.texts = R.texts.filter(t => t.life > 0);

      // -------- camera (real time) --------
      const cam = R.cam;
      if (R.cine > 0) { R.cine -= dtReal; if (R.cine <= 0) { R.timeScale = 1; cam.tz = 1; cam.tcx = 500; cam.tcy = 330; } }
      else { cam.tz = mg.pinned ? 1.1 : 1; cam.tcx = mg.pinned ? lerp(500, g.x, 0.6) : 500; cam.tcy = mg.pinned ? lerp(330, g.y - 60, 0.6) : 330; }
      const ck = 1 - Math.exp(-dtReal * 3);
      cam.zoom = lerp(cam.zoom, cam.tz, ck); cam.cx = lerp(cam.cx, cam.tcx, ck); cam.cy = lerp(cam.cy, cam.tcy, ck);
      cam.shake *= Math.exp(-dtReal * 7);
      cam.shx = (Math.random() - 0.5) * cam.shake * 2; cam.shy = (Math.random() - 0.5) * cam.shake * 2;
    };

    // ---- drawing ----
    R.draw = function (sim, info) {
      const c = ctx, s = canvas.width / W, cam = R.cam;
      c.setTransform(1, 0, 0, 1, 0, 0); c.clearRect(0, 0, canvas.width, canvas.height);
      const z = cam.zoom;
      c.setTransform(s * z, 0, 0, s * z, s * (W / 2 - z * (cam.cx - cam.shx)), s * (H / 2 - z * (cam.cy - cam.shy)));
      c.drawImage(bg, 0, 0);
      if (!R.sim || !sim) { c.setTransform(s, 0, 0, s, 0, 0); c.drawImage(vig, 0, 0); return; }
      c.drawImage(decals, 0, 0);
      const g = R.gor;
      // depth-sorted drawables
      const items = [];
      for (const h of sim.humans) { const v = R.humans.get(h.id); if (!v) continue; let key = v.y; if (v.attach >= 0 && v.mode === 'latched') { const p = ATTACH[v.attach]; key = g.y + (p.z < 0 ? -2 : 2); } else if (v.mode === 'down' || v.mode === 'lying') key -= 6; items.push({ key, v, h }); }
      items.push({ key: g.y, gor: true });
      items.sort((a, b) => a.key - b.key);
      for (const it of items) { if (it.gor) drawGorilla(c, g, sim.g); else drawHuman(c, it.v, it.h); }
      // particles
      for (const p of R.particles) {
        const a = clamp(p.life / p.life0, 0, 1);
        if (p.type === 'dust') { c.fillStyle = `rgba(196,168,126,${0.32 * a})`; c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill(); }
        else if (p.type === 'blood') { c.fillStyle = '#9b1414'; c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill(); }
        else if (p.type === 'spark') { c.fillStyle = `rgba(255,255,255,${a})`; c.beginPath(); c.arc(p.x, p.y, p.size, 0, TAU); c.fill(); }
        else if (p.type === 'flash') { c.fillStyle = `rgba(255,255,255,${0.9 * a})`; c.beginPath(); c.arc(p.x, p.y, p.size * (1.4 - a), 0, TAU); c.fill(); }
      }
      for (const t of R.texts) { const a = clamp(t.life / t.life0, 0, 1); c.globalAlpha = a; c.font = `900 ${t.size}px system-ui, -apple-system, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.lineWidth = 4; c.strokeStyle = 'rgba(0,0,0,0.7)'; c.strokeText(t.txt, t.x, t.y); c.fillStyle = t.color; c.fillText(t.txt, t.x, t.y); c.globalAlpha = 1; }
      // overlays in screen space
      c.setTransform(s, 0, 0, s, 0, 0);
      c.drawImage(vig, 0, 0);
      drawHUD(c, sim, info);
      if (R.cine > 0 || cam.zoom > 1.05) { const bh = 34 * clamp((cam.zoom - 1) / 0.4, 0, 1); c.fillStyle = 'rgba(0,0,0,0.85)'; c.fillRect(0, 0, W, bh); c.fillRect(0, H - bh, W, bh); }
    };

    function drawHUD(c, sim, info) {
      const mg = sim.g, f = R.figure;
      let hp = 0, hpMax = 0, standing = 0; for (const h of sim.humans) { hp += h.hp; hpMax += h.hpMax; if (h.state !== 'down') standing++; }
      const barW = 330, y = 18;
      c.font = '700 13px system-ui, sans-serif'; c.textBaseline = 'top';
      // crew (left)
      c.textAlign = 'left'; c.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(c, 14, y - 6, barW + 12, 46, 8); c.fill();
      c.fillStyle = '#e7e9ee'; c.fillText(`${sim.n} × ${f.name.toUpperCase()}`, 22, y - 2);
      c.fillStyle = '#9aa3b2'; c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'right'; c.fillText(`${standing} standing`, 14 + barW + 4, y - 1);
      hudBar(c, 22, y + 16, barW - 4, 9, hp / hpMax, '#2fbf85', '#0f2a1f');
      hudBar(c, 22, y + 27, barW - 4, 4, sim.humans.reduce((a, h) => a + (h.state === 'down' ? 0 : h.stam), 0) / (100 * Math.max(1, standing)), '#fbbf24', '#2a2410');
      // gorilla (right)
      c.textAlign = 'right'; c.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(c, W - 14 - barW - 12, y - 6, barW + 12, 46, 8); c.fill();
      c.font = '700 13px system-ui, sans-serif'; c.fillStyle = '#f59e0b'; c.fillText('SILVERBACK', W - 22, y - 2);
      c.textAlign = 'left'; c.fillStyle = '#9aa3b2'; c.font = '600 11px system-ui, sans-serif'; c.fillText(mg.pinned ? 'PINNED' : mg.hampered > 0 ? `held ${Math.round(mg.hampered * 100)}%` : mg.stam < 30 ? 'EXHAUSTED' : 'free', W - 14 - barW - 4, y - 1);
      hudBar(c, W - 22 - (barW - 4), y + 16, barW - 4, 9, mg.hp / mg.hpMax, '#f87171', '#2a1010', true);
      hudBar(c, W - 22 - (barW - 4), y + 27, barW - 4, 4, mg.stam / 100, '#f59e0b', '#2a2410', true);
      // centre: round + clock
      c.textAlign = 'center'; c.fillStyle = 'rgba(0,0,0,0.5)'; roundRect(c, W / 2 - 78, y - 6, 156, 46, 8); c.fill();
      c.fillStyle = '#9aa3b2'; c.font = '600 11px system-ui, sans-serif'; c.fillText(`ROUND ${info.roundNo}`, W / 2, y - 1);
      c.fillStyle = '#e7e9ee'; c.font = '700 20px ui-monospace, Menlo, monospace'; const t = sim.t; c.fillText(`${Math.floor(t / 60)}:${(t % 60).toFixed(1).padStart(4, '0')}`, W / 2, y + 12);
      if (mg.pinTimer > 0.05) { c.fillStyle = '#9aa3b2'; c.font = '600 11px system-ui, sans-serif'; c.fillText('PIN', W / 2 - 60, H - 30); hudBar(c, W / 2 - 40, H - 28, 80, 7, mg.pinTimer / (root.GorillaModel ? root.GorillaModel.PIN_HOLD_SECONDS : 10), '#34d399', '#0f2a1f'); }
      c.fillStyle = 'rgba(231,233,238,0.55)'; c.font = '600 11px system-ui, sans-serif'; c.textAlign = 'right'; c.fillText(`${info.speed}×${R.cine > 0 ? ' · SLOW-MO' : ''}`, W - 16, H - 22);
    }
    function hudBar(c, x, y, w, h, p, color, back, rtl) { c.fillStyle = back; c.fillRect(x, y, w, h); const fw = clamp(p, 0, 1) * w; c.fillStyle = color; c.fillRect(rtl ? x + w - fw : x, y, fw, h); }
    function roundRect(c, x, y, w, h, r) { c.beginPath(); c.moveTo(x + r, y); c.arcTo(x + w, y, x + w, y + h, r); c.arcTo(x + w, y + h, x, y + h, r); c.arcTo(x, y + h, x, y, r); c.arcTo(x, y, x + w, y, r); c.closePath(); }

    // ---- human figure ----
    function targetPose(v, h) {
      const m = v.mode;
      let p;
      if (m === 'down') p = POSES.down;
      else if (m === 'lying') p = POSES.down;
      else if (m === 'thrown') p = POSES.thrown;
      else if (m === 'falling') p = POSES.hurt;
      else if (m === 'rising') p = Object.assign({}, POSES.stance, { rot: 92 * clamp(v.riseT / 0.5, 0, 1), crouch: 0.5, yoff: clamp(v.riseT / 0.5, 0, 1) });
      else if (m === 'latched') p = POSES.latched;
      else if (v.celebrate) p = POSES.celebrate;
      else if (v.hurtT > 0) p = POSES.hurt;
      else if (v.dodgeT > 0) p = POSES.dodge;
      else if (v.grabT > 0) p = POSES.grab;
      else if (v.punchT > 0) p = v.punchT > 0.16 ? POSES.punch : POSES.stance;
      else if (m === 'walk') p = POSES.walk;
      else if (m === 'tired') p = POSES.tired;
      else if (m === 'idle') p = POSES.idle;
      else p = POSES.stance;
      return p;
    }
    function drawHuman(c, v, h) {
      const s = depthScale(v.y), hh = v.h * s, bulk = v.bulk, f = R.figure;
      const tp = targetPose(v, h);
      const fast = v.punchT > 0 || v.hurtT > 0 || v.mode === 'thrown' || v.mode === 'falling';
      blend(v.pose, tp, fast ? 0.55 : 0.28);
      const p = v.pose;
      // walking / idle oscillation
      let legSwing = 0, armSwing = 0, bob = 0;
      if (v.mode === 'walk') { legSwing = Math.sin(v.walkPhase) * 28; armSwing = -legSwing * 0.6; bob = Math.abs(Math.cos(v.walkPhase)) * 3; }
      else if (v.mode === 'stance') bob = Math.sin(R.simClock * 9 + v.seed * 6) * 2.2;
      else if (v.mode === 'idle') bob = Math.sin(R.simClock * 2 + v.seed * 6) * 1.2;
      else if (v.celebrate) bob = Math.abs(Math.sin(R.simClock * 10 + v.seed * 6)) * 9;
      else if (v.mode === 'latched') legSwing = Math.sin(R.simClock * 12 + v.seed * 6) * 16;
      const x0 = v.x + v.kx + v.dx, groundY = v.y + v.ky;
      const inAir = v.z > 0.5;
      // shadow
      ellipse(c, x0, groundY, hh * 0.2 * (inAir ? 0.6 : 1) * (p.rot > 45 ? 1.8 : 1), hh * 0.06 * (inAir ? 0.6 : 1), `rgba(0,0,0,${inAir ? 0.22 : 0.38})`);
      const hipH = hh * (0.52 - 0.17 * p.crouch);
      const pivotY = groundY - v.z * s - hipH * (1 - p.yoff * 0.86) - bob;
      c.save(); c.translate(x0, pivotY); c.scale(v.face, 1); c.rotate(rad(p.rot) + (v.mode === 'thrown' ? v.rot : 0));
      const dim = v.down ? 0.72 : 1;
      const skin = v.down ? shade(SKIN, dim) : SKIN, shirt = v.down ? shade(SHIRT, dim) : SHIRT, shorts = v.down ? shade(SHORTS, dim) : SHORTS;
      const Lt = 0.3 * hh, hw = 0.085 * hh * bulk, sw = 0.14 * hh * bulk;
      const lean = rad(p.lean);
      const sh = { x: Math.sin(lean) * Lt, y: -Math.cos(lean) * Lt };
      const Lu = 0.25 * hh, Ll = 0.25 * hh, Au = 0.17 * hh, Al = 0.16 * hh;
      const legW = 0.075 * hh * bulk, armW = 0.055 * hh * bulk;
      const dir = a => ({ x: Math.sin(rad(a)), y: Math.cos(rad(a)) });
      const limb = (ox, oy, a1, bend, L1, L2, w, col, backward) => { const d1 = dir(a1), kx = ox + d1.x * L1, ky = oy + d1.y * L1; const d2 = dir(a1 + (backward ? -bend : bend)); const ex = kx + d2.x * L2, ey = ky + d2.y * L2; capsule(c, ox, oy, kx, ky, w, col); capsule(c, kx, ky, ex, ey, w * 0.9, col); return { x: ex, y: ey }; };
      // back leg, back arm (drawn first)
      const lB = limb(-hw * 0.35, 0, p.lB[0] - legSwing, p.lB[1] + Math.max(0, -legSwing) * 0.8, Lu, Ll, legW, shade(skin, 0.85), true);
      ellipse(c, lB.x, lB.y, legW * 0.75, legW * 0.42, SHOE);
      limb(sh.x - sw * 0.3, sh.y, p.aB[0] + armSwing, p.aB[1], Au, Al, armW, shade(skin, 0.85), false);
      // shorts + torso
      c.fillStyle = shorts; c.beginPath(); c.moveTo(-hw, -hh * 0.02); c.lineTo(hw, -hh * 0.02); c.lineTo(hw * 1.05, hh * 0.12); c.lineTo(-hw * 1.05, hh * 0.12); c.closePath(); c.fill();
      const tg = c.createLinearGradient(-sw, 0, sw, 0); tg.addColorStop(0, shade(shirt, 0.8)); tg.addColorStop(0.5, shirt); tg.addColorStop(1, shade(shirt, 0.7));
      c.fillStyle = tg; c.beginPath(); c.moveTo(-hw, 0); c.lineTo(hw, 0); c.lineTo(sh.x + sw * 0.55, sh.y + 0.02 * hh); c.quadraticCurveTo(sh.x, sh.y - 0.04 * hh, sh.x - sw * 0.55, sh.y + 0.02 * hh); c.closePath(); c.fill();
      // head
      const hr = 0.072 * hh, hd = rad(p.lean + p.head), hx = sh.x + Math.sin(hd) * hr * 1.7, hy = sh.y - Math.cos(hd) * hr * 1.7;
      capsule(c, sh.x, sh.y, hx, hy, hr * 0.9, skin); // neck
      ellipse(c, hx, hy, hr, hr * 1.08, skin);
      c.fillStyle = HAIR; c.beginPath(); c.arc(hx, hy - hr * 0.1, hr * 1.02, Math.PI * 1.05, Math.PI * 1.95); c.lineTo(hx + hr * 0.9, hy - hr * 0.2); c.closePath(); c.fill();
      c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(hx + hr * 0.35, hy - hr * 0.15, hr * 0.22, hr * 0.14); // eye
      // front leg, front arm
      const lF = limb(hw * 0.35, 0, p.lF[0] + legSwing, p.lF[1] + Math.max(0, legSwing) * 0.8, Lu, Ll, legW, skin, true);
      ellipse(c, lF.x, lF.y, legW * 0.75, legW * 0.42, SHOE);
      const hand = limb(sh.x + sw * 0.3, sh.y, p.aF[0] - armSwing, p.aF[1], Au, Al, armW, skin, false);
      ellipse(c, hand.x, hand.y, armW * 0.62, armW * 0.62, shade(skin, 0.95));
      c.restore();
      // tag + HP
      if (!v.down) {
        const topY = pivotY - hh * 0.55;
        const bw = Math.max(26, hh * 0.32);
        c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x0 - bw / 2, topY - 6, bw, 4); c.fillStyle = v.hp > 0.5 ? '#2fbf85' : v.hp > 0.25 ? '#fbbf24' : '#f87171'; c.fillRect(x0 - bw / 2, topY - 6, bw * clamp(v.hp, 0, 1), 4);
        if (R.sim.n > 1) { c.fillStyle = 'rgba(231,233,238,0.75)'; c.font = `600 ${Math.round(9 * s)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'bottom'; c.fillText('#' + (v.id + 1), x0, topY - 8); }
      }
    }

    // ---- gorilla ----
    function drawGorilla(c, g, mg) {
      const S = depthScale(GY) * GSCALE, x0 = g.x + g.lungeDir * g.lunge, y0 = g.y;
      const rise = g.rise, prone = g.prone, low = g.low;
      // shadow
      ellipse(c, x0, y0 + 4, lerp(112, 150, prone) * S, lerp(30, 34, prone) * S, 'rgba(0,0,0,0.42)');
      c.save(); c.translate(x0, y0); c.scale(g.face * S, S);
      const FUR = '#2a2422', FUR_D = '#1a1614', FUR_L = '#3b3431', SILVER = '#8d8a86', FACE = '#3a3230';
      // key points: knuckle stance → upright → prone
      const K = { hipX: -12, hipY: -46, shX: 14, shY: -114, headX: 40, headY: -142, torsoW: 110, hipW: 82 };
      const U = { hipX: -8, hipY: -60, shX: -2, shY: -172, headX: 10, headY: -212, torsoW: 116, hipW: 78 };
      const P = { hipX: -60, hipY: -26, shX: 60, shY: -30, headX: 118, headY: -22, torsoW: 60, hipW: 52 };
      const mix = (k) => lerp(lerp(K[k], U[k], rise), P[k], prone);
      let hipX = mix('hipX'), hipY = mix('hipY') + low * 10, shX = mix('shX'), shY = mix('shY') + low * 26, headX = mix('headX') + g.headDx, headY = mix('headY') + g.headDy + low * 30, torsoW = mix('torsoW') * (1 + 0.035 * g.heave * (low + 0.3)), hipW = mix('hipW');
      shX += Math.sin(rad(g.lean)) * 20; shY += Math.abs(Math.sin(rad(g.lean))) * 4;
      // legs (behind)
      const legW = 30, footY = 0;
      capsule(c, hipX - 26, hipY + 10, lerp(-38, -70, prone) , lerp(footY, -6, prone), legW, FUR_D);
      capsule(c, hipX + 22, hipY + 10, lerp(30, -40, prone), lerp(footY, -2, prone), legW, FUR_D);
      ellipse(c, lerp(-40, -74, prone), lerp(2, -4, prone), 22, 9, FUR_D); ellipse(c, lerp(32, -44, prone), lerp(2, -1, prone), 22, 9, FUR_D);
      // far arm
      const armW = 34;
      const arm = (sx, sy, a, bend, Lu, Ll, w, col, hand) => { const d1 = { x: Math.sin(rad(a)), y: Math.cos(rad(a)) }; const ex = sx + d1.x * Lu, ey = sy + d1.y * Lu; const d2 = { x: Math.sin(rad(a + bend)), y: Math.cos(rad(a + bend)) }; const hx = ex + d2.x * Ll, hy = ey + d2.y * Ll; capsule(c, sx, sy, ex, ey, w, col); capsule(c, ex, ey, hx, hy, w * 0.86, col); if (hand) ellipse(c, hx, hy, w * 0.62, w * 0.5, FUR_D); return { x: hx, y: hy }; };
      const armLu = lerp(72, 60, prone), armLl = lerp(62, 56, prone);
      const aB = lerp(g.armB, 100, prone), aF = lerp(g.armF, 100, prone);
      arm(shX - torsoW * 0.36, shY + 6, aB + lerp(0, -30, prone) - 8, g.elbB, armLu, armLl, armW, FUR_D, true);
      // torso
      const tg = c.createLinearGradient(0, shY - 20, 0, hipY + 30); tg.addColorStop(0, FUR_L); tg.addColorStop(0.45, FUR); tg.addColorStop(1, FUR_D);
      c.fillStyle = tg; c.beginPath();
      c.moveTo(hipX - hipW * 0.5, hipY + 26);
      c.bezierCurveTo(hipX - hipW * 0.9, hipY - 10, shX - torsoW * 0.62, shY + 10, shX - torsoW * 0.5, shY - 22);
      c.bezierCurveTo(shX - torsoW * 0.2, shY - 44, shX + torsoW * 0.25, shY - 46, shX + torsoW * 0.5, shY - 14);
      c.bezierCurveTo(shX + torsoW * 0.7, shY + 24, hipX + hipW * 0.9, hipY - 6, hipX + hipW * 0.5, hipY + 26);
      c.closePath(); c.fill();
      // silver saddle
      c.fillStyle = 'rgba(141,138,134,0.55)'; c.beginPath(); c.ellipse(shX - torsoW * 0.1, shY - 6, torsoW * 0.36, 26, -0.2, 0, TAU); c.fill();
      // chest sheen
      c.fillStyle = 'rgba(80,72,68,0.5)'; c.beginPath(); c.ellipse(shX + torsoW * 0.22, shY + 30, torsoW * 0.22, 34, 0.3, 0, TAU); c.fill();
      // head
      const hr = 34;
      ellipse(c, headX, headY, hr * 1.05, hr * 1.12, FUR);
      c.fillStyle = FUR_L; c.beginPath(); c.ellipse(headX - 4, headY - hr * 0.55, hr * 0.7, hr * 0.5, 0, Math.PI, TAU); c.fill(); // crest
      // face plate
      c.fillStyle = FACE; c.beginPath(); c.ellipse(headX + 10, headY + 6, hr * 0.68, hr * 0.78, 0, 0, TAU); c.fill();
      // brow ridge
      c.strokeStyle = FUR_D; c.lineWidth = 9; c.lineCap = 'round'; c.beginPath(); c.moveTo(headX - 14, headY - 9); c.quadraticCurveTo(headX + 10, headY - 18, headX + 30, headY - 8); c.stroke();
      // eyes
      const dazed = g.dazedT > 0;
      for (const ex of [headX + 0, headX + 22]) { ellipse(c, ex, headY - 2, 4.6, dazed ? 2.2 : 4.2, '#0b0a0a'); if (!dazed) ellipse(c, ex + 1.4, headY - 3.4, 1.4, 1.4, 'rgba(255,255,255,0.85)'); }
      // nostrils & muzzle
      ellipse(c, headX + 17, headY + 14, 12, 8, shade(FACE, 0.8)); ellipse(c, headX + 12, headY + 13, 2.6, 1.8, '#0b0a0a'); ellipse(c, headX + 23, headY + 13, 2.6, 1.8, '#0b0a0a');
      // mouth
      const mo = g.mouth;
      if (mo > 0.08) { c.fillStyle = '#6d1010'; c.beginPath(); c.ellipse(headX + 16, headY + 27, 14, 3 + 12 * mo, 0, 0, TAU); c.fill(); c.fillStyle = '#f1efe6'; for (const tx of [headX + 8, headX + 24]) { c.beginPath(); c.moveTo(tx - 3, headY + 22); c.lineTo(tx + 3, headY + 22); c.lineTo(tx, headY + 22 + 6 + 8 * mo); c.closePath(); c.fill(); } }
      else { c.strokeStyle = '#1a1414'; c.lineWidth = 2.5; c.beginPath(); c.moveTo(headX + 5, headY + 27); c.quadraticCurveTo(headX + 16, headY + 30, headX + 28, headY + 26); c.stroke(); }
      // near arm (front)
      arm(shX + torsoW * 0.3, shY + 8, aF + lerp(0, 40, prone), g.elbF, armLu, armLl, armW, FUR, true);
      if (dazed) { c.fillStyle = '#fbbf24'; c.font = '900 18px system-ui'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.scale(g.face, 1); c.fillText('✦  ✦  ✦', g.face * headX, headY - 60); }
      c.restore();
      if (mg.pinned) { c.strokeStyle = 'rgba(52,211,153,0.6)'; c.lineWidth = 3; c.setLineDash([10, 8]); c.beginPath(); c.ellipse(x0, y0 - 6, 150 * S, 44 * S, 0, 0, TAU); c.stroke(); c.setLineDash([]); }
    }

    return R;
  }

  root.GorillaRenderer = { create: createRenderer, W, H };
})(window);
