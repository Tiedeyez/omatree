#!/usr/bin/env node
// shot.js — render one Omatree frame to a PNG (for design iteration).
//
//   node dev/shot.js out.png --seed me --maturity 0.7 --yaw 0.6 --age 0 --hour 13
//   node dev/shot.js grid.png --gallery 9
//
// Same modules + palette as dev/timelapse.js. Writes a PPM to imagemagick.

'use strict'
const os = require('os'); const cp = require('child_process'); const FS = require('fs')
const P = require('./preview.js')

const argv = process.argv.slice(2)
const OUT = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'omatree.png'
const flag = (n) => argv.includes('--' + n)
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
const num = (n, d) => { const v = +val(n, d); return isNaN(v) ? d : v }
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

const SCALE = num('scale', 5)
const ART = num('art', 2.4)
const MAT = clamp(num('maturity', 1), 0, 1)
const AGE = Math.max(0, num('age', 0))
const CASE = flag('case')
// --desktop mirrors Bonsai.qml's on-wallpaper ornament: the flatter, front-on
// viewpoint, so this harness can see what the desktop widget actually draws
// and not just the in-panel view.
const DESK = flag('desktop')
const YAW = num('yaw', CASE ? 0.12 : DESK ? 0 : 0.5)   // the cased ornament sits near head-on
const PITCH = num('pitch', CASE ? 0.34 : DESK ? 0.12 : 0.26)
const HOUR = clamp(num('hour', 13), 0, 24)
const THIRST = clamp(num('thirst', 0), 0, 1)
const HEALTH = clamp(num('health', 1), 0, 1)
const PRUNE = num('prune', 0) | 0
const LAMP = flag('lamp')
const LIGHT = flag('light')
const GALLERY = num('gallery', 0) | 0
const GENUS = val('genus', null)
const STYLE = val('style', null)
const TIME = flag('anim') ? num('t', 0) : undefined

function fnv1a (s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) } return h >>> 0 }
function identity () {
  let mid = ''; try { mid = FS.readFileSync('/etc/machine-id', 'utf8').trim() } catch (e) {}
  let host = os.hostname(); try { host = cp.execSync('hostname', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || host } catch (e) {}
  return [mid, (process.env.USER || '') + '@' + host]
}
function genFor (arg) {
  if (arg === 'me') { const [m, u] = identity(); return P.TreeGen.genesis(m, u) }
  const s = arg != null && !isNaN(+arg) ? (+arg >>> 0) : 777
  return P.TreeGen.genesis('seed:' + s, 'seed:' + s)
}

// palette (mirror Bonsai.qml)
function hexHSV (hex) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); if (!m) return { h: .33, s: .6, v: .8 }; const r = parseInt(m[1], 16) / 255, g = parseInt(m[2], 16) / 255, b = parseInt(m[3], 16) / 255; const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0; if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h = (h / 6 + 1) % 1 } return { h, s: mx ? d / mx : 0, v: mx } }
function hsv (h, s, v) { const i = Math.floor(h * 6), f = h * 6 - i; const p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s); return { r: [v, q, p, p, t, v][i % 6], g: [t, v, v, q, p, p][i % 6], b: [p, p, t, v, v, q][i % 6] } }
function mixHue (a, b, k) { let d = b - a; if (d > .5) d -= 1; else if (d < -.5) d += 1; return ((a + d * k) % 1 + 1) % 1 }
function hexRGB (hex) { const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex || ''); return m ? { r: parseInt(m[1], 16) / 255, g: parseInt(m[2], 16) / 255, b: parseInt(m[3], 16) / 255 } : { r: .31, g: .97, b: .45 } }
const ACCENT = val('accent', '#50f872')
const ACC = hexHSV(ACCENT)
const ARGB = hexRGB(ACCENT)
const grey = ACC.s < 0.14, ah = grey ? .33 : ACC.h
const PAL = {
  frond: hsv(grey ? .32 : mixHue(.30, ah, .34), grey ? .14 : (LIGHT ? .62 : .52), LIGHT ? .54 : .80),
  trunk: hsv(grey ? .07 : mixHue(.075, ah, .14), grey ? .08 : .36, LIGHT ? .46 : .56),
  // mirrors Bonsai.qml potC: earthen terracotta, only faintly tinted by accent
  pot: { r: 0.71 + 0.10 * ARGB.r, g: 0.46 + 0.10 * ARGB.g, b: 0.33 + 0.10 * ARGB.b },
  soil: hsv(grey ? .07 : mixHue(.075, ah, .14), grey ? .10 : .24, LIGHT ? .40 : .34),
  fruit: hsv(grey ? .32 : mixHue(.30, ah, .34), .55, LIGHT ? .72 : .9)
}
const BG = LIGHT ? [232, 233, 228] : [15, 17, 20]

// --prune N cuts the N largest foliage clumps, so a before/after pair can show
// what a trim actually takes off. The clump ids only exist once the draw list
// has been built, so this grows the tree, reads the ids back off the hit areas,
// then regrows with those clumps pruned — the same round trip the panel makes
// when you cut by hand.
function pruneMapFor (gen, mat, age, yaw, hour) {
  if (PRUNE <= 0) return {}
  const bare = P.Grow.grow(gen, { maturity: mat, ageYears: age, thirst: THIRST, health: HEALTH, prune: {}, origin: 'cutting' })
  const mz = P.Paint.measureStable(bare, { art: ART, showCase: CASE, yaw, pitch: PITCH })
  const V = { yaw, pitch: PITCH, art: ART, w: mz.w, h: mz.h, originX: mz.originX, originY: mz.originY, sun: P.Paint.sunForTime(Math.floor(hour), 0), lamp: LAMP, palette: PAL, showCase: CASE }
  const areas = (P.Paint.build(bare, V).hitAreas || []).slice()
  areas.sort((a, b) => (b.w * b.h) - (a.w * a.h))
  const map = {}
  for (let i = 0; i < Math.min(PRUNE, areas.length); i++) map[areas[i].id] = 1
  return map
}

function renderOne (gen, mat, age, yaw, hour, time) {
  if (GENUS) gen.genus = GENUS
  if (STYLE) gen.style = STYLE
  const prune = pruneMapFor(gen, mat, age, yaw, hour)
  const sk = P.Grow.grow(gen, { maturity: mat, ageYears: age, thirst: THIRST, health: HEALTH, prune: prune, origin: 'cutting' })
  const mz = P.Paint.measureStable(sk, { art: ART, showCase: CASE, yaw, pitch: PITCH })
  const V = { yaw, pitch: PITCH, art: ART, w: mz.w, h: mz.h, originX: mz.originX, originY: mz.originY, sun: P.Paint.sunForTime(Math.floor(hour), Math.round((hour % 1) * 60)), lamp: LAMP, palette: PAL, time, showCase: CASE }
  const dl = P.Paint.build(sk, V)
  const sBuf = P.renderBuffer(dl.staticOps, V.w, V.h, BG)
  const lBuf = P.renderBuffer(dl.leafOps, V.w, V.h, BG)
  let rgb
  if (CASE) {
    // show real per-pixel alpha over a checkerboard, so the glass translucency
    // and the wallpaper-through areas are visible
    rgb = new Uint8ClampedArray(V.w * V.h * 3)
    for (let y = 0; y < V.h; y++) for (let x = 0; x < V.w; x++) {
      const chk = (((x >> 3) + (y >> 3)) & 1) ? 46 : 32
      let r = chk, g = chk, b = chk
      for (const buf of [sBuf, lBuf]) {
        const p = (y * V.w + x) * 4, a = buf[p + 3] / 255
        if (a <= 0) continue
        r = buf[p] * a + r * (1 - a)
        g = buf[p + 1] * a + g * (1 - a)
        b = buf[p + 2] * a + b * (1 - a)
      }
      const di = (y * V.w + x) * 3
      rgb[di] = r; rgb[di + 1] = g; rgb[di + 2] = b
    }
  } else {
    rgb = P.flatten([sBuf, lBuf], V.w, V.h, BG)
  }
  return { rgb, w: V.w, h: V.h, style: sk.style, genus: sk.genus }
}

// compose (grid or single) into one RGB buffer
let W, H, RGB
if (GALLERY > 0) {
  const cells = []
  for (let i = 0; i < GALLERY; i++) {
    const seed = (Math.random() * 0xffffffff) >>> 0
    cells.push(renderOne(genFor(String(seed)), MAT, AGE, YAW, HOUR, TIME))
  }
  const cols = Math.ceil(Math.sqrt(GALLERY))
  const cw = Math.max(...cells.map(c => c.w)) + 6
  const ch = Math.max(...cells.map(c => c.h)) + 6
  const rows = Math.ceil(GALLERY / cols)
  W = cw * cols; H = ch * rows
  RGB = new Uint8ClampedArray(W * H * 3)
  for (let p = 0; p < W * H; p++) { RGB[p * 3] = BG[0]; RGB[p * 3 + 1] = BG[1]; RGB[p * 3 + 2] = BG[2] }
  cells.forEach((c, i) => {
    const ox = (i % cols) * cw + ((cw - c.w) >> 1)
    const oy = Math.floor(i / cols) * ch + (ch - c.h - 3)
    for (let y = 0; y < c.h; y++) for (let x = 0; x < c.w; x++) {
      const di = ((oy + y) * W + ox + x) * 3, si = (y * c.w + x) * 3
      RGB[di] = c.rgb[si]; RGB[di + 1] = c.rgb[si + 1]; RGB[di + 2] = c.rgb[si + 2]
    }
  })
} else {
  const one = renderOne(genFor(val('seed', '777')), MAT, AGE, YAW, HOUR, TIME)
  W = one.w; H = one.h; RGB = one.rgb
  process.stderr.write(`${one.style} · ${one.genus} · ${W}x${H} art-px\n`)
}

// nearest-neighbour upscale + write PPM to imagemagick
const S = SCALE
const up = Buffer.alloc(W * S * H * S * 3)
for (let y = 0; y < H * S; y++) for (let x = 0; x < W * S; x++) {
  const si = ((y / S | 0) * W + (x / S | 0)) * 3
  const di = (y * W * S + x) * 3
  up[di] = RGB[si]; up[di + 1] = RGB[si + 1]; up[di + 2] = RGB[si + 2]
}
const ppm = Buffer.concat([Buffer.from(`P6\n${W * S} ${H * S}\n255\n`), up])
const r = cp.spawnSync('magick', ['ppm:-', OUT], { input: ppm })
if (r.status !== 0) { process.stderr.write((r.stderr || '').toString() + '\nfallback: writing ' + OUT + '.ppm\n'); FS.writeFileSync(OUT + '.ppm', ppm) }
else process.stderr.write('wrote ' + OUT + '\n')
