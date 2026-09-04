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
  var botY = Math.min(sk.bounds.min[1], potBottomY(sk) - SAUCER_DROP) * cp
  var w = Math.ceil(reach * 2 * art) + 4
  var h = Math.ceil((topY - botY) * art) + 6
  // nudge the trunk off-centre toward the lighter side so a leaning canopy
  // still sits balanced over the pot
  var cxModel = (sk.bounds.min[0] + sk.bounds.max[0]) / 2
  var originX = w / 2 - 0.45 * cxModel * art
  originX = Math.max(w * 0.28, Math.min(w * 0.72, originX))
  return { w: w, h: h, originX: originX, originY: 3 + topY * art }
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

  var clumpDraw = []
  for (var c = 0; c < sk.clumps.length; c++) {
    var cl = sk.clumps[c]
    var P = project(cl.c, V)
    var wob = V.time !== undefined && !cl.seedling
      ? Math.sin(V.time * WOBBLE_RATE + cl.phase) * WOBBLE_AMP
      : 0
    var rpx = cl.r * V.art * P.s
    var blossom = false
    var fillCol = cl.seedling && cl.c[1] < 0 ? pal.trunk : pal.frond
    var op2 = {
      op: "blob",
      cx: P.x + wob, cy: P.y + wob * 0.4,
      rx: rpx * 1.15, ry: rpx * (sk.needle ? 0.78 : 0.92),
      wobf: [noise(c, 1, salt) - 0.5, noise(c, 2, salt) - 0.5, noise(c, 3, salt) - 0.5],
      base: fillCol, night: night, gold: gold, ambient: ambient,
      lx: lx, ly: ly, intensity: night ? 0.5 : sun.intensity,
      salt: salt + c * 97, seedling: !!cl.seedling,
      z: P.z
    }
    if (sk.fruit && c === ((sk.seed >>> 0) % Math.max(1, sk.clumps.length))) {
      leafOps.push({
        op: "blob", mat: "fruit", cx: P.x + rpx * 0.58, cy: P.y + rpx * 0.32,
        rx: Math.max(2.5, rpx * 0.22), ry: Math.max(2.5, rpx * 0.22),
        wobf: [0.02, -0.03, 0.01], base: pal.fruit,
        night: night, gold: gold, ambient: ambient, lx: lx, ly: ly,
        intensity: night ? 0.55 : sun.intensity, salt: salt + 201,
        seedling: false, z: P.z + 0.2
      })
    }
    for (var bi = 0; bi < berryCount; bi++) {
      if (c !== berryIdx[bi]) continue
      leafOps.push({
        op: "blob", mat: "berry",
        cx: P.x + rpx * (bi === 0 ? -0.55 : 0.15),
        cy: P.y + rpx * (bi === 0 ? 0.30 : -0.45),
        rx: Math.max(1.8, rpx * 0.15), ry: Math.max(1.8, rpx * 0.15),
        wobf: [-0.02, 0.03, -0.01], base: pal.berry,
        night: night, gold: gold, ambient: ambient, lx: lx, ly: ly,
        intensity: night ? 0.55 : sun.intensity, salt: salt + 311 + bi * 7,
        seedling: false, z: P.z + 0.2
      })
    }
    clumpDraw.push({ z: P.z, op: op2 })
    if (!cl.seedling && rpx > 3)
      hitAreas.push({ id: cl.id, x: op2.cx - op2.rx, y: op2.cy - op2.ry,
        w: op2.rx * 2, h: op2.ry * 2 })
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

  return { staticOps: staticOps, leafOps: leafOps, hitAreas: hitAreas }
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
  return shade(op.base, lum, op.night, op.gold)
}

function blobPixel(op, x, y) {
  // Moss is a skin on the soil, so it takes the ground's depth rather than a
  // card depth — a flat card cuts through a sloped ground plane and the patch
  // comes out sliced into stripes. Everything else keeps its card depth, which
  // is what lets the foliage masses stack as sprites.
  lastZ = op.cy0 !== undefined ? (y + 0.5 - op.cy0) * op.zk : op.z
  var nx = (x + 0.5 - op.cx) / op.rx
  var ny = (y + 0.5 - op.cy) / op.ry
  var ang = Math.atan2(ny, nx)
  var edge = 1
    + op.wobf[0] * Math.sin(2 * ang + 0.6)
    + op.wobf[1] * Math.sin(3 * ang + 1.7)
    + op.wobf[2] * Math.sin(5 * ang)
  if (edge < 0.72) edge = 0.72
  var rr = nx * nx + ny * ny
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
  } else if (op.mat === "fruit" || op.mat === "berry") {
    lum = 0.82 + 0.28 * clamp(ndotl, 0, 1)
  }

  var dap = noise(x >> 1, y >> 1, op.salt) * 0.6 + noise(x, y, op.salt) * 0.4
  if (op.mat === "moss") {
    if (dap < 0.18) lum -= 0.06
    else if (dap > 0.74) lum += 0.10
  } else if (op.mat === "water") {
    if (dap > 0.72) lum += 0.12
  } else if ((op.mat === "fruit" || op.mat === "berry") && dap > 0.62) {
    lum += 0.10
  } else if (dap < 0.22) lum -= 0.22             // inner leaf-gap shadow
  else if (dap > 0.74) lum += 0.16              // sun fleck

  var rim = rr > edge - 0.34
  if (rim) lum -= op.mat === "moss" ? 0.12
    : (op.mat === "water" || op.mat === "fruit" || op.mat === "berry" ? 0.05 : OUTLINE)
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
