#!/usr/bin/env node
// shot-fusion.js — render specific fused trees from sweep-fusion.js's index
// space, for eyeballing what the numbers in the stress test actually look
// like. Companion to sweep-fusion.js; same blend logic, duplicated rather
// than shared mid-noodle (see that file's header).
//
//   node dev/shot-fusion.js out/ --idx 34858,20095,83980,777,1,2 --tier 3

'use strict'
const cp = require('child_process')
const FS = require('fs')
const path = require('path')
const P = require('./preview.js')

const argv = process.argv.slice(2)
const OUTDIR = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'out/fusion'
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
const num = (n, d) => { const v = +val(n, d); return isNaN(v) ? d : v }
const IDX = (val('idx', '0') || '0').split(',').map(s => s.trim())
const TIER = Math.max(1, Math.min(3, num('tier', 1) | 0))
const COMPOUND = val('mode', 'compound') === 'compound'
const MAT = num('maturity', 1)
const SCALE = num('scale', 6)
const YAW = num('yaw', 0.5)

function lerp (a, b, t) { return a + (b - a) * t }
function blendModel (a, b, t) {
  return {
    taper: lerp(a.taper, b.taper, t),
    boughs: Math.max(2, Math.round(lerp(a.boughs, b.boughs, t))),
    spread: lerp(a.spread, b.spread, t),
    droop: lerp(a.droop, b.droop, t),
    depth: Math.round(lerp(a.depth, b.depth, t)),
  }
}
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
function fusedGenFor (i) {
  const baseSeed = 'graft-base-' + i
  let gen = P.TreeGen.genesis('seed:' + baseSeed, 'seed:' + baseSeed)
  gen = { ...gen, needle: gen.genus === 'pine' || gen.genus === 'juniper' }
  let current = gen
  const original = gen
  for (let g = 0; g < TIER; g++) {
    const donorSeed = 'graft-donor-' + i + '-' + g
    const base = COMPOUND ? current : original
    current = graft(base, donorSeed, 0.5)
  }
  return { seed: gen.seed, style: gen.style, genus: current.genus, model: current.model }
}

// ---- palette + render, mirrors shot.js's own (light register) -----------
const ACCENT = val('accent', '#50f872')
function hexHSV (hex) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h = (h / 6 + 1) % 1 } return { h, s: mx ? d / mx : 0, v: mx } }
function hsv (h, s, v) { const i = Math.floor(h * 6), f = h * 6 - i; const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return { r: [v, q, p, p, t, v][i % 6], g: [t, v, v, q, p, p][i % 6], b: [p, p, t, v, v, q][i % 6] } }
function mixHue (a, b, k) { let d = b - a; if (d > .5) d -= 1; else if (d < -.5) d += 1; return ((a + d * k) % 1 + 1) % 1 }
const ACC = hexHSV(ACCENT)
const grey = ACC.s < 0.14, ah = grey ? .33 : ACC.h
const PAL = {
  frond: hsv(grey ? .32 : mixHue(.30, ah, .34), grey ? .14 : .62, .54),
  trunk: hsv(grey ? .07 : mixHue(.075, ah, .14), grey ? .08 : .36, .46),
  pot: { r: 0.71, g: 0.46, b: 0.33 },
  soil: hsv(grey ? .07 : mixHue(.075, ah, .14), grey ? .10 : .24, .40),
  fruit: hsv(grey ? .32 : mixHue(.30, ah, .34), .55, .72),
  berry: hsv(0.70, .55, .62),
}
const BG = [232, 233, 228]

function renderOne (gen) {
  const sk = P.Grow.grow(gen, { maturity: MAT, ageYears: 0, thirst: 0, health: 1, prune: {}, origin: 'cutting' })
  const mz = P.Paint.measureStable(sk, { art: 2.4, showCase: false, yaw: YAW, pitch: 0.26 })
  const V = { yaw: YAW, pitch: 0.26, art: 2.4, w: mz.w, h: mz.h, originX: mz.originX, originY: mz.originY, sun: P.Paint.sunForTime(13, 0), lamp: false, palette: PAL, showCase: false }
  const dl = P.Paint.build(sk, V)
  const sBuf = P.renderBuffer(dl.staticOps, V.w, V.h, BG)
  const lBuf = P.renderBuffer(dl.leafOps, V.w, V.h, BG)
  const rgb = P.flatten([sBuf, lBuf], V.w, V.h, BG)
  return { rgb, w: V.w, h: V.h, style: sk.style, genus: gen.genus }
}

function writePng (outPath, w, h, rgb, scale) {
  const up = Buffer.alloc(w * scale * h * scale * 3)
  for (let y = 0; y < h * scale; y++) for (let x = 0; x < w * scale; x++) {
    const si = ((y / scale | 0) * w + (x / scale | 0)) * 3
    const di = (y * w * scale + x) * 3
    up[di] = rgb[si]; up[di + 1] = rgb[si + 1]; up[di + 2] = rgb[si + 2]
  }
  const ppm = Buffer.concat([Buffer.from(`P6\n${w * scale} ${h * scale}\n255\n`), up])
  const r = cp.spawnSync('magick', ['ppm:-', outPath], { input: ppm })
  if (r.status !== 0) FS.writeFileSync(outPath + '.ppm', ppm)
}

FS.mkdirSync(OUTDIR, { recursive: true })
const written = []
for (const idx of IDX) {
  const gen = fusedGenFor(idx)
  const { rgb, w, h, style, genus } = renderOne(gen)
  const out = path.join(OUTDIR, `fusion-${idx}.png`)
  writePng(out, w, h, rgb, SCALE)
  console.log(`${idx}\t${style}\t${genus}\t${out}`)
  written.push(out)
}

// contact sheet
const montageArgs = ['-tile', String(Math.min(written.length, 4)) + 'x', '-geometry', '+4+4', '-background', '#eef1e9', ...written, path.join(OUTDIR, 'contact-sheet.png')]
cp.spawnSync('magick', ['montage', ...montageArgs], { stdio: 'inherit' })
