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
    lastEvent: 0, acc: 0, lastTs: 0,
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
    sound: $('#btn-sound'),
  };
  const renderer = window.GorillaRenderer.create(el.canvas);

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
    state.lastEvent = 0; state.acc = 0; state.pendingEscalate = false;
    state.roundNo++;
    renderer.reset(state.sim, state.figure);
    if (window.GAudio && window.GAudio.ready && opts.autoplay) window.GAudio.play('bell', { vol: 0.6 });
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
        state.pendingEscalate = true; state.escalateTimer = 2.2;
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
      renderer.event(ev, sim);
    }
  }

  function resizeCanvas() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cw = el.canvas.clientWidth || window.GorillaRenderer.W;
    el.canvas.width = Math.round(cw * dpr); el.canvas.height = Math.round(cw * (window.GorillaRenderer.H / window.GorillaRenderer.W) * dpr);
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
    let steps = 0;
    if (state.playing && !state.sim.over) {
      state.acc += dt * state.speed * renderer.timeScale;
      while (state.acc >= M.DT && steps < 600 && !state.sim.over) { M.step(state.sim); state.acc -= M.DT; steps++; }
      if (steps >= 600) state.acc = 0;
      drainEvents();
      if (state.sim.over) onRunOver();
    } else if (state.sim.over && state.pendingEscalate && renderer.cine <= 0) {
      state.escalateTimer -= dt;
      if (state.escalateTimer <= 0) { state.pendingEscalate = false; startRun(state.n + 1, { autoplay: true }); }
    }
    // after the fight ends let the scene keep animating (celebration / chest-beat) in real time
    const dtSim = state.sim.over && !state.playing ? Math.min(dt, 0.1) : steps * M.DT;
    renderer.update(dtSim, dt, state.sim, { speed: state.speed, roundNo: state.roundNo });
    updateStatus();
  }
  function frame() { if (state.sim) renderer.draw(state.sim, { speed: state.speed, roundNo: state.roundNo }); requestAnimationFrame(frame); }
  setInterval(() => advance(performance.now()), 33);

  // ---------- controls ----------
  function ensureAudio() { if (window.GAudio && !window.GAudio.ready) window.GAudio.init(); }
  el.play.addEventListener('click', () => { ensureAudio(); if (state.sim && state.sim.over && !state.pendingEscalate) startRun(state.n, { autoplay: true }); else setPlaying(!state.playing); });
  function syncSoundBtn() { const m = window.GAudio ? window.GAudio.muted : true; el.sound.textContent = m ? '🔇 Sound off' : '🔊 Sound on'; el.sound.title = m ? 'Unmute fight sounds' : 'Mute fight sounds'; }
  el.sound.addEventListener('click', () => { ensureAudio(); window.GAudio.setMuted(!window.GAudio.muted); syncSoundBtn(); if (!window.GAudio.muted) window.GAudio.play('punch'); });
  syncSoundBtn();
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
    if (/input|select|textarea/i.test(e.target.tagName)) return;
    if (e.code === 'Space') { e.preventDefault(); el.play.click(); }
    else if (e.key === 'm' || e.key === 'M') el.sound.click();
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
  window.GorillaGauntlet = { state, startRun, setFigure, solve, figureById, renderer };
})();
