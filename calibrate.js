// node calibrate.js [trials] [id,id,...]  — prints N needed for 50% / 90% win rate per figure
const M = require('./js/model.js');
const R = require('./js/roster.js');
const trials = parseInt(process.argv[2] || '30', 10);
const only = process.argv[3] ? process.argv[3].split(',') : null;
const t0 = Date.now();
for (const f of R.FIGURES) {
  if (only && !only.includes(f.id)) continue;
  const s = M.solver(f, R.GORILLA, { strategy: 'swarm', seed: 12345 }, { trials, maxN: 150, target: 0.9 });
  while (!s.done) s.next();
  const sum = s.summary();
  const first = sum.rows.find(r => r.winRate > 0);
  const one = M.run(f, 1, R.GORILLA, { seed: 1 });
  console.log(`${f.name.padEnd(32)} first-win=${String(first ? first.n : '-').padStart(3)} n50=${String(sum.n50).padStart(3)}  n90=${String(sum.n90).padStart(3)}  (1v1: ${one.winner} in ${one.t.toFixed(0)}s)`);
}
console.log(`-- ${((Date.now() - t0) / 1000).toFixed(1)}s`);
