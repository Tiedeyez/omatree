// TreeGen.js — procedural tree generator.
//
// The tree is NOT random per frame. It is derived from a stable per-machine,
// per-user seed, so every user gets a tree that is genuinely theirs — and no
// two machines will ever grow the same one. The same seed always produces the
// same trunk, branching and foliage, so the tree survives restarts.
//
// Coordinate contract (screen space, y grows downward):
//   - The trunk base sits at (0, 0) and grows UPWARD (decreasing y).
//   - `bounds` reports the tight box around every branch + foliage tip, so a
//     renderer can fit the whole tree into the pot/housing.
//   - Each branch carries a control point `q` so a renderer can draw a tapered
//     quadratic curve for an organic limb rather than a straight line.
//
// Shape only advances with growth: maturity (0..1) controls depth, length and
// foliage density. The "form" (neat/tangled) reflects how well it is pruned.

.pragma library

function mulberry32(seed) {
  var a = seed >>> 0
  return function() {
    a = (a + 0x6D2B79F5) >>> 0
    var t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function clamp01(v) { return Math.max(0, Math.min(1, v)) }

function fnv1a(str) {
  var h = 2166136261 >>> 0
  for (var i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

// nameFor(seed): a short, whimsical, one-word name for the tree, built from
// its seed. Every tree gets one; it never changes once set (Service persists
// it). Syllables are assembled from small pools chosen so any combination
// reads as a soft, pronounceable little name — then a filter rejects anything
// that runs harsh or unkind, and the next attempt (same deterministic stream)
// is tried. The reachable set is ~40k names, so two machines sharing one is
// unlikely — not impossible, but unlikely.
var _NAME_ON = ["b", "c", "d", "f", "g", "h", "j", "k", "l", "m", "n", "p",
  "r", "s", "t", "v", "w", "z", "br", "cl", "dr", "fl", "fr", "gl", "gr",
  "pl", "sl", "st", "th", "tr", "wr", "sk", "sn"]
var _NAME_MID = ["b", "d", "f", "g", "k", "l", "m", "n", "p", "r", "s", "t",
  "v", "z", "ll", "mm", "nn", "rr", "ss", "ck", "nd", "nt", "sh", "th"]
var _NAME_V = ["a", "e", "i", "o", "u", "a", "e", "i", "o", "a", "o", "e", "y"]
var _NAME_END = ["", "", "", "", "a", "o", "i", "ie", "el", "en", "in", "na",
  "no", "by", "ka", "o", "a", "ric", "wen", "ora", "ette", "kin", "der", "is"]
// substrings a finished name must never contain (profanity / slur stems /
// obvious rude words) — checked case-insensitively, purely to reject
var _NAME_BAD = /ass|tit|cum|f[uc]k|fck|sht|sex|c[o0]k|cnt|d[i1]k|n[i1]g|fag|kkk|rap|jiz|pis|tur|cra|twa|wan|spi|hom|slu|naz|hor|who|dyk|ret|pen|vag|but|coc|dic|shi|bit|dam|hell|chin|kik|coon|goo|poo|pee|boob|ars|spaz|god|jew|nud|pube|kum|fuq|smeg|felch|phuc|labia|scro|hitl|coom/i

function nameFor(seed) {
  var rnd = mulberry32((seed >>> 0) ^ 0x27d4eb2f)
  rnd(); rnd(); rnd()
  function pick(a) { return a[(rnd() * a.length) | 0] }
  function build() {
    var s = pick(_NAME_ON) + pick(_NAME_V) + pick(_NAME_MID) + pick(_NAME_V)
    if (rnd() < 0.11) s += pick(_NAME_ON.slice(0, 18)) + pick(_NAME_V)
    var e = pick(_NAME_END)
    if (/[aeiou]$/.test(s) && /^[aeiou]/.test(e)) e = e.slice(1)
    s = (s + e).replace(/(.)\1\1+/g, "$1$1")
    return s.charAt(0).toUpperCase() + s.slice(1)
  }
  function acceptable(n) {
    if (n.length < 3 || n.length > 8) return false
    var l = n.toLowerCase()
    if (/[^a-z]/.test(l) || !/[aeiou]/.test(l)) return false
    if (/[aeiou]{3}|[bcdfghjklmnpqrstvwxz]{3}/.test(l)) return false
    if (/([bcdfghjklmnpqrstvwxz][aeiou])\1/.test(l)) return false   // no "nono", "lala"
    if ((l.match(/(ll|mm|nn|rr|ss|tt|ck|pp|bb|dd)/g) || []).length > 1) return false
    if (/(aa|uu|ii|yy)/.test(l)) return false
    if (_NAME_BAD.test(l)) return false
    return true
  }
  for (var t = 0; t < 64; t++) {
    var name = build()
    if (acceptable(name)) return name
  }
  return "Sprout"
}

var GENUS = {
  juniper: { depth: 7, spread: 0.60, droop: 0.5, taper: 0.62, boughs: 3, leaf: "scale" },
  maple:   { depth: 6, spread: 0.82, droop: 0.20, taper: 0.66, boughs: 4, leaf: "fan" },
  pine:    { depth: 8, spread: 0.46, droop: 0.72, taper: 0.55, boughs: 3, leaf: "needle" }
}
var GENUS_NAMES = ["juniper", "maple", "pine"]

// Training styles. Each biases the trunk line and where foliage sits.
// STYLES is the full set Grow.js understands (and dev/timelapse --style can pick);
// STYLE_POOL is what identity actually rolls from — cascade/twin need more work
// before they read well at bar size.
var STYLES = ["formal", "informal", "slant", "cascade", "windswept",
              "literati", "broom", "twin"]
var STYLE_POOL = ["formal", "informal", "informal", "slant", "windswept",
                  "literati", "broom"]

// Unique, stable identity of this user's tree. `genesis()` is the ONLY source of
// per-machine randomness — Grow.js/Paint.js re-derive everything deterministically
// from these numbers, so the same box always grows the same tree.
function genesis(machineId, user) {
  var seed = fnv1a(String(machineId || "") + "|" + String(user || ""))
  var rnd = mulberry32(seed)
  rnd(); rnd(); rnd()                         // mulberry32's first outputs correlate

  var genus = GENUS_NAMES[Math.floor(rnd() * GENUS_NAMES.length)]
  var g = GENUS[genus]
  var style = STYLE_POOL[Math.floor(rnd() * STYLE_POOL.length)]
  var facing = rnd() * 6.2831853               // which way it leans / is viewed at rest

  return {
    seed: seed,
    genus: genus,
    model: g,
    style: style,

    // --- trunk character ---
    facing: facing,                            // azimuth of the lean, radians
    lean: (style === "slant" ? 0.5 : style === "windswept" ? 0.7
          : style === "literati" ? 0.32 : 0.08) + rnd() * 0.18,
    twist: 0.3 + rnd() * 0.7,                  // how much the trunk spirals as it climbs
    gnarlAmp: (style === "formal" ? 0.35 : 1) * (0.5 + rnd() * 0.9),
    gnarlFreq: 1.2 + rnd() * 2.4,

    // --- branching ---
    breadth: 0.55 + rnd() * 0.5,               // angular spread of child branches
    droop: g.droop * (0.7 + rnd() * 0.6),      // how far branches sag from horizontal
    vigor: 0.45 + rnd() * 0.5,                 // probability a branch forks again
    phyllotaxis: 2.2 + rnd() * 0.6,            // radial angle between successive branches
    taper: g.taper * (0.94 + rnd() * 0.12),

    // --- foliage ---
    foliage: 0.7 + rnd() * 0.6,                // clump density / size multiplier
    leafHue: 90 + rnd() * 80,
    leafSat: 0.45 + rnd() * 0.3
  }
}

// grow(gen, maturity, tangled): produce the branch + foliage geometry.
function grow(gen, maturity0, tangled0) {
  var m = clamp01(maturity0 || 0)
  var f = clamp01(tangled0 || 0)
  var model = gen.model
  var rnd = mulberry32(gen.seed ^ 0x9E3779B9)

  var depth = 2 + Math.ceil(m * model.depth)
  var breadth = gen.breadth * (1 + 0.35 * f)
  var scale = 0.85 + 0.25 * m

  var branches = []
  var foliage = []
  var minX = 0, maxX = 0, minY = 0, maxY = 0

  function expand(x, y, r) {
    if (x - r < minX) minX = x - r
    if (x + r > maxX) maxX = x + r
    if (y - r < minY) minY = y - r
    if (y + r > maxY) maxY = y + r
  }

  // The trunk meanders sinusoidally (t advances 0..1 down its length) so it
  // has a gentle balanced S-bend rather than drifting to one side.
  function rec(x, y, ang, len, w, level, t) {
    if (branches.length > 600) return
    if (Math.abs(x) > 46) return   // keep the canopy inside the glass

    // Small symmetric jitter; stronger when wild, gentle when neat & mature.
    var jog = (rnd() - 0.5) * (0.22 + f * 0.7) * (level === 0 ? 0.4 : 1)
    var bend = level === 0 ? Math.sin(Math.PI * t) * gen.twist * 0.5 : 0
    var nAng = ang + jog + bend

    var ex = x + Math.sin(nAng) * len
    var sag = model.droop > 0.5 ? len * 0.04 * rnd() : (rnd() - 0.5) * len * 0.015
    var ey = y - Math.cos(nAng) * len + sag

    var w0 = w
    var w1 = Math.max(0.4, w * model.taper)

    branches.push({ x0: x, y0: y, x1: ex, y1: ey, w0: w0, w1: w1, level: level })
    expand(ex, ey, w1)

    if (level >= depth) {
      if (rnd() < (0.75 - f * 0.1) && foliage.length < 170) {
        var lr = (4 + m * 8) * scale * (0.55 + f * 0.35)
        foliage.push({ x: ex, y: ey, r: lr })
        expand(ex, ey, lr)
      }
      return
    }

    var childCount = level === 0
      ? model.boughs
      : (rnd() < (0.34 + gen.vigor * 0.22 + f * 0.16 + m * 0.14) ? 2 : 1)

    var childLen = len * (0.6 + rnd() * 0.24)
    for (var i = 0; i < childCount; i++) {
      var off = (i - (childCount - 1) / 2) * model.spread * breadth
      var calm = Math.max(0, m * 0.55 - f)
      rec(ex, ey, nAng + off * (0.5 + calm), childLen * (0.8 + rnd() * 0.35),
          w1, level + 1, t + (level === 0 ? 0.5 : 0))
    }
  }

  // Trunk: short, gnarled, winding out of the soil.
  var trunkLen = (30 + 26 * m) * scale
  var trunkW = (3.0 + 2.4 * m) * scale
  rec(0, 0, 0, trunkLen, trunkW, 0, 0)

  return {
    branches: branches,
    foliage: foliage,
    leafCount: foliage.length,
    ringCount: 1 + Math.floor(m * 12),
    bounds: { minX: minX, maxX: maxX, minY: minY, maxY: maxY },
    depth: depth
  }
}
