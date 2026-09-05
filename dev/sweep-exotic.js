#!/usr/bin/env node
// sweep-exotic.js — stress test for TreeGen.js's graft-only EXOTIC_GENUS_NAMES,
// same proportion bands and measure() shape as sweep.js/sweep-fusion.js so
// results are directly comparable to the solo baseline.
//
//   node dev/sweep-exotic.js --n 200000 --maturity 1

'use strict'
const P = require('./preview.js')

const argv = process.argv.slice(2)
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
const num = (n, d) => { const v = +val(n, d); return isNaN(v) ? d : v }
const N = num('n', 50000) | 0
const MAT = num('maturity', 1)
const AGE = num('age', 0)
const WORST = num('worst', 0) | 0

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

function measure (genusName, i) {
  const gen = P.TreeGen.exoticGenesis(genusName, 'exotic:' + genusName + ':' + i, 'seed')
  const sk = P.Grow.grow(gen, { maturity: MAT, ageYears: AGE, thirst: 0, health: 1, prune: {}, origin: 'cutting' })
  const b = sk.bounds
  const potR = sk.potR
  const pcx = sk.potCX || 0, pcz = sk.potCZ || 0
  const canopyR = Math.max(
    Math.abs(b.min[0] - pcx), Math.abs(b.max[0] - pcx),
    Math.abs(b.min[2] - pcz), Math.abs(b.max[2] - pcz))
  const treeH = b.max[1]
  return {
    i, genus: genusName, style: sk.style, potR, canopyR, treeH,
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
function pct (arr, p) { const a = arr.slice().sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.max(0, Math.round((a.length - 1) * p)))] }
function f (v) { return v.toFixed(2).padStart(7) }

for (const genusName of P.TreeGen.EXOTIC_GENUS_NAMES) {
  const rows = []
  for (let i = 0; i < N; i++) rows.push(measure(genusName, i))
  const spreads = rows.map(r => r.spread), heights = rows.map(r => r.height), bals = rows.map(r => r.balance)
  const scored = rows.map(r => ({ ...r, bad: score(r) }))
  const failing = scored.filter(r => r.bad > 0)

  console.log(`\n=== ${genusName} — ${N} seeds · maturity ${MAT} ===`)
  console.log('metric                    min    p01    p50    p99    max   outside')
  for (const [name, vals, lo, hi] of [
    ['spread  (canopy/pot)', spreads, sLo, SPREAD_HI],
    ['height  (tree/potW)', heights, hLo, HEIGHT_HI],
    ['balance (offset/pot)', bals, -1e9, BAL_HI],
  ]) {
    const bad = vals.filter(v => v < lo || v > hi).length
    console.log(`${name.padEnd(22)}${f(pct(vals, 0))}${f(pct(vals, 0.01))}${f(pct(vals, 0.5))}${f(pct(vals, 0.99))}${f(pct(vals, 1))}   ${String(bad).padStart(4)}  ${(100 * bad / vals.length).toFixed(1)}%`)
  }
  console.log(`${failing.length} of ${N} outside the bands (${(100 * failing.length / N).toFixed(1)}%)`)

  const byStyle = {}
  for (const r of scored) { byStyle[r.style] = byStyle[r.style] || { all: 0, bad: 0 }; byStyle[r.style].all++ }
  for (const r of failing) byStyle[r.style].bad++
  const styleLines = Object.keys(byStyle).sort((a, b) => byStyle[b].bad / byStyle[b].all - byStyle[a].bad / byStyle[a].all)
    .map(k => `    ${k.padEnd(11)} ${String(byStyle[k].bad).padStart(4)} / ${String(byStyle[k].all).padEnd(5)} ${(100 * byStyle[k].bad / byStyle[k].all).toFixed(0).padStart(3)}%`)
  console.log('  by style:'); console.log(styleLines.join('\n'))

  if (WORST > 0) {
    const worst = scored.slice().sort((a, b) => b.bad - a.bad).slice(0, WORST)
    console.log(`  worst ${WORST}:`)
    for (const r of worst) console.log(`    i=${r.i}  style=${r.style}  spread=${r.spread.toFixed(2)}  height=${r.height.toFixed(2)}  bad=${r.bad.toFixed(2)}`)
  }
}
console.log('')
