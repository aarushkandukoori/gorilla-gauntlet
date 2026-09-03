// node crosseval.js [trials] — who learned what: RL vs scripted brains on both sides at fixed crew sizes
const E = require('./js/env.js'), R = require('./js/roster.js'), P = require('./js/policy.js');
const B = require('./js/brains.js');
const trials = parseInt(process.argv[2] || '30', 10);
const heur = { human: E.heuristicHuman('swarm'), gorilla: E.heuristicGorilla() };
const rl = P.brainsFromParams(B.human, B.gorilla, heur);
const combos = { 'RL humans vs RL gorilla': rl, 'RL humans vs scripted gorilla': { human: rl.human, gorilla: heur.gorilla }, 'scripted humans vs RL gorilla': { human: heur.human, gorilla: rl.gorilla }, 'scripted vs scripted': heur };
console.log(`brains gen ${B.meta.generations}; human win % at fixed N (${trials} fights each)`);
const cases = [['average-man', 16], ['average-man', 24], ['mike-tyson', 8], ['brian-shaw', 6], ['karelin', 6], ['bruce-lee', 12]];
console.log('combo'.padEnd(32) + cases.map(c => (c[0].slice(0, 8) + '×' + c[1]).padStart(14)).join(''));
for (const [name, brains] of Object.entries(combos)) {
  const row = cases.map(([id, n]) => { const f = R.byId(id); let w = 0; for (let i = 0; i < trials; i++) if (E.run(f, n, R.GORILLA, { seed: 4242 + i * 31, brains }).winner === 'humans') w++; return (Math.round(100 * w / trials) + '%').padStart(14); });
  console.log(name.padEnd(32) + row.join(''));
}
