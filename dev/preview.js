// preview.js — software rasteriser for the Paint.js draw list.
//
// The shell renders the draw list onto a QML Canvas; this renders the SAME list
// into an RGB buffer and prints it with `▀` half-blocks so the tree can be
// tuned end-to-end in a terminal without restarting the shell. Both consume
// Paint.polyPixel / Paint.blobPixel, so the preview can't drift from the panel.

'use strict'
const fs = require('path')
const path = require('path')
const FS = require('fs')

function loadLib (rel, exportList) {
  const src = FS.readFileSync(path.join(__dirname, '..', rel), 'utf8')
    .replace(/^\s*\.pragma\b.*$/m, '')
  const m = { exports: {} }
  // `lastZ` is a live depth channel the shaders write to, so it has to be read
  // through a getter — a plain export would freeze it at load time and the
  // preview's z-buffer would silently do nothing.
  new Function('module', 'exports', src + `\nmodule.exports={${exportList}};`
    + `\ntry{Object.defineProperty(module.exports,'lastZ',{get:function(){return lastZ}})}catch(e){}`)(m, m.exports)
  return m.exports
}

const TreeGen = loadLib('TreeGen.js', 'genesis,STYLES,GENUS_NAMES')
const Grow = loadLib('Grow.js', 'grow')
const Paint = loadLib('Paint.js',
  'build,measure,measureStable,polyPixel,blobPixel,moundPixel,strokePixel,bboxOf,grainGlyph,sunForTime,lampDir')

function shaderFor (op) {
  return op.op === 'blob' ? Paint.blobPixel
    : op.op === 'mound' ? Paint.moundPixel
      : op.op === 'stroke' ? Paint.strokePixel
        : Paint.polyPixel
}

// ---- rasterise ---------------------------------------------------------
function renderBuffer (ops, w, h, bg) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0)
  const buf = new Uint8ClampedArray(w * h * 4)      // rgba, a=0 transparent
  const zbuf = new Float64Array(w * h).fill(-Infinity)
  for (const op of ops) {
    const bb = Paint.bboxOf(op)
    const x0 = Math.max(0, bb[0]), y0 = Math.max(0, bb[1])
    const x1 = Math.min(w - 1, bb[2]), y1 = Math.min(h - 1, bb[3])
    const shade = shaderFor(op)
    const tested = op.depth === 1
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const c = shade(op, x, y)
        if (!c) continue
        const a = c.length > 3 ? (c[3] | 0) : 255
        if (a <= 0) continue
        const pi = y * w + x
        if (tested) {
          const z = Paint.lastZ
          if (z < zbuf[pi]) continue
          zbuf[pi] = z
        } else {
          zbuf[pi] = -Infinity
        }
        const i = pi * 4
        if (a >= 255) {
          buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255
        } else {
          const da = buf[i + 3] / 255, sa = a / 255
          const na = sa + da * (1 - sa)
          buf[i] = na ? (c[0] * sa + buf[i] * da * (1 - sa)) / na : 0
          buf[i + 1] = na ? (c[1] * sa + buf[i + 1] * da * (1 - sa)) / na : 0
          buf[i + 2] = na ? (c[2] * sa + buf[i + 2] * da * (1 - sa)) / na : 0
          buf[i + 3] = na * 255
        }
      }
    }
  }
  return buf
}

// composite a list of buffers (back to front) over bg
function flatten (buffers, w, h, bg) {
  const out = new Uint8ClampedArray(w * h * 3)
  for (let p = 0; p < w * h; p++) {
    let r = bg[0], g = bg[1], b = bg[2]
    for (const buf of buffers) {
      const a = buf[p * 4 + 3]
      if (a) { r = buf[p * 4]; g = buf[p * 4 + 1]; b = buf[p * 4 + 2] }
    }
    out[p * 3] = r; out[p * 3 + 1] = g; out[p * 3 + 2] = b
  }
  return out
}

// RGB buffer -> ANSI string using ▀ (fg = top row, bg = bottom row)
function toAnsi (rgb, w, h) {
  let out = ''
  for (let y = 0; y < h; y += 2) {
    let line = ''
    let cf = '', cb = ''
    for (let x = 0; x < w; x++) {
      const t = (y * w + x) * 3
      const bi = ((y + 1 < h ? y + 1 : y) * w + x) * 3
      const f = `${rgb[t]};${rgb[t + 1]};${rgb[t + 2]}`
      const bk = `${rgb[bi]};${rgb[bi + 1]};${rgb[bi + 2]}`
      if (f !== cf || bk !== cb) { line += `\x1b[38;2;${f}m\x1b[48;2;${bk}m`; cf = f; cb = bk }
      line += '▀'
    }
    out += line + '\x1b[0m\n'
  }
  return out
}

// full pipeline: skeleton + view -> ANSI string
function frameAnsi (sk, V, bg) {
  const dl = Paint.build(sk, V)
  const sBuf = renderBuffer(dl.staticOps, V.w, V.h, bg)
  const lBuf = renderBuffer(dl.leafOps, V.w, V.h, bg)
  const rgb = flatten([sBuf, lBuf], V.w, V.h, bg)
  return { ansi: toAnsi(rgb, V.w, V.h), hitAreas: dl.hitAreas, w: V.w, h: V.h }
}

module.exports = {
  TreeGen, Grow, Paint,
  renderBuffer, flatten, toAnsi, frameAnsi, loadLib
}
