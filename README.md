# Gorilla Gauntlet

**How many copies of a public figure does it take to beat a silverback gorilla?**
A static, ad-ready web app: pick a figure (Ronnie Coleman, Mike Tyson, Brian Shaw, Khabib… or
import anyone from Wikidata), watch the fight play out, and let the app keep adding a copy
until the humans win. A Monte Carlo solver reports the reliable number.

No build step. Open `index.html` or serve the folder with any static host.

```bash
python3 -m http.server 8765 --directory .
```

## Features

- **Roster of 25 figures** with public metrics (height, weight, documented lifts, fight records)
  and an editable 0–1 fight profile (striking, grappling, endurance, speed, toughness).
- **Wikidata import** — search any person; height (P2048), mass (P2067) and occupations (P106/P641)
  are pulled live and mapped to an archetype (boxer → striker, bodybuilder → lifter, …).
- **Animated fight scene** — procedurally drawn, articulated humans and a silverback on a 3/4-view
  jungle clearing. Every swing, bite, latch, throw and knockout is a simulation event: wind-ups,
  knockback, ballistic throws, chest-beating break-frees, dust, blood decals, damage pop-ups,
  camera shake, slow-motion finish, fighting-game HUD.
- **Synthesized sound** (WebAudio, no assets): thuds, bites, whooshes, roars, bell. Toggle with the
  button or `M`; preference is remembered.
- Play / pause / step / speed (0.5×–16×), live gorilla health & stamina, restraint-vs-strength
  meter, pin timer, fight log, and a round history.
- **Auto-escalation** — "Keep adding a copy until they win" reruns with N+1 after every loss.
- **Solve it** — runs 60 silent fights per crew size and reports the smallest crew that wins
  ≥50% and ≥90% of the time, with a win-rate chart and shareable text.
- **Three plans**: Swarm & pin (realistic), Mixed, Strike only.
- **Ad slots**: leaderboard (728×90), sidebar rectangle (300×250), footer (responsive).
- Deep links: `?figure=mike-tyson&n=5`.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `css/style.css` | Page and styling (dark theme, responsive to 375 px) |
| `js/model.js` | Headless combat model — same code runs the arena, the solver, and Node calibration |
| `js/roster.js` | Gorilla stats, figure roster, archetype table |
| `js/render.js` | Animated arena: figures, gorilla, particles, camera, HUD |
| `js/audio.js` | Synthesized sound effects |
| `js/sim.js` | Controls, run lifecycle, result cards, solver UI |
| `js/wikidata.js` | Wikidata search/import + occupation → archetype mapping |
| `js/ads.js` | Ad slot loader (placeholders until configured) |
| `calibrate.js` | `node calibrate.js [trials] [id,id,...]` — prints N50/N90 for every figure |

## The model (plain English)

Time advances in 0.1 s ticks. Up to 10 humans can be in contact with the gorilla at once;
the rest wait in reserve and rotate in (spent bodies tag out when a fresh reserve exists).

**Gorilla.** 170 kg, strength index 815 (the widely cited but unverified ~815 kg lift figure),
1,400 HP, 88% of blunt strike damage negated. It swings (18 + 0.05 × strength damage) or bites
(12% chance of a fight-ending maim) roughly every 1.1 s when fresh, and keeps mauling the same
target 75% of the time until it drops. Every action costs stamina; effective strength is
`815 × (floor + (1 − floor) × stamina^0.7) × (0.6 + 0.4 × health)`. The floor starts at 0.40
and falls to 0.20 after 90 s at redline — a gorilla can't sprint forever.

**Humans.** HP = 70 + 0.5 × mass. Damage taken scales with `1.2 − 0.4 × toughness`. Each human
either strikes (damage from mass, strength index and striking skill, mostly absorbed) or tries to
latch on (success from grappling skill, easier as the gorilla tires). Latched bodies add
**restraint** = `(strength × (0.35 + 0.65 × grappling) + 0.5 × mass × (0.5 + 0.5 × grappling)) × fatigue`,
with diminishing returns beyond four bodies.

**Pin.** When restraint ≥ effective strength (and ≥2 latched) the gorilla is pinned and must
try to break free every second: `burst = strength × (0.9 + rand × (0.2 + 0.6 × √stamina))`
vs `restraint × (0.9 + 0.2 × rand)`. A fresh gorilla explodes out and hurls 1–3 bodies
(20–45 damage each); an exhausted one mostly can't. Humans win after 10 continuous seconds of
pin with gorilla stamina < 30%, or if gorilla HP reaches 0. The gorilla wins when every human is
down or it is still standing at 10 minutes.

### Calibration (Swarm & pin, 30 fights per crew size, seed 12345)

| Figure | N for ≥50% | N for ≥90% |
| --- | --- | --- |
| Aleksandr Karelin | 4 | 5 |
| Brian Shaw / Björnsson / Eddie Hall / Lesnar / André | 5 | 6–7 |
| Ronnie Coleman / Ngannou / Jon Jones / Gordon Ryan / Pudzianowski | 6 | 6–7 |
| Mike Tyson / Khabib / Arnold (1974) / Shaq / The Rock | 7 | 7–9 |
| Muhammad Ali / LeBron James | 8 | 9 |
| Amanda Nunes / Conor McGregor | 9–10 | 9–11 |
| Bruce Lee | 11 | 12 |
| Usain Bolt | 14 | 15 |
| Serena Williams | 16 | 18 |
| Average American man (90.6 kg, untrained) | 19 | 21 |
| Average American woman (77.5 kg, untrained) | 23 | 25 |

Re-run with `node calibrate.js 50` after changing constants in `js/model.js`.

## Turning on ads

1. Get an AdSense (or other network) account approved for your domain.
2. In `js/ads.js` set `enabled: true` and your `client` id (`ca-pub-…`). With no slot ids this
   runs **Auto ads** (Google picks placements). For fixed placements, also fill one slot id per
   placement (`leaderboard`, `sidebar`, `footer`) from Display ad units you create.
3. Put the `ads.txt` line AdSense gives you at the site root.
4. Until then every slot shows a labelled placeholder so the layout does not shift.

Other networks: replace the `live` branch in `js/ads.js` with the network's tag; the slot
`<div class="ad" data-ad="…">` containers are already sized.

## Deploying

Any static host works (GitHub Pages, Netlify, Cloudflare Pages, S3). Push the folder as-is.
Wikidata import needs outbound HTTPS from the visitor's browser; nothing else calls out.

## Caveats

Everything here is a model, not a measurement. Gorilla strength is genuinely uncertain
(4–9× an adult man is the usual range), fight profiles are editorial estimates, and real
gorillas mostly bluff-charge and leave. Wild gorillas are endangered: https://gorillafund.org
