#!/usr/bin/env node
// fxlab.js — render the care effects (Fx.js) over the real tree, one variant at
// a time, so water and light can be tuned by looking rather than by guessing.
//
//   node dev/fxlab.js out/ --seed live --set water      # every water variant
//   node dev/fxlab.js out/ --set light --only L2,L3
//
// Per variant: <name>.gif (the effect in motion), <name>-sheet.png (frames
// side by side), <name>-trail.png (every frame stacked — trajectories at a
// glance), and one metrics line: duration, peak rect count (what the panel's
// Rectangle pool has to carry), where the drops ended up.

'use strict'
const cp = require('child_process')
const FS = require('fs')
const P = require('./preview.js')

const argv = process.argv.slice(2)
const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 && i + 1 < argv.length ? argv[i + 1] : d }
const OUT = argv[0] && !argv[0].startsWith('--') ? argv[0] : 'fxlab'
const SEED = val('seed', 'live')
const SET = val('set', 'water')
const ONLY = val('only', null)
const SCALE = +val('scale', 3)
const YAW = +val('yaw', 0.35)
const MAT = +val('maturity', 1)
const AGE = +val('age', 0.06)
const AT = (val('at', '') || '').split(',').filter(Boolean).map(Number)
FS.mkdirSync(OUT, { recursive: true })

// ---- the tree: background frame + the scene Paint exports ----------------
const bgPng = `${OUT}/_bg.png`
cp.execFileSync('node', [__dirname + '/shot.js', bgPng, '--seed', SEED, '--maturity', String(MAT), '--age', String(AGE), '--yaw', String(YAW), '--scale', '1'], { stdio: ['ignore', 'ignore', 'pipe'] })
const dims = cp.execFileSync('magick', ['identify', '-format', '%w %h', bgPng]).toString().split(' ').map(Number)
const [BW, BH] = dims
const BG = cp.execFileSync('magick', [bgPng, '-depth', '8', 'rgb:-'], { maxBuffer: 1 << 28 })

// the scene has to come from the same view shot.js used
function genFor (arg) {
  const os = require('os')
  if (arg === 'live' || arg === 'me') {
    const mid = FS.readFileSync('/etc/machine-id', 'utf8').trim()
    const host = cp.execSync('hostname').toString().trim()
    let g = P.TreeGen.genesis(mid, process.env.USER + '@' + host)
    if (arg === 'live') {
      let lin = []
      try { lin = JSON.parse(FS.readFileSync(os.homedir() + '/.local/state/omarchy/omatree-state.json', 'utf8')).graftLineage || [] } catch (e) {}
      for (const gr of lin.slice(0, 3)) { const d = P.TreeGen.importGraft(gr); if (d) g = P.TreeGen.fuse(g, d, undefined) }
    }
    return g
  }
  const s = (+arg >>> 0)
  return P.TreeGen.genesis('seed:' + s, 'seed:' + s)
}
const sk = P.Grow.grow(genFor(SEED), { maturity: MAT, ageYears: AGE, thirst: 0, health: 1, prune: {}, origin: 'cutting' })
const ART = 2.4, PITCH = 0.26
const mz = P.Paint.measureStable(sk, { art: ART, yaw: YAW, pitch: PITCH })
const grey = { r: 0.5, g: 0.5, b: 0.5 }   // geometry only: any palette builds the same scene
const V = { yaw: YAW, pitch: PITCH, art: ART, w: mz.w, h: mz.h, originX: mz.originX, originY: mz.originY, sun: P.Paint.sunForTime(13, 0),
  palette: { frond: grey, trunk: grey, pot: grey, soil: grey, fruit: grey, berry: grey } }
const scene = P.Paint.build(sk, V).scene
if (scene.w !== BW || scene.h !== BH) console.error(`warning: scene ${scene.w}x${scene.h} vs bg ${BW}x${BH}`)

// dark-theme tones, as Omatree.qml maps them
const TONE = {
  water: [143, 199, 255], waterHi: [232, 246, 255], splash: [168, 216, 255],
  wet: [0, 0, 0], glint: [255, 243, 201], gold: [255, 217, 138], star: [255, 255, 255]
}

function mulberry (a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296 } }

// ---- the effect as it plays today, for the baseline ------------------------
// Omatree.qml's dropPool / motePool, transcribed: InQuad tweens to a fixed
// fraction of the frame, a ring, and three even winks.
function legacyWater (rng) {
  const H = BH, W = BW, s = 0.5 / 1   // screen px -> art px at artScale 2
  const drops = []
  for (let i = 0; i < 22; i++) {
    const x = W * (0.24 + 0.52 * rng()), edge = Math.abs(x / W - 0.5) * 2
    drops.push({ x, y0: (-10 - rng() * 34) * s, y1: H * 0.74 + edge * H * 0.04, t0: (i * 42 + rng() * 55) / 1000, dur: (500 + rng() * 280) / 1000 })
  }
  return {
    t: 0,
    alive () { return this.t < 2.2 },
    step (dt) { this.t += dt },
    prims () {
      const out = []
      for (const d of drops) {
        const u = (this.t - d.t0) / d.dur
        if (u < 0) continue
        if (u < 1) {
          const y = d.y0 + (d.y1 - d.y0) * u * u
          out.push({ x: Math.floor(d.x), y: Math.floor(y), w: 1, h: 4, c: 'water', a: 0.9 * Math.min(1, u * 5) })
        } else {
          const k = (this.t - d.t0 - d.dur) / 0.38
          if (k < 1) {
            const sc = 0.4 + 1.3 * (1 - (1 - k) * (1 - k)), rw = 5.5 * sc, rh = 2 * sc
            out.push({ x: Math.floor(d.x - rw / 2), y: Math.floor(d.y1 + 2 - rh / 2), w: Math.max(1, Math.round(rw)), h: 1, c: 'splash', a: 0.85 * (1 - k) })
          }
        }
      }
      return out
    }
  }
}
function legacyLight (rng) {
  const motes = []
  for (let i = 0; i < 12 && scene.clumps.length; i++) {
    const c = scene.clumps[Math.floor(rng() * scene.clumps.length)]
    motes.push({ x: c.cx - c.rx + rng() * c.rx * 2, y: c.cy - c.ry + rng() * c.ry * 2, t0: rng() * 1.8, sz: 1 })
  }
  return {
    t: 0,
    alive () { return this.t < 3.1 },
    step (dt) { this.t += dt },
    prims () {
      const out = []
      for (const m of motes) {
        const u = this.t - m.t0
        if (u < 0 || u > 0.92) continue
        let a
        if (u < 0.11) a = u / 0.11
        else if (u < 0.74) { const w = ((u - 0.11) / 0.21) % 1; a = w < 0.5 ? 1 - 1.68 * w : 0.16 + 1.68 * (w - 0.5) }
        else a = 1 - (u - 0.74) / 0.18
        out.push({ x: Math.floor(m.x), y: Math.floor(m.y), w: m.sz, h: m.sz, c: 'glint', a: Math.max(0, a) })
      }
      return out
    }
  }
}

function fxSim (opts, kind) {
  return (rng) => {
    const sim = P.Fx.create(scene, { rng, water: opts.water, light: opts.light })
    if (kind === 'water') P.Fx.water(sim)
    else P.Fx.light(sim, opts.ambient === true)
    return {
      sim,
      alive () { return P.Fx.alive(sim) },
      step (dt) { P.Fx.step(sim, dt) },
      prims () { return P.Fx.prims(sim) }
    }
  }
}

const VARIANTS = {
  water: {
    W0: { note: 'today: tweens to a fixed row', make: legacyWater },
    W1: { note: 'shower, gravity + drag only', make: fxSim({ water: { catch: 0, splash: false, ring: false, wet: false } }, 'water') },
    W2: { note: 'shower + soil impact (ring, crown, wet)', make: fxSim({ water: { catch: 0 } }, 'water') },
    W3: { note: 'shower full (default): catch/drip + depth', make: fxSim({ water: {} }, 'water') },
    W5: { note: 'shower full, faster (g 7.5)', make: fxSim({ water: { g: 7.5, vT: 2.5 } }, 'water') },
    W6: { note: 'shower full, slow', make: fxSim({ water: { g: 3, vT: 1.1 } }, 'water') },
    W7: { note: 'shower full, heavy pour (72)', make: fxSim({ water: { count: 72, span: 1.15 } }, 'water') }
  },
  light: {
    L0: { note: 'today: 12 motes, three even winks', make: legacyLight },
    L1: { note: 'sparks only, new twinkle', make: fxSim({ light: { flakes: 0 } }, 'light') },
    L2: { note: 'sparks + falling glitter', make: fxSim({}, 'light') },
    L3: { note: 'denser glitter (44)', make: fxSim({ light: { flakes: 44, flakeSpan: 2.8 } }, 'light') },
    L4: { note: 'glitter slower drift (0.12-0.2)', make: fxSim({ light: { fallV: [0.12, 0.2] } }, 'light') },
    L5: { note: 'ambient (idle) version', make: fxSim({ ambient: true }, 'light') }
  }
}

// ---- render ------------------------------------------------------------------
function composite (prims, base) {
  const f = Buffer.from(base)
  for (const p of prims) {
    const col = TONE[p.c] || TONE.glint, a = Math.max(0, Math.min(1, p.a))
    for (let y = p.y; y < p.y + p.h; y++) {
      if (y < 0 || y >= BH) continue
      for (let x = p.x; x < p.x + p.w; x++) {
        if (x < 0 || x >= BW) continue
        const i = (y * BW + x) * 3
        f[i] = f[i] * (1 - a) + col[0] * a; f[i + 1] = f[i + 1] * (1 - a) + col[1] * a; f[i + 2] = f[i + 2] * (1 - a) + col[2] * a
      }
    }
  }
  return f
}
function writePng (rgb, w, h, out, scale) {
  cp.execFileSync('magick', ['-size', `${w}x${h}`, '-depth', '8', 'rgb:-', '-filter', 'point', '-resize', `${scale * 100}%`, out], { input: rgb })
}

const list = VARIANTS[SET]
const FPS = 60, CAP = 2          // simulate at 60, keep every 2nd frame (30 fps GIF)
for (const name of Object.keys(list)) {
  if (ONLY && !ONLY.split(',').includes(name)) continue
  const v = list[name]
  const eff = v.make(mulberry(1234))
  const frames = []
  let t = 0, peak = 0, peakParts = 0, visSum = 0, visN = 0
  const trail = Buffer.from(BG)
  const atFrames = []
  while ((eff.alive() || t < 0.1) && t < 7) {
    eff.step(1 / FPS); t += 1 / FPS
    const pr = eff.prims()
    peak = Math.max(peak, pr.length)
    if (eff.sim) peakParts = Math.max(peakParts, eff.sim.parts.length)
    if (SET === 'water' && t > 0.2 && t < 1.2) { visSum += eff.sim ? P.Fx.visibleDrops(eff.sim) : pr.filter(q => q.c === 'water').length; visN++ }
    // light: distinct lit points (a core pixel over half bright) per frame
    if (SET === 'light' && t < 3) { visSum += pr.filter(q => q.w <= 2 && q.h <= 2 && q.a > 0.5 && q.c !== 'glint' || (q.w === 1 && q.h === 1 && q.a > 0.5)).length; visN++ }
    for (const at of AT) if (Math.abs(t - at) < 0.5 / FPS) atFrames.push(composite(pr, BG))
    if (Math.round(t * FPS) % CAP === 0) {
      const fr = composite(pr, BG)
      frames.push(fr)
      for (let i = 0; i < fr.length; i++) if (fr[i] > trail[i]) trail[i] = fr[i]
    }
  }
  // GIF
  const dir = `${OUT}/_${name}`
  FS.rmSync(dir, { recursive: true, force: true }); FS.mkdirSync(dir)
  frames.forEach((fr, i) => FS.writeFileSync(`${dir}/${String(i).padStart(4, '0')}.rgb`, fr))
  const hold = Array(12).fill(`${dir}/${String(frames.length - 1).padStart(4, '0')}.rgb`)
  cp.execFileSync('magick', ['-size', `${BW}x${BH}`, '-depth', '8', '-delay', String(100 / (FPS / CAP)),
    ...frames.map((_, i) => `rgb:${dir}/${String(i).padStart(4, '0')}.rgb`), ...hold.map(h => 'rgb:' + h),
    '-filter', 'point', '-resize', `${SCALE * 100}%`, '-loop', '0', `${OUT}/${name}.gif`])
  // contact sheet: 7 frames across the ACTIVE window (the first ~2 s, where
  // the motion is) plus the last frame, so the slow soak-in tail doesn't eat it
  const picks = [], act = Math.min(frames.length - 1, Math.round(+val('window', 1.8) * FPS / CAP))
  for (let k = 0; k < 7; k++) picks.push(frames[Math.round(2 + k * (act - 2) / 6)])
  picks.push(frames[frames.length - 1])
  const sheet = Buffer.alloc(BW * 8 * BH * 3)
  picks.forEach((fr, k) => { for (let y = 0; y < BH; y++) fr.copy(sheet, (y * BW * 8 + k * BW) * 3, y * BW * 3, (y + 1) * BW * 3) })
  writePng(sheet, BW * 8, BH, `${OUT}/${name}-sheet.png`, 2)
  writePng(trail, BW, BH, `${OUT}/${name}-trail.png`, SCALE)
  if (atFrames.length) {
    // --at 0.3,0.7: those moments side by side at full scale
    const row = Buffer.alloc(BW * atFrames.length * BH * 3)
    atFrames.forEach((fr, k) => { for (let y = 0; y < BH; y++) fr.copy(row, (y * BW * atFrames.length + k * BW) * 3, y * BW * 3, (y + 1) * BW * 3) })
    writePng(row, BW * atFrames.length, BH, `${OUT}/${name}-at.png`, SCALE)
  }
  FS.rmSync(dir, { recursive: true, force: true })
  const st = eff.sim ? eff.sim.stats : null
  console.log(`${name}  ${v.note.padEnd(44)} ${t.toFixed(2)}s  rects ${String(peak).padStart(3)}  parts ${String(peakParts).padStart(3)}` +
    `  ${SET === 'water' ? 'visible' : 'lit'} ${(visSum / Math.max(1, visN)).toFixed(1).padStart(4)}` +
    (st && SET === 'water' ? `  landed ${st.landed} caught ${st.caught} dripped ${st.dripped} lost ${st.lost}` : ''))
}
