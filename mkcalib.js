// node mkcalib.js [trials] — writes CALIBRATION.md (RL brains + scripted baseline)
const E = require('./js/env.js'), R = require('./js/roster.js'), P = require('./js/policy.js'), fs = require('fs');
const B = require('./js/brains.js');
const trials = parseInt(process.argv[2] || '30', 10);
const heur = { human: E.heuristicHuman('swarm'), gorilla: E.heuristicGorilla() };
const rl = P.brainsFromParams(B.human, B.gorilla, heur);
function ladder(brains) { const out = {}; for (const f of R.FIGURES) { const s = E.solver(f, R.GORILLA, { seed: 12345, brains }, { trials, maxN: 60, target: 0.9 }); while (!s.done) s.next(); out[f.id] = s.summary(); } return out; }
const a = ladder(rl), b = ladder(heur);
let md = `# Calibration\n\nCrew size needed to beat the silverback, ${trials} fights per crew size, seed 12345. "RL" = shipped neural brains on both sides (generation ${B.meta.generations}); "scripted" = swarm-and-pin humans vs heuristic gorilla.\n\n| Figure | RL: N for ≥50% | RL: N for ≥90% | Scripted: N ≥50% | Scripted: N ≥90% |\n| --- | --- | --- | --- | --- |\n`;
for (const f of R.FIGURES) md += `| ${f.name} | ${a[f.id].n50 ?? '60+'} | ${a[f.id].n90 ?? '60+'} | ${b[f.id].n50 ?? '60+'} | ${b[f.id].n90 ?? '60+'} |\n`;
md += `\nRegenerate with \`node mkcalib.js ${trials}\` after training.\n`;
fs.writeFileSync('CALIBRATION.md', md); console.log(md);
