// Paint.js — turn a Grow.js skeleton into a pixel-art picture.
//
// This module is backend-agnostic: `build()` returns a flat draw list in
// ART-PIXEL space (painter's order), and `polyPixel()` / `blobPixel()` are the
// per-pixel shaders. A backend just walks the ops and, for each art-pixel in an
// op's bounding box, asks the shader for a colour. The QML Canvas renderer and
// the node terminal preview share this exact code, so they can never drift.
//
// Two lists come back:
//   staticOps — pot, soil, trunk, thick branches. Repaint rarely.
//   leafOps   — twigs + foliage clumps. Repaint on the wobble timer; the trunk
//               is never in here, so it stays dead still.
// plus hitAreas — screen boxes of prunable clumps, for click-to-trim.

.pragma library

var PI = Math.PI
var TAU = PI * 2

// ---- the depth channel ----------------------------------------------------
// The draw list is painted back-to-front, which is fine for things that stack
// (foliage masses, the faces of the pot) and wrong for things that INTERSECT.
// A root crossing another root, a branch passing through the trunk, moss
// growing around a root: those share the same volume, and no ordering of whole
// ops can resolve them — one of them always paints flat over the other and the
// tree stops reading as a single solid object.
//
// So ops that make up the wood-and-soil body carry `depth: 1`. Their shaders
// leave the depth of the surface they just shaded in `lastZ`, and the
// rasteriser keeps a z-buffer for them, resolving the overlap per pixel. Ops
// without the flag paint exactly as before, so the sprite look — the stacked
// clump masses, the flat pot faces, the silhouette rims — is untouched.
// Larger z is NEARER the viewer (project() puts +z toward the camera).
var lastZ = 0

var GROUND_BIAS  = 2.2       // soil yields to wood resting on it (z-fight guard)
var DEPTH_BULGE  = 0.5       // how much of a limb's radius counts toward its depth
var PITCH        = 0.26      // fixed downward view tilt (radians) — look slightly
                            // DOWN at the plant, so the pot rim + soil read as
                            // surfaces, not edge-on slivers
var FOCAL        = 380       // art units — near-ortho, a little parallax for solidity
var SPLIT_LEVEL  = 1         // branch level <= this goes in the static layer
var WOBBLE_AMP   = 1.6       // art-px of foliage sway
var WOBBLE_RATE  = 0.9
var TEXTURE      = 0.10      // strength of the monospace char-grain
var OUTLINE      = 0.46      // how dark the silhouette rim goes
var GRAIN_CH     = ["·", ":", "+", "×", "#"]

function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }
function lerp(a, b, t) { return a + (b - a) * t }

// value noise, salted per tree — the leaf dapple / bark knot / gravel texture
function noise(x, y, salt) {
  var h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + (salt | 0)) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296
}

// ---- projection --------------------------------------------------------
// V: { yaw, art, w, h, originX, originY }  (originX/Y = art-px of the model origin)
function project(p, V) {
  var cy = Math.cos(V.yaw), sy = Math.sin(V.yaw)
  var x = p[0] * cy + p[2] * sy
  var z = -p[0] * sy + p[2] * cy
  var pitch = V.pitch !== undefined ? V.pitch : PITCH
  var cp = Math.cos(pitch), spp = Math.sin(pitch)
  var y = p[1] * cp - z * spp
  var zz = p[1] * spp + z * cp
  var s = FOCAL / (FOCAL - zz)
  return {
    x: V.originX + x * s * V.art,
    y: V.originY - y * s * V.art,
    z: zz,
    s: s
  }
}

// measure the projected footprint so the host can size the tree box
function measure(sk, V0) {
  var V = { yaw: V0.yaw || 0, art: V0.art || 3, originX: 0, originY: 0 }
  var minX = 1e9, maxX = -1e9, minY = 1e9, maxY = -1e9
  function acc(p, pad) {
    var q = project(p, V)
    if (q.x - pad < minX) minX = q.x - pad
    if (q.x + pad > maxX) maxX = q.x + pad
    if (q.y - pad < minY) minY = q.y - pad
    if (q.y + pad > maxY) maxY = q.y + pad
  }
  for (var i = 0; i < sk.nodes.length; i++) {
    acc(sk.nodes[i].a, sk.nodes[i].ra * V.art)
    acc(sk.nodes[i].b, sk.nodes[i].rb * V.art)
  }
  for (var j = 0; j < sk.clumps.length; j++)
    acc(sk.clumps[j].c, (sk.clumps[j].r + 1) * V.art)
  // include the pot footprint — SAUCER_DROP down, since the dish sits below
  // the pot's own floor and would otherwise be cropped off the bottom edge
  var potR = potRadius(sk)
  acc([potCX(sk) - potR, potBottomY(sk) - SAUCER_DROP, potCZ(sk) - potR], V.art)
  acc([potCX(sk) + potR, 0, potCZ(sk) + potR], V.art)
  if (minX > maxX) { minX = -20; maxX = 20; minY = -40; maxY = 4 }
  return {
    w: Math.ceil(maxX - minX), h: Math.ceil(maxY - minY),
    originX: -minX, originY: -minY        // where to put the model origin inside w×h
  }
}

// measure a footprint that never clips at ANY turntable yaw: size from the
// bounding cylinder (max horizontal reach in x OR z), so the box is stable while
// the tree spins inside it.
function measureStable(sk, V0) {
  var art = (V0 && V0.art) || 3
  var pitch = V0 && V0.pitch !== undefined ? V0.pitch : PITCH

  // Case on: this is the still desktop ornament at a fixed yaw — measure the
  // exact projected footprint of the 8 case corners (they bound everything).
  if (V0 && V0.showCase) {
    var Vp = { yaw: V0.yaw || 0, pitch: pitch, art: art, originX: 0, originY: 0 }
    var cc = caseCorners(sk)
    var mnx = 1e9, mxx = -1e9, mny = 1e9, mxy = -1e9
    for (var k = 0; k < cc.length; k++) {
      var q = project(cc[k], Vp)
      if (q.x < mnx) mnx = q.x
      if (q.x > mxx) mxx = q.x
      if (q.y < mny) mny = q.y
      if (q.y > mxy) mxy = q.y
    }
    var pad = 4
    return {
      w: Math.ceil(mxx - mnx) + pad * 2,
      h: Math.ceil(mxy - mny) + pad * 2,
      originX: -mnx + pad,
      originY: -mny + pad
    }
  }

  var bx = Math.max(Math.abs(sk.bounds.min[0]), Math.abs(sk.bounds.max[0]))
  var bz = Math.max(Math.abs(sk.bounds.min[2]), Math.abs(sk.bounds.max[2]))
  var reach = Math.max(bx, bz)
  // The skeleton's bounds are the wood only. Foliage stands proud of the twig
  // it grows on, a pine pad is wider than it is round, and a weeping clump
  // trails strands well below itself, so the cylinder has to hold all of that
  // too or a clump at the edge of the crown is cut off at some turns.
  var wideK = sk.leaf === "needle" ? 1.40 : 1.20
  var hang = sk.weeping ? 3.0 : 1.0
  var clumpLow = 1e9
  for (var ci = 0; ci < sk.clumps.length; ci++) {
    var cc0 = sk.clumps[ci], cr0 = cc0.r * wideK + WOBBLE_AMP / art + 1
    reach = Math.max(reach, Math.sqrt(cc0.c[0] * cc0.c[0] + cc0.c[2] * cc0.c[2]) + cr0)
    clumpLow = Math.min(clumpLow, cc0.c[1] - cc0.r * hang)
  }
  var potR = potRadius(sk)
  // the pot no longer sits on the trunk axis, so its own offset counts toward reach
  reach = Math.max(reach, Math.max(Math.abs(potCX(sk)), Math.abs(potCZ(sk))) + potR * 1.42) + 3
  // vertical extent: project the y-range at pitch (yaw doesn't matter for a
  // near-vertical model), pad for clump radius
  var padTop = 0, padBot = 0
  for (var i = 0; i < sk.clumps.length; i++) {
    var c = sk.clumps[i]
    if (c.c[1] + c.r > sk.bounds.max[1] + padTop) padTop = c.c[1] + c.r - sk.bounds.max[1]
  }
  var cp = Math.cos(pitch)
  var topY = (sk.bounds.max[1] + padTop) * cp
  var botY = Math.min(sk.bounds.min[1], clumpLow, potBottomY(sk) - SAUCER_DROP) * cp
  // a little perspective: the near side of the cylinder projects slightly larger
  var persp = FOCAL / (FOCAL - reach)
  var half = reach * art * persp
  // Nudge the trunk off-centre toward the lighter side so a leaning canopy
  // still sits balanced over the pot. The frame grows by the nudge rather than
  // the nudge eating into the cylinder: a nudged frame of the old width cut the
  // crown off on the far side whenever the tree turned that way.
  var cxModel = (sk.bounds.min[0] + sk.bounds.max[0]) / 2
  var shift = clamp(0.45 * cxModel * art, -half * 0.5, half * 0.5)
  var w = Math.ceil(2 * (half + Math.abs(shift))) + 4
  var h = Math.ceil((topY - botY) * art * persp) + 6
  var originX = w / 2 - shift
  return { w: w, h: h, originX: originX, originY: 3 + topY * art * persp }
}

// Where the box sits, in x/z. Grow slides it under the crown for leaning and
// windswept trees the way a tree is actually potted off-centre; everything
// that belongs to the pot rather than to the tree has to move with it.
function potCX(sk) { return sk.potCX || 0 }
function potCZ(sk) { return sk.potCZ || 0 }

function potRadius(sk) {
  // Grow owns the rim (it clamps the surface roots to it); this is only a
  // fallback for skeletons built before `potR` existed.
  if (sk.potR > 0) return sk.potR
  var narrow = sk.style === "cascade" || sk.style === "literati"
  return (narrow ? 6.4 : 10.2) * (0.72 + 0.28 * sk.maturity) * Math.pow(sk.ageScalar, 0.32)
}
// The four walls of a box built from an 8-corner ring (top 0..3, floor 4..7),
// each with its outward normal. Shared by the pot and its saucer.
var BOX_SIDES = [
  { i: [0, 1, 5, 4], n: [0, 0, -1] }, { i: [1, 2, 6, 5], n: [1, 0, 0] },
  { i: [2, 3, 7, 6], n: [0, 0, 1] }, { i: [3, 0, 4, 7], n: [-1, 0, 0] }
]
function sideDefsFor(f) { return BOX_SIDES[f] }

// how far the saucer's floor hangs below the pot's own bottom
var SAUCER_DROP = 2.2

function potBottomY(sk) {
  // Grow owns the box's proportions now — depth follows the rim, so the two can
  // never disagree about the shape of the pot. The old fixed depth is kept as a
  // fallback for skeletons built before `potDepth` existed.
  if (sk.potDepth > 0) return -sk.potDepth - 2
  var deep = sk.style === "cascade"
  return -((deep ? 18 : 12.5) + 2 * sk.maturity) * Math.pow(sk.ageScalar, 0.28) - 2
}

// ---- glass case (the desktop "vitrine") --------------------------------
// A rectangular display case around the whole planting, drawn as a thin
// wireframe: 12 edges, accent-cool hairlines, the top ring brightest so it
// reads as a glass lid. Purely cosmetic — for the on-desktop ornament, where
// the case top doubles as the ledge the Omagotchi pet walks (that ledge is
// really the host window's top edge; this just makes it look intentional).
var CASE_MARGIN = 1.05        // case half-size vs the tree's reach
var CASE_HEADROOM = 1.5       // art units of air above the canopy
var CASE_UNDER = 0.5          // art units below the pot foot
var CASE_BRACKET = 0.26       // fraction of a vertical post that gets drawn
                              // (top + bottom corner brackets, open middle)

// The case is a square-plan box that CONTAINS the whole planting, centred on the
// foliage centroid (not the trunk foot) so a slant / windswept canopy still sits
// inside it instead of spilling out one wall.
function caseBox(sk) {
  var n = sk.clumps.length
  var cx = 0, cz = 0
  for (var i = 0; i < n; i++) { cx += sk.clumps[i].c[0]; cz += sk.clumps[i].c[2] }
  if (n) { cx /= n; cz /= n } else { cx = 0; cz = 0 }
  // pull the centre back toward the trunk a little — a fully centroid-centred
  // case can look like it's sliding off the pot
  cx *= 0.6; cz *= 0.6
  var R = potRadius(sk) * 1.3
  for (var j = 0; j < n; j++) {
    var c = sk.clumps[j]
    var d = Math.max(Math.abs(c.c[0] - cx), Math.abs(c.c[2] - cz)) + c.r
    if (d > R) R = d
  }
  R = R * CASE_MARGIN + 2
  return { cx: cx, cz: cz, R: R, TY: caseTopY(sk), FY: caseFloorY(sk) }
}
// the 8 case corners in model space (top ring 0..3, floor ring 4..7)
function caseCorners(sk) {
  var B = caseBox(sk)
  var x0 = B.cx - B.R, x1 = B.cx + B.R, z0 = B.cz - B.R, z1 = B.cz + B.R
  return [
    [x0, B.TY, z0], [x1, B.TY, z0], [x1, B.TY, z1], [x0, B.TY, z1],
    [x0, B.FY, z0], [x1, B.FY, z0], [x1, B.FY, z1], [x0, B.FY, z1]
  ]
}
function caseTopY(sk) {
  // 90th-percentile clump top, so one leggy shoot doesn't push the lid up
  var ys = []
  for (var i = 0; i < sk.clumps.length; i++) ys.push(sk.clumps[i].c[1] + sk.clumps[i].r)
  ys.sort(function (a, b) { return a - b })
  var top = ys.length ? ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.9))]
                      : sk.bounds.max[1]
  return Math.max(top, sk.trunkTop ? sk.trunkTop[1] : top) + CASE_HEADROOM
}
function caseFloorY(sk) {
  return Math.min(sk.bounds.min[1], potBottomY(sk)) - CASE_UNDER
}

// build the wireframe as `stroke` ops, split into { back, front } by projected
// depth so the caller can composite the far edges behind the tree and the near
// edges (and the lid) in front of it.
function buildCase(sk, V) {
  var pal = V.palette
  var night = !!(V.sun && V.sun.night) && !V.lamp
  var salt = (sk.seed >>> 0) ^ 0x0a5e
  var CN = caseCorners(sk)
  var CP = []
  for (var i = 0; i < 8; i++) CP.push(project(CN[i], V))

  var gf = pal.frond
  function tint(k) {
    var r = clamp(gf.r * 0.42 + 0.54, 0, 1) * k
    var g = clamp(gf.g * 0.42 + 0.62, 0, 1) * k
    var b = clamp(gf.b * 0.42 + 0.72, 0, 1) * k
    if (night) { r *= 0.66; g *= 0.72; b *= 0.9 }
    return [clamp(r, 0, 1) * 255, clamp(g, 0, 1) * 255, clamp(b, 0, 1) * 255]
  }

  // edge list: [a, b, kind]  kind: "lid" | "post" | "floor"
  var E = [
    [0, 1, "lid"], [1, 2, "lid"], [2, 3, "lid"], [3, 0, "lid"],
    [0, 4, "post"], [1, 5, "post"], [2, 6, "post"], [3, 7, "post"],
    [4, 5, "floor"], [5, 6, "floor"], [6, 7, "floor"], [7, 4, "floor"]
  ]
  var back = [], front = []
  function emit(ax, ay, az, bx, by, bz, rad, bright, isFront, alpha) {
    var op = {
      op: "stroke", mat: "glass",
      pts: [[ax, ay, rad, az], [bx, by, rad, bz]],
      hi: tint(bright), lo: tint(bright * 0.6),
      front: isFront, alpha: alpha || 150, salt: salt, z: (az + bz) / 2
    }
    ;(isFront ? front : back).push(op)
  }
  for (var e = 0; e < E.length; e++) {
    var a = CP[E[e][0]], b = CP[E[e][1]]
    var zc = (a.z + b.z) / 2
    var isFront = zc > 0
    var kind = E[e][2]
    // the lid reads as the glass roof (and the pet's ledge); the floor ring
    // hides behind the pot, so only its near edge earns ink.
    if (kind === "floor" && !isFront) continue
    var unit = V.art / 3 + 0.5
    if (kind === "lid") {
      emit(a.x, a.y, a.z, b.x, b.y, b.z, 0.75 * unit, isFront ? 1.18 : 0.82, true,
           isFront ? 195 : 120)                         // the roof / pet's ledge
    } else if (kind === "floor") {
      emit(a.x, a.y, a.z, b.x, b.y, b.z, 0.5 * unit, isFront ? 0.7 : 0.34, isFront,
           isFront ? 135 : 80)
    } else {
      // vertical post. Near head-on (the shipped ornament) these land on the
      // silhouette edges; at a strong turntable angle a front post would spear
      // the trunk, so past a threshold it becomes top+bottom corner brackets.
      var rad = 0.5 * unit
      var bright = isFront ? 0.8 : 0.34
      var pa = isFront ? 150 : 85
      var midAcross = Math.abs(a.x - b.x) > 6 * unit    // post is raked across screen
      if (isFront && midAcross) {
        var f = CASE_BRACKET
        emit(a.x, a.y, a.z, lerp(a.x, b.x, f), lerp(a.y, b.y, f), lerp(a.z, b.z, f), rad, bright, true, pa)
        emit(lerp(a.x, b.x, 1 - f), lerp(a.y, b.y, 1 - f), lerp(a.z, b.z, 1 - f), b.x, b.y, b.z, rad, bright, true, pa)
      } else {
        emit(a.x, a.y, a.z, b.x, b.y, b.z, rad, bright, isFront, pa)
      }
    }
  }

  // very faint glass sheets: the lid + whichever side wall faces the viewer, so
  // the case reads as glazed, not a bare wireframe. Kept near-invisible (low
  // alpha) so the tree behind stays clean.
  var sheen = tint(1.25)
  function pane(i0, i1, i2, i3, alpha) {
    front.push({
      op: "fillPoly", mat: "glasspane",
      pts: [[CP[i0].x, CP[i0].y], [CP[i1].x, CP[i1].y], [CP[i2].x, CP[i2].y], [CP[i3].x, CP[i3].y]],
      fill: sheen, alpha: alpha, salt: salt,
      z: (CP[i0].z + CP[i1].z + CP[i2].z + CP[i3].z) / 4
    })
  }
  pane(0, 1, 2, 3, 20)                                    // lid
  // the front-facing side wall (largest projected z on its shared edge)
  var walls = [[0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]]
  var bestW = -1, bestZ = -1e9
  for (var w = 0; w < 4; w++) {
    var zc2 = (CP[walls[w][0]].z + CP[walls[w][1]].z + CP[walls[w][2]].z + CP[walls[w][3]].z) / 4
    if (zc2 > bestZ) { bestZ = zc2; bestW = w }
  }
  pane(walls[bestW][0], walls[bestW][1], walls[bestW][2], walls[bestW][3], 16)

  return { back: back, front: front }
}

// ---- palette shading helpers -----------------------------------------
// pal entry {r,g,b} 0..1 -> quantised, lit rgb 0..255
function shade(col, lum, night, gold) {
  lum = clamp(lum, 0.12, 1.25)
  var q = Math.round(lum * 6) / 6                    // ~7 brightness steps
  var r = col.r * q, g = col.g * q, b = col.b * q
  if (gold > 0.4 && !night) { r *= 1.06; g *= 1.0; b *= 0.9 }
  if (night) { r *= 0.72; g *= 0.74; b *= 0.86 }
  return [clamp(r, 0, 1) * 255, clamp(g, 0, 1) * 255, clamp(b, 0, 1) * 255]
}


// ---- what the foliage looks like: genus, graft colour, and the season ------
// Each genus wears its own leaf, not one shared green clump: pine in flat,
// dark, layered pads; juniper in spiky flame-shaped tufts; maple in lobed,
// bright, coarse-leaved masses; zelkova in a fine, smooth dome; willow as tufts
// with strands hanging from them. The base of a graft (the rootstock) decides
// the leaf; a weeping donor still hangs its strands (sk.weeping).
var LEAF_DIMS = { needle: [1.35, 0.60], scale: [0.92, 1.08], fan: [1.18, 0.92],
                  fine: [1.10, 0.86], weeping: [0.85, 0.62] }
// hue shift, saturation and value multipliers, relative to the theme's green
var LEAF_TONE = { needle: [0.035, 1.08, 0.80], scale: [0.045, 0.85, 0.82],
                  fan: [-0.045, 1.02, 1.10], fine: [-0.010, 0.95, 0.98],
                  weeping: [-0.020, 0.95, 1.06] }
// where each deciduous genus ends up at the full autumn turn: [h, s, v]
var AUTUMN = { maple: [0.025, 0.80, 0.86], "crimson-maple": [0.975, 0.78, 0.70],
               zelkova: [0.075, 0.72, 0.80], plum: [0.055, 0.62, 0.78],
               willow: [0.14, 0.62, 0.86] }

var LEAF_CODE = { needle: 1, scale: 2, fan: 3, fine: 4 }
// fix a foliage op's leaf code and edge bound once, at build time
function blobShape(op) {
  op.lk = LEAF_CODE[op.leaf] || 0
  // a small phase for the outline: sin() of the raw salt (a 32-bit seed) takes
  // the slow large-argument path on every single pixel
  op.ph = ((op.salt >>> 0) % 6283) / 1000
  op.emax = 1 + Math.abs(op.wobf[0]) + Math.abs(op.wobf[1]) + Math.abs(op.wobf[2])
    + (op.lk === 2 ? 0.12 : op.lk === 3 ? 0.08 : 0)
  return op
}

function leafKindOf(sk) { return LEAF_DIMS[sk.leaf] ? sk.leaf : (sk.needle ? "needle" : "fan") }
function evergreenLeaf(kind) { return kind === "needle" || kind === "scale" }

// The tree-wide foliage colour and habit for this day of the year. season is
// TreeGen.seasonOf(doy); absent (an old host) means high summer, which is
// exactly what every tree looked like before seasons.
function foliageLook(sk, pal, season) {
  var kind = leafKindOf(sk)
  var base = String(sk.genus || "").split("+")[0]
  var se = season || { turn: 0, cover: 1, fresh: 0, bloom: 0, dormant: 0 }
  var f = _hsv(pal.frond)
  var tone = LEAF_TONE[kind]
  var h = (f.h + tone[0] + 1) % 1, s = clamp(f.s * tone[1], 0, 1), v = clamp(f.v * tone[2], 0, 1)
  // a graft-only genus that breaks the green anchor (crimson maple, zelkova)
  if (sk.hue !== undefined && sk.hue !== null && isFinite(sk.hue)) {
    h = ((sk.hue % 1) + 1) % 1; s = Math.max(s, 0.62)
  }
  var deciduous = !evergreenLeaf(kind)
  var fresh = se.fresh * (deciduous ? 1 : 0.5)
  // spring: soft, light, a little yellow
  h = _mixHue(h, 0.21, 0.40 * fresh); v = clamp(v * (1 + 0.12 * fresh), 0, 1); s *= 1 - 0.12 * fresh
  // winter on an evergreen: juniper bronzes, pine just dulls
  if (!deciduous) {
    if (kind === "scale") { h = _mixHue(h, 0.07, 0.30 * se.dormant); s *= 1 - 0.10 * se.dormant }
    v *= 1 - 0.08 * se.dormant
  }
  var fall = deciduous ? (AUTUMN[base] || AUTUMN.maple) : null
  // winter: a deciduous crown keeps its autumn colour, gone a little dusky
  if (deciduous) { s *= 1 - 0.22 * se.dormant; v *= 1 - 0.10 * se.dormant }
  return {
    kind: kind, deciduous: deciduous,
    h: h, s: s, v: v,
    fall: fall, turn: deciduous ? se.turn : 0,
    cover: deciduous ? se.cover : 1,
    bloom: sk.blossom ? se.bloom : 0,
    dormant: se.dormant,
    snow: se.snow || 0,
    leafOut: se.doy !== undefined && se.doy < 200,
    blossomHsv: sk.blossom && pal.blossom ? _hsv(pal.blossom) : null,
    winter: deciduous ? se.dormant : 0
  }
}

// One clump's share of that: whether it is on the tree today, how full, and
// its own colour (some clumps turn early and some hang on, as on a real tree).
function clumpLeaf(look, c, salt) {
  var n1 = noise(c, 41, salt), n2 = noise(c, 43, salt)
  var show = look.cover >= 0.999 || n2 < look.cover * 1.05
  var h = look.h, s = look.s, v = look.v
  if (look.fall && look.turn > 0) {
    // Autumn turns each clump gradually; spring replaces it outright, clump by
    // clump: new leaves come in green, they do not fade back through orange.
    var t = look.leafOut ? (n1 < look.turn ? 1 : 0) : clamp(look.turn * 1.6 - n1 * 0.6, 0, 1)
    h = _mixHue(h, look.fall[0], t)
    s = lerp(s, look.fall[1] * (1 - 0.22 * look.winter), t)
    v = lerp(v, look.fall[2] * (1 - 0.10 * look.winter), t)
  }
  // in flower: a blooming clump is a cloud of blossom more than it is leaf
  if (look.blossomHsv && look.bloom > 0 && noise(c, 47, salt) < 0.75 * look.bloom) {
    var bk = 0.75 * look.bloom
    h = _mixHue(h, look.blossomHsv.h, bk); s = lerp(s, look.blossomHsv.s, bk); v = lerp(v, look.blossomHsv.v, bk)
  }
  return { show: show, scale: 0.6 + 0.4 * look.cover, col: _fromHsv(h, s, v), n: n1 }
}

// ---------------------------------------------------------------------------
// build the draw lists
// V: { yaw, art, w, h, originX, originY, sun, lamp, palette, time }
function build(sk, V) {
  var pal = V.palette
  var sun = V.sun || { dir: [0.3, 0.9, 0.2], intensity: 1, night: false, goldeness: 0.2 }
  var lamp = !!V.lamp
  var night = !!sun.night && !lamp
  var salt = sk.seed >>> 0

  // light direction in screen space (x right, y DOWN, z toward viewer)
  var L = sun.dir
  var lx = L[0], ly = -L[1], lz = L[2]
  if (lamp) { var LD = lampDir(); lx = LD[0]; ly = LD[1]; lz = LD[2] }
  var ll = Math.sqrt(lx * lx + ly * ly + lz * lz) || 1
  lx /= ll; ly /= ll; lz /= ll
  var ambient = night ? 0.5 : lamp ? 0.62 : 0.34
  var gold = lamp ? 0.1 : (sun.goldeness || 0.2)

  var staticOps = []
  var leafOps = []
  var hitAreas = []

  // ---- pot + soil : a tapered rectangular box that turns with the tree ----
  // pushed AFTER the trunk (see below) so the pot hides the buried trunk foot.
  var potR = potRadius(sk)
  var rt = potR, rb = potR * 0.78
  var pcx = potCX(sk), pcz = potCZ(sk)
  var pTopY = 0.6, pBotY = potBottomY(sk)
  // 8 corners: top 0..3, bottom 4..7 (walking the same +x/+z square), around the
  // pot's own centre rather than the trunk's
  var CN = [
    [pcx - rt, pTopY, pcz - rt], [pcx + rt, pTopY, pcz - rt], [pcx + rt, pTopY, pcz + rt], [pcx - rt, pTopY, pcz + rt],
    [pcx - rb, pBotY, pcz - rb], [pcx + rb, pBotY, pcz - rb], [pcx + rb, pBotY, pcz + rb], [pcx - rb, pBotY, pcz + rb]
  ]
  var CP = []
  for (var ci = 0; ci < 8; ci++) CP.push(project(CN[ci], V))
  var cyaw = Math.cos(V.yaw), syaw = Math.sin(V.yaw)
  // A matte terracotta pot: adjacent faces should differ only gently, or the
  // box reads as separate flats. Keep a bright floor and a small directional
  // swing.
  var potAmb = night ? 0.5 : 0.5
  function faceLum(nx, nz) {
    var rx2 = nx * cyaw + nz * syaw            // normal after the turntable yaw
    var rz2 = -nx * syaw + nz * cyaw
    var toward = clamp(rz2 * 0.5 + 0.5, 0, 1)  // faces the viewer -> lit
    var side = clamp(rx2 * lx * 0.5 + 0.5, 0, 1)
    return potAmb + (1 - potAmb) * (0.62 + 0.23 * toward + 0.15 * side) * (night ? 0.5 : sun.intensity)
  }
  // A shallow saucer gives the pot a physical footprint. It has to be a real
  // (if squat) box like the pot, not a flat quad — a horizontal plate at either
  // pitch sits at the pot's own centre plane, so it lands behind the front wall
  // and disappears. The box is what makes the rim visible from every angle,
  // including the flatter desktop pitch. Glazed cream, so the plate reads as a
  // separate piece of pottery the pot is standing on.
  var sTopR = potR * 0.98, sBotR = potR * 0.90
  var sTopY = pBotY + 0.5, sBotY = pBotY - SAUCER_DROP + 0.5
  var SN = [
    [pcx - sTopR, sTopY, pcz - sTopR], [pcx + sTopR, sTopY, pcz - sTopR], [pcx + sTopR, sTopY, pcz + sTopR], [pcx - sTopR, sTopY, pcz + sTopR],
    [pcx - sBotR, sBotY, pcz - sBotR], [pcx + sBotR, sBotY, pcz - sBotR], [pcx + sBotR, sBotY, pcz + sBotR], [pcx - sBotR, sBotY, pcz + sBotR]
  ]
  var SP = []
  for (var si = 0; si < 8; si++) SP.push(project(SN[si], V))
  var saucerOps = []
  var cream = { r: 0.95, g: 0.92, b: 0.80 }
  for (var sf = 0; sf < 4; sf++) {
    var sdd = sideDefsFor(sf)
    var slm = faceLum(sdd.n[0], sdd.n[2]) * 0.88     // a touch in the pot's shadow
    saucerOps.push({
      op: "roundedPoly", mat: "pot",
      pts: [[SP[sdd.i[0]].x, SP[sdd.i[0]].y], [SP[sdd.i[1]].x, SP[sdd.i[1]].y],
            [SP[sdd.i[2]].x, SP[sdd.i[2]].y], [SP[sdd.i[3]].x, SP[sdd.i[3]].y]],
      fill: shade(cream, slm, night, gold),
      edge: shade(cream, slm * 0.86, night, gold), salt: salt + 17,
      z: (SP[sdd.i[0]].z + SP[sdd.i[1]].z + SP[sdd.i[2]].z + SP[sdd.i[3]].z) / 4
    })
  }
  saucerOps.sort(function (p, q) { return p.z - q.z })
  // the saucer's dish, seen as a ring around the pot foot under this pitch. It
  // rides the same rotating x/z frame as the pot, so the whole platform turns
  // together instead of keeping a fixed world-facing edge.
  var dishLum = faceLum(0, 0) * 0.94
  var dishOp = {
    op: "roundedPoly", mat: "pot",
    pts: [[SP[0].x, SP[0].y], [SP[1].x, SP[1].y], [SP[2].x, SP[2].y], [SP[3].x, SP[3].y]],
    fill: shade(cream, dishLum * 0.9, night, gold),
    edge: shade(cream, dishLum * 0.74, night, gold), salt: salt + 29,
    z: (SP[0].z + SP[1].z + SP[2].z + SP[3].z) / 4
  }
  // Standing water in the dish, but only right after a drink — a permanent
  // puddle would read as neglect, and a dry saucer is what a thirsty tree looks
  // like. Fades out as the soil dries.
  var wet = clamp(1 - (sk.thirst || 0) / 0.42, 0, 1)
  var waterOps = []
  if (wet > 0.02) {
    var wR = sTopR * 0.86, wY = sTopY - 0.12
    var wC = [project([pcx - wR, wY, pcz - wR], V), project([pcx + wR, wY, pcz - wR], V),
              project([pcx + wR, wY, pcz + wR], V), project([pcx - wR, wY, pcz + wR], V)]
    var wetTone = {
      r: pal.pot.r * (1 - 0.55 * wet) + 0.10 * wet,
      g: pal.pot.g * (1 - 0.42 * wet) + 0.16 * wet,
      b: pal.pot.b * (1 - 0.20 * wet) + 0.24 * wet
    }
    waterOps.push({
      op: "roundedPoly", mat: "pot",
      pts: wC.map(function (p) { return [p.x, p.y] }),
      fill: shade(wetTone, dishLum * (0.86 + 0.2 * wet), night, gold),
      edge: shade(wetTone, dishLum * 0.7, night, gold), salt: salt + 83,
      z: (wC[0].z + wC[1].z + wC[2].z + wC[3].z) / 4
    })
  }

  var potSideOps = []
  for (var f = 0; f < 4; f++) {
    var sd = sideDefsFor(f)
    var lm = faceLum(sd.n[0], sd.n[2])
    var faceOp = {
      op: "roundedPoly",
      pts: [[CP[sd.i[0]].x, CP[sd.i[0]].y], [CP[sd.i[1]].x, CP[sd.i[1]].y],
            [CP[sd.i[2]].x, CP[sd.i[2]].y], [CP[sd.i[3]].x, CP[sd.i[3]].y]],
      mat: "pot", fill: shade(pal.pot, lm, night, gold),
      // soft edge — a hard dark rim on every face turns the shared corners into
      // cracks and the box falls apart into separate flats
      edge: shade(pal.pot, lm * 0.86, night, gold), salt: salt,
      z: (CP[sd.i[0]].z + CP[sd.i[1]].z + CP[sd.i[2]].z + CP[sd.i[3]].z) / 4
    }
    // The Omarchy mark belongs on the front-facing wall of the pot so the
    // logo reads clearly in the desktop ornament, not hidden on the rear face.
    if (sd.n[2] === 1) { faceOp.etch = 1; faceOp.lx = lx; faceOp.ly = ly }
    potSideOps.push(faceOp)
  }
  // a bottom cap so a low viewing angle never sees into the open box
  potSideOps.push({
    op: "roundedPoly",
    pts: [[CP[4].x, CP[4].y], [CP[5].x, CP[5].y], [CP[6].x, CP[6].y], [CP[7].x, CP[7].y]],
    mat: "pot", fill: shade(pal.pot, potAmb * 0.82, night, gold),
    edge: shade(pal.pot, potAmb * 0.72, night, gold), salt: salt,
    z: (CP[4].z + CP[5].z + CP[6].z + CP[7].z) / 4 - 100    // always drawn first
  })
  potSideOps.sort(function (p, q) { return p.z - q.z })   // far walls first
  // soil: a rounded mound crowning over the rim, centred on the trunk foot, so
  // the tree grows OUT of the soil instead of stopping at a flat dark line. A
  // near-horizontal disc barely projects any height under this pitch, so the
  // crown lift is carried by cy/ry, not real geometry.
  var soilP = project([pcx, pTopY, pcz], V)
  var moundLift = potR * 0.12 * V.art
  // Thirst is the dryness signal: saturated soil is deep and cool, while dry
  // soil loses moisture and reads lighter and dustier.
  var soilDryness = clamp(sk.thirst || 0, 0, 1)
  // soil reads too dark straight off pal.soil next to the lit pot — lift it
  // toward the pot's warmth so the mound looks like settled potting mix
  var soilBase = {
    r: pal.soil.r * 0.42 + pal.pot.r * 0.58,
    g: pal.soil.g * 0.42 + pal.pot.g * 0.58,
    b: pal.soil.b * 0.42 + pal.pot.b * 0.58
  }
  var pitchNow = V.pitch !== undefined ? V.pitch : PITCH
  var soilMoundOp = {
    op: "mound", mat: "soil", depth: 1,
    cy0: soilP.y, zk: 1 / Math.max(0.02, Math.sin(pitchNow) * V.art),
    cx: soilP.x, cy: soilP.y + moundLift * 0.15,
    // The soil is a rounded, near-circular fill over the whole pot opening.
    // Its projected footprint is wider than the crown so it reaches the
    // terracotta walls without spilling past the rim.
    rx: potR * 1.16 * V.art,
    ry: potR * 0.22 * V.art + moundLift,
    base: soilBase, lx: lx, ly: ly,
    ambient: night ? 0.62 : 0.72, intensity: night ? 0.6 : sun.intensity,
    dryness: soilDryness, night: night, gold: gold, salt: salt,
    snow: V.season && V.season.snow > 0 ? V.season.snow : 0,
    clip: [[CP[0].x, CP[0].y], [CP[1].x, CP[1].y],
           [CP[2].x, CP[2].y], [CP[3].x, CP[3].y]]
  }
  var mossOps = []
  for (var mPatch = 0; mPatch < 9; mPatch++) {
    var mossAng = (mPatch / 9) * TAU + (salt % 7) * 0.31
    if (noise(mPatch, 21, salt) < 0.34) continue        // gaps, or it hoops the rim
    // Out near the rim, never over the nebari: the spread of the roots is the
    // thing worth looking at, and now that the depth pass puts moss properly in
    // FRONT of what it overlaps, a patch sitting mid-mound simply buries them.
    var mossSpread = 0.58 + 0.34 * noise(mPatch, 12, salt)
    var mossDx = pcx + Math.cos(mossAng) * potR * mossSpread
    var mossDz = pcz + Math.sin(mossAng) * potR * mossSpread
    var mossP = project([mossDx, pTopY + 0.15, mossDz], V)
    // Moss is soil that has gone green, not foliage that fell off: keep it
    // resting on the soil, never across the trunk, roots, or above the pot rim.
    // It should feel like a damp living crust on the surface, not a hanging vine.
    var mossBase = {
      r: clamp(soilBase.r * 0.58 + pal.frond.r * 0.42, 0, 1) * 0.86,
      g: clamp(soilBase.g * 0.40 + pal.frond.g * 0.60, 0, 1) * 0.92,
      b: clamp(soilBase.b * 0.62 + pal.frond.b * 0.38, 0, 1) * 0.80
    }
    mossOps.push({
      op: "blob", mat: "moss", depth: 1,
      cy0: soilP.y, zk: 1 / Math.max(0.02, Math.sin(pitchNow) * V.art),
      cx: mossP.x,
      cy: mossP.y + 0.55 + (mPatch % 2) * 0.45,
      rx: (2.2 + (mPatch % 3) * 0.65) * V.art,
      ry: (0.9 + (mPatch % 2) * 0.22) * V.art,
      wobf: [noise(mPatch + 4, 1, salt) - 0.5, noise(mPatch + 7, 3, salt) - 0.5, noise(mPatch + 11, 5, salt) - 0.5],
      base: mossBase,
      night: night, gold: gold, ambient: ambient,
      lx: lx, ly: ly, intensity: night ? 0.45 : sun.intensity,
      salt: salt + 33 + mPatch * 11, seedling: false,
      z: mossP.z
    })
  }

  // ---- branches: group connected segments into continuous limbs -------
  // Each limb is drawn as ONE rounded stroke so joints don't show and the
  // silhouette outline is clean (no stacked-block look).
  var limbs = {}          // key -> { pts:[[x,y,r,z]...], level }
  for (var i = 0; i < sk.nodes.length; i++) {
    var n = sk.nodes[i]
    var key = n.kind === "trunk" ? "trunk" : n.id
    var A = project(n.a, V), B = project(n.b, V)
    var L2 = limbs[key]
    if (!L2) { L2 = limbs[key] = { pts: [], level: n.level, mat: "wood", kind: n.kind } }
    if (L2.pts.length === 0)
      L2.pts.push([A.x, A.y, Math.max(1.1, n.ra * V.art * A.s), A.z])
    L2.pts.push([B.x, B.y, Math.max(0.9, n.rb * V.art * B.s), B.z])
    if (n.level < L2.level) L2.level = n.level
  }
  var limbDraw = []
  for (var lk in limbs) {
    var Lm = limbs[lk]
    var zsum = 0
    for (var pz = 0; pz < Lm.pts.length; pz++) zsum += Lm.pts[pz][3]
    var wbase = ambient + (1 - ambient) * 0.62 * (night ? 0.5 : sun.intensity)
    var op = {
      op: "stroke", pts: Lm.pts, mat: "wood", depth: 1, iart: 1 / V.art,
      fill: shade(pal.trunk, wbase, night, gold),
      lo: shade(pal.trunk, wbase * 0.78, night, gold),
      hi: shade(pal.trunk, wbase * 1.3, night, gold),
      edge: shade(pal.trunk, wbase * 0.62, night, gold),
      lx: lx, ly: ly, salt: salt, z: zsum / Lm.pts.length, kind: Lm.kind
    }
    limbDraw.push({ z: op.z, op: op, level: Lm.level })
  }
  limbDraw.sort(function (p, q) { return p.z - q.z })

  // painter order: trunk + thick branches first (the pot walls then bury the
  // foot), then the walls, then rim + soil mound capping the trunk foot, then
  // the surface roots sitting on the mound. Foliage + twigs go on top (leafOps).
  var rootOps = []
  for (var b = 0; b < limbDraw.length; b++) {
    if (limbDraw[b].op.kind === "root") {
      // Nebari lies a little in the soil's shade — but only a little. It is
      // the same wood as the trunk and, now that the depth pass welds it in
      // rather than stacking it on top, it no longer needs darkening to stop
      // reading as a slab.
      var rop = limbDraw[b].op
      rop.fill = mul(rop.fill, 0.90); rop.lo = mul(rop.lo, 0.84)
      rop.hi = mul(rop.hi, 0.94); rop.edge = mul(rop.edge, 0.80)
      rootOps.push(rop); continue
    }
    if (limbDraw[b].level <= SPLIT_LEVEL) staticOps.push(limbDraw[b].op)
    else leafOps.push(limbDraw[b].op)
  }
  for (var sq = 0; sq < saucerOps.length; sq++) staticOps.push(saucerOps[sq])
  staticOps.push(dishOp)
  for (var wq = 0; wq < waterOps.length; wq++) staticOps.push(waterOps[wq])
  for (var ps = 0; ps < potSideOps.length; ps++) staticOps.push(potSideOps[ps])
  staticOps.push(soilMoundOp)               // caps the walls + the buried trunk foot
  for (var mp = 0; mp < mossOps.length; mp++) staticOps.push(mossOps[mp])
  for (var rr = 0; rr < rootOps.length; rr++) staticOps.push(rootOps[rr])

  // ---- foliage clumps (leaf layer) --------------------------------
  // Berries pick their own clump slots the same deterministic way fruit
  // picks its one — offset far enough from the fruit's index (and each
  // other) that a fruiting tree's berries never land on the same clump.
  var berryCount = Math.max(0, Math.min(2, sk.berries || 0))
  var clumpN = Math.max(1, sk.clumps.length)
  var fruitIdx = (sk.seed >>> 0) % clumpN
  var berryIdx = [((sk.seed >>> 0) + 97) % clumpN, ((sk.seed >>> 0) + 233) % clumpN]
  if (berryIdx[0] === fruitIdx) berryIdx[0] = (berryIdx[0] + 1) % clumpN
  if (berryIdx[1] === fruitIdx || berryIdx[1] === berryIdx[0])
    berryIdx[1] = (berryIdx[1] + 2) % clumpN

  // Today's foliage: the genus's own leaf and tone, any graft colour, and the
  // season (V.season = TreeGen.seasonOf(doy)). A deciduous crown turns, thins
  // and goes bare; a clump that is off the tree for the winter still keeps its
  // hit area, because winter is exactly when a deciduous tree is shaped.
  var look = foliageLook(sk, pal, V.season)
  var dims = LEAF_DIMS[look.kind]
  var shownClumps = []

  var clumpDraw = []
  for (var c = 0; c < sk.clumps.length; c++) {
    var cl = sk.clumps[c]
    var P = project(cl.c, V)
    var wob = V.time !== undefined && !cl.seedling
      ? Math.sin(V.time * WOBBLE_RATE + cl.phase) * WOBBLE_AMP
      : 0
    var rpx0 = cl.r * V.art * P.s
    var lf = cl.seedling ? null : clumpLeaf(look, c, salt)
    var shown = !lf || lf.show
    var rpx = rpx0 * (lf ? lf.scale : 1)
    var fillCol = cl.seedling ? (cl.c[1] < 0 ? pal.trunk : pal.frond) : lf.col
    var wk = look.kind === "fine" ? 0.5 : 1
    var op2 = {
      op: "blob",
      cx: P.x + wob, cy: P.y + wob * 0.4,
      rx: rpx * (cl.seedling ? 1.15 : dims[0]), ry: rpx * (cl.seedling ? 0.92 : dims[1]),
      wobf: [(noise(c, 1, salt) - 0.5) * wk, (noise(c, 2, salt) - 0.5) * wk, (noise(c, 3, salt) - 0.5) * wk],
      leaf: cl.seedling ? "" : look.kind,
      base: fillCol, night: night, gold: gold, ambient: ambient,
      lx: lx, ly: ly, intensity: night ? 0.5 : sun.intensity,
      salt: salt + c * 97, seedling: !!cl.seedling,
      z: P.z
    }
    // Weeping (willow, and any hybrid carrying it): real weeping willow
    // bonsai read as long thin cascading strands trailing from each branch
    // tip, not round clumps at all — a plain high droop value alone (just
    // tilting the whole clump down) still looked like an ordinary tree.
    // These are separate elongated blobs stepping straight down from the
    // clump's own position, shrinking as they fall, with a small per-strand
    // horizontal drift so the curtain doesn't read as a rigid stack.
    if (shown && sk.weeping && !cl.seedling) {
      var strandN = 3
      for (var wi = 1; wi <= strandN; wi++) {
        var shrink = 1 - wi * 0.22
        var strandR = Math.max(1.3, rpx * 0.40 * shrink)
        var driftX = (noise(c, 10 + wi, salt) - 0.5) * rpx * 0.5
        var sx = P.x + wob + driftX
        var sy = P.y + wob * 0.4 + rpx * 0.85 * wi
        clumpDraw.push({ z: P.z + 0.001 * wi, op: {
          op: "blob", cx: sx, cy: sy,
          rx: strandR * 0.6, ry: strandR * 1.6,
          wobf: [noise(c, 20 + wi, salt) - 0.5, noise(c, 21 + wi, salt) - 0.5, noise(c, 22 + wi, salt) - 0.5],
          leaf: "weeping",
          base: fillCol, night: night, gold: gold, ambient: ambient,
          lx: lx, ly: ly, intensity: night ? 0.5 : sun.intensity,
          salt: salt + c * 97 + wi * 13, seedling: false,
          z: P.z + 0.001 * wi
        } })
      }
    }
    // Fruit and berries go through clumpDraw's own z-sort (below), same as
    // every foliage blob — pushing them straight to leafOps here would paint
    // them BEFORE all of clumpDraw's sorted blobs land at the end of this
    // function, so every leaf clump would draw over them unconditionally.
    // They hang on through the winter, on bare wood if need be.
    if (sk.fruit && c === ((sk.seed >>> 0) % Math.max(1, sk.clumps.length))) {
      var fruitZ = P.z + 0.2
      clumpDraw.push({ z: fruitZ, op: {
        op: "blob", mat: "fruit", cx: P.x + rpx0 * 0.58, cy: P.y + rpx0 * 0.32,
        rx: Math.max(2.5, rpx0 * 0.22), ry: Math.max(2.5, rpx0 * 0.22),
        wobf: [0.02, -0.03, 0.01], base: pal.fruit,
        night: night, gold: gold, ambient: ambient, lx: lx, ly: ly,
        intensity: night ? 0.55 : sun.intensity, salt: salt + 201,
        seedling: false, z: fruitZ
      } })
    }
    for (var bi = 0; bi < berryCount; bi++) {
      if (c !== berryIdx[bi]) continue
      var berryZ = P.z + 0.2
      clumpDraw.push({ z: berryZ, op: {
        op: "blob", mat: "berry",
        cx: P.x + rpx0 * (bi === 0 ? -0.55 : 0.15),
        cy: P.y + rpx0 * (bi === 0 ? 0.30 : -0.45),
        rx: Math.max(1.8, rpx0 * 0.15), ry: Math.max(1.8, rpx0 * 0.15),
        wobf: [-0.02, 0.03, -0.01], base: pal.berry,
        night: night, gold: gold, ambient: ambient, lx: lx, ly: ly,
        intensity: night ? 0.55 : sun.intensity, salt: salt + 311 + bi * 7,
        seedling: false, z: berryZ
      } })
    }
    // A flowering genus flowers in early spring, and on the bare wood, before
    // the leaves: most clumps carry a pair of blooms at the peak.
    if (!cl.seedling && look.bloom > 0 && noise(c, 47, salt) < 0.75 * look.bloom) {
      for (var fl = 0; fl < 2; fl++) {
        var blossomZ = P.z + 0.2
        var bAng = fl * 2.6 + noise(c, 48 + fl, salt) * 2.2
        clumpDraw.push({ z: blossomZ, op: {
          op: "blob", mat: "blossom",
          cx: P.x + Math.cos(bAng) * rpx0 * 0.55, cy: P.y + Math.sin(bAng) * rpx0 * 0.45,
          rx: Math.max(1.6, rpx0 * 0.14), ry: Math.max(1.6, rpx0 * 0.14),
          wobf: [0.03, -0.02, 0.02], base: pal.blossom,
          night: night, gold: gold, ambient: ambient, lx: lx, ly: ly,
          intensity: night ? 0.55 : sun.intensity, salt: salt + 401 + c * 13 + fl,
          seedling: false, z: blossomZ
        } })
      }
    }
    // Winter on a deciduous tree: where a clump has dropped, a resting bud on
    // the twig says the tree is asleep, not gone.
    if (!shown && look.deciduous && noise(c, 49, salt) < 0.6) {
      var budZ = P.z + 0.1
      clumpDraw.push({ z: budZ, op: {
        op: "blob", mat: "bud", cx: P.x, cy: P.y,
        rx: Math.max(1.2, rpx0 * 0.09), ry: Math.max(1.4, rpx0 * 0.11),
        wobf: [0, 0, 0], base: pal.bud,
        night: night, gold: gold, ambient: ambient, lx: lx, ly: ly,
        intensity: night ? 0.55 : sun.intensity, salt: salt + 601 + c,
        seedling: false, z: budZ
      } })
    }
    if (shown) { op2.snow = look.snow; clumpDraw.push({ z: P.z, op: blobShape(op2) }) }
    if (!cl.seedling && rpx0 > 3) {
      var hrx = rpx0 * dims[0], hry = rpx0 * dims[1]
      hitAreas.push({ id: cl.id, x: op2.cx - hrx, y: op2.cy - hry, w: hrx * 2, h: hry * 2 })
      if (shown) shownClumps.push({ cx: op2.cx, cy: op2.cy, rx: op2.rx, ry: op2.ry })
    }
  }
  clumpDraw.sort(function (p, q) { return p.z - q.z })
  for (var d = 0; d < clumpDraw.length; d++) leafOps.push(clumpDraw[d].op)

  // the desktop ornament's glass case: far edges tuck behind the trunk, near
  // edges + the lid ride over the foliage.
  if (V.showCase) {
    var cc = buildCase(sk, V)
    for (var cb = cc.back.length - 1; cb >= 0; cb--) staticOps.unshift(cc.back[cb])
    for (var cf = 0; cf < cc.front.length; cf++) leafOps.push(cc.front[cf])
  }

  // Where a companion stands with the tree: the front-left quarter of the soil
  // mound, in the moss, at the pot's near rim. A point for the feet, in art-px,
  // on the same frame as hitAreas — it orbits with the pot as the tree turns.
  var pm = project([pcx - potR * 0.62, pTopY + 0.18, pcz + potR * 0.62], V)

  // The physical scene the care effects (Fx.js) fall through, in art-px on
  // the same frame as hitAreas: the pot opening at soil level, the mound that
  // crowns it, the trunk where it leaves the soil, the saucer, and every
  // foliage clump as an ellipse. Water that falls onto a guessed "soil line"
  // lands in mid-air the moment the tree turns or grows; this is where the
  // soil actually is.
  var tf = project([sk.nodes.length ? footOf(sk)[0] : 0, pTopY, sk.nodes.length ? footOf(sk)[1] : 0], V)
  var scene = {
    w: V.w, h: V.h,
    rim: [[CP[0].x, CP[0].y], [CP[1].x, CP[1].y], [CP[2].x, CP[2].y], [CP[3].x, CP[3].y]],
    saucer: [[SP[0].x, SP[0].y], [SP[1].x, SP[1].y], [SP[2].x, SP[2].y], [SP[3].x, SP[3].y]],
    mound: { cx: soilMoundOp.cx, cy: soilMoundOp.cy, rx: soilMoundOp.rx, ry: soilMoundOp.ry, lift: moundLift },
    trunk: { x: tf.x, y: tf.y, r: footRadiusOf(sk) * V.art * tf.s },
    clumps: shownClumps   // only foliage that is on the tree catches water
  }

  return { staticOps: staticOps, leafOps: leafOps, hitAreas: hitAreas,
           potMoss: { x: pm.x, y: pm.y }, scene: scene }
}

// where the trunk crosses the soil, and how wide it is there — the first
// trunk segment to climb past y=0
function footOf(sk) {
  for (var i = 0; i < sk.nodes.length; i++) {
    var n = sk.nodes[i]
    if (n.kind === "trunk" && n.a[1] <= 0 && n.b[1] > 0) {
      var u = -n.a[1] / (n.b[1] - n.a[1])
      return [n.a[0] + (n.b[0] - n.a[0]) * u, n.a[2] + (n.b[2] - n.a[2]) * u, n.ra + (n.rb - n.ra) * u]
    }
  }
  return [0, 0, 1]
}
function footRadiusOf(sk) { return footOf(sk)[2] }

// The tree's plumbing, for Fx.js's feeding: for every foliage clump, the path
// sap actually takes to reach it — up the trunk from where it leaves the soil,
// out along each bough in the clump's lineage, to the clump. Screen art-px, on
// the same frame as `scene`. The lineage is in the ids: clump "c.t.b0.0.1s1"
// hangs off branch "t.b0.0.1", which grows from "t.b0.0", from "t.b0", from
// the trunk. Built on demand (only while a feed plays), not every frame.
function veins(sk, V) {
  // points carry the wood's radius as a 4th element, so food can rise
  // across the whole width of the trunk rather than up one line
  var lines = {}, trunk = []
  for (var i = 0; i < sk.nodes.length; i++) {
    var n = sk.nodes[i]
    if (n.kind === "trunk") {
      if (!trunk.length) trunk.push([n.a[0], n.a[1], n.a[2], n.ra])
      trunk.push([n.b[0], n.b[1], n.b[2], n.rb])
    } else if (n.kind === "branch") {
      var L = lines[n.id]
      if (!L) L = lines[n.id] = [[n.a[0], n.a[1], n.a[2], n.ra]]
      L.push([n.b[0], n.b[1], n.b[2], n.rb])
    }
  }
  // the trunk from the soil line up
  var foot = footOf(sk), tr = [[foot[0], 0, foot[1], foot[2]]]
  for (var ti = 0; ti < trunk.length; ti++) if (trunk[ti][1] > 0) tr.push(trunk[ti])
  function nearest(poly, p) {
    var bi = 0, bd = 1e18
    for (var k = 0; k < poly.length; k++) {
      var dx = poly[k][0] - p[0], dy = poly[k][1] - p[1], dz = poly[k][2] - p[2], d = dx * dx + dy * dy + dz * dz
      if (d < bd) { bd = d; bi = k }
    }
    return bi
  }
  var out = []
  for (var c = 0; c < sk.clumps.length; c++) {
    var cl = sk.clumps[c]
    if (cl.seedling || !cl.id || cl.id.indexOf("c.") !== 0) continue
    var id = cl.id.slice(2).replace(/s\d+$/, ""), chain = []
    while (id && id !== "t") {
      if (lines[id]) chain.unshift(id)
      var cut = id.lastIndexOf(".")
      if (cut < 0) break
      id = id.slice(0, cut)
    }
    if (!chain.length) continue
    var path = tr.slice(0, nearest(tr, lines[chain[0]][0]) + 1)
    for (var q = 0; q < chain.length; q++) {
      var poly = lines[chain[q]]
      var end = q + 1 < chain.length ? nearest(poly, lines[chain[q + 1]][0]) : poly.length - 1
      path = path.concat(poly.slice(0, end + 1))
    }
    path.push([cl.c[0], cl.c[1], cl.c[2], 0])
    var pts = []
    for (var pp = 0; pp < path.length; pp++) {
      var P = project(path[pp], V)
      pts.push([P.x, P.y, (path[pp][3] || 0) * V.art * P.s])
    }
    var pc = project(cl.c, V)
    out.push({ id: cl.id, pts: pts, cx: pc.x, cy: pc.y, r: cl.r * V.art * pc.s })
  }
  return out
}

// ---------------------------------------------------------------------------
// per-pixel shaders — a backend calls these for every art-pixel in op's bbox.
// Return [r,g,b] (0..255) or null for transparent.

function bboxOf(op) {
  if (op.op === "blob" || op.op === "mound")
    return [Math.floor(op.cx - op.rx - 2), Math.floor(op.cy - op.ry - 2),
            Math.ceil(op.cx + op.rx + 2), Math.ceil(op.cy + op.ry + 2)]
  if (op.op === "stroke") {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9
    for (var i = 0; i < op.pts.length; i++) {
      var p = op.pts[i], r = p[2] + 2
      if (p[0] - r < x0) x0 = p[0] - r
      if (p[0] + r > x1) x1 = p[0] + r
      if (p[1] - r < y0) y0 = p[1] - r
      if (p[1] + r > y1) y1 = p[1] + r
    }
    return [Math.floor(x0), Math.floor(y0), Math.ceil(x1), Math.ceil(y1)]
  }
  var xs = op.pts.map(function (p) { return p[0] }), ys = op.pts.map(function (p) { return p[1] })
  return [Math.floor(Math.min.apply(null, xs)) - 1, Math.floor(Math.min.apply(null, ys)) - 1,
          Math.ceil(Math.max.apply(null, xs)) + 1, Math.ceil(Math.max.apply(null, ys)) + 1]
}

function pointInPoly(px, py, pts) {
  var inside = false
  for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    var xi = pts[i][0], yi = pts[i][1], xj = pts[j][0], yj = pts[j][1]
    if (((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / ((yj - yi) || 1e-9) + xi))
      inside = !inside
  }
  return inside
}
function distToPoly(px, py, pts) {
  var best = 1e9
  for (var i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    var ax = pts[j][0], ay = pts[j][1], bx = pts[i][0], by = pts[i][1]
    var dx = bx - ax, dy = by - ay
    var t = clamp(((px - ax) * dx + (py - ay) * dy) / ((dx * dx + dy * dy) || 1e-9), 0, 1)
    var ex = ax + dx * t - px, ey = ay + dy * t - py
    var d = Math.sqrt(ex * ex + ey * ey)
    if (d < best) best = d
  }
  return best
}

// inverse bilinear: where does screen point (px,py) land in the unit square of
// a quad a-b-c-d (corners walked in order)? Returns [u,v] in [0,1] or null.
// (Íñigo Quílez's closed form.)
function invBilinear(px, py, a, b, c, d) {
  var ex = b[0] - a[0], ey = b[1] - a[1]
  var fx = d[0] - a[0], fy = d[1] - a[1]
  var gx = a[0] - b[0] + c[0] - d[0], gy = a[1] - b[1] + c[1] - d[1]
  var hx = px - a[0], hy = py - a[1]
  var cross = function (ux, uy, vx, vy) { return ux * vy - uy * vx }
  var k2 = cross(gx, gy, fx, fy)
  var k1 = cross(ex, ey, fx, fy) + cross(hx, hy, gx, gy)
  var k0 = cross(hx, hy, ex, ey)
  var u, v
  if (Math.abs(k2) < 1e-5) {
    if (Math.abs(k1) < 1e-9) return null
    v = -k0 / k1
  } else {
    var w = k1 * k1 - 4 * k0 * k2
    if (w < 0) return null
    w = Math.sqrt(w)
    v = (-k1 - w) / (2 * k2)
    if (v < 0 || v > 1) v = (-k1 + w) / (2 * k2)
  }
  var dx = ex + gx * v, dy = ey + gy * v
  if (Math.abs(dx) > Math.abs(dy)) u = (hx - fx * v) / dx
  else u = (hy - fy * v) / dy
  if (u < -0.002 || u > 1.002 || v < -0.002 || v > 1.002) return null
  return [clamp(u, 0, 1), clamp(v, 0, 1)]
}

// The official Omarchy logo (omarchy.org/brand/omarchy-logo.svg) is carved
// into the pot clay. These are the SVG path's three even-odd subpaths,
// normalized into the pot face so the etch matches the source geometry.
var OMARCHY_PATH = [
  [[1200, 1200], [720, 1200], [720, 1120], [1120, 1120],
   [1120, 80], [640, 80], [640, 240], [240, 240], [240, 960],
   [960, 960], [960, 240], [880, 240], [880, 160], [1040, 160],
   [1040, 1040], [640, 1040], [640, 1200], [0, 1200], [0, 0], [1200, 0]],
  [[80, 1120], [560, 1120], [560, 1040], [160, 1040], [160, 640], [80, 640]],
  [[80, 560], [160, 560], [160, 160], [560, 160], [560, 80], [80, 80]]
]
// Returns a LUMINANCE DELTA for a pixel of the pot face (0 = untouched):
// a shade darker on the trench floor, deep shadow on the walls the light
// misses, a catch-light on the walls it rakes across. lx/ly = screen light dir.
function omarchyMark(u, v, lx, ly) {
  // Keep the Omarchy square upright and keep the mark as one solid, consistent
  // depth: a single dark etch, not a lit-and-shadowed logo with moving depth.
  var px = (((1 - u) - 0.5) / 0.60 + 0.5) * 1200
  var py = ((v - 0.50) / 0.58 + 0.5) * 1200
  // Rotate the logo 90° counter-clockwise on the pot face while keeping it
  // square and fully dark.
  var cx = 600, cy = 600
  var dx = px - cx, dy = py - cy
  var rx = -dy
  var ry = dx
  px = cx + rx
  py = cy + ry
  var inside = false
  for (var i = 0; i < OMARCHY_PATH.length; i++)
    if (pointInPoly(px, py, OMARCHY_PATH[i])) inside = !inside
  return inside ? -0.68 : 0
}

function polyPixel(op, x, y) {
  var cx = x + 0.5, cy = y + 0.5
  if (!pointInPoly(cx, cy, op.pts)) return null

  if (op.mat === "glasspane") {
    // a barely-there glazed sheet: a faint wash, a soft diagonal sheen band,
    // a slightly stronger line right at the pane edge. Translucent (op.alpha).
    var d = distToPoly(cx, cy, op.pts)
    var a = op.alpha || 16
    var streak = noise((x + y) >> 3, 0, op.salt) > 0.72 ? 1.5 : 1
    if (d < 1.4) { a += 26; streak = 1.35 }
    return [op.fill[0] * streak, op.fill[1] * streak, op.fill[2] * streak,
            Math.min(120, a)]
  }

  var col = op.fill
  var edge = distToPoly(cx, cy, op.pts)
  if (edge < 1.05 && op.edge) col = op.edge
  if (op.mat === "wood") {
    var k = noise(x, y * 3 + 5, op.salt)
    if (k < 0.16) col = mul(col, 0.78)             // bark knot
    else if (k > 0.86) col = mul(col, 1.12)
  } else if (op.mat === "pot") {
    var pg = noise(x, y * 2 + 3, op.salt)
    if (pg < 0.14) col = mul(col, 0.9)             // ceramic mottle
    else if (pg > 0.9) col = mul(col, 1.06)
    // A narrow bevel gives the 2D raster a rounded, solid ceramic edge:
    // highlight the upper rim and soften the lower/side silhouette.
    if (edge < 1.8) {
      var bevel = clamp(edge / 1.8, 0, 1)
      col = mul(col, 0.82 + bevel * 0.18)
      if (cy < op.pts[0][1] + 3 && op.edge) col = mul(op.edge, 1.08)
    }
    if (op.etch) {
      var uv = invBilinear(cx, cy, op.pts[0], op.pts[1], op.pts[2], op.pts[3])
      if (uv) {
        var m = omarchyMark(uv[0], uv[1], op.lx, op.ly)
        if (m !== 0) col = mul(col, clamp(1 + m, 0.12, 1.4))
      }
    }
  } else if (op.mat === "soil") {
    var sg = noise(x >> 1, y, op.salt + 4)
    if (sg < 0.28) col = mul(col, 0.8)             // gravel speckle
    else if (sg > 0.9) col = mul(col, 1.12)
  } else if (op.mat === "moss") {
    var mg = noise(x >> 1, y >> 1, op.salt + 19)
    if (mg < 0.16) col = mul(col, 0.72)
    else if (mg > 0.82) col = mul(col, 1.16)
  }
  return col
}

function mul(c, k) { return [clamp(c[0] * k, 0, 255), clamp(c[1] * k, 0, 255), clamp(c[2] * k, 0, 255)] }

// continuous rounded limb: distance to the tapered polyline
function strokePixel(op, x, y) {
  var px = x + 0.5, py = y + 0.5
  var pts = op.pts
  var bestSD = 1e9       // signed dist to surface (neg = inside), tracked as min
  var bestNx = 0, bestNy = -1, bestZ = 0, bestR = 1
  for (var i = 0; i < pts.length - 1; i++) {
    var ax = pts[i][0], ay = pts[i][1], bx = pts[i + 1][0], by = pts[i + 1][1]
    var dx = bx - ax, dy = by - ay
    var seglen2 = dx * dx + dy * dy || 1e-9
    var t = clamp(((px - ax) * dx + (py - ay) * dy) / seglen2, 0, 1)
    var qx = ax + dx * t, qy = ay + dy * t
    var r = pts[i][2] + (pts[i + 1][2] - pts[i][2]) * t
    var ex = px - qx, ey = py - qy
    var d = Math.sqrt(ex * ex + ey * ey)
    var sd = d - r
    if (sd < bestSD) {
      bestSD = sd
      bestNx = d > 0.01 ? ex / d : 0
      bestNy = d > 0.01 ? ey / d : -1
      bestZ = pts[i][3] + (pts[i + 1][3] - pts[i][3]) * t
      bestR = r
    }
  }
  if (bestSD > 0) return null
  // The limb is round: its surface bulges toward the viewer over its axis, so
  // two limbs that cross weld along the seam where their surfaces actually
  // meet instead of one flatly covering the other. (Radii are art-px, z is in
  // model units, hence op.iart.)
  var dAxis = bestR + bestSD
  var bulge = Math.sqrt(Math.max(0, bestR * bestR - dAxis * dAxis))
  lastZ = bestZ + bulge * (op.iart || 0) * DEPTH_BULGE
  if (op.mat === "glass") {
    // a flat hairline pane edge — no bark, no silhouette darkening; a sparse
    // sparkle fleck sells it as glass. Translucent (op.alpha) so the wallpaper
    // and the tree read through it, matching Omarchy's see-through surfaces.
    var gk = noise(x * 2 + 3, y * 2 + 1, op.salt)
    var a = op.alpha || 150
    var col = op.front ? op.hi : op.lo
    if (bestSD > -0.9) { col = op.hi; a = Math.min(255, a + 40) }   // crisper rim
    else if (gk > 0.9) { col = op.hi; a = Math.min(255, a + 55) }   // catch-light
    else if (gk < 0.12) col = op.lo
    return [col[0], col[1], col[2], a]
  }
  // light: limb surface normal ~ (bestNx, bestNy) with a viewer-facing bulge
  var nz = Math.sqrt(clamp(1 - (bestNx * bestNx + bestNy * bestNy), 0, 1))
  var ndotl = bestNx * op.lx + bestNy * op.ly + nz * 0.4
  var lum = clamp(ndotl * 0.6 + 0.55, 0, 1)
  var col = lum > 0.72 ? op.hi : lum < 0.42 ? op.lo : op.fill
  if (op.mat === "wood") {
    // Crisp, deliberate silhouettes on the trunk, branches and roots: keep a
    // darker true edge so every limb reads as a distinct solid form instead of a
    // soft painted blur.
    if (bestSD > -0.25) col = mul(op.edge, 0.82)
    else if (bestSD > -0.9) col = mul(op.edge, 0.94)
    else if (bestSD > -1.6) col = op.edge
  } else if (bestSD > -1.0) {
    col = op.edge
  }
  var k = noise(x >> 1, y >> 1, op.salt) * 0.6 + noise(x, y, op.salt + 9) * 0.4
  if (k < 0.14) col = mul(col, 0.88)                    // bark mottle
  else if (k > 0.9) col = mul(col, 1.07)
  return col
}

// the soil mound: a low dome the trunk rises out of. Half-ellipse footprint,
// top-lit, gravel-grained, darker toward the front lip where the pot shades it.
function moundPixel(op, x, y) {
  if (op.clip && !pointInPoly(x + 0.5, y + 0.5, op.clip)) return null
  // The soil is a flat plane, so its depth is a straight function of screen y:
  // under a downward pitch, ground further from the viewer sits higher up the
  // image. This is what lets wood be BURIED — a root that dives below the
  // surface, or the near lip of the mound in front of the trunk's foot, is now
  // resolved by the ground itself rather than by draw order.
  lastZ = (y + 0.5 - op.cy0) * op.zk - GROUND_BIAS
  var nx = (x + 0.5 - op.cx) / op.rx
  var ny = (y + 0.5 - op.cy) / op.ry
  var rr = nx * nx + ny * ny
  if (rr > 1) return null
  var nz = Math.sqrt(Math.max(0, 1 - rr))
  var ndotl = nx * op.lx + ny * op.ly + nz * 0.62
  var lum = op.ambient + (1 - op.ambient) * clamp(0.42 + 0.58 * ndotl, 0, 1) * op.intensity
  // Moist soil absorbs light; dry soil reflects more of it.
  lum *= 0.72 + 0.38 * (op.dryness === undefined ? 0.5 : op.dryness)
  var g = noise(x >> 1, y >> 1, op.salt + 4) * 0.55 + noise(x, y, op.salt + 7) * 0.45
  if (g < 0.28) lum -= 0.12                         // clod / gravel shadow
  else if (g > 0.84) lum += 0.12                    // grit fleck
  if (ny < -0.45) lum += 0.06                       // catch-light on the crown
  if (ny > 0.55) lum -= 0.16 * (ny - 0.55)          // the far lip dips into pot shade
  // winter: drifts of snow on the soil, gathering as the season deepens
  if (op.snow > 0 && noise(x >> 1, y >> 1, op.salt + 13) * 0.7 + noise(x, y, op.salt + 17) * 0.3 < 0.62 * op.snow)
    return shade(SNOW, lum * 1.18 + 0.08, op.night, op.gold)
  return shade(op.base, lum, op.night, op.gold)
}

// Snow: a cold white, a touch blue, that the light and the night still shade.
var SNOW = { r: 0.93, g: 0.96, b: 1.0 }

// small bright things that sit on the foliage rather than being foliage
var GEM = { fruit: 1, berry: 1, blossom: 1, bud: 1 }

function blobPixel(op, x, y) {
  // Moss is a skin on the soil, so it takes the ground's depth rather than a
  // card depth — a flat card cuts through a sloped ground plane and the patch
  // comes out sliced into stripes. Everything else keeps its card depth, which
  // is what lets the foliage masses stack as sprites.
  lastZ = op.cy0 !== undefined ? (y + 0.5 - op.cy0) * op.zk : op.z
  var nx = (x + 0.5 - op.cx) / op.rx
  var ny = (y + 0.5 - op.cy) / op.ry
  // lk: the leaf as a number (0 plain, 1 needle, 2 scale, 3 fan, 4 fine), and
  // emax: the furthest the edge can reach, both fixed when the op is built
  // (blobShape) so the per-pixel path never compares strings
  var lk = op.lk | 0
  // a pine pad is domed on top and flat underneath
  if (lk === 1 && ny > 0) ny *= 1.35
  // Most pixels in a blob's box are outside the blob: reject them on the
  // radius alone, before any trig. The edge can never pass this bound.
  var rr0 = nx * nx + ny * ny
  if (op.emax !== undefined && rr0 > op.emax) return null
  var ang = Math.atan2(ny, nx)
  var edge = 1
    + op.wobf[0] * Math.sin(2 * ang + 0.6)
    + op.wobf[1] * Math.sin(3 * ang + 1.7)
    + op.wobf[2] * Math.sin(5 * ang)
  // juniper: a spiky, flame-like tuft; maple: a lobed, leafy outline
  if (lk === 2) edge += 0.13 * Math.abs(Math.sin(7 * ang + op.ph)) + 0.05 * Math.sin(15 * ang) - 0.06
  else if (lk === 3) edge += 0.15 * Math.abs(Math.sin(3.5 * ang + op.ph)) - 0.07
  if (edge < 0.72) edge = 0.72
  var rr = rr0
  if (rr > edge) return null

  var base = op.base
  if (op.seedling) {
    var gg = noise(x, y, op.salt)
    return shade(base, 0.7 + 0.4 * gg, op.night, op.gold)
  }

  // fake screen-space normal: radial, tipped toward the viewer in the middle
  var nz = Math.sqrt(Math.max(0, 1 - Math.min(1, rr)))
  var ndotl = nx * op.lx + ny * op.ly + nz * 0.55
  var lum = op.ambient + (1 - op.ambient) * clamp(ndotl * 0.6 + 0.5, 0, 1) * op.intensity
  if (op.mat === "moss") {
    // Moss hugs the soil surface: low, irregular, and darker than the leaves.
    lum *= 0.78
  } else if (op.mat === "water") {
    lum = 0.76 + 0.20 * clamp(ndotl, 0, 1)
  } else if (GEM[op.mat]) {
    lum = 0.82 + 0.28 * clamp(ndotl, 0, 1)
  } else if (lk === 1) {
    // light on the top of the pad, the underside in its own shade: that band
    // is what makes stacked pine pads read as layers
    lum += 0.08 * clamp(-ny, 0, 1) - 0.24 * clamp(ny, 0, 1)
  }

  // the leaf texture: coarse flecks for maple, horizontal needle streaks for
  // pine, a fine even grain for juniper and zelkova
  var dap = lk === 1 ? noise(x >> 2, y, op.salt) * 0.65 + noise(x, y, op.salt) * 0.35
    : lk === 3 ? noise(x >> 2, y >> 2, op.salt) * 0.7 + noise(x, y, op.salt) * 0.3
    : lk === 2 || lk === 4 ? noise(x, y, op.salt) * 0.8 + noise(x >> 1, y >> 1, op.salt) * 0.2
    : noise(x >> 1, y >> 1, op.salt) * 0.6 + noise(x, y, op.salt) * 0.4
  if (op.mat === "moss") {
    if (dap < 0.18) lum -= 0.06
    else if (dap > 0.74) lum += 0.10
  } else if (op.mat === "water") {
    if (dap > 0.72) lum += 0.12
  } else if (GEM[op.mat] && dap > 0.62) {
    lum += 0.10
  } else if (dap < 0.22) lum -= 0.22             // inner leaf-gap shadow
  else if (dap > 0.74) lum += 0.16              // sun fleck

  var rim = rr > edge - 0.34
  // Snow settles on the top of a clump, deeper the further into winter, with
  // a ragged lower edge; the underside stays leaf.
  if (op.snow > 0) {
    var sl = -1.05 + 0.85 * op.snow + 0.24 * (noise(x >> 1, y, op.salt + 9) - 0.5)
    if (ny < sl) {
      var slum = 0.90 + 0.16 * clamp(-ny, 0, 1) + 0.10 * clamp(ndotl, 0, 1)
      if (rim) slum -= 0.16
      if (dap > 0.80) slum += 0.06
      return shade(SNOW, slum, op.night, op.gold)
    }
  }
  if (rim) lum -= op.mat === "moss" ? 0.12
    : (op.mat === "water" || GEM[op.mat] ? 0.05 : OUTLINE)
  if (op.night && rim && ndotl > 0.1) lum += 0.5    // moonlit edge

  var col = shade(base, lum, op.night, op.gold)

  // subtle monospace char-grain: darken a sparse scatter of pixels
  var t = noise(x + 7, y + 11, op.salt + 3)
  if (t < TEXTURE) col = mul(col, 0.82)
  else if (t > 1 - TEXTURE * 0.5) col = mul(col, 1.08)

  return col
}

// which grain glyph a pixel would read as (for the ANSI preview only)
function grainGlyph(x, y, salt) {
  var t = noise(x + 7, y + 11, salt + 3)
  if (t < TEXTURE) return GRAIN_CH[(x + y) % GRAIN_CH.length]
  return null
}

// ---------------------------------------------------------------------------
// Sun from local time of day -> light dir + brightness. (time-of-day light model)
// Where the grow lamp hangs: just above the tree and slightly in front, in the
// same screen frame as the sun vector (x right, y DOWN, z toward viewer), so
// y is negative. Omatree.qml reads this too — the light shafts it draws and the
// shading here have to agree, and they cannot if each hardcodes its own guess.
// This matters most at night: sunForTime returns elevation 0 after dusk, so a
// lamp that fell back to the sun vector would be lit dead horizontally.
function lampDir() { return [0.15, -0.9, 0.4] }

function sunForTime(hour, minute) {
  var t = hour + minute / 60
  var DAYSTART = 5.5, DAYEND = 19.5
  var straight = clamp((t - DAYSTART) / (DAYEND - DAYSTART), 0, 1)
  var elevAngle = straight * PI
  var elevation = Math.sin(elevAngle)
  var azimuth = -0.9 + straight * 1.8
  var L = { x: Math.sin(azimuth) * 0.85 + 0.15, y: Math.max(0, elevation), z: -Math.cos(azimuth) * 0.85 }
  var ln = Math.sqrt(L.x * L.x + L.y * L.y + L.z * L.z) || 1
  var night = t < DAYSTART || t > DAYEND
  return {
    dir: [L.x / ln, L.y / ln, L.z / ln],
    intensity: night ? 0.12 : Math.max(0.05, Math.pow(elevation, 0.8)),
    goldeness: night ? 0.15 : Math.abs(Math.cos(elevAngle)),
    night: night
  }
}

// ---------------------------------------------------------------------------
// The plant's palette, tinted by the running theme. Plain {r,g,b} in 0..1 in,
// plain {r,g,b} out — no Qt colour types — so the panel (Omatree.qml) and the
// dev tools (dev/shot.js and friends) shade the same tree from one definition.
// `accent` / `urgent` are the theme's accent + urgent colours; `lite` is a
// light background.
function _hsv(c) {
  var mx = Math.max(c.r, c.g, c.b), mn = Math.min(c.r, c.g, c.b), d = mx - mn
  var h = 0
  if (d > 0) {
    if (mx === c.r) h = ((c.g - c.b) / d) % 6
    else if (mx === c.g) h = (c.b - c.r) / d + 2
    else h = (c.r - c.g) / d + 4
    h = ((h / 6) % 1 + 1) % 1
  }
  return { h: h, s: mx > 0 ? d / mx : 0, v: mx }
}
function _fromHsv(h, s, v) {
  var i = Math.floor(h * 6), f = h * 6 - i
  var p = v * (1 - s), q = v * (1 - f * s), t = v * (1 - (1 - f) * s)
  switch (((i % 6) + 6) % 6) {
  case 0: return { r: v, g: t, b: p }
  case 1: return { r: q, g: v, b: p }
  case 2: return { r: p, g: v, b: t }
  case 3: return { r: p, g: q, b: v }
  case 4: return { r: t, g: p, b: v }
  default: return { r: v, g: p, b: q }
  }
}
function _mixHue(base, target, t) {
  var d = target - base
  if (d > 0.5) d -= 1; else if (d < -0.5) d += 1
  return ((base + d * t) % 1 + 1) % 1
}
function paletteFor(accent, urgent, lite) {
  var a = _hsv(accent), u = _hsv(urgent)
  var grey = a.s < 0.14
  var ah = grey ? 0.33 : a.h
  var leafH = grey ? 0.32 : _mixHue(0.30, ah, 0.34)
  var woodH = grey ? 0.07 : _mixHue(0.075, ah, 0.14)
  return {
    frond: _fromHsv(leafH, grey ? 0.14 : (lite ? 0.62 : 0.52), lite ? 0.54 : 0.80),
    trunk: _fromHsv(woodH, grey ? 0.08 : 0.36, lite ? 0.46 : 0.56),
    // Earthen terracotta, warm and distinct from the trunk/roots so it reads
    // as a deliberate pot rather than a continuation of the wood mass. The
    // theme is allowed to tint it only very slightly.
    pot: { r: 0.71 + 0.10 * accent.r, g: 0.46 + 0.10 * accent.g, b: 0.33 + 0.10 * accent.b },
    soil: _fromHsv(woodH, grey ? 0.10 : 0.24, lite ? 0.40 : 0.34),
    fruit: _fromHsv(u.s < 0.12 ? leafH : u.h, 0.55, lite ? 0.72 : 0.9),
    // Berries stay a fixed, cool indigo rather than following the theme's
    // urgent hue the way fruit does — they need to read as a distinct kind
    // of thing (food) wherever fruit happens to land on any given theme.
    berry: _fromHsv(0.70, 0.55, lite ? 0.62 : 0.80),
    // Blossom is a fixed pale pink and a winter bud a fixed russet, for the same
    // reason: a flowering plum should look like one on any theme.
    blossom: _fromHsv(0.93, 0.34, lite ? 0.90 : 0.96),
    bud: _fromHsv(0.03, 0.62, lite ? 0.50 : 0.62)
  }
}
