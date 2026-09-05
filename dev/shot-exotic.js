#!/usr/bin/env node
// shot-exotic.js — render the graft-only exotic genera (TreeGen.js's
// EXOTIC_GENUS_NAMES) and a few fused examples, for visual review.
// Companion to sweep-exotic.js's numeric stress test.
//
//   node dev/shot-exotic.js out/exotic --seed me --maturity 1
//   node dev/shot-exotic.js out/exotic --fuse willow,plum --maturity 1

'use strict'
const cp = require('child_process')
const FS = require('fs')
const path = require('path')
const P = require('./preview.js')

const argv = process.argv.slice(2)
const OUTDIR = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'out/exotic'
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
const num = (n, d) => { const v = +val(n, d); return isNaN(v) ? d : v }
const SEED = val('seed', 'me')
const MAT = num('maturity', 1)
const YAW = num('yaw', 0.5)
const SCALE = num('scale', 6)
const FUSE = val('fuse', null)          // "willow,plum" -> fuse those two onto the base identity

function identity () {
  const mid = (process.env.MACHINE_ID || '/etc/machine-id needs root, using seed string').toString()
  return [SEED === 'me' ? mid : 'seed:' + SEED, SEED === 'me' ? (process.env.USER || 'user') : 'seed:' + SEED]
}

// ---- palette: same formula as Omatree.qml's palette getter, extended with
// the hue-override + blossom color this feature needs. Kept here rather than
// touching Omatree.qml, which has no live path to an exotic tree yet (no
// grafting UI exists) — this is lab-only until that's built. ----------------
const ACCENT = val('accent', '#50f872')
function hexHSV (hex) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h = (h / 6 + 1) % 1 } return { h, s: mx ? d / mx : 0, v: mx } }
function hsv (h, s, v) { const i = Math.floor(h * 6), f = h * 6 - i; const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return { r: [v, q, p, p, t, v][i % 6], g: [t, v, v, q, p, p][i % 6], b: [p, p, t, v, v, q][i % 6] } }
function mixHue (a, b, k) { let d = b - a; if (d > .5) d -= 1; else if (d < -.5) d += 1; return ((a + d * k) % 1 + 1) % 1 }
const ACC = hexHSV(ACCENT)
const grey = ACC.s < 0.14, ah = grey ? .33 : ACC.h

function paletteFor (hueOverride) {
  // A hue override BREAKS the usual green anchor entirely (that's the whole
  // point of a crimson maple or gold zelkova) rather than blending toward it
  // like the theme accent does.
  const leafH = hueOverride !== undefined && hueOverride !== null
    ? hueOverride
    : (grey ? .32 : mixHue(.30, ah, .34))
  const frond = hsv(leafH, grey ? .14 : .62, .54)
  const woodH = grey ? .07 : mixHue(.075, ah, .14)
  return {
    frond, trunk: hsv(woodH, grey ? .08 : .36, .46),
    pot: { r: 0.71, g: 0.46, b: 0.33 },
    soil: hsv(woodH, grey ? .10 : .24, .40),
    fruit: hsv(grey ? .32 : mixHue(.30, ah, .34), .55, .72),
    berry: hsv(0.70, .55, .62),
    // Fixed pastel pink, not theme-tinted at all — a blossom genus should
    // look the same regardless of what accent color you're running.
    blossom: hsv(0.92, 0.42, 0.92),
  }
}
const BG = [232, 233, 228]

function renderOne (gen) {
  const pal = paletteFor(gen.hue)
  const sk = P.Grow.grow(gen, { maturity: MAT, ageYears: 0, thirst: 0, health: 1, prune: {}, origin: 'cutting' })
  const mz = P.Paint.measureStable(sk, { art: 2.4, showCase: false, yaw: YAW, pitch: 0.26 })
  const V = { yaw: YAW, pitch: 0.26, art: 2.4, w: mz.w, h: mz.h, originX: mz.originX, originY: mz.originY, sun: P.Paint.sunForTime(13, 0), lamp: false, palette: pal, showCase: false }
  const dl = P.Paint.build(sk, V)
  const sBuf = P.renderBuffer(dl.staticOps, V.w, V.h, BG)
  const lBuf = P.renderBuffer(dl.leafOps, V.w, V.h, BG)
  const rgb = P.flatten([sBuf, lBuf], V.w, V.h, BG)
  return { rgb, w: V.w, h: V.h, style: sk.style, genus: sk.genus }
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
const [mid, user] = identity()
const written = []

if (FUSE) {
  const names = FUSE.split(',').map(s => s.trim())
  let gen = P.TreeGen.genesis(mid, user)
  for (const name of names) {
    const donor = P.TreeGen.exoticGenesis(name, mid + ':' + name, user)
    gen = P.TreeGen.fuse(gen, donor, 0.5)
  }
  const { rgb, w, h, style, genus } = renderOne(gen)
  const out = path.join(OUTDIR, `fused-${names.join('+')}.png`)
  writePng(out, w, h, rgb, SCALE)
  console.log(`fused(${names.join('+')})\t${style}\t${genus}\t${out}`)
  written.push(out)
} else {
  for (const name of P.TreeGen.EXOTIC_GENUS_NAMES) {
    const gen = P.TreeGen.exoticGenesis(name, mid, user)
    const { rgb, w, h, style, genus } = renderOne(gen)
    const out = path.join(OUTDIR, `${name}.png`)
    writePng(out, w, h, rgb, SCALE)
    console.log(`${name}\t${style}\t${genus}\t${out}`)
    written.push(out)
  }
}

if (written.length > 1) {
  cp.spawnSync('magick', ['montage', '-tile', Math.min(written.length, 4) + 'x', '-geometry', '+4+4',
    '-background', '#eef1e9', ...written, path.join(OUTDIR, 'contact-sheet.png')], { stdio: 'inherit' })
}
