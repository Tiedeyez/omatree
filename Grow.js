// Grow.js — the 3D skeleton of the tree.
//
// A recursive branch model in art-unit space: the trunk base sits at (0,0,0),
// the tree climbs +y, and +z points at the viewer when the turntable yaw is 0.
// Everything is derived deterministically from `gen` (TreeGen.genesis) so the
// same machine always grows the same tree; `state` (maturity / age / care /
// prune) only flexes that fixed structure.
//
// Determinism contract for pruning: a node's identity is its PATH ("t4.1.0"),
// and its geometry is seeded from that path — never from draw order. So a node
// that exists at maturity 0.4 is the same node, in the same place, at 0.8; it
// just may have sprouted children in between. Removing a node (prune) never
// shifts its siblings. Drop the prune entry and it regrows identically.
//
// grow(gen, state) -> {
//   nodes:  [{ id, a:[x,y,z], b:[x,y,z], ra, rb, level, kind }]   painter-agnostic
//   clumps: [{ id, c:[x,y,z], r, phase, sag }]
//   bounds: { min:[x,y,z], max:[x,y,z] }
//   trunkTop:[x,y,z], style, seed, genus, ageScalar, ringCount
// }

.pragma library

var PI = Math.PI
var TAU = PI * 2

// ---- tunables (all named; tune from dev/preview.js) ------------------------
var TRUNK_H_BASE = 8        // art units of trunk on a bare sprout
var TRUNK_H_GROW = 19       // + this much at maturity 1  (bonsai: short + stout)
var TRUNK_R_BASE = 2.6
var TRUNK_R_GROW = 3.6
var TRUNK_BURY   = 11       // how far the trunk foot sits below the soil line
var TRUNK_SEGS   = 9
var MAX_DEPTH    = { formal: 4, informal: 5, slant: 4, cascade: 5,
                     windswept: 4, literati: 4, broom: 4, twin: 4 }
var CHILD_LEN    = 0.68     // child branch length as fraction of parent
var LEN_MATURE   = 0.6      // branch lengths scale (0.6 .. 1.0) with maturity
var PHOTOTROPISM = 0.16     // per-level blend of branch dir back toward world-up
// Pipe model (da Vinci's rule): the cross-section area of a limb equals the
// summed area of what grows out of it. Wood is conserved through every fork,
// so a limb visibly loses girth where a child leaves and children are never
// thicker than the stub they sprang from — that continuity is most of what
// makes a drawn tree read as one grown object instead of assembled parts.
var PIPE_LEAK    = 0.94     // a little area lost to bark/heartwood at each fork
var BOUGH_SHARE  = 0.22     // fraction of trunk area a single main bough takes
var LIMB_TAPER   = 0.28     // girth a limb loses along its OWN length
var COLLAR       = 1.24     // branch-collar swelling where a limb leaves its parent
var SAG_C        = 0.30     // cantilever droop coefficient (see sagAt)

// Beam deflection: a limb bends under its own weight as roughly L^3 / r^4, and
// carries more the further out you go. Normalised and clamped so an old, long,
// thin branch sags convincingly without folding in half.
function sagAt(length, radius, frac, load) {
  var slender = length / Math.max(0.6, radius * 4)
  return Math.min(0.9, SAG_C * Math.pow(slender, 1.35) * frac * frac * load)
}
var CLUMP_R_BASE = 2.4
var CLUMP_R_GROW = 4.6
var NODE_CAP     = 820
var CLUMP_CAP    = 130
var AGE_GAIN     = 4.2      // trunk/branch length multiplier approached with age
var AGE_TAU      = 120      // years; ~95% of AGE_GAIN by ~360y, never reached

// ---- hashing / rng -------------------------------------------------------
function hashStr(s) {
  var h = 2166136261 >>> 0
  for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function mulberry32(a) {
  a = a >>> 0
  return function () {
    a = (a + 0x6D2B79F5) >>> 0
    var t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
// a deterministic rng bound to (this tree, this node path)
function rngFor(seed, id) { return mulberry32((seed ^ hashStr(id)) >>> 0) }

// ---- vec3 ---------------------------------------------------------------
function add(a, b) { return [a[0] + b[0], a[1] + b[1], a[2] + b[2]] }
function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]] }
function scl(a, s) { return [a[0] * s, a[1] * s, a[2] * s] }
function len3(a) { return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]) }
function norm(a) { var l = len3(a) || 1; return [a[0] / l, a[1] / l, a[2] / l] }
function lerp3(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t] }
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}
// an orthonormal frame with `d` as the forward axis
function frame(d) {
  d = norm(d)
  var up = Math.abs(d[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]
  var u = norm(cross(up, d))
  var v = cross(d, u)
  return [d, u, v]
}
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v) }

// ---------------------------------------------------------------------------
function grow(gen, state) {
  state = state || {}
  var seed = (gen && gen.seed) >>> 0
  var style = (gen && gen.style) || "informal"
  var m = clamp(state.maturity || 0, 0, 1)
  var thirst = clamp(state.thirst || 0, 0, 1)
  var health = (state.health === 0 || state.health > 0) ? clamp(state.health, 0, 1) : 1
  var fruit = state.fruit === true
  var prune = (state.prune && typeof state.prune === "object") ? state.prune : {}
  var ageYears = Math.max(0, state.ageYears || 0)
  var weather = state.weather && typeof state.weather === "object" ? state.weather : {}
  var wind = clamp(Number(weather.windKmph) || 0, 0, 140)
  var humidity = clamp(Number(weather.humidity) || 50, 0, 100)
  var heat = Math.max(0, Number(weather.temperatureC) || 0)
  var windLoad = Math.min(0.34, wind / 140 * 0.34)
  var dryLoad = Math.max(0, (38 - humidity) / 38) + Math.max(0, (heat - 28) / 28) * 0.35

  var ageScalar = 1 + AGE_GAIN * (1 - Math.exp(-ageYears / AGE_TAU))
  // The pot's half-width. Grow owns it (not Paint) because the surface roots
  // have to stay inside the rim — a root that reaches past the terracotta
  // floats in mid-air once the box turns. Paint reads it back off `sk.potR`.
  var potR = potRadiusFor(style, m, ageScalar)
  var girth = Math.pow(ageScalar, 0.62)              // trunk thickens faster than it lengthens
  var ringCount = 1 + Math.floor(Math.min(1200, ageYears) / 3)

  // Where the main boughs leave the trunk has to be known BEFORE the trunk is
  // drawn: the trunk sheds girth at each of those heights (pipe model), which
  // is what keeps a bough from looking screwed onto a parallel-sided pole.
  var boughStart = style === "broom" ? 0.58 : style === "literati" ? 0.78
    : style === "cascade" ? 0.35 : 0.52
  var boughCount = (gen && gen.model && gen.model.boughs) || 3
  var boughTs = []
  for (var bt = 0; bt < boughCount; bt++)
    boughTs.push(boughStart + (0.98 - boughStart) * (boughCount === 1 ? 0.5 : bt / (boughCount - 1)))
  // area still running up the trunk above height t
  function trunkPipe(t) {
    var area = 1
    for (var q = 0; q < boughTs.length; q++)
      if (t > boughTs[q]) area *= (1 - BOUGH_SHARE)
    return Math.sqrt(area)
  }

  var depth = 2 + Math.round(m * (MAX_DEPTH[style] || 6))
  var lenGrow = LEN_MATURE + (1 - LEN_MATURE) * m
  var upright = style !== "cascade" && style !== "windswept"
  var g = (gen && gen.model) || { taper: 0.62, boughs: 3 }
  var facing = (gen && gen.facing) || 0
  var lean = (gen && gen.lean) || 0.1
  var twist = (gen && gen.twist) || 0.4
  var gnarlAmp = (gen && gen.gnarlAmp) || 0.8
  var gnarlFreq = (gen && gen.gnarlFreq) || 2
  var breadth = (gen && gen.breadth) || 0.8
  var droop = (gen && gen.droop) || 0.4
  var vigor = (gen && gen.vigor) || 0.6
  var phyllo = (gen && gen.phyllotaxis) || 2.4
  var taper = (gen && gen.taper) || g.taper || 0.62
  var foliage = (gen && gen.foliage) || 1

  var nodes = []
  var clumps = []
  var clumpN = 0
  var min = [1e9, 1e9, 1e9], max = [-1e9, -1e9, -1e9]

  function expand(p, r) {
    r = r || 0
    for (var i = 0; i < 3; i++) {
      if (p[i] - r < min[i]) min[i] = p[i] - r
      if (p[i] + r > max[i]) max[i] = p[i] + r
    }
  }
  function seg(id, a, b, ra, rb, level, kind) {
    nodes.push({ id: id, a: a, b: b, ra: ra, rb: rb, level: level, kind: kind })
    expand(a, ra); expand(b, rb)
  }
  var leanDir = [Math.cos(facing), 0, Math.sin(facing)]
  var windDir = [Math.cos(facing + 1.7), 0, Math.sin(facing + 1.7)]

  // ---- trunk: a trained line the branches hang off ----------------------
  var trunkH = (TRUNK_H_BASE + TRUNK_H_GROW * m) * ageScalar
  var trunkR = (TRUNK_R_BASE + TRUNK_R_GROW * m) * ageScalar * girth
  var trnd = rngFor(seed, "trunk")
  var ph = trnd() * TAU

  var trunkPts = []      // { p:[x,y,z], r, dir:[x,y,z] }
  for (var i = 0; i <= TRUNK_SEGS; i++) {
    var t = i / TRUNK_SEGS
    var y = t * (trunkH + TRUNK_BURY) - TRUNK_BURY     // foot buried below the soil
    var off = [0, 0, 0]
    // the base is planted straight; the character builds higher up
    var settle = clamp((t - 0.05) / 0.28, 0, 1)
    settle = settle * settle * (3 - 2 * settle)

    if (style === "formal") {
      off = scl(leanDir, Math.sin(t * PI) * gnarlAmp * trunkH * 0.02)
    } else if (style === "slant") {
      off = scl(leanDir, t * lean * trunkH)
    } else if (style === "windswept") {
      off = scl(leanDir, t * t * lean * trunkH * 1.4)
    } else if (style === "literati") {
      off = scl(leanDir, Math.sin(t * gnarlFreq * PI + ph) * gnarlAmp * trunkH * 0.12 + t * lean * trunkH * 0.5)
    } else if (style === "cascade") {
      if (t < 0.4) { y = t * trunkH * 0.55; off = scl(leanDir, t * lean * trunkH * 0.7) }
      else {
        var k = (t - 0.4) / 0.6
        y = 0.22 * trunkH - k * trunkH * 0.62
        off = scl(leanDir, lean * trunkH * 0.5 + k * lean * trunkH * 0.8)
      }
    } else if (style === "broom") {
      off = scl(leanDir, Math.sin(t * PI) * gnarlAmp * trunkH * 0.04)
    } else { // informal / twin
      off = scl(leanDir, Math.sin(t * gnarlFreq * PI + ph) * gnarlAmp * trunkH * 0.05 * (1 + t))
    }
    off = scl(off, settle)                              // planted straight at the foot
    off = add(off, scl(windDir, windLoad * t * t * trunkH * 0.22))
    // spiral the lateral offset a touch as the trunk climbs
    var sp = twist * t * PI * 0.5
    var ox = off[0] * Math.cos(sp) - off[2] * Math.sin(sp)
    var oz = off[0] * Math.sin(sp) + off[2] * Math.cos(sp)
    var p = [ox, y, oz]
    // basal flare / nebari — the trunk swells to a peak right at the soil line
    // (y≈0) and eases off above it, so it reads as rooted rather than propped.
    // Keyed to world height, not t (TRUNK_BURY puts t≈0.45 at the soil).
    var flare = 1 + 0.55 * clamp((4 - Math.abs(y - 1)) / 7, 0, 1)
    // and tuck the BURIED foot back in — otherwise a big old trunk paints a
    // giant hidden disc that spills out past the pot.
    var buriedTuck = y < 0 ? clamp((y + TRUNK_BURY) / TRUNK_BURY + 0.3, 0.32, 1) : 1
    // The trunk's own slow taper is gentle now — most of the narrowing comes
    // from the wood that leaves at each bough.
    var r = trunkR * (1 - 0.46 * t) * trunkPipe(t) * flare * buriedTuck
    trunkPts.push({ p: p, r: r })
  }
  for (var s = 0; s < trunkPts.length; s++) {
    if (s > 0) seg("t" + s, trunkPts[s - 1].p, trunkPts[s].p,
      trunkPts[s - 1].r, trunkPts[s].r, 0, "trunk")
    trunkPts[s].dir = s < trunkPts.length - 1
      ? norm(sub(trunkPts[s + 1].p, trunkPts[s].p))
      : norm(sub(trunkPts[s].p, trunkPts[s - 1].p))
  }
  var trunkTop = trunkPts[trunkPts.length - 1].p

  // ---- surface roots: short buttresses splaying from the foot into the soil,
  // so the trunk and the pot read as one planted thing
  if ((state.origin === "seed" || state.origin === "cutting") && m > 0.06) {
    var rootRng = rngFor(seed, "roots")
    var nRoots = 3 + Math.floor(rootRng() * 3)          // 3..5
    var footX = trunkPts[0].p[0], footZ = trunkPts[0].p[2]
    // The girth the buttresses are carved out of is the trunk's own flare at
    // the soil line — a root is the flare continuing, not a stick leaning on
    // it, so it starts inside the trunk's silhouette and at the flare's radius.
    var flareR = 0
    for (var fp = 0; fp < trunkPts.length; fp++)
      if (trunkPts[fp].p[1] >= 0.2 && trunkPts[fp].p[1] <= 3.0)
        flareR = Math.max(flareR, trunkPts[fp].r)
    if (flareR <= 0) flareR = trunkR
    var rootR = Math.min(flareR * 0.38, 5.2)
    for (var ri = 0; ri < nRoots; ri++) {
      var ra0 = (ri / nRoots) * TAU + (rootRng() - 0.5) * 1.5
      // splay, but never past the soil surface: the rim is the hard stop
      var rlen = Math.min(flareR * (1.1 + rootRng() * 1.0), potR * 0.50)
      var rdx = Math.cos(ra0), rdz = Math.sin(ra0)
      // Three segments along a curve that leaves the trunk almost vertically,
      // rolls over the shoulder of the flare and dives into the soil: the
      // shape a buttress root actually makes, and it keeps the join tangent to
      // the trunk instead of cutting across it.
      var yTop = 2.3 + rootRng() * 0.9
      // A surface root rides PROUD of the soil for most of its run — that
      // ridge is the nebari, and it is the thing you are meant to look at —
      // and only slips under right at the tip.
      var arc = [
        [footX, yTop, footZ],
        [footX + rdx * rlen * 0.34, yTop * 0.74, footZ + rdz * rlen * 0.34],
        [footX + rdx * rlen * 0.78, 1.15 + rootRng() * 0.45, footZ + rdz * rlen * 0.78],
        // The tip finishes just under the soil line: a surface root shows its
        // shoulder for most of its run and then slips into the ground, rather
        // than lying on top of it or stopping dead at the surface.
        [footX + rdx * rlen, -0.55 - rootRng() * 0.4, footZ + rdz * rlen]
      ]
      var rads = [rootR, rootR * 0.74, rootR * 0.42, rootR * 0.16]
      for (var rk = 0; rk < 3; rk++)
        seg("root" + ri, arc[rk], arc[rk + 1], rads[rk], rads[rk + 1], 0, "root")
    }
  }

  // ---- germination: a buried seed / first sprout, no branches ----------
  var origin = state.origin || ""
  var germinating = origin === "seed" && m < 0.03
  if (!origin || germinating || m < 0.045) {
    clumps.push({ id: "seed", c: [0, germinating ? -0.5 : 1.2, 0], r: 2.0, phase: 0, sag: 0, seedling: true })
    if (m >= 0.02 && m < 0.045) {
      // two cotyledons on the sprout tip
      addClump("c.cot0", add(trunkTop, [-1.6, 0.4, 0]), CLUMP_R_BASE * 0.7, 0)
      addClump("c.cot1", add(trunkTop, [1.6, 0.8, 0]), CLUMP_R_BASE * 0.7, 0)
    }
    return finish()
  }

  function addClump(id, c, r, level) {
    if (clumps.length >= CLUMP_CAP) return
    var cut = clamp(prune[id] || 0, 0, 1)
    if (cut >= 0.98) return
    r *= (1 - 0.82 * cut)
    r *= (0.55 + 0.45 * m) * (0.62 + 0.38 * health) * foliage
    if (r < 1.2) return
    var sag = (thirst * 0.55 + dryLoad * 0.22 + windLoad * 0.12) * r
    var rr = rngFor(seed, id + "|ph")
    clumps.push({ id: id, c: [c[0], c[1] - sag, c[2]], r: r, phase: rr() * TAU, sag: sag, level: level || 0 })
  }

  // ---- branches -------------------------------------------------------
  function branch(id, base, dir, length, radius, level, childIdx) {
    if (nodes.length >= NODE_CAP) return
    var rnd = rngFor(seed, id)
    var subs = level < 2 ? 3 : 2
    var cur = base.slice()
    var d = norm(dir)
    // How much this limb has to carry: its own wood, plus foliage that is
    // heavier when it is fruiting and lighter when the tree is starved.
    var load = (0.7 + 0.5 * foliage) * (fruit ? 1.25 : 1) * (0.75 + 0.35 * health)
    for (var k = 0; k < subs; k++) {
      var frac = (k + 0.5) / subs
      // reach toward the light, add a little gnarl
      d = norm(lerp3(d, [0, 1, 0], PHOTOTROPISM * (level + 0.5)))
      d = norm(add(d, scl(windDir, windLoad * (0.55 + level * 0.12))))
      // then let gravity win it back: a cantilever bends more the further out
      // and the thinner it gets, so limb tips curve over instead of shooting
      // out straight
      d = norm(add(d, [0, -sagAt(length, radius, frac, load), 0]))
      var jitter = [(rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.35, (rnd() - 0.5) * 0.5]
      d = norm(add(d, scl(jitter, 0.35 / (level + 1))))
      var next = add(cur, scl(d, length / subs))
      // the branch collar: a short swelling right where it leaves its parent,
      // then a gentle taper of its own — the sharp narrowing happens at forks
      var ra = radius * (1 - k / subs * LIMB_TAPER) * (k === 0 ? COLLAR : 1)
      var rb = radius * (1 - (k + 1) / subs * LIMB_TAPER)
      seg(id, cur, next, Math.max(0.55, ra), Math.max(0.5, rb), level,
        level >= depth - 1 ? "twig" : "branch")
      cur = next
    }
    var end = cur
    var endR = radius * (1 - LIMB_TAPER)      // the girth actually available to children

    var terminal = level >= depth || radius * taper < 0.4
    if (terminal) {
      var cr = CLUMP_R_BASE + CLUMP_R_GROW * (0.4 + 0.6 * (level / depth))
      addClump("c." + id, end, cr, level)
      // a couple of satellite puffs so a lone twig reads as a mass, not a dot
      if (level >= 2) {
        var sr = rngFor(seed, id + "|s")
        addClump("c." + id + "s0", add(end, [(sr() - 0.5) * cr * 1.4, cr * 0.5, (sr() - 0.5) * cr]), cr * 0.66, level)
        addClump("c." + id + "s1", add(end, [(sr() - 0.5) * cr * 1.4, -cr * 0.3, (sr() - 0.5) * cr]), cr * 0.6, level)
      }
      return
    }

    // a little foliage along an inner branch too, for canopy fullness
    if (level >= depth - 2 && rnd() < 0.5)
      addClump("c." + id + "m", lerp3(base, end, 0.7), CLUMP_R_BASE * 0.8, level)

    var kids = level === 0 ? (g.boughs || 3)
      : (rnd() < (0.32 + vigor * 0.3 + m * 0.16) ? 2 : 1)
    if (rnd() < 0.14 && level > 0) kids += 1
    var fr = frame(d)
    // Split the stub's cross-section between the children rather than handing
    // each a fixed fraction of the parent — that is what stopped children from
    // being born fatter than the twig they grow out of.
    var kidR = endR * Math.pow(1 / kids, 0.5) * PIPE_LEAK * (0.72 + 0.45 * taper)
    for (var c = 0; c < kids; c++) {
      var cid = id + "." + c
      if (clamp(prune[cid] || 0, 0, 1) >= 0.98) continue
      var kr = rngFor(seed, cid)
      var azi = phyllo * (childIdx * 3 + c) + (kr() - 0.5) * 0.9
      var tilt = (0.55 + breadth * 0.7) * (0.8 + kr() * 0.5)
      var cd = norm(add(scl(fr[0], Math.cos(tilt)),
        scl(add(scl(fr[1], Math.cos(azi)), scl(fr[2], Math.sin(azi))), Math.sin(tilt))))
      // genus droop pulls outer branches down; phototropism lifts them
      cd = norm(add(cd, [0, -droop * 0.4 + PHOTOTROPISM, 0]))
      if (upright && cd[1] < -0.25) { cd[1] = -0.25; cd = norm(cd) }
      var cl = length * (CHILD_LEN + kr() * 0.18) * lenGrow
      branch(cid, end, cd, cl, kidR, level + 1, childIdx * 3 + c + 1)
    }
  }

  // spawn the main boughs off the upper trunk
  var boughs = g.boughs || 3
  var brnd = rngFor(seed, "boughs")
  for (var b = 0; b < boughs; b++) {
    var bid = "t.b" + b
    if (clamp(prune[bid] || 0, 0, 1) >= 0.98) continue
    var tt = boughStart + (0.98 - boughStart) * (boughs === 1 ? 0.5 : b / (boughs - 1))
    var tp = trunkAt(trunkPts, tt)
    var azi2 = phyllo * b + brnd() * 0.7 + facing
    var fr2 = frame(tp.dir)
    var tilt2 = Math.min(1.0, 0.5 + breadth * 0.35)
    var bd = norm(add(scl(fr2[0], Math.cos(tilt2)),
      scl(add(scl(fr2[1], Math.cos(azi2)), scl(fr2[2], Math.sin(azi2))), Math.sin(tilt2))))
    if (style === "windswept") bd = norm(add(bd, scl(leanDir, 0.6)))
    if (style === "cascade") bd = norm(add(bd, [0, -0.55, 0]))
    // upright styles: a bough never dives back down through the trunk
    if (upright && bd[1] < -0.1) { bd[1] = -0.1; bd = norm(bd) }
    var blen = Math.min(trunkH * 0.6, trunkH * 0.45 * (0.8 + brnd() * 0.5)) * lenGrow
    // exactly the wood the trunk gave up at this height, so nothing appears
    // from nowhere and nothing is left dangling
    branch(bid, tp.p, bd, blen, tp.r * Math.sqrt(BOUGH_SHARE) * PIPE_LEAK, 1, b + 1)
  }
  // broom & literati crown: a burst of branches right at the top
  if (style === "broom" || style === "literati") {
    var cn = style === "broom" ? 4 + Math.round(2 * m) : 3
    for (var q = 0; q < cn; q++) {
      var qid = "t.c" + q
      if (clamp(prune[qid] || 0, 0, 1) >= 0.98) continue
      var qr = rngFor(seed, qid)
      var qa = (q / cn) * TAU + qr() * 0.5
      var qd = norm([Math.cos(qa) * 0.9, 0.7, Math.sin(qa) * 0.9])
      var tipR = trunkPts[trunkPts.length - 1].r
      branch(qid, trunkTop, qd, trunkH * 0.42 * lenGrow,
        tipR * Math.pow(1 / cn, 0.5) * PIPE_LEAK, 1, q + 1)
    }
  }

  return finish()

  function finish() {
    if (min[0] > max[0]) { min = [-4, 0, -4]; max = [4, 6, 4] }
    return {
      nodes: nodes, clumps: clumps,
      bounds: { min: min, max: max },
      trunkTop: trunkTop, style: style, seed: seed,
      genus: (gen && gen.genus) || "juniper",
      ageScalar: ageScalar, ringCount: ringCount,
      needle: (gen && gen.genus) === "pine" || (gen && gen.genus) === "juniper",
      maturity: m, potR: potR,
      thirst: thirst, health: health,
      fruit: fruit
    }
  }
}

// Half-width of the pot the tree is planted in. Deep/upright styles get a
// narrower, taller box; everything else a broad training pot. Kept here so
// Grow and Paint can never disagree about where the rim is.
function potRadiusFor(style, m, ageScalar) {
  var narrow = style === "cascade" || style === "literati"
  return (narrow ? 6.4 : 10.2) * (0.72 + 0.28 * m) * Math.pow(ageScalar, 0.32)
}

// sample the trunk polyline at fraction t (0 base .. 1 top)
function trunkAt(pts, t) {
  var f = clamp(t, 0, 1) * (pts.length - 1)
  var i = Math.min(pts.length - 2, Math.floor(f))
  var u = f - i
  return {
    p: lerp3(pts[i].p, pts[i + 1].p, u),
    r: pts[i].r + (pts[i + 1].r - pts[i].r) * u,
    dir: norm(lerp3(pts[i].dir, pts[i + 1].dir, u))
  }
}
