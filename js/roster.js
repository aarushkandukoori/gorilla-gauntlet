/* roster.js — the gorilla and a roster of public figures with publicly reported metrics.
 * Numbers are approximate, peak-era where noted. Skill fields (0–1) are editorial
 * estimates from each person's documented background; the UI lets you change them.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GorillaRoster = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const GORILLA = {
    name: 'Silverback gorilla',
    species: 'Western lowland gorilla, adult male',
    massKg: 170,          // wild adult males typically 136–195 kg
    heightM: 1.7,         // standing
    reachM: 2.5,          // arm span 2.3–2.6 m
    strengthIndex: 815,   // kgf-equivalent; the oft-cited ~815 kg lift estimate (uncertain — 4–9× an adult man)
    sprintKmh: 40,        // short bursts
    biteForcePsi: 1300,
    hp: 1600,
    strikeResist: 0.93,   // share of blunt human strike damage negated (dense bone, thick hide, heavy musculature)    // share of blunt human strike damage negated (dense bone, thick hide, muscle)
    facts: [
      'Adult male mass 136–195 kg (typical ~170 kg)',
      'Arm span 2.3–2.6 m; standing height ~1.7 m',
      'Bite force ≈ 1,300 PSI (≈ 2× a lion)',
      'Short sprint ≈ 40 km/h',
      'Strength estimates run 4–9× an adult man; a ~815 kg lift figure is widely cited but unverified',
      'Burst animal: rests most of the day, tires far faster than a human endurance athlete',
    ],
  };

  const ARCHETYPES = {
    untrained:   { label: 'Untrained / non-athlete', striking: 0.1,  grappling: 0.1,  endurance: 0.3,  speed: 0.4,  toughness: 0.5,  strengthPerKg: 0.9 },
    athlete:     { label: 'Pro athlete (non-contact)', striking: 0.15, grappling: 0.25, endurance: 0.8, speed: 0.8,  toughness: 0.7,  strengthPerKg: 1.5 },
    contact:     { label: 'Contact-sport athlete',   striking: 0.3,  grappling: 0.45, endurance: 0.6,  speed: 0.6,  toughness: 0.85, strengthPerKg: 1.8 },
    striker:     { label: 'Boxer / striker',          striking: 0.9,  grappling: 0.35, endurance: 0.75, speed: 0.85, toughness: 0.85, strengthPerKg: 1.6 },
    grappler:    { label: 'Wrestler / grappler',      striking: 0.3,  grappling: 0.95, endurance: 0.8,  speed: 0.65, toughness: 0.9,  strengthPerKg: 1.9 },
    mma:         { label: 'Mixed martial artist',     striking: 0.8,  grappling: 0.8,  endurance: 0.75, speed: 0.8,  toughness: 0.9,  strengthPerKg: 1.7 },
    lifter:      { label: 'Bodybuilder / powerlifter', striking: 0.15, grappling: 0.3, endurance: 0.45, speed: 0.45, toughness: 0.8,  strengthPerKg: 2.4 },
    strongman:   { label: 'Strongman',                striking: 0.15, grappling: 0.35, endurance: 0.35, speed: 0.35, toughness: 0.9,  strengthPerKg: 2.0 },
  };

  const FIGURES = [
    // ---- Strength ----
    { id: 'ronnie-coleman', name: 'Ronnie Coleman', group: 'Strength', emoji: '🏋️', tag: '8× Mr. Olympia',
      heightM: 1.80, massKg: 136, strengthIndex: 330, striking: 0.15, grappling: 0.3, endurance: 0.5, speed: 0.45, toughness: 0.85,
      facts: ['5\'11" · 300 lb contest weight (≈315 lb off-season)', '800 lb squat ×2 and 800 lb deadlift ×2 on film (2000)', '495 lb bench ×5', 'Former Arlington PD officer; no fight training'] },
    { id: 'brian-shaw', name: 'Brian Shaw', group: 'Strength', emoji: '🏋️', tag: '4× World\'s Strongest Man',
      heightM: 2.03, massKg: 200, strengthIndex: 370, striking: 0.1, grappling: 0.35, endurance: 0.35, speed: 0.35, toughness: 0.9,
      facts: ['6\'8" · ~440 lb', '1,021 lb Hummer-tire deadlift (2016)', 'WSM 2011, 2013, 2015, 2016', 'Played college basketball'] },
    { id: 'hafthor', name: 'Hafþór Björnsson', group: 'Strength', emoji: '🏋️', tag: '501 kg deadlift',
      heightM: 2.06, massKg: 205, strengthIndex: 395, striking: 0.3, grappling: 0.35, endurance: 0.4, speed: 0.4, toughness: 0.9,
      facts: ['6\'9" · ~450 lb at WSM 2018', '501 kg deadlift world record (2020)', 'Won a pro boxing bout vs Eddie Hall (2022)', '"The Mountain" in Game of Thrones'] },
    { id: 'eddie-hall', name: 'Eddie Hall', group: 'Strength', emoji: '🏋️', tag: 'First 500 kg deadlift',
      heightM: 1.91, massKg: 190, strengthIndex: 400, striking: 0.35, grappling: 0.35, endurance: 0.4, speed: 0.4, toughness: 0.9,
      facts: ['6\'3" · ~190–196 kg at WSM 2017', '500 kg deadlift (2016)', 'World\'s Strongest Man 2017', 'Boxed Björnsson (2022), later MMA debut'] },
    { id: 'pudzianowski', name: 'Mariusz Pudzianowski', group: 'Strength', emoji: '🏋️', tag: 'Strongman turned MMA',
      heightM: 1.86, massKg: 120, strengthIndex: 355, striking: 0.45, grappling: 0.45, endurance: 0.5, speed: 0.55, toughness: 0.85,
      facts: ['6\'1" · ~265 lb', '5× World\'s Strongest Man (record)', 'Deadlift 415 kg, squat 380 kg, bench 290 kg', '17+ pro MMA wins in KSW'] },
    { id: 'arnold-1974', name: 'Arnold Schwarzenegger (1974)', group: 'Strength', emoji: '🏋️', tag: '7× Mr. Olympia',
      heightM: 1.88, massKg: 107, strengthIndex: 270, striking: 0.15, grappling: 0.3, endurance: 0.55, speed: 0.5, toughness: 0.8,
      facts: ['6\'2" · 235 lb contest weight', 'Bench 525 lb, squat 545 lb, deadlift 710 lb (powerlifting era)', 'Mr. Olympia 1970–75, 1980'] },
    { id: 'andre-the-giant', name: 'André the Giant', group: 'Strength', emoji: '🤼', tag: '7\'4", 520 lb',
      heightM: 2.24, massKg: 236, strengthIndex: 300, striking: 0.25, grappling: 0.5, endurance: 0.3, speed: 0.3, toughness: 0.85,
      facts: ['Billed 7\'4" · ~520 lb', 'Acromegaly; largest mainstream pro wrestler', 'Decades of (scripted) grappling'] },

    // ---- Combat ----
    { id: 'mike-tyson', name: 'Mike Tyson', group: 'Combat', emoji: '🥊', tag: 'Youngest heavyweight champ',
      heightM: 1.78, massKg: 100, strengthIndex: 175, striking: 0.97, grappling: 0.35, endurance: 0.7, speed: 0.9, toughness: 0.85,
      facts: ['5\'10" · 218–220 lb peak', '50–6, 44 KOs', 'Undisputed heavyweight champion at 20 (1987)', 'Peek-a-boo style: fastest heavyweight hands of his era'] },
    { id: 'ngannou', name: 'Francis Ngannou', group: 'Combat', emoji: '🥊', tag: 'Hardest punch ever measured',
      heightM: 1.93, massKg: 117, strengthIndex: 195, striking: 0.95, grappling: 0.5, endurance: 0.6, speed: 0.8, toughness: 0.9,
      facts: ['6\'4" · 257 lb', '129,161 units on the UFC PI PowerKube (2017) — record', 'UFC heavyweight champion 2021–22', 'Knocked down Tyson Fury (2023)'] },
    { id: 'jon-jones', name: 'Jon Jones', group: 'Combat', emoji: '🤼', tag: '84.5" reach',
      heightM: 1.93, massKg: 111, strengthIndex: 175, reachM: 2.15, striking: 0.85, grappling: 0.9, endurance: 0.8, speed: 0.8, toughness: 0.9,
      facts: ['6\'4" · ~248 lb at heavyweight', '84.5-inch reach (longest in UFC history)', 'Two-division UFC champion; NJCAA wrestling champ'] },
    { id: 'khabib', name: 'Khabib Nurmagomedov', group: 'Combat', emoji: '🤼', tag: '29–0',
      heightM: 1.78, massKg: 70, strengthIndex: 135, striking: 0.6, grappling: 1.0, endurance: 0.95, speed: 0.8, toughness: 0.9,
      facts: ['5\'10" · 155 lb', 'Retired undefeated 29–0', '2× combat sambo world champion', 'Famously wrestled a bear cub as a child'] },
    { id: 'karelin', name: 'Aleksandr Karelin', group: 'Combat', emoji: '🤼', tag: '13 years undefeated',
      heightM: 1.91, massKg: 130, strengthIndex: 265, striking: 0.3, grappling: 1.0, endurance: 0.85, speed: 0.6, toughness: 0.95,
      facts: ['6\'3" · 286 lb', '3× Olympic gold, 9× world champion (Greco-Roman)', 'Unbeaten 1987–2000; six years without conceding a point', 'Reverse body-lift of 130 kg opponents'] },
    { id: 'brock-lesnar', name: 'Brock Lesnar', group: 'Combat', emoji: '🤼', tag: 'NCAA champ + UFC champ',
      heightM: 1.91, massKg: 120, strengthIndex: 240, striking: 0.5, grappling: 0.9, endurance: 0.5, speed: 0.75, toughness: 0.85,
      facts: ['6\'3" · 265 lb', 'NCAA Division I heavyweight champion (2000)', 'UFC heavyweight champion 2008–10'] },
    { id: 'gordon-ryan', name: 'Gordon Ryan', group: 'Combat', emoji: '🤼', tag: 'No-gi GOAT',
      heightM: 1.88, massKg: 105, strengthIndex: 165, striking: 0.2, grappling: 1.0, endurance: 0.75, speed: 0.6, toughness: 0.8,
      facts: ['6\'2" · ~230 lb', 'Multiple ADCC titles incl. absolute (2019, 2022)', 'Pure submission grappler; no striking record'] },
    { id: 'ali', name: 'Muhammad Ali', group: 'Combat', emoji: '🥊', tag: 'The Greatest',
      heightM: 1.91, massKg: 98, strengthIndex: 150, striking: 0.9, grappling: 0.3, endurance: 0.9, speed: 0.95, toughness: 0.95,
      facts: ['6\'3" · ~215 lb', '56–5, 37 KOs; 3× lineal heavyweight champion', 'Rope-a-dope: absorbed Foreman for 7 rounds'] },
    { id: 'mcgregor', name: 'Conor McGregor', group: 'Combat', emoji: '🥊', tag: 'Two-division UFC champ',
      heightM: 1.75, massKg: 70, strengthIndex: 120, striking: 0.9, grappling: 0.5, endurance: 0.6, speed: 0.85, toughness: 0.75,
      facts: ['5\'9" · 155 lb', 'First simultaneous two-division UFC champion (2016)', '13-second KO of José Aldo'] },
    { id: 'amanda-nunes', name: 'Amanda Nunes', group: 'Combat', emoji: '🥊', tag: 'Two-division champ',
      heightM: 1.73, massKg: 61, strengthIndex: 105, striking: 0.9, grappling: 0.85, endurance: 0.75, speed: 0.8, toughness: 0.85,
      facts: ['5\'8" · 135 lb', 'UFC bantamweight + featherweight champion simultaneously', 'BJJ black belt; KO\'d Cyborg in 51 s'] },
    { id: 'bruce-lee', name: 'Bruce Lee', group: 'Combat', emoji: '🥋', tag: 'Jeet Kune Do founder',
      heightM: 1.72, massKg: 64, strengthIndex: 115, striking: 0.9, grappling: 0.4, endurance: 0.8, speed: 1.0, toughness: 0.6,
      facts: ['5\'7" · ~140 lb', 'One-inch punch; two-finger push-ups', 'Reported 5.7 lb/mm punch speed; no pro fight record'] },

    // ---- Athletes ----
    { id: 'usain-bolt', name: 'Usain Bolt', group: 'Athletes', emoji: '🏃', tag: 'Fastest human',
      heightM: 1.95, massKg: 94, strengthIndex: 150, striking: 0.1, grappling: 0.1, endurance: 0.6, speed: 1.0, toughness: 0.5,
      facts: ['6\'5" · 207 lb', '100 m in 9.58 s (2009); top speed ≈ 44.7 km/h', '8 Olympic golds'] },
    { id: 'lebron', name: 'LeBron James', group: 'Athletes', emoji: '🏀', tag: '6\'9", 250 lb',
      heightM: 2.06, massKg: 113, strengthIndex: 195, striking: 0.15, grappling: 0.35, endurance: 0.85, speed: 0.85, toughness: 0.8,
      facts: ['6\'9" · 250 lb', 'NBA all-time scoring leader', 'All-state wide receiver in high school'] },
    { id: 'shaq', name: 'Shaquille O\'Neal', group: 'Athletes', emoji: '🏀', tag: '7\'1", 325 lb',
      heightM: 2.16, massKg: 147, strengthIndex: 240, striking: 0.2, grappling: 0.35, endurance: 0.4, speed: 0.5, toughness: 0.85,
      facts: ['7\'1" · 325 lb listed (heavier in later years)', '4× NBA champion', 'Broke two backboards in 1993'] },
    { id: 'the-rock', name: 'Dwayne Johnson', group: 'Athletes', emoji: '🤼', tag: 'The Rock',
      heightM: 1.96, massKg: 118, strengthIndex: 225, striking: 0.3, grappling: 0.45, endurance: 0.6, speed: 0.55, toughness: 0.85,
      facts: ['6\'5" · ~260 lb', 'Miami Hurricanes defensive lineman (1991 national champions)', 'Decades of pro wrestling; reported 425+ lb bench'] },
    { id: 'serena', name: 'Serena Williams', group: 'Athletes', emoji: '🎾', tag: '23 Grand Slams',
      heightM: 1.75, massKg: 70, strengthIndex: 100, striking: 0.1, grappling: 0.1, endurance: 0.8, speed: 0.75, toughness: 0.7,
      facts: ['5\'9" · ~155 lb', '23 Grand Slam singles titles', 'Serve clocked at 128.6 mph'] },

    // ---- Baseline ----
    { id: 'average-man', name: 'Average American man', group: 'Baseline', emoji: '🧍', tag: 'CDC 2015–2018',
      heightM: 1.75, massKg: 90.6, strengthIndex: 80, striking: 0.1, grappling: 0.1, endurance: 0.3, speed: 0.4, toughness: 0.5,
      facts: ['5\'9" · 199.8 lb (CDC NHANES 2015–2018, age 20+)', 'Untrained: ~130 lb bench, ~175 lb squat, ~220 lb deadlift', 'This is the "100 men vs 1 gorilla" baseline'] },
    { id: 'average-woman', name: 'Average American woman', group: 'Baseline', emoji: '🧍', tag: 'CDC 2015–2018',
      heightM: 1.62, massKg: 77.5, strengthIndex: 50, striking: 0.1, grappling: 0.1, endurance: 0.3, speed: 0.35, toughness: 0.45,
      facts: ['5\'4" · 170.8 lb (CDC NHANES 2015–2018, age 20+)', 'Untrained strength baseline'] },
  ];

  function byId(id) { return FIGURES.find(f => f.id === id) || null; }
  function groups() { const g = []; for (const f of FIGURES) if (!g.includes(f.group)) g.push(f.group); return g; }

  return { GORILLA, FIGURES, ARCHETYPES, byId, groups };
});
