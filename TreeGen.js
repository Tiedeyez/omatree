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
  pine:    { depth: 8, spread: 0.46, droop: 0.72, taper: 0.55, boughs: 3, leaf: "needle" },

  // Exotic — reachable only through grafting (see exoticGenesis()/fuse()
  // below), never rolled for a solo tree. GENUS_NAMES stays exactly the 3
  // above; a real install's genesis() never sees these.
  //   hue      — a fixed leaf hue (0..1) that breaks the usual theme-tinted
  //              green anchor. Undefined = tinted green like the base 3.
  //   blossom  — scatters a handful of small blossom blobs across the
  //              canopy (Paint.js), same technique as the fruit/berry blobs.
  willow:          { depth: 5, spread: 1.05, droop: 0.92, taper: 0.74, boughs: 3, leaf: "weeping" },
  "crimson-maple": { depth: 6, spread: 0.82, droop: 0.20, taper: 0.66, boughs: 4, leaf: "fan", hue: 0.02 },
  zelkova:         { depth: 7, spread: 0.55, droop: 0.15, taper: 0.60, boughs: 5, leaf: "fine", hue: 0.13 },
  plum:            { depth: 6, spread: 0.70, droop: 0.30, taper: 0.64, boughs: 4, leaf: "fan", blossom: true }
}
var GENUS_NAMES = ["juniper", "maple", "pine"]
var EXOTIC_GENUS_NAMES = ["willow", "crimson-maple", "zelkova", "plum"]

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

// Same identity math as genesis() above, but for a graft-only genus: forces
// the genus instead of rolling from GENUS_NAMES, and — since this is a new
// path with no installed tree depending on its exact numbers — fixes the one
// real gap genesis() has: `breadth` (the angular spread of child branches)
// never actually read the genus's own `spread` value. genesis() itself is
// left completely untouched; every already-planted tree renders exactly as
// it always has.
function exoticGenesis(genusName, machineId, user) {
  var seed = fnv1a(String(machineId || "") + "|" + String(user || "") + "|graft:" + genusName)
  return exoticGenesisFromSeed(seed, genusName) || genesis(machineId, user)   // unknown name -> ordinary tree, never throw
}

// A real tree's own base is one of the 3 solo genera from a real genesis()
// call — tied to real machine identity, and never meant to leave the
// machine. To let a real tree be exported as a graft donor at all, it needs
// a PUBLIC STAND-IN for that base: a one-way hash distinct from every other
// seed this plugin computes (its own "graft-alias:" salt, separate from
// exoticGenesis()'s "graft:" salt), reconstructible only by replaying
// exoticGenesisFromSeed(aliasSeed, genus) — never the real seed itself, and
// not practically invertible back to machineId/user.
function graftAliasSeed(machineId, user, genus) {
  return fnv1a(String(machineId || "") + "|" + String(user || "") + "|graft-alias:" + String(genus || ""))
}

// The seed-only half of exoticGenesis() above — everything about an exotic
// tree is a pure function of (seed, genusName), nothing else, which is what
// makes graft files possible: a graft file ships this pair, never a
// machineId/user, and every field below is regenerated identically by
// whoever imports it. See exportGraft()/importGraft() further down.
function exoticGenesisFromSeed(seed, genusName) {
  seed = seed >>> 0
  var g = GENUS[genusName]
  if (!g) return null                        // unknown genus -> caller's problem, never throw

  var rnd = mulberry32(seed)
  rnd(); rnd(); rnd()

  var style = STYLE_POOL[Math.floor(rnd() * STYLE_POOL.length)]
  var facing = rnd() * 6.2831853
  // 0.7 is roughly the mean `spread` across the 3 live genera (0.60/0.82/0.46),
  // so an exotic with an average spread value still lands in genesis()'s
  // original 0.55-1.05 breadth band; only genuinely wide (willow, 1.05) or
  // narrow (zelkova, 0.55) genera visibly push past it.
  var spreadMid = 0.7

  return {
    seed: seed, genus: genusName, model: g, style: style, facing: facing,
    lean: (style === "slant" ? 0.5 : style === "windswept" ? 0.7
          : style === "literati" ? 0.32 : 0.08) + rnd() * 0.18,
    twist: 0.3 + rnd() * 0.7,
    gnarlAmp: (style === "formal" ? 0.35 : 1) * (0.5 + rnd() * 0.9),
    gnarlFreq: 1.2 + rnd() * 2.4,
    breadth: (0.55 + rnd() * 0.5) * (g.spread / spreadMid),
    droop: g.droop * (0.7 + rnd() * 0.6),
    vigor: 0.45 + rnd() * 0.5,
    phyllotaxis: 2.2 + rnd() * 0.6,
    taper: g.taper * (0.94 + rnd() * 0.12),
    foliage: 0.7 + rnd() * 0.6,
    leafHue: 90 + rnd() * 80,
    leafSat: 0.45 + rnd() * 0.3,
    hue: g.hue,                                // undefined unless the genus breaks the green anchor
    blossom: !!g.blossom
  }
}

// Blend a recipient tree with a donor's — the actual "graft". Seed, style,
// facing and lean stay the recipient's own (a graft changes what a tree IS
// made of, not which way it already leans), everything genus/branch-shaped
// interpolates at weight t (0 = all recipient, 1 = all donor).
//
// t defaults to 0.65, not 0.5: an even split regresses toward the mean of
// whatever's being combined, so a chain of grafts gets BLANDER with every
// step rather than rarer — measured (dev/shot-exotic.js --fuse willow,plum
// starting from an ordinary maple) a 3-trait 50/50 chain diluted willow's
// droop from 0.20 -> 0.56 -> 0.43, ending up unremarkable, exactly backwards
// from what grafting is supposed to feel like.
//
// hue is handled differently from the numeric fields on purpose: lerping it
// against a plain tree's *implicit* green (there is no real hue to blend
// against — `undefined` was standing in for one) is what produced a muddy
// olive instead of a real color. A break in the green anchor is now STICKY —
// it survives being crossed with an ordinary tree at full strength, the way
// a real trait doesn't get "half-inherited" from a parent that never had it.
// Two ACTUAL exotic hues (both sides genuinely break the anchor) still blend
// for real, since that is a real two-way mix, not one side diluting a
// default that was never there.
function fuse(recipient, donor, t) {
  t = (t === 0 || t > 0) ? t : 0.65
  function lerp(a, b) { return a + (b - a) * t }
  var genus = recipient.genus === donor.genus ? recipient.genus : recipient.genus + "+" + donor.genus
  var rHue = recipient.model.hue, dHue = donor.model.hue
  var hue = (rHue !== undefined && dHue !== undefined) ? lerp(rHue, dHue)
    : (dHue !== undefined ? dHue : rHue)   // undefined when neither side ever broke the anchor
  var blossom = !!(recipient.model.blossom || donor.model.blossom)
  var model = {
    taper: lerp(recipient.model.taper, donor.model.taper),
    boughs: Math.max(2, Math.round(lerp(recipient.model.boughs, donor.model.boughs))),
    spread: lerp(recipient.model.spread, donor.model.spread),
    droop: lerp(recipient.model.droop, donor.model.droop),
    depth: Math.round(lerp(recipient.model.depth, donor.model.depth)),
    hue: hue, blossom: blossom
  }
  var out = {}
  for (var k in recipient) out[k] = recipient[k]
  out.genus = genus
  out.model = model
  out.taper = lerp(recipient.taper, donor.taper)
  out.droop = lerp(recipient.droop, donor.droop)
  out.breadth = lerp(recipient.breadth, donor.breadth)
  out.vigor = lerp(recipient.vigor, donor.vigor)
  out.phyllotaxis = lerp(recipient.phyllotaxis, donor.phyllotaxis)
  out.foliage = lerp(recipient.foliage, donor.foliage)
  out.gnarlAmp = lerp(recipient.gnarlAmp, donor.gnarlAmp)
  out.twist = lerp(recipient.twist, donor.twist)
  out.hue = hue
  out.blossom = blossom
  return out
}

// ---------------------------------------------------------------------------
// Graft files — the actual exchange, P2P, no network in the plugin at all.
// A file ships a RECIPE, not a result: a base genus + seed, and a flat list
// of exotic grafts on top of it — never the dozen derived trait numbers.
// importGraft() never trusts a stored trait value; it recomputes every one
// fresh via exoticGenesisFromSeed()/fuse(). That single choice is why there
// is no clamp table anywhere here: the generator's own formulas
// (droop: g.droop * (0.7 + rnd()*0.6), etc.) already bound every field to
// what SOME seed could plausibly produce, for every possible seed — it is
// the one source of truth for valid ranges, forever in sync with itself,
// rather than a second hand-maintained bounds table that could drift from
// it. A forged/hand-edited seed still only ever yields an ordinary member
// of the named genus, never an out-of-range one.
//
// The base is the piece that makes a REAL tree exportable at all — a real
// tree's own genus (juniper/maple/pine) never appears in EXOTIC_GENUS_NAMES,
// and once grafted its genus is a "+"-joined label, not a single exotic
// name either. Neither could ever be exported under a scheme that only
// recognized fresh exotic donors. graftAliasSeed() (above) gives every real
// tree a public, non-identifying stand-in for its base so IT can be the
// base of an exported recipe too — a graft file's `base` is just another
// {genus, genusSeed} pair, reconstructed the exact same way a fresh
// exotic's is.
//
// A `grafts` entry can itself be a full nested {base, grafts} object, not
// just a flat exotic leaf — that's what lets an already-grafted tree be
// re-shared with its whole real lineage intact, satisfying an unbounded,
// community-grown donor pool rather than a fixed catalog. Depth and total
// node count are both hard-capped (GRAFT_MAX_DEPTH / GRAFT_MAX_NODES)
// regardless of what a file claims, so a maliciously deep or wide chain
// costs a bounded amount of computation to reject, never an unbounded one.
//
// What this proves, and what it doesn't: NOTHING here can prove a seed was
// actually earned through real play rather than picked freely — every
// recipient runs the identical open-source math a forger would, and there
// is no server or key in this design to change that. What it DOES
// guarantee is narrower and still real: whatever a file claims, the result
// is bounded to a plausible instance of the named genus at every step,
// nothing more exotic than that. A signed/authenticated version is
// deliberately not attempted, since it would need infrastructure this
// plugin refuses to have (a server, an account, a network call).
var GRAFT_SCHEMA = 2
var GRAFT_MAX_DEPTH = 4     // how many "generations" of nested re-sharing a chain may reference
var GRAFT_MAX_NODES = 40    // total donor reconstructions across one whole chain, however it's shaped

// baseGenus/baseAliasSeed identify the exporter's own base tree (real
// genesis(), via graftAliasSeed() — never the real seed); graftLineage is
// that tree's OWN accumulated graft steps, in the exact shape Service.qml
// stores them (each either a flat exotic leaf or another full recipe).
function exportGraft(baseGenus, baseAliasSeed, graftLineage, treeName) {
  if (typeof baseGenus !== "string" || !GENUS[baseGenus]) return null
  return {
    schemaVersion: GRAFT_SCHEMA,
    treeName: typeof treeName === "string" ? treeName.slice(0, 40) : "",
    base: { genus: baseGenus, genusSeed: (Number(baseAliasSeed) || 0) >>> 0 },
    grafts: Array.isArray(graftLineage) ? graftLineage.slice(0, 8) : []
  }
}

function _graftNode(data, depth, budget) {
  if (depth > GRAFT_MAX_DEPTH || budget.n <= 0) return null
  if (!data || typeof data !== "object") return null
  if (data.schemaVersion !== GRAFT_SCHEMA) return null
  if (!data.base || typeof data.base !== "object") return null
  if (typeof data.base.genus !== "string" || !GENUS[data.base.genus]) return null

  budget.n--
  var baseSeed = Number(data.base.genusSeed)
  if (!isFinite(baseSeed)) baseSeed = 0
  var g = exoticGenesisFromSeed(baseSeed >>> 0, data.base.genus)
  if (!g) return null

  var steps = Array.isArray(data.grafts) ? data.grafts.slice(0, 8) : []
  for (var i = 0; i < steps.length; i++) {
    var step = steps[i]
    if (!step || typeof step !== "object") continue
    var donor = null
    if (step.base) {
      donor = _graftNode(step, depth + 1, budget)          // a re-shared, already-grafted tree
    } else if (typeof step.genus === "string" && EXOTIC_GENUS_NAMES.indexOf(step.genus) >= 0) {
      if (budget.n <= 0) return g
      budget.n--
      var seed = Number(step.genusSeed)
      if (!isFinite(seed)) seed = 0
      donor = exoticGenesisFromSeed(seed >>> 0, step.genus)  // a fresh exotic leaf
    }
    if (donor) g = fuse(g, donor, undefined)
  }
  return g
}

// Returns null on anything malformed rather than throwing — a bad graft
// file fails closed, same instinct as Service.qml's own save-file loader.
// Every seed is coerced with `>>> 0`, which turns literally any input (a
// string, a float, a huge number, NaN) into some valid 32-bit seed rather
// than throwing — an invalid seed can't exist, only an unpredictable one,
// and exoticGenesisFromSeed() bounds whatever it produces regardless.
function importGraft(data) {
  var g = _graftNode(data, 0, { n: GRAFT_MAX_NODES })
  if (!g) return null
  g.treeName = typeof data.treeName === "string"
    ? data.treeName.replace(/[^\x20-\x7e]/g, "").slice(0, 40) : ""
  return g
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
