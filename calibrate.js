// node calibrate.js [trials] [id,id,...] [--heuristic]  — N needed for 50% / 90% win rate per figure
const E = require('./js/env.js'), R = require('./js/roster.js'), P = require('./js/policy.js');
const fs = require('fs');
const trials = parseInt(process.argv[2] || '30', 10);
const only = process.argv[3] && !process.argv[3].startsWith('--') ? process.argv[3].split(',') : null;
const heuristic = process.argv.includes('--heuristic');
let brains = null;
if (!heuristic && fs.existsSync('./js/brains.js')) { const B = require('./js/brains.js'); brains = P.brainsFromParams(B.human, B.gorilla, { human: E.heuristicHuman('swarm'), gorilla: E.heuristicGorilla() }); console.log('using RL brains, gen', B.meta.generations); }
else console.log('using heuristic brains');
const t0 = Date.now();
for (const f of R.FIGURES) {
  if (only && !only.includes(f.id)) continue;
  const s = E.solver(f, R.GORILLA, { strategy: 'swarm', seed: 12345, brains }, { trials, maxN: 120, target: 0.9 });
  while (!s.done) s.next();
  const sum = s.summary();
  const first = sum.rows.find(r => r.winRate > 0);
  console.log(`${f.name.padEnd(32)} first-win=${String(first ? first.n : '-').padStart(3)} n50=${String(sum.n50).padStart(3)}  n90=${String(sum.n90).padStart(3)}`);
}
console.log(`-- ${((Date.now() - t0) / 1000).toFixed(1)}s`);
