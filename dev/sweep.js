#!/usr/bin/env node
// sweep.js — grow N trees and measure how each one sits in its pot.
//
//   node dev/sweep.js               # 1000 seeds at maturity 0.85
//   node dev/sweep.js --n 4000 --maturity 1 --age 200
//   node dev/sweep.js --n 1000 --json out.json
//   node dev/sweep.js --n 1000 --worst 12 --shots out/   # render the worst offenders
//
// The point is the TAIL, not the average. A plugin seeded from machine identity
// hands a different tree to every install, so a proportion that only looks wrong
// for 2% of seeds is still thousands of people with an ugly tree and no way to
// reroll it. This measures the distribution so the bad end can be found and
// fixed rather than discovered in the wild.

'use strict'
const cp = require('child_process')
const FS = require('fs')
const P = require('./preview.js')

const argv = process.argv.slice(2)
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
const num = (n, d) => { const v = +val(n, d); return isNaN(v) ? d : v }
const flag = (n) => argv.includes('--' + n)

const N = num('n', 1000) | 0
const MAT = num('maturity', 0.85)
const AGE = num('age', 0)
const WORST = num('worst', 0) | 0
const SHOTS = val('shots', null)
const JSONOUT = val('json', null)

// ---- what "well proportioned" means here ---------------------------------
// Bonsai practice puts the canopy a little wider than the pot and the tree
// noticeably taller than the pot is wide. These are the bands the sweep scores
// against; they are deliberately generous, so anything flagged is a real
// outlier and not a matter of taste.
const SPREAD_LO = 1.05   // canopy half-width / pot half-width
// A windswept or slanting bonsai legitimately reaches further past its rim than
// a formal upright does — that reach IS the style. A single ceiling calibrated
// on upright trees flagged the whole of windswept forever, which makes the gate
// useless as a regression guard. Rendered evidence: these styles read correctly
// at ~2.5 and read broken at 4+, so they get their own ceiling. It is a better
// calibrated model, not a looser one; the upright ceiling is unchanged.
const SPREAD_HI_BY_STYLE = { windswept: 2.85, slant: 2.70, literati: 2.60, cascade: 2.85 }
const SPREAD_HI = 2.30
const spreadHi = (st) => SPREAD_HI_BY_STYLE[st] || SPREAD_HI
const HEIGHT_LO = 1.30   // tree height / pot width
const HEIGHT_HI = 3.20
const BAL_HI    = 0.85   // canopy midpoint must stay well inside the rim

// The LOW bands describe a grown bonsai. A sapling legitimately sits small in a
// full-size training pot — that is what a fresh planting looks like, and the pot
// is deliberately not shrunk to it (shrinking the rim turns the box into a tall
// column). So below this maturity only the upper bands are enforced: a tree can
// never be too big for its pot at any age, but it can certainly be too small.
// Phased in rather than switched on: a tree fills its pot gradually, so a hard
// threshold just moves the false failures to whatever maturity sits just past
// it (at 0.55 it flagged 83% of half-grown trees that were filling out exactly
// as they should).
const fill = Math.max(0, Math.min(1, (MAT - 0.35) / 0.5))
const grown = fill >= 1
const sLo = SPREAD_LO * fill
const hLo = HEIGHT_LO * fill

function measure (seed) {
  const gen = P.TreeGen.genesis('seed:' + seed, 'seed:' + seed)
  const sk = P.Grow.grow(gen, {
    maturity: MAT, ageYears: AGE, thirst: 0, health: 1, prune: {}, origin: 'cutting'
  })
  const b = sk.bounds
  const potR = sk.potR
  // Measured from where the POT sits, not from the trunk: the box is planted
  // off-centre under a leaning crown, so overhang and balance only mean
  // anything relative to the rim's own centre.
  const pcx = sk.potCX || 0, pcz = sk.potCZ || 0
  const canopyR = Math.max(
    Math.abs(b.min[0] - pcx), Math.abs(b.max[0] - pcx),
    Math.abs(b.min[2] - pcz), Math.abs(b.max[2] - pcz))
  const treeH = b.max[1]                       // soil is y=0-ish; top of foliage
  return {
    seed,
    style: sk.style,
    genus: sk.genus,
    potR,
    canopyR,
    treeH,
    spread: canopyR / potR,                    // how far it overhangs the rim
    height: treeH / (potR * 2),                // how tall against the pot's width
    // Where the canopy's mass sits relative to the pot it is standing in. Past
    // 1.0 the middle of the foliage is outside the rim entirely, which is what
    // makes a tree read as toppling rather than as leaning.
    balance: Math.max(
      Math.abs((b.min[0] + b.max[0]) / 2 - pcx),
      Math.abs((b.min[2] + b.max[2]) / 2 - pcz)) / potR
  }
}

function score (r) {
  // distance outside the acceptable band, 0 = inside
  const hiS = spreadHi(r.style)
  const s = r.spread < sLo ? sLo - r.spread
    : r.spread > hiS ? r.spread - hiS : 0
  const h = r.height < hLo ? hLo - r.height
    : r.height > HEIGHT_HI ? r.height - HEIGHT_HI : 0
  const b = r.balance > BAL_HI ? r.balance - BAL_HI : 0
  return s + h + b
}

function pct (arr, p) {
  const a = arr.slice().sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]
}

function stat (name, vals, lo, hi) {
  const bad = vals.filter(v => v < lo || v > hi).length
  return {
    name,
    min: pct(vals, 0), p01: pct(vals, 0.01), p50: pct(vals, 0.5),
    p99: pct(vals, 0.99), max: pct(vals, 1),
    outside: bad, pctOutside: 100 * bad / vals.length
  }
}

const rows = []
for (let i = 0; i < N; i++) rows.push(measure(i))

const spreads = rows.map(r => r.spread)
const heights = rows.map(r => r.height)
const stats = [
  stat('spread  (canopy/pot)', spreads, sLo, SPREAD_HI),   // headline uses the strict ceiling
  stat('height  (tree/potW)', heights, hLo, HEIGHT_HI),
  stat('balance (offset/pot)', rows.map(r => r.balance), -1e9, BAL_HI)
]

function f (v) { return (v).toFixed(2).padStart(7) }
console.log(`\n${N} seeds · maturity ${MAT} · age ${AGE}` + (grown ? '' : '  (still filling out: lower bands at ' + (100 * fill).toFixed(0) + '%)') + '\n')
console.log('metric                    min    p01    p50    p99    max   outside')
for (const s of stats) {
  console.log(`${s.name.padEnd(22)}${f(s.min)}${f(s.p01)}${f(s.p50)}${f(s.p99)}${f(s.max)}` +
    `   ${String(s.outside).padStart(4)}  ${s.pctOutside.toFixed(1)}%`)
}

// which styles / genera carry the failures
const scored = rows.map(r => ({ ...r, bad: score(r) }))
const failing = scored.filter(r => r.bad > 0)
console.log(`\n${failing.length} of ${N} outside the bands (${(100 * failing.length / N).toFixed(1)}%)`)

function tally (key) {
  const all = {}, bad = {}
  for (const r of scored) { all[r[key]] = (all[r[key]] || 0) + 1 }
  for (const r of failing) { bad[r[key]] = (bad[r[key]] || 0) + 1 }
  return Object.keys(all).sort((a, b) => (bad[b] || 0) / all[b] - (bad[a] || 0) / all[a])
    .map(k => `    ${k.padEnd(11)} ${String(bad[k] || 0).padStart(4)} / ${String(all[k]).padEnd(5)} ${(100 * (bad[k] || 0) / all[k]).toFixed(0).padStart(3)}%`)
}
console.log('\n  by style:'); console.log(tally('style').join('\n'))
console.log('\n  by genus:'); console.log(tally('genus').join('\n'))

if (JSONOUT) { FS.writeFileSync(JSONOUT, JSON.stringify(scored, null, 1)); console.error('wrote ' + JSONOUT) }

if (WORST > 0) {
  const worst = scored.slice().sort((a, b) => b.bad - a.bad).slice(0, WORST)
  console.log(`\n  worst ${WORST}:`)
  console.log('    seed      style       genus     spread  height')
  for (const r of worst) {
    console.log(`    ${String(r.seed).padEnd(9)} ${r.style.padEnd(11)} ${r.genus.padEnd(9)} ${f(r.spread)}${f(r.height)}`)
  }
  if (SHOTS) {
    FS.mkdirSync(SHOTS, { recursive: true })
    for (const r of worst) {
      cp.execSync(`node ${__dirname}/shot.js ${SHOTS}/w-${r.seed}.png --seed ${r.seed} --maturity ${MAT} --age ${AGE} --yaw 0.5 --scale 2`,
        { stdio: ['ignore', 'ignore', 'ignore'] })
    }
    console.error('rendered ' + WORST + ' worst cases to ' + SHOTS)
  }
}
console.log('')
