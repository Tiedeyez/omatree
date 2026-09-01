#!/usr/bin/env node
// timelapse.js — terminal time-travel for Omatree.
//
// Loads the REAL modules (TreeGen + Grow + Paint) and rasterises them the same
// way the shell's Canvas does (dev/preview.js), so what you see here is what the
// panel draws. Growth happens over weeks of use and the light tracks the wall
// clock — this plays the whole arc in a few seconds.
//
//   node dev/timelapse.js                      seed -> mature, clock cycling
//   node dev/timelapse.js --still              one frame (tune with flags)
//   node dev/timelapse.js --spin               hold growth, rotate the turntable
//   node dev/timelapse.js --seed me            this machine's tree
//   node dev/timelapse.js --gallery 12         a grid of random-seed trees
//
// Flags: --seed N|me  --genus juniper|maple|pine  --style formal|informal|...
//        --maturity 0..1  --age YEARS  --yaw RAD  --hour 0..24  --thirst 0..1
//        --health 0..1  --lamp  --light  --art N  --secs N  --fps N  --loop

'use strict'
const os = require('os')
const cp = require('child_process')
const FS = require('fs')
const P = require('./preview.js')

const argv = process.argv.slice(2)
const flag = (n) => argv.includes('--' + n)
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
const num = (n, d) => { const v = +val(n, d); return isNaN(v) ? d : v }
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

const GALLERY = num('gallery', 0) | 0
const MODE = GALLERY > 0 ? 'gallery' : flag('spin') ? 'spin' : flag('still') ? 'still' : flag('day') ? 'day' : 'life'
const LIGHT = flag('light')
const LOOP = flag('loop')
const FPS = Math.max(4, num('fps', 24))
const SECS = Math.max(1, num('secs', MODE === 'spin' ? 8 : MODE === 'day' ? 12 : 20))
const ART = num('art', 2.4)
const HOUR0 = clamp(num('hour', 13), 0, 24)
const MAT0 = clamp(num('maturity', 1), 0, 1)
const AGE0 = Math.max(0, num('age', 0))
const YAW0 = num('yaw', 0.5)
const THIRST = clamp(num('thirst', 0), 0, 1)
const HEALTH = clamp(num('health', 1), 0, 1)
const LAMP = flag('lamp')
const GENUS = val('genus', null)
const STYLE = val('style', null)

// ---- seed / identity -------------------------------------------------
function fnv1a (s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function machineIdentity () {
  let mid = ''
  try { mid = FS.readFileSync('/etc/machine-id', 'utf8').trim() } catch (e) {}
  let host = os.hostname()
  try { host = cp.execSync('hostname', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || host } catch (e) {}
  return [mid, (process.env.USER || os.userInfo().username || '') + '@' + host]
}
function genFor (arg) {
  if (arg === 'me') { const [mid, u] = machineIdentity(); return P.TreeGen.genesis(mid, u) }
  let seed = arg != null && !isNaN(+arg) ? (+arg >>> 0) : 777
  // craft a gen straight from a numeric seed
  const g = P.TreeGen.genesis('seed:' + seed, 'seed:' + seed)
  return g
}
let GEN = genFor(val('seed', '777'))
if (GENUS) GEN.genus = GENUS
if (STYLE) GEN.style = STYLE
if (GENUS) GEN.model = { juniper: { depth: 7, spread: .6, droop: .5, taper: .62, boughs: 3 }, maple: { depth: 6, spread: .82, droop: .2, taper: .66, boughs: 4 }, pine: { depth: 8, spread: .46, droop: .72, taper: .55, boughs: 3 } }[GENUS] || GEN.model

// ---- palette (mirrors Bonsai.qml palette block) --------------------
function hexHSV (hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || '')
  if (!m) return { h: 0.33, s: 0.6, v: 0.8 }
  const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn
  let h = 0
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h = (h / 6 + 1) % 1 }
  return { h, s: mx ? d / mx : 0, v: mx }
}
function hsv (h, s, v) {
  const i = Math.floor(h * 6), f = h * 6 - i
  const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  const r = [v, q, p, p, t, v][i % 6], g = [t, v, v, q, p, p][i % 6], b = [p, p, t, v, v, q][i % 6]
  return { r, g, b }
}
function mixHue (base, target, k) { let d = target - base; if (d > .5) d -= 1; else if (d < -.5) d += 1; return ((base + d * k) % 1 + 1) % 1 }
const ACC = hexHSV(val('accent', '#50f872'))
const grey = ACC.s < 0.14
const ah = grey ? 0.33 : ACC.h
const PAL = {
  frond: hsv(grey ? 0.32 : mixHue(0.30, ah, 0.34), grey ? 0.14 : (LIGHT ? 0.62 : 0.52), LIGHT ? 0.54 : 0.80),
  trunk: hsv(grey ? 0.07 : mixHue(0.075, ah, 0.14), grey ? 0.08 : 0.36, LIGHT ? 0.46 : 0.56),
  pot: hsv(grey ? 0.05 : mixHue(0.045, ah, 0.12), grey ? 0.10 : 0.44, LIGHT ? 0.60 : 0.74),
  soil: hsv(grey ? 0.07 : mixHue(0.075, ah, 0.14), grey ? 0.10 : 0.24, LIGHT ? 0.40 : 0.34),
  fruit: hsv(grey ? 0.32 : mixHue(0.30, ah, 0.34), 0.55, LIGHT ? 0.72 : 0.9)
}
const BG = LIGHT ? [232, 233, 228] : [15, 17, 20]

// ---- one frame -----------------------------------------------------
function view (sk, yaw, hour, time) {
  const mz = P.Paint.measureStable(sk, { art: ART })
  return {
    yaw, art: ART, w: mz.w, h: mz.h, originX: mz.originX, originY: mz.originY,
    sun: P.Paint.sunForTime(Math.floor(((hour % 24) + 24) % 24), Math.round((hour % 1 + 1) % 1 * 60)),
    lamp: LAMP, palette: PAL, time
  }
}
function frame (maturity, age, yaw, hour, time) {
  const sk = P.Grow.grow(GEN, { maturity, ageYears: age, thirst: THIRST, health: HEALTH, prune: {}, origin: 'cutting' })
  const V = view(sk, yaw, hour, time)
  const f = P.preview ? null : P.frameAnsi(sk, V, BG)
  const label = `\x1b[2m  ${sk.style} · ${sk.genus} · m${Math.round(maturity * 100)}% · age ${age}y · yaw ${yaw.toFixed(2)} · ${String(Math.floor(hour)).padStart(2, '0')}h · ${V.w}x${V.h}\x1b[0m`
  return P.frameAnsi(sk, V, BG).ansi + label
}

// ---- run ----------------------------------------------------------
function cleanup () { process.stdout.write('\x1b[?25h\x1b[0m\n') }
process.on('SIGINT', () => { cleanup(); process.exit(0) })
process.on('exit', cleanup)

if (MODE === 'gallery') {
  const cols = Math.max(1, Math.floor((process.stdout.columns || 160) / 34))
  let out = '\n'
  const seeds = []
  for (let i = 0; i < GALLERY; i++) seeds.push((Math.random() * 0xffffffff) >>> 0)
  for (let i = 0; i < GALLERY; i += cols) {
    const blocks = []
    for (let j = i; j < Math.min(GALLERY, i + cols); j++) {
      GEN = genFor(String(seeds[j]))
      const sk = P.Grow.grow(GEN, { maturity: MAT0, ageYears: AGE0, thirst: THIRST, health: HEALTH, prune: {}, origin: 'cutting' })
      const V = view(sk, YAW0, HOUR0, undefined)
      blocks.push((P.frameAnsi(sk, V, BG).ansi + `\x1b[2m ${sk.style}/${sk.genus}\x1b[0m`).split('\n'))
    }
    const hh = Math.max(...blocks.map(b => b.length))
    for (let r = 0; r < hh; r++) out += blocks.map(b => (b[r] || '').padEnd(46)).join('  ') + '\n'
    out += '\n'
  }
  process.stdout.write(out); process.exit(0)
}

process.stdout.write('\x1b[2J\x1b[?25l')

if (MODE === 'still') { process.stdout.write('\x1b[H' + frame(MAT0, AGE0, YAW0, HOUR0, flag('anim') ? 0 : undefined) + '\n'); cleanup(); process.exit(0) }

let start = Date.now()
const timer = setInterval(() => {
  const el = (Date.now() - start) / 1000
  const p = el / SECS
  if (p >= 1 && !LOOP) { clearInterval(timer); cleanup(); process.exit(0) }
  const pp = LOOP ? (p % 1) : p
  let mat = MAT0, age = AGE0, yaw = YAW0, hour = HOUR0
  if (MODE === 'life') { mat = clamp(0.02 + pp * 0.98, 0, 1); hour = HOUR0 + el * 2 }
  else if (MODE === 'spin') { yaw = pp * Math.PI * 2 }
  else if (MODE === 'day') { hour = HOUR0 + pp * 24 }
  process.stdout.write('\x1b[H' + frame(mat, age, yaw, hour, el) + '\n')
}, 1000 / FPS)
