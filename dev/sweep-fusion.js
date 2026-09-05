#!/usr/bin/env node
// sweep-fusion.js — stress test for the (unbuilt, still-noodling) grafting
// idea: does blending two trees' genus parameters produce sane geometry, or
// does hybrid vigor need clamping before this ever becomes a real feature?
//
// Reuses sweep.js's own proportion bands and measure() shape so fusion
// failure rates are directly comparable to the solo baseline
// (`node dev/sweep.js --n 200000 --maturity 1`).
//
//   node dev/sweep-fusion.js --n 200000 --maturity 1
//   node dev/sweep-fusion.js --n 200000 --tier 3       # compound 3x, worst case
//   node dev/sweep-fusion.js --n 2000 --worst 12 --shots out/fusion/
//
// A "graft" here blends the two donors' GENUS model (taper, boughs, spread,
// droop — see TreeGen.js's GENUS table) at a fixed 50/50 weight per tier.
// spread/droop are defined per genus but NOT currently read by Grow.js
// (confirmed while researching this: Grow.js:163 reads `gen.droop`, which
// genesis() never sets — only `gen.model.droop`). This sweep wires them in
// via an explicit `gen.droop`/`gen.spread` override so the fusion's full
// intended effect can actually be measured, not just its currently-wired
// half (taper/boughs). If grafting ships, that wiring becomes real for solo
// trees too, not just a test shim.

'use strict'
const cp = require('child_process')
const FS = require('fs')
const P = require('./preview.js')

const argv = process.argv.slice(2)
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
const num = (n, d) => { const v = +val(n, d); return isNaN(v) ? d : v }

const N = num('n', 1000) | 0
const MAT = num('maturity', 1)
const AGE = num('age', 0)
const TIER = Math.max(1, Math.min(3, num('tier', 1) | 0))   // grafts 1..3, compounding
const COMPOUND = val('mode', 'compound') === 'compound'       // vs 'fresh' (see graft-idea memory)
const WORST = num('worst', 0) | 0
const SHOTS = val('shots', null)
const JSONOUT = val('json', null)

// ---- same bands sweep.js uses, kept in sync by hand (small enough to
// duplicate rather than refactor sweep.js's internals into a shared module
// mid-noodle) ----------------------------------------------------------
const SPREAD_LO = 1.05
const SPREAD_HI_BY_STYLE = { windswept: 2.85, slant: 2.70, literati: 2.60, cascade: 2.85 }
const SPREAD_HI = 2.30
const spreadHi = (st) => SPREAD_HI_BY_STYLE[st] || SPREAD_HI
const HEIGHT_LO = 1.30
const HEIGHT_HI = 3.20
const BAL_HI = 0.85
const fill = Math.max(0, Math.min(1, (MAT - 0.35) / 0.5))
const sLo = SPREAD_LO * fill
const hLo = HEIGHT_LO * fill

function lerp (a, b, t) { return a + (b - a) * t }

// Blend two genus models at weight t (0 = all A, 1 = all B). boughs rounds
// to a whole branch count; everything else stays continuous.
function blendModel (a, b, t) {
  return {
    taper: lerp(a.taper, b.taper, t),
    boughs: Math.max(2, Math.round(lerp(a.boughs, b.boughs, t))),
    spread: lerp(a.spread, b.spread, t),
    droop: lerp(a.droop, b.droop, t),
    depth: Math.round(lerp(a.depth, b.depth, t)),
  }
}

// One graft: donor seed -> blended model + a synthetic identity for the
// "needle-ness" the renderer keys off genus name for.
function graft (recipient, donorSeedStr, tierWeight) {
  const donorGen = P.TreeGen.genesis('seed:' + donorSeedStr, 'seed:' + donorSeedStr)
  const model = blendModel(recipient.model, donorGen.model, tierWeight)
  const needle = recipient.needle || donorGen.genus === 'pine' || donorGen.genus === 'juniper'
  return {
    seed: recipient.seed, style: recipient.style,
    genus: recipient.genus === donorGen.genus ? recipient.genus : recipient.genus + '+' + donorGen.genus,
    model, needle, donor: donorGen.genus,
  }
}

function measure (i) {
  const baseSeed = 'graft-base-' + i
  let gen = P.TreeGen.genesis('seed:' + baseSeed, 'seed:' + baseSeed)
  gen = { ...gen, needle: gen.genus === 'pine' || gen.genus === 'juniper' }

  // TIER grafts, each from a fresh donor. Weight 0.5 per graft either blends
  // against the ORIGINAL solo profile every time ('fresh') or against
  // whatever the tree has already become ('compound') — the open question
  // from the conversation, made concrete so both can actually be compared.
  let current = gen
  const original = gen
  for (let g = 0; g < TIER; g++) {
    const donorSeed = 'graft-donor-' + i + '-' + g
    const base = COMPOUND ? current : original
    current = graft(base, donorSeed, 0.5)
  }

  // Grow.grow reads gen.model / gen.genus / gen.needle; everything else
  // (style, seed) rides along from the recipient so the fused tree still
  // trains into a real STYLE_POOL shape, not something ungoverned.
  const fusedGen = { seed: gen.seed, style: gen.style, genus: current.genus, model: current.model }
  const sk = P.Grow.grow(fusedGen, {
    maturity: MAT, ageYears: AGE, thirst: 0, health: 1, prune: {}, origin: 'cutting',
  })
  const b = sk.bounds
  const potR = sk.potR
  const pcx = sk.potCX || 0, pcz = sk.potCZ || 0
  const canopyR = Math.max(
    Math.abs(b.min[0] - pcx), Math.abs(b.max[0] - pcx),
    Math.abs(b.min[2] - pcz), Math.abs(b.max[2] - pcz))
  const treeH = b.max[1]
  return {
    seed: i, style: sk.style, genus: current.genus,
    potR, canopyR, treeH,
    spread: canopyR / potR,
    height: treeH / (potR * 2),
    balance: Math.max(
      Math.abs((b.min[0] + b.max[0]) / 2 - pcx),
      Math.abs((b.min[2] + b.max[2]) / 2 - pcz)) / potR,
  }
}

function score (r) {
  const hiS = spreadHi(r.style)
  const s = r.spread < sLo ? sLo - r.spread : r.spread > hiS ? r.spread - hiS : 0
  const h = r.height < hLo ? hLo - r.height : r.height > HEIGHT_HI ? r.height - HEIGHT_HI : 0
  const b = r.balance > BAL_HI ? r.balance - BAL_HI : 0
  return s + h + b
}

function pct (arr, p) {
  const a = arr.slice().sort((x, y) => x - y)
  return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))]
}
function stat (name, vals, lo, hi) {
  const bad = vals.filter(v => v < lo || v > hi).length
  return { name, min: pct(vals, 0), p01: pct(vals, 0.01), p50: pct(vals, 0.5), p99: pct(vals, 0.99), max: pct(vals, 1), outside: bad, pctOutside: 100 * bad / vals.length }
}
function f (v) { return v.toFixed(2).padStart(7) }

const rows = []
for (let i = 0; i < N; i++) rows.push(measure(i))

const stats = [
  stat('spread  (canopy/pot)', rows.map(r => r.spread), sLo, SPREAD_HI),
  stat('height  (tree/potW)', rows.map(r => r.height), hLo, HEIGHT_HI),
  stat('balance (offset/pot)', rows.map(r => r.balance), -1e9, BAL_HI),
]

console.log(`\n${N} fusions · tier ${TIER} (${COMPOUND ? 'compound' : 'fresh'}) · maturity ${MAT}\n`)
console.log('metric                    min    p01    p50    p99    max   outside')
for (const s of stats) {
  console.log(`${s.name.padEnd(22)}${f(s.min)}${f(s.p01)}${f(s.p50)}${f(s.p99)}${f(s.max)}   ${String(s.outside).padStart(4)}  ${s.pctOutside.toFixed(1)}%`)
}

const scored = rows.map(r => ({ ...r, bad: score(r) }))
const failing = scored.filter(r => r.bad > 0)
console.log(`\n${failing.length} of ${N} outside the bands (${(100 * failing.length / N).toFixed(1)}%)`)

function tally (key) {
  const all = {}, bad = {}
  for (const r of scored) all[r[key]] = (all[r[key]] || 0) + 1
  for (const r of failing) bad[r[key]] = (bad[r[key]] || 0) + 1
  return Object.keys(all).sort((a, b) => (bad[b] || 0) / all[b] - (bad[a] || 0) / all[a])
    .map(k => `    ${k.padEnd(18)} ${String(bad[k] || 0).padStart(4)} / ${String(all[k]).padEnd(6)} ${(100 * (bad[k] || 0) / all[k]).toFixed(0).padStart(3)}%`)
}
console.log('\n  by style:'); console.log(tally('style').join('\n'))
console.log('\n  by genus (fused label):'); console.log(tally('genus').join('\n'))

if (JSONOUT) { FS.writeFileSync(JSONOUT, JSON.stringify(scored, null, 1)); console.error('wrote ' + JSONOUT) }

if (WORST > 0) {
  const worst = scored.slice().sort((a, b) => b.bad - a.bad).slice(0, WORST)
  console.log(`\n  worst ${WORST}:`)
  console.log('    idx       style       genus                spread  height')
  for (const r of worst) {
    console.log(`    ${String(r.seed).padEnd(9)} ${r.style.padEnd(11)} ${r.genus.padEnd(20)} ${f(r.spread)}${f(r.height)}`)
  }
  if (SHOTS) console.error('note: --shots not wired for fusion (fused models are synthetic, not a --seed shot.js can take directly) — inspect via --json + dev/preview.js by hand')
}
console.log('')
