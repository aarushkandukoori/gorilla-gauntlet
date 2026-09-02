/* sim.js — arena renderer + UI controller for Gorilla Gauntlet. */
(function () {
  'use strict';
  const M = window.GorillaModel, R = window.GorillaRoster, WD = window.Wikidata;
  const $ = (s, el) => (el || document).querySelector(s);
  const G = R.GORILLA;

  // ---------- logical arena space ----------
  const W = 1000, H = 620, CX = 500, CY = 300, GR = 44;
  const TAU = Math.PI * 2;

  const state = {
    figure: null, n: 1, sim: null, playing: false, speed: 1, autoEscalate: true, strategy: 'swarm',
    view: new Map(), slots: new Array(M.CONTACT_SLOTS).fill(-1), fx: [], lastEvent: 0, acc: 0, lastTs: 0,
    pendingEscalate: false, escalateTimer: 0, rounds: [], roundNo: 0, solving: false, customFigures: new Map(),
  };

  const el = {
    canvas: $('#arena'), banner: $('#banner'), select: $('#figure-select'), card: $('#figure-card'), gorillaFacts: $('#gorilla-facts'),
    play: $('#btn-play'), step: $('#btn-step'), reset: $('#btn-reset'), speed: $('#speed'), nInput: $('#n-input'), nMinus: $('#n-minus'), nPlus: $('#n-plus'),
    strategy: $('#strategy'), auto: $('#auto-escalate'), solve: $('#btn-solve'), result: $('#result-card'), log: $('#log'), rounds: $('#rounds'),
    matchN: $('#matchup-n'), matchName: $('#matchup-name'), taglineName: $('#tagline-name'), clock: $('#clock'),
    barGhp: $('#bar-ghp'), valGhp: $('#val-ghp'), barGstam: $('#bar-gstam'), valGstam: $('#val-gstam'), barPin: $('#bar-pin'), valPin: $('#val-pin'),
    valRestraint: $('#val-restraint'), valStanding: $('#val-standing'), valAttacks: $('#val-attacks'),
    wdQuery: $('#wd-query'), wdGo: $('#wd-go'), wdResults: $('#wd-results'), wdHint: $('#wd-hint'), customForm: $('#custom-form'), customDetails: $('#custom-details'),
  };
  const ctx = el.canvas.getContext('2d');

  // ---------- helpers ----------
  const fmtT = t => t.toFixed(1) + ' s';
  const pct = x => Math.round(x * 100) + '%';
  const plural = (n, name) => n === 1 ? name : name + (/s$/i.test(name) ? '' : 's');
  function ftIn(m) { const inches = Math.round(m / 0.0254); return Math.floor(inches / 12) + '′' + (inches % 12) + '″'; }
  function initials(name) { const p = name.replace(/\(.*?\)/g, '').trim().split(/\s+/); return ((p[0] || '?')[0] + (p.length > 1 ? p[p.length - 1][0] : '')).toUpperCase(); }
  function humanRadius(f) { return Math.max(11, Math.min(22, 10 + f.massKg / 22)); }
  function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

  // ---------- roster UI ----------
  function populateSelect() {
    el.select.innerHTML = '';
    for (const grp of R.groups()) {
      const og = document.createElement('optgroup'); og.label = grp;
      for (const f of R.FIGURES.filter(f => f.group === grp)) { const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; og.appendChild(o); }
      el.select.appendChild(og);
    }
    if (state.customFigures.size) {
      const og = document.createElement('optgroup'); og.label = 'Custom';
      for (const f of state.customFigures.values()) { const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; og.appendChild(o); }
      el.select.appendChild(og);
    }
  }
  function figureById(id) { return state.customFigures.get(id) || R.byId(id); }

  function renderFigureCard(f) {
    const bar = (label, v) => `<div><span>${label}</span><div class="bar"><i class="fill fill-blue" style="width:${Math.round(v * 100)}%"></i></div><span>${v.toFixed(2)}</span></div>`;
    el.card.innerHTML = `
      <div class="fc-head"><span class="fc-emoji">${f.emoji || '🧑'}</span><div><div class="fc-name">${escapeHtml(f.name)}</div><div class="fc-tag">${escapeHtml(f.tag || '')}</div></div></div>
      <div class="fc-metrics">
        <div><span>Height</span><b>${f.heightM.toFixed(2)} m</b><small style="display:block;color:var(--muted)">${ftIn(f.heightM)}</small></div>
        <div><span>Weight</span><b>${Math.round(f.massKg)} kg</b><small style="display:block;color:var(--muted)">${Math.round(f.massKg * 2.20462)} lb</small></div>
        <div><span>Strength</span><b>${Math.round(f.strengthIndex)}</b><small style="display:block;color:var(--muted)">kgf index</small></div>
      </div>
      <div class="fc-profile">${bar('Striking', f.striking)}${bar('Grappling', f.grappling)}${bar('Endurance', f.endurance)}${bar('Speed', f.speed)}${bar('Toughness', f.toughness)}</div>
      ${f.facts && f.facts.length ? `<ul class="fc-facts">${f.facts.map(x => `<li>${escapeHtml(x)}</li>`).join('')}</ul>` : ''}
      <div class="fc-edit">Restraint per copy ≈ <b>${Math.round(M.humanRestraint(f, { stam: 100 }))}</b> · HP ${Math.round(M.humanHpMax(f))} <button class="btn btn-small" id="btn-edit-figure">Tweak profile</button></div>`;
    $('#btn-edit-figure', el.card).addEventListener('click', () => { fillCustomForm(f); el.customDetails.open = true; el.customDetails.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); });
  }

  function renderGorillaFacts() {
    el.gorillaFacts.innerHTML = G.facts.map(x => `<li>${escapeHtml(x)}</li>`).join('');
  }

  function setFigure(f, opts) {
    state.figure = f;
    el.select.value = f.id;
    el.taglineName.textContent = f.name;
    el.matchName.textContent = f.name;
    renderFigureCard(f);
    state.rounds = []; state.roundNo = 0; el.rounds.innerHTML = '';
    el.result.hidden = true;
    if (!(opts && opts.keepN)) setN(1);
    startRun(state.n, { autoplay: false });
    try { const u = new URL(location.href); u.searchParams.set('figure', f.id); history.replaceState(null, '', u); } catch (e) {}
  }

  // ---------- custom figure form ----------
  const form = el.customForm;
  function fillArchetypes() {
    const sel = form.elements.archetype; sel.innerHTML = '';
    for (const [k, a] of Object.entries(R.ARCHETYPES)) { const o = document.createElement('option'); o.value = k; o.textContent = a.label; sel.appendChild(o); }
    const o = document.createElement('option'); o.value = 'manual'; o.textContent = 'Manual (keep sliders)'; sel.appendChild(o);
  }
  function syncSliderLabels() { form.querySelectorAll('.sliders label').forEach(l => { l.querySelector('b').textContent = Number(l.querySelector('input').value).toFixed(2); }); }
  function applyArchetype(key) {
    const a = R.ARCHETYPES[key]; if (!a) return;
    for (const k of ['striking', 'grappling', 'endurance', 'speed', 'toughness']) form.elements[k].value = a[k];
    form.elements.strengthIndex.value = Math.round(a.strengthPerKg * Number(form.elements.massKg.value) / 5) * 5;
    syncSliderLabels();
  }
  function fillCustomForm(f) {
    form.elements.name.value = f.name.replace(/ \(\d{4}\)$/, '') ;
    form.elements.heightCm.value = Math.round(f.heightM * 100);
    form.elements.massKg.value = Math.round(f.massKg * 2) / 2;
    form.elements.strengthIndex.value = Math.round(f.strengthIndex);
    for (const k of ['striking', 'grappling', 'endurance', 'speed', 'toughness']) form.elements[k].value = f[k];
    form.elements.archetype.value = 'manual';
    syncSliderLabels();
  }
  function customFromForm() {
    const fd = form.elements;
    const name = fd.name.value.trim() || 'Custom figure';
    const id = 'custom-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'custom';
    const f = {
      id, name, group: 'Custom', emoji: '🧑', tag: (R.ARCHETYPES[fd.archetype.value] || { label: 'Custom profile' }).label,
      heightM: Math.max(1, Math.min(2.6, Number(fd.heightCm.value) / 100 || 1.75)),
      massKg: Math.max(35, Math.min(350, Number(fd.massKg.value) || 80)),
      strengthIndex: Math.max(20, Math.min(600, Number(fd.strengthIndex.value) || 100)),
      striking: +fd.striking.value, grappling: +fd.grappling.value, endurance: +fd.endurance.value, speed: +fd.speed.value, toughness: +fd.toughness.value,
      facts: form.dataset.wdFacts ? JSON.parse(form.dataset.wdFacts) : ['Custom profile entered by you'],
    };
    return f;
  }
  form.addEventListener('input', e => { if (e.target.type === 'range') syncSliderLabels(); });
  form.elements.archetype.addEventListener('change', e => applyArchetype(e.target.value));
  form.elements.massKg.addEventListener('change', () => { if (form.elements.archetype.value !== 'manual') applyArchetype(form.elements.archetype.value); });
  form.addEventListener('submit', e => {
    e.preventDefault();
    const f = customFromForm();
    state.customFigures.set(f.id, f);
    populateSelect();
    setFigure(f);
    el.customDetails.open = false;
  });

  // ---------- Wikidata import ----------
  async function wdSearch() {
    const q = el.wdQuery.value.trim(); if (!q) return;
    el.wdResults.innerHTML = '<li>Searching…</li>';
    try {
      const rows = await WD.search(q);
      if (!rows.length) { el.wdResults.innerHTML = '<li>No matches.</li>'; return; }
      el.wdResults.innerHTML = '';
      for (const r of rows) {
        const li = document.createElement('li');
        li.innerHTML = `${escapeHtml(r.label)}<small>${escapeHtml(r.description)}</small>`;
        li.addEventListener('click', () => wdPick(r));
        el.wdResults.appendChild(li);
      }
    } catch (err) { el.wdResults.innerHTML = `<li>Wikidata unreachable: ${escapeHtml(err.message)}</li>`; }
  }
  async function wdPick(r) {
    el.wdHint.textContent = 'Loading ' + r.label + '…';
    try {
      const p = await WD.load(r.id);
      el.wdResults.innerHTML = '';
      form.elements.name.value = p.name;
      const bits = [];
      if (p.heightM) { form.elements.heightCm.value = Math.round(p.heightM * 100); bits.push(p.heightM.toFixed(2) + ' m'); }
      if (p.massKg) { form.elements.massKg.value = Math.round(p.massKg * 2) / 2; bits.push(Math.round(p.massKg) + ' kg'); }
      const arch = WD.archetypeFor(p.occupations);
      form.elements.archetype.value = arch; applyArchetype(arch);
      const facts = [];
      if (bits.length) facts.push('Wikidata: ' + bits.join(', '));
      if (p.occupations.length) facts.push('Occupation: ' + p.occupations.slice(0, 4).join(', '));
      if (p.description) facts.push(p.description);
      facts.push('Fight profile: ' + R.ARCHETYPES[arch].label + ' archetype (editable)');
      form.dataset.wdFacts = JSON.stringify(facts);
      const missing = [!p.heightM && 'height', !p.massKg && 'weight'].filter(Boolean);
      el.wdHint.textContent = (bits.length ? 'Wikidata has ' + bits.join(' and ') : 'Wikidata has no body metrics') + (p.occupations.length ? ' · ' + p.occupations.slice(0, 3).join(', ') : '') + (missing.length ? ' — enter ' + missing.join(' and ') + ' manually.' : '.') + (p.isHuman ? '' : ' (Not tagged as a human — double-check.)');
    } catch (err) { el.wdHint.textContent = 'Could not load: ' + err.message; }
  }
  el.wdGo.addEventListener('click', wdSearch);
  el.wdQuery.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); wdSearch(); } });

  // ---------- run lifecycle ----------
  function setN(n) {
    n = Math.max(1, Math.min(200, Math.round(n) || 1));
    state.n = n; el.nInput.value = n; el.matchN.textContent = n;
  }
  function startRun(n, opts) {
    opts = opts || {};
    setN(n);
    state.sim = M.createSim(state.figure, state.n, G, { strategy: state.strategy });
    state.view.clear(); state.slots.fill(-1); state.fx = []; state.lastEvent = 0; state.acc = 0; state.pendingEscalate = false;
    state.roundNo++;
    el.log.innerHTML = '';
    el.banner.hidden = true; el.banner.className = 'banner';
    addLog({ t: 0, kind: 'info', msg: `Round ${state.roundNo}: ${state.n} × ${state.figure.name} step into the arena` });
    if (opts.autoplay) setPlaying(true);
    updateStatus();
  }
  function setPlaying(p) {
    state.playing = p;
    el.play.textContent = p ? '❚❚ Pause' : '▶ Play';
    el.play.classList.toggle('btn-primary', !p);
  }
  function stepSim(seconds) {
    if (!state.sim || state.sim.over) return;
    const k = Math.round(seconds / M.DT);
    for (let i = 0; i < k && !state.sim.over; i++) M.step(state.sim);
    drainEvents();
    if (state.sim.over) onRunOver();
  }

  function onRunOver() {
    const sim = state.sim, r = sim.result, f = state.figure;
    const won = r.winner === 'humans';
    state.rounds.push(r);
    const li = document.createElement('li'); li.className = won ? 'win' : 'lose';
    li.innerHTML = `<span>Round ${state.roundNo} · ${r.n} × ${escapeHtml(f.name)}</span><span>${won ? 'Humans win' : 'Gorilla wins'} · ${r.t.toFixed(0)} s · ${r.kos} down</span>`;
    el.rounds.prepend(li);
    el.banner.hidden = false;
    if (won) {
      el.banner.className = 'banner win';
      el.banner.innerHTML = `<div><b>${r.n} × ${escapeHtml(f.name)} beat the gorilla</b><div class="sub">${escapeHtml(howText(r))} · ${r.t.toFixed(0)} s · ${r.kos} of ${r.n} down</div></div><button class="btn" id="banner-again">Run again from 1</button>`;
      $('#banner-again', el.banner).addEventListener('click', () => { startRun(1, { autoplay: true }); el.result.hidden = true; });
      setPlaying(false);
      showResult(r);
    } else {
      el.banner.className = 'banner lose';
      if (state.autoEscalate && r.n < 200) {
        state.pendingEscalate = true; state.escalateTimer = 1.8;
        el.banner.innerHTML = `<div><b>Gorilla wins</b> — ${escapeHtml(howText(r))} in ${r.t.toFixed(0)} s.<div class="sub">Adding another copy… next up ${r.n + 1} × ${escapeHtml(f.name)}</div></div>`;
      } else {
        el.banner.innerHTML = `<div><b>Gorilla wins</b> — ${escapeHtml(howText(r))} in ${r.t.toFixed(0)} s.<div class="sub">Add a copy and try again.</div></div><button class="btn" id="banner-plus">+1 copy</button>`;
        $('#banner-plus', el.banner).addEventListener('click', () => startRun(state.n + 1, { autoplay: true }));
        setPlaying(false);
      }
    }
  }
  function howText(r) {
    return { subdued: 'pinned and exhausted', incapacitated: 'beaten down', all_down: 'everyone down', timeout: 'still standing after 10 minutes' }[r.how] || r.how;
  }

  function showResult(r) {
    const f = state.figure;
    el.result.hidden = false; el.result.className = 'result-card';
    const shareText = `It takes ${r.n} ${plural(r.n, f.name)} to beat a silverback gorilla 🦍 — try your own: ${location.href.split('#')[0]}`;
    el.result.innerHTML = `
      <h3>It takes <span style="color:var(--green)">${r.n}</span> ${escapeHtml(plural(r.n, f.name))} to beat a silverback.</h3>
      <div class="sub">This run: ${r.n} copies, ${r.t.toFixed(0)} s, ${r.kos} taken down, gorilla ${escapeHtml(howText(r))}. Each round is random — <b>Solve it</b> runs hundreds of fights for the reliable number.</div>
      <div class="actions"><button class="btn btn-primary" id="res-share">Copy result</button><button class="btn btn-accent" id="res-solve">⚡ Solve it</button><button class="btn" id="res-again">Run again from 1</button></div>`;
    $('#res-share', el.result).addEventListener('click', e => copyText(shareText, e.target));
    $('#res-solve', el.result).addEventListener('click', solve);
    $('#res-again', el.result).addEventListener('click', () => { startRun(1, { autoplay: true }); el.result.hidden = true; });
  }
  function copyText(text, btn) {
    const done = () => { const old = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = old, 1400); };
    if (navigator.clipboard) navigator.clipboard.writeText(text).then(done, () => prompt('Copy:', text));
    else prompt('Copy:', text);
  }

  // ---------- Monte Carlo solve ----------
  function solve() {
    if (state.solving) return;
    state.solving = true; el.solve.disabled = true;
    setPlaying(false);
    const f = state.figure;
    const trials = 60;
    const s = M.solver(f, G, { strategy: state.strategy }, { trials, maxN: 150, target: 0.9 });
    el.result.hidden = false; el.result.className = 'result-card';
    el.result.innerHTML = `<h3>Solving: how many ${escapeHtml(plural(2, f.name))}?</h3><div class="solve-progress" id="solve-progress">Warming up…</div><canvas class="solve-chart" id="solve-chart" width="800" height="140"></canvas><div class="solve-summary" id="solve-summary"></div><div class="actions" id="solve-actions"></div>`;
    const prog = $('#solve-progress', el.result), chart = $('#solve-chart', el.result);
    const tick = () => {
      const t0 = performance.now();
      while (!s.done && performance.now() - t0 < 30) { const row = s.next(); prog.textContent = `Crew of ${row.n}: won ${Math.round(row.winRate * 100)}% of ${trials} fights`; }
      drawSolveChart(chart, s.rows);
      if (!s.done) return setTimeout(tick, 0);
      finishSolve(s);
    };
    setTimeout(tick, 0);
  }
  function finishSolve(s) {
    state.solving = false; el.solve.disabled = false;
    const f = state.figure, sum = s.summary();
    const prog = $('#solve-progress', el.result);
    const n50 = sum.n50, n90 = sum.n90;
    prog.textContent = `${s.rows.length} crew sizes × ${s.cfg.trials} fights each, plan: ${el.strategy.options[el.strategy.selectedIndex].text}.`;
    $('#solve-summary', el.result).innerHTML = `
      <div><span>Wins ≥ 50%</span><b>${n50 == null ? '150+' : n50}</b> ${escapeHtml(plural(n50 || 2, f.name))}</div>
      <div><span>Wins ≥ 90%</span><b>${n90 == null ? '150+' : n90}</b> ${escapeHtml(plural(n90 || 2, f.name))}</div>
      <div><span>Per copy</span><b>${Math.round(M.humanRestraint(f, { stam: 100 }))}</b> restraint vs gorilla ${G.strengthIndex}</div>`;
    const headline = n50 == null ? `Even 150 ${plural(150, f.name)} can't reliably beat a silverback.` : `It takes about ${n50} ${plural(n50, f.name)} to beat a silverback (${n90 || '150+'} to be sure).`;
    $('h3', el.result).textContent = headline;
    const shareText = headline + ' 🦍 — simulate your own: ' + location.href.split('#')[0];
    const acts = $('#solve-actions', el.result);
    acts.innerHTML = `<button class="btn btn-primary" id="solve-share">Copy result</button>${n50 ? `<button class="btn" id="solve-watch">Watch ${n50} × ${escapeHtml(f.name)} fight</button>` : ''}`;
    $('#solve-share', acts).addEventListener('click', e => copyText(shareText, e.target));
    if (n50) $('#solve-watch', acts).addEventListener('click', () => { el.auto.checked = state.autoEscalate = true; startRun(n50, { autoplay: true }); el.canvas.scrollIntoView({ behavior: 'smooth', block: 'center' }); });
  }
  function drawSolveChart(c, rows) {
    const x = c.getContext('2d'), w = c.width, h = c.height;
    x.clearRect(0, 0, w, h);
    if (!rows.length) return;
    const pad = 28, bw = Math.max(2, (w - pad - 8) / rows.length - 2);
    x.strokeStyle = '#2a313b'; x.lineWidth = 1;
    for (const y of [0.5, 0.9]) { const yy = h - 18 - (h - 30) * y; x.beginPath(); x.moveTo(pad, yy); x.lineTo(w - 4, yy); x.stroke(); x.fillStyle = '#9aa3b2'; x.font = '11px system-ui'; x.fillText(Math.round(y * 100) + '%', 2, yy + 4); }
    rows.forEach((r, i) => {
      const bh = (h - 30) * r.winRate, bx = pad + i * (bw + 2), by = h - 18 - bh;
      x.fillStyle = r.winRate >= 0.9 ? '#34d399' : r.winRate >= 0.5 ? '#60a5fa' : '#f87171';
      x.fillRect(bx, by, bw, bh);
      if (rows.length <= 40 || i % 5 === 0) { x.fillStyle = '#9aa3b2'; x.font = '10px system-ui'; x.textAlign = 'center'; x.fillText(r.n, bx + bw / 2, h - 5); x.textAlign = 'left'; }
    });
  }

  // ---------- log + fx ----------
  function addLog(ev) {
    const li = document.createElement('li');
    li.innerHTML = `<time>${ev.t.toFixed(1)}s</time><span class="k-${ev.kind}">${escapeHtml(ev.msg)}</span>`;
    el.log.prepend(li);
    while (el.log.children.length > 80) el.log.lastChild.remove();
  }
  function drainEvents() {
    const sim = state.sim; if (!sim) return;
    for (; state.lastEvent < sim.events.length; state.lastEvent++) {
      const ev = sim.events[state.lastEvent];
      if (ev.msg) addLog(ev);
      const v = ev.who >= 0 ? state.view.get(ev.who) : null;
      const px = v ? v.x : CX, py = v ? v.y : CY;
      switch (ev.kind) {
        case 'hit': case 'bite': state.fx.push({ type: 'impact', x: px, y: py, ttl: .3, ttl0: .3, color: ev.kind === 'bite' ? '#f59e0b' : '#f87171' }); break;
        case 'ko': state.fx.push({ type: 'impact', x: px, y: py, ttl: .45, ttl0: .45, color: '#f87171' }, { type: 'text', x: px, y: py - 18, ttl: 1.1, ttl0: 1.1, text: 'DOWN', color: '#f87171' }); break;
        case 'latch': state.fx.push({ type: 'ring', x: px, y: py, ttl: .4, ttl0: .4, color: '#60a5fa' }); break;
        case 'strike': if (v) { const a = Math.atan2(py - CY, px - CX); state.fx.push({ type: 'spark', x: CX + Math.cos(a) * (GR + 4), y: CY + Math.sin(a) * (GR + 4), ttl: .18, ttl0: .18, color: '#e7e9ee' }); } break;
        case 'vital': state.fx.push({ type: 'text', x: CX, y: CY - GR - 14, ttl: 1.2, ttl0: 1.2, text: 'EYES!', color: '#34d399' }); break;
        case 'pin': state.fx.push({ type: 'text', x: CX, y: CY - GR - 14, ttl: 1.2, ttl0: 1.2, text: 'PINNED', color: '#34d399' }); break;
        case 'throw': state.fx.push({ type: 'text', x: CX, y: CY - GR - 14, ttl: 1.2, ttl0: 1.2, text: 'BREAKS FREE', color: '#f59e0b' }, { type: 'ring', x: CX, y: CY, ttl: .5, ttl0: .5, color: '#f59e0b', big: true }); break;
      }
    }
  }

  // ---------- view positions ----------
  function ensureView(h) {
    let v = state.view.get(h.id);
    if (!v) {
      const a = TAU * ((h.id * 0.618033) % 1);
      v = { x: CX + Math.cos(a) * 420, y: CY + Math.sin(a) * 280, slot: -1, downAngle: null };
      state.view.set(h.id, v);
    }
    return v;
  }
  function updateView(dt) {
    const sim = state.sim; if (!sim) return;
    const f = state.figure, hr = humanRadius(f);
    // slot bookkeeping
    for (let i = 0; i < state.slots.length; i++) {
      const id = state.slots[i];
      if (id >= 0) { const h = sim.humans[id]; if (h.state !== 'engaged' && h.state !== 'latched') { state.slots[i] = -1; const v = state.view.get(id); if (v) { if (h.state === 'down') v.downAngle = slotAngle(i); v.slot = -1; } } }
    }
    const waiting = [];
    for (const h of sim.humans) {
      const v = ensureView(h);
      if ((h.state === 'engaged' || h.state === 'latched') && v.slot < 0) {
        const free = state.slots.indexOf(-1);
        if (free >= 0) { state.slots[free] = h.id; v.slot = free; }
      }
      if (h.state === 'waiting') waiting.push(h);
    }
    const k = Math.min(1, dt * 6);
    let wi = 0;
    for (const h of sim.humans) {
      const v = state.view.get(h.id);
      let tx, ty;
      if (v.slot >= 0) {
        const a = slotAngle(v.slot);
        const rr = h.state === 'latched' ? GR + hr - 6 : GR + hr + 26;
        tx = CX + Math.cos(a) * rr; ty = CY + Math.sin(a) * rr;
      } else if (h.state === 'down') {
        const a = v.downAngle == null ? TAU * ((h.id * 0.618033) % 1) : v.downAngle;
        const rr = GR + hr + 78 + (h.id % 3) * 26;
        tx = CX + Math.cos(a) * rr * 1.15; ty = CY + Math.sin(a) * rr;
      } else {
        // waiting: ellipse rings, 18 per ring
        const ring = Math.floor(wi / 18), idx = wi % 18, per = Math.min(18, waiting.length - ring * 18);
        const a = -Math.PI / 2 + TAU * (idx / per) + ring * 0.17;
        tx = CX + Math.cos(a) * (330 + ring * 42); ty = CY + Math.sin(a) * (235 + ring * 30);
        wi++;
      }
      v.x += (tx - v.x) * k; v.y += (ty - v.y) * k;
    }
    for (const fx of state.fx) { fx.ttl -= dt; if (fx.type === 'text') fx.y -= 22 * dt; }
    state.fx = state.fx.filter(x => x.ttl > 0);
  }
  function slotAngle(i) { return -Math.PI / 2 + TAU * (i / M.CONTACT_SLOTS); }

  // ---------- drawing ----------
  function resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = el.canvas.clientWidth || W;
    el.canvas.width = Math.round(cw * dpr); el.canvas.height = Math.round(cw * (H / W) * dpr);
  }
  function draw() {
    const c = ctx, sim = state.sim;
    const sx = el.canvas.width / W;
    c.setTransform(sx, 0, 0, sx, 0, 0);
    // ground
    const grd = c.createRadialGradient(CX, CY, 40, CX, CY, 560);
    grd.addColorStop(0, '#1b2a20'); grd.addColorStop(0.55, '#111a15'); grd.addColorStop(1, '#0b0d10');
    c.fillStyle = grd; c.fillRect(0, 0, W, H);
    c.strokeStyle = 'rgba(255,255,255,0.05)'; c.lineWidth = 2;
    for (const r of [120, 250]) { c.beginPath(); c.ellipse(CX, CY, r * 1.3, r, 0, 0, TAU); c.stroke(); }
    if (!sim) return;
    const f = state.figure, hr = humanRadius(f), g = sim.g;

    // draw order: down → waiting → engaged → gorilla → latched
    const order = { down: 0, waiting: 1, engaged: 2, latched: 4 };
    const hs = sim.humans.slice().sort((a, b) => order[a.state] - order[b.state]);
    let gorillaDrawn = false;
    for (const h of hs) {
      if (!gorillaDrawn && order[h.state] >= 4) { drawGorilla(c, g); gorillaDrawn = true; }
      drawHuman(c, h, state.view.get(h.id), hr, f);
    }
    if (!gorillaDrawn) drawGorilla(c, g);

    // fx
    for (const fx of state.fx) {
      const p = fx.ttl / fx.ttl0;
      c.globalAlpha = Math.max(0, p);
      if (fx.type === 'impact') { c.strokeStyle = fx.color; c.lineWidth = 3; c.beginPath(); c.arc(fx.x, fx.y, 8 + (1 - p) * 26, 0, TAU); c.stroke(); }
      else if (fx.type === 'ring') { c.strokeStyle = fx.color; c.lineWidth = 2; c.beginPath(); c.arc(fx.x, fx.y, (fx.big ? GR + 10 : 14) + (1 - p) * 30, 0, TAU); c.stroke(); }
      else if (fx.type === 'spark') { c.fillStyle = fx.color; c.beginPath(); c.arc(fx.x, fx.y, 3 + (1 - p) * 5, 0, TAU); c.fill(); }
      else if (fx.type === 'text') { c.fillStyle = fx.color; c.font = 'bold 18px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText(fx.text, fx.x, fx.y); }
      c.globalAlpha = 1;
    }
    // HUD corner
    c.fillStyle = 'rgba(231,233,238,0.75)'; c.font = '14px system-ui, sans-serif'; c.textAlign = 'left'; c.textBaseline = 'top';
    const standing = sim.humans.filter(h => h.state !== 'down').length;
    c.fillText(`${standing}/${sim.n} standing · ${sim.humans.filter(h => h.state === 'latched').length} latched · ${g.pinned ? 'PINNED' : g.hampered > 0 ? 'held ' + Math.round(g.hampered * 100) + '%' : 'free'}`, 14, 12);
    c.textAlign = 'right';
    c.fillText(`${state.speed}×`, W - 14, 12);
  }
  function drawGorilla(c, g) {
    const sf = g.stam / 100, hf = g.hp / g.hpMax;
    // shadow + body
    c.fillStyle = 'rgba(0,0,0,0.45)'; c.beginPath(); c.ellipse(CX, CY + GR * 0.85, GR * 1.25, GR * 0.45, 0, 0, TAU); c.fill();
    if (g.pinned) { c.strokeStyle = '#34d399'; c.lineWidth = 4; c.setLineDash([8, 6]); c.beginPath(); c.arc(CX, CY, GR + 10, 0, TAU); c.stroke(); c.setLineDash([]); }
    c.fillStyle = g.dazed > 0 ? '#5a4a3a' : '#3b2f2a'; c.beginPath(); c.arc(CX, CY, GR, 0, TAU); c.fill();
    c.strokeStyle = '#f59e0b'; c.lineWidth = 2.5; c.stroke();
    c.font = `${Math.round(GR * 1.35)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText('🦍', CX, CY + 3);
    if (g.dazed > 0) { c.fillStyle = '#fbbf24'; c.font = '16px system-ui'; c.fillText('✦ ✦ ✦', CX, CY - GR - 8); }
    // bars
    bar(c, CX - 50, CY + GR + 12, 100, 7, hf, '#f87171');
    bar(c, CX - 50, CY + GR + 22, 100, 7, sf, '#f59e0b');
    if (g.pinTimer > 0) bar(c, CX - 50, CY + GR + 32, 100, 7, Math.min(1, g.pinTimer / M.PIN_HOLD_SECONDS), '#34d399');
    c.fillStyle = 'rgba(231,233,238,0.85)'; c.font = '12px system-ui, sans-serif'; c.textBaseline = 'top'; c.textAlign = 'center';
    c.fillText('Silverback · ' + Math.round(g.eff) + ' str', CX, CY + GR + (g.pinTimer > 0 ? 42 : 32));
  }
  function drawHuman(c, h, v, hr, f) {
    const down = h.state === 'down';
    const r = down ? hr * 0.9 : hr;
    c.fillStyle = 'rgba(0,0,0,0.35)'; c.beginPath(); c.ellipse(v.x, v.y + r * 0.8, r * 1.1, r * 0.4, 0, 0, TAU); c.fill();
    let fill = '#34d399', stroke = '#0e2a1c';
    if (h.state === 'latched') { fill = '#60a5fa'; stroke = '#10233f'; }
    else if (h.state === 'waiting') { fill = '#1f6f52'; stroke = '#0e2a1c'; }
    else if (down) { fill = '#3a3f47'; stroke = '#1a1d22'; }
    if (h.stun > 0 && !down) fill = '#a7f3d0';
    c.fillStyle = fill; c.beginPath(); c.arc(v.x, v.y, r, 0, TAU); c.fill();
    c.strokeStyle = stroke; c.lineWidth = 2; c.stroke();
    if (h.state === 'latched') { c.strokeStyle = 'rgba(96,165,250,0.6)'; c.lineWidth = 3; c.beginPath(); c.moveTo(v.x, v.y); const a = Math.atan2(CY - v.y, CX - v.x); c.lineTo(CX - Math.cos(a) * (GR - 4), CY - Math.sin(a) * (GR - 4)); c.stroke(); }
    c.fillStyle = down ? '#7b8291' : '#06130c'; c.font = `bold ${Math.round(r * 0.95)}px system-ui, sans-serif`; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.fillText(down ? '✕' : initials(f.name), v.x, v.y + 1);
    if (!down) {
      bar(c, v.x - r, v.y - r - 9, r * 2, 4, h.hp / h.hpMax, '#f87171');
      bar(c, v.x - r, v.y - r - 4, r * 2, 3, h.stam / 100, '#fbbf24');
      if (state.sim.n > 1) { c.fillStyle = 'rgba(231,233,238,0.7)'; c.font = '10px system-ui'; c.textBaseline = 'top'; c.fillText('#' + (h.id + 1), v.x, v.y + r + 3); }
    }
  }
  function bar(c, x, y, w, h, p, color) {
    c.fillStyle = 'rgba(0,0,0,0.55)'; c.fillRect(x, y, w, h);
    c.fillStyle = color; c.fillRect(x, y, Math.max(0, Math.min(1, p)) * w, h);
  }

  // ---------- status panel ----------
  function updateStatus() {
    const sim = state.sim; if (!sim) return;
    const g = sim.g;
    el.clock.textContent = fmtT(sim.t);
    el.barGhp.style.width = pct(g.hp / g.hpMax); el.valGhp.textContent = pct(g.hp / g.hpMax);
    el.barGstam.style.width = pct(g.stam / 100); el.valGstam.textContent = pct(g.stam / 100);
    el.barPin.style.width = pct(Math.min(1, g.pinTimer / M.PIN_HOLD_SECONDS)); el.valPin.textContent = g.pinTimer.toFixed(1) + ' / ' + M.PIN_HOLD_SECONDS + ' s';
    el.valRestraint.textContent = `${Math.round(g.restraint)} / ${Math.round(g.eff)}`;
    el.valStanding.textContent = `${sim.humans.filter(h => h.state !== 'down').length} / ${sim.n}`;
    el.valAttacks.textContent = `${g.attacks} (${g.kos} KOs)`;
  }

  // ---------- main loop ----------
  // Simulation advances on a timer with wall-clock deltas (keeps working in throttled /
  // hidden tabs); rendering rides requestAnimationFrame.
  function advance(now) {
    const dt = Math.min(1.0, state.lastTs ? (now - state.lastTs) / 1000 : 0.016); state.lastTs = now;
    if (!state.sim) return;
    if (state.playing && !state.sim.over) {
      state.acc += dt * state.speed;
      let steps = 0;
      while (state.acc >= M.DT && steps < 600 && !state.sim.over) { M.step(state.sim); state.acc -= M.DT; steps++; }
      if (steps >= 600) state.acc = 0;
      drainEvents();
      if (state.sim.over) onRunOver();
    } else if (state.sim.over && state.pendingEscalate) {
      state.escalateTimer -= dt;
      if (state.escalateTimer <= 0) { state.pendingEscalate = false; startRun(state.n + 1, { autoplay: true }); }
    }
    updateView(dt); updateStatus();
  }
  function frame() { draw(); requestAnimationFrame(frame); }
  setInterval(() => advance(performance.now()), 33);

  // ---------- controls ----------
  el.play.addEventListener('click', () => { if (state.sim && state.sim.over && !state.pendingEscalate) startRun(state.n, { autoplay: true }); else setPlaying(!state.playing); });
  el.step.addEventListener('click', () => { setPlaying(false); if (state.sim && state.sim.over) startRun(state.n); stepSim(0.5); });
  el.reset.addEventListener('click', () => { const p = state.playing; startRun(state.n, { autoplay: p }); el.result.hidden = true; });
  el.speed.addEventListener('change', e => state.speed = Number(e.target.value));
  el.nInput.addEventListener('change', e => { startRun(Number(e.target.value), { autoplay: state.playing }); });
  el.nMinus.addEventListener('click', () => startRun(state.n - 1, { autoplay: state.playing }));
  el.nPlus.addEventListener('click', () => startRun(state.n + 1, { autoplay: state.playing }));
  el.strategy.addEventListener('change', e => { state.strategy = e.target.value; startRun(state.n, { autoplay: state.playing }); });
  el.auto.addEventListener('change', e => state.autoEscalate = e.target.checked);
  el.solve.addEventListener('click', solve);
  el.select.addEventListener('change', e => setFigure(figureById(e.target.value)));
  document.addEventListener('keydown', e => {
    if (e.code === 'Space' && !/input|select|textarea|button/i.test(e.target.tagName)) { e.preventDefault(); el.play.click(); }
  });
  window.addEventListener('resize', resizeCanvas);

  // ---------- boot ----------
  populateSelect(); fillArchetypes(); renderGorillaFacts(); syncSliderLabels(); resizeCanvas();
  const params = new URLSearchParams(location.search);
  const startFigure = R.byId(params.get('figure')) || R.byId('ronnie-coleman') || R.FIGURES[0];
  state.strategy = el.strategy.value; state.speed = Number(el.speed.value); state.autoEscalate = el.auto.checked;
  setFigure(startFigure, { keepN: false });
  if (params.get('n')) startRun(Number(params.get('n')));
  requestAnimationFrame(frame);
  window.GorillaGauntlet = { state, startRun, setFigure, solve, figureById };
})();
