.pragma library
// Fx.js — the physics of the care effects: water falling through the tree onto
// the soil, light glittering on it and falling out of the sky, and food
// sprinkled onto the soil and drawn up through the tree.
//
// Pure and deterministic given an rng, so dev/fxlab.js renders exactly what the
// panel will play. Everything is in ART-PX on the same frame as Paint's
// hitAreas and `scene` — the caller scales to screen. Output is a flat list of
// axis-aligned rects snapped to the art-pixel grid, so the effect is drawn at
// the same pixel pitch as the tree it lands on (Quickshell has no working
// Canvas; the panel draws these with a pool of Rectangles).
//
// ES5 only: this file also runs inside the QML V4 engine.
//
//   var sim = Fx.create(scene, { rng: Math.random })
//   Fx.water(sim)            Fx.light(sim, ambient)     Fx.feed(sim, veins)
//   Fx.step(sim, dt)         Fx.prims(sim) -> [{ x, y, w, h, c, a, o? }]   (o: draw as an oval)
//   Fx.alive(sim)

var TAU = Math.PI * 2

function clamp(v, a, b) { return v < a ? a : v > b ? b : v }

// ---- tuning --------------------------------------------------------------
// Distances scale with the view height H (art-px), so a sprout's small frame
// and an old tree's big one play at the same apparent speed.
var WATER = {
  count: 52,          // drops per pour
  span: 1.0,          // seconds over which they leave the rose
  g: 5.2,             // gravity, H/s²  (true scale would be ~20; this is a gentle slow-mo)
  vT: 1.9,            // terminal velocity, H/s — drag makes long falls stop accelerating
  // Share of a pour the canopy catches. Decided per DROP, not per clump: a
  // per-clump chance compounds through a dense crown (nine stacked willow
  // clumps caught 0.9x per drop at just 10% each, and the pour vanished into
  // the leaves), where a per-drop share plays the same on any canopy.
  catch: 0.30,
  behind: 0.25,       // share of drops falling behind the foliage/trunk (hidden while they pass it)
  dripHold: [0.18, 0.9],   // seconds a caught drop beads on the leaves before it drips
  splash: true,       // crown droplets thrown up where a drop hits the soil
  ring: true,         // the ripple ring on impact
  wet: true,          // darkening where the soil takes the water, soaking in after
  exposure: 0.022     // seconds of motion blur in a streak
}
var LIGHT = {
  sparks: 26,         // catches of light on the foliage
  sparkLife: [1.4, 3.4],
  twinkleHz: [2.4, 6.0],
  // A lone pixel of pale light is invisible on bright foliage, so most sparks
  // flare into the pixel-art sparkle (a plus) at their peak: the arms are what
  // carry it against the green.
  stars: 0.7,
  flakes: 30,         // glitter falling from the sky
  flakeSpan: 2.4,     // seconds over which flakes keep appearing
  fallV: [0.19, 0.30],     // H/s — it drifts down across the tree in ~3-4 s
  sway: [0.02, 0.05],      // H/s of side-to-side flutter
  spin: [8, 16],      // rad/s a flake tumbles; each facet-on flash is a glint
  settle: 0.38,       // chance a flake that drifts into foliage catches there
  ambientScale: 0.3   // the idle sparkle plays at this fraction
}

// Feeding: pellets sprinkled onto the soil, which settle, dissolve, and are
// TAKEN UP — motes of nutrient running from each pellet to the trunk foot and
// up the real sap path (Paint.veins) to a clump, which flushes as they arrive.
var FEED = {
  pellets: 14,
  span: 0.5,          // seconds over which the hand lets them go
  vT: 3.0,            // H/s — a pellet is denser than a drop, the air slows it less
  bounce: 0.32,       // restitution off the soil
  skitter: 0.35,      // chance a pellet falling into a clump is knocked sideways
  rest: [0.25, 0.7],  // seconds a pellet sits before it starts to dissolve
  dissolve: 0.65,     // seconds to dissolve
  motes: 2,           // nutrient motes per pellet
  // seconds to climb the whole sap path. A time, not a speed: the panel's
  // view has headroom over the tree, so an H-relative speed raced up a small
  // tree and crawled up a tall one.
  climb: [1.1, 1.5],
  flush: 0.8          // seconds a clump glows as the food arrives
}

function create(scene, opts) {
  opts = opts || {}
  return {
    t: 0, scene: scene, rng: opts.rng || Math.random,
    water: merge(WATER, opts.water), light: merge(LIGHT, opts.light), feedCfg: merge(FEED, opts.feed),
    veins: null, flushes: {},
    parts: [], pend: [], lastImpact: -1e9,
    stats: { landed: 0, caught: 0, dripped: 0, lost: 0, motes: 0, arrived: 0 }
  }
}
function merge(base, over) {
  var o = {}, k
  for (k in base) o[k] = base[k]
  if (over) for (k in over) o[k] = over[k]
  return o
}
function rr(sim, a, b) { return a + (b - a) * sim.rng() }

// ---- scene geometry --------------------------------------------------------
// The pot opening is a quad on screen. A drop falling straight down at screen
// x can land anywhere between its far edge and its near edge; which depends
// on how deep in the pot the drop is, so each drop carries a depth d (0 far,
// 1 near) chosen when it is born. That is what spreads the landings over the
// soil instead of lining them up on one guessed row.
function rimSpan(scene, x) {
  var q = scene.rim, lo = 1e9, hi = -1e9
  for (var i = 0; i < 4; i++) {
    var a = q[i], b = q[(i + 1) % 4]
    if ((x < a[0] && x < b[0]) || (x > a[0] && x > b[0]) || a[0] === b[0]) continue
    var y = a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0])
    if (y < lo) lo = y
    if (y > hi) hi = y
  }
  return lo <= hi ? [lo, hi] : null
}
function soilY(scene, x, d) {
  var sp = rimSpan(scene, x)
  if (!sp) return null
  var y = sp[0] + (sp[1] - sp[0]) * d
  // the mound crowns above the rim toward the middle
  var m = scene.mound
  if (m && m.rx > 0 && m.ry > 0) {
    var u = (x - m.cx) / m.rx, v = (y - m.cy) / m.ry
    y -= m.lift * clamp(1 - u * u - v * v, 0, 1)
  }
  return y
}
// the table under the saucer, at depth d (0 far .. 1 near)
function floorY(scene, d) {
  var q = scene.saucer
  if (!q) return null
  var lo = 1e9, hi = -1e9
  for (var i = 0; i < 4; i++) { lo = Math.min(lo, q[i][1]); hi = Math.max(hi, q[i][1]) }
  return lo + (hi - lo) * d + 1
}
function rimTop(scene) {
  var y = 1e9
  for (var i = 0; i < 4; i++) y = Math.min(y, scene.rim[i][1])
  return y
}
function inClump(c, x, y) {
  var u = (x - c.cx) / c.rx, v = (y - c.cy) / c.ry
  return u * u + v * v < 1
}
// behind something in front of it: foliage, or the trunk above the soil
function occluded(scene, p) {
  if (!p.behind) return false
  var cl = scene.clumps
  for (var i = 0; i < cl.length; i++) if (inClump(cl[i], p.x, p.y)) return true
  var t = scene.trunk
  return !!t && p.y < t.y && Math.abs(p.x - t.x) < t.r
}
function canopySpan(scene) {
  var cl = scene.clumps, x0 = 1e9, x1 = -1e9, y0 = 1e9
  for (var i = 0; i < cl.length; i++) {
    x0 = Math.min(x0, cl[i].cx - cl[i].rx); x1 = Math.max(x1, cl[i].cx + cl[i].rx)
    y0 = Math.min(y0, cl[i].cy - cl[i].ry)
  }
  if (x0 > x1) { x0 = scene.w * 0.3; x1 = scene.w * 0.7; y0 = scene.h * 0.3 }
  return { x0: x0, x1: x1, y0: y0 }
}

// ---- spawning ---------------------------------------------------------------
function water(sim) {
  var W = sim.water, sc = sim.scene, H = sc.h
  var r = sc.rim, rx0 = 1e9, rx1 = -1e9
  for (var i = 0; i < 4; i++) { rx0 = Math.min(rx0, r[i][0]); rx1 = Math.max(rx1, r[i][0]) }
  var inset = (rx1 - rx0) * 0.08
  for (var n = 0; n < W.count; n++) {
    var d = sim.rng()
    // aim at a point on the soil: that is what someone watering does
    var tx = rr(sim, rx0 + inset, rx1 - inset)
    var ty = soilY(sc, tx, d)
    if (ty === null) continue
    var p = { k: "w", x: 0, y: 0, vx: 0, vy: 0, d: d, behind: d < W.behind,
              hit: {}, size: sim.rng() < 0.25 ? 2 : 1, catchable: sim.rng() < W.catch }
    // straight down from a rose held above the frame: each drop leaves with
    // a little speed already, directly over the spot it will land on
    p.x = tx
    p.y = rr(sim, -0.06, -0.01) * H
    p.vy = rr(sim, 0.35, 0.55) * H
    sim.pend.push({ at: sim.t + W.span * Math.pow(n / W.count, 1.25) + rr(sim, 0, 0.04), p: p })
  }
}

function feed(sim, veins) {
  var F = sim.feedCfg, sc = sim.scene, H = sc.h
  sim.veins = prepVeins(veins || [])
  var r = sc.rim, rx0 = 1e9, rx1 = -1e9
  for (var i = 0; i < 4; i++) { rx0 = Math.min(rx0, r[i][0]); rx1 = Math.max(rx1, r[i][0]) }
  var inset = (rx1 - rx0) * 0.14
  for (var n = 0; n < F.pellets; n++) {
    var d = rr(sim, 0.15, 0.95), tx = rr(sim, rx0 + inset, rx1 - inset)
    if (soilY(sc, tx, d) === null) continue
    sim.pend.push({ at: sim.t + F.span * n / F.pellets + rr(sim, 0, 0.05), p: {
      k: "p", x: tx, y: -rr(sim, 0.01, 0.05) * H, vx: 0, vy: rr(sim, 0.1, 0.25) * H, d: d,
      behind: d < 0.2, hit: {}, state: 0, bounces: 0, age: 0, big: sim.rng() < 0.5 } })
  }
}
// cumulative lengths, so a mote can be placed by distance along its path
function prepVeins(vs) {
  var out = []
  for (var i = 0; i < vs.length; i++) {
    var v = vs[i], acc = [0], L = 0
    for (var k = 1; k < v.pts.length; k++) {
      var dx = v.pts[k][0] - v.pts[k - 1][0], dy = v.pts[k][1] - v.pts[k - 1][1]
      L += Math.sqrt(dx * dx + dy * dy); acc.push(L)
    }
    if (L > 0) out.push({ id: v.id, pts: v.pts, acc: acc, len: L, cx: v.cx, cy: v.cy, r: Math.max(1, v.r) })
  }
  return out
}
// the point `s` along a vein, displaced `lane` (-1..1) across the wood's
// width — perpendicular to the path, scaled by the radius there
function alongVein(v, s, lane) {
  var a = v.acc, k = 1
  while (k < a.length - 1 && a[k] < s) k++
  var p0 = v.pts[k - 1], p1 = v.pts[k]
  var seg = a[k] - a[k - 1], u = seg > 0 ? clamp((s - a[k - 1]) / seg, 0, 1) : 1
  var x = p0[0] + (p1[0] - p0[0]) * u, y = p0[1] + (p1[1] - p0[1]) * u
  if (lane && seg > 0) {
    var r = ((p0[2] || 0) + ((p1[2] || 0) - (p0[2] || 0)) * u) * 0.7
    x += -(p1[1] - p0[1]) / seg * lane * r
    y += (p1[0] - p0[0]) / seg * lane * r
  }
  return [x, y]
}
// a bigger clump drinks more: pick one weighted by its size
function pickVein(sim) {
  var vs = sim.veins, tot = 0
  for (var i = 0; i < vs.length; i++) tot += vs[i].r * vs[i].r
  var x = sim.rng() * tot
  for (var j = 0; j < vs.length; j++) { x -= vs[j].r * vs[j].r; if (x <= 0) return vs[j] }
  return vs[vs.length - 1]
}

function light(sim, ambient) {
  var L = sim.light, sc = sim.scene, H = sc.h
  var k = ambient === true ? L.ambientScale : 1
  var cl = sc.clumps
  var nS = Math.round(L.sparks * k), nF = Math.round(L.flakes * k)
  for (var i = 0; i < nS; i++) {
    var px, py
    if (cl.length) {
      var c = cl[Math.floor(sim.rng() * cl.length)]
      // uniform in the ellipse, biased toward its lit upper half
      var a = sim.rng() * TAU, rad = Math.sqrt(sim.rng())
      px = c.cx + Math.cos(a) * rad * c.rx * 0.9
      py = c.cy - Math.abs(Math.sin(a)) * rad * c.ry * 0.9 * (sim.rng() < 0.7 ? 1 : -1)
    } else { px = sc.w * rr(sim, 0.4, 0.6); py = H * rr(sim, 0.3, 0.5) }
    sim.pend.push({ at: sim.t + rr(sim, 0, 1.6), p: {
      k: "g", x: px, y: py, age: 0, life: rr(sim, L.sparkLife[0], L.sparkLife[1]),
      hz: rr(sim, L.twinkleHz[0], L.twinkleHz[1]), ph: sim.rng() * TAU,
      star: sim.rng() < L.stars, big: sim.rng() < 0.3 } })
  }
  var span = canopySpan(sc), wid = span.x1 - span.x0
  for (var j = 0; j < nF; j++) {
    sim.pend.push({ at: sim.t + L.flakeSpan * j / Math.max(1, nF) + rr(sim, 0, 0.25), p: {
      k: "f", x: rr(sim, span.x0 - wid * 0.12, span.x1 + wid * 0.12), y: -rr(sim, 0.01, 0.05) * H,
      x0: 0, age: 0, vy: rr(sim, L.fallV[0], L.fallV[1]) * H,
      sway: rr(sim, L.sway[0], L.sway[1]) * H, sw: rr(sim, 1.4, 2.8), sph: sim.rng() * TAU,
      spin: rr(sim, L.spin[0], L.spin[1]), spp: sim.rng() * TAU, d: sim.rng(),
      gold: sim.rng() < 0.45, state: 0, stuck: 0, hit: {}, behind: sim.rng() < 0.3 } })
  }
}

// ---- integration ------------------------------------------------------------
function step(sim, dt) {
  dt = clamp(dt, 0, 0.05)
  // substeps keep fast drops from tunnelling through a thin clump
  var n = Math.max(1, Math.ceil(dt / 0.008))
  for (var s = 0; s < n; s++) substep(sim, dt / n)
}

function substep(sim, dt) {
  sim.t += dt
  var sc = sim.scene, H = sc.h, W = sim.water, L = sim.light
  for (var q = sim.pend.length - 1; q >= 0; q--) {
    if (sim.pend[q].at <= sim.t) {
      var np = sim.pend[q].p
      if (np.k === "f") np.x0 = np.x
      sim.parts.push(np); sim.pend.splice(q, 1)
    }
  }
  var g = W.g * H, kDrag = W.g / (W.vT * W.vT * H)   // quadratic drag, 1/px
  var out = []
  for (var i = 0; i < sim.parts.length; i++) {
    var p = sim.parts[i]
    if (p.k === "w" || p.k === "s" || p.k === "m") {
      var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
      if (!p.float) {
        p.vx += -kDrag * sp * p.vx * dt
        p.vy += (g - kDrag * sp * p.vy) * dt
      }
      p.x += p.vx * dt; p.y += p.vy * dt
      if (p.k === "w") {
        {
          // caught by the leaves: beads, then drips from under the clump
          var cl = sc.clumps, caught = false
          for (var c = 0; c < cl.length && !caught; c++) {
            if (p.hit[c] || !inClump(cl[c], p.x, p.y)) continue
            p.hit[c] = true
            // a catchable drop beads on one of the first clumps it meets; a
            // drip has already been through the leaves and falls clear
            if (p.catchable && !p.drip && sim.rng() < 0.55) {
              caught = true
              sim.stats.caught++
              out.push({ k: "b", x: p.x, y: p.y, age: 0, hold: rr(sim, W.dripHold[0], W.dripHold[1]),
                         c: c, d: p.d, behind: p.behind, hit: p.hit })
              if (W.splash) for (var m = 0; m < 2; m++)
                out.push({ k: "m", x: p.x, y: p.y, vx: rr(sim, -0.12, 0.12) * H, vy: rr(sim, -0.10, 0.02) * H,
                           age: 0, life: rr(sim, 0.12, 0.26), d: p.d, behind: p.behind })
            }
          }
          if (caught) continue
        }
        var sy = soilY(sc, p.x, p.d)
        if (sy !== null && p.y >= sy) { sim.stats.landed++; (sim.stats.landT = sim.stats.landT || []).push(sim.t); impact(sim, out, p, sy, sp); continue }
        // missed the pot: it comes down on the table the saucer stands on,
        // with a small splash and nothing to soak into
        var fl = floorY(sc, p.d)
        if (sy === null && fl !== null && p.y >= fl) {
          sim.stats.lost++
          if (W.splash) out.push({ k: "s", x: p.x, y: fl - 0.5, vx: rr(sim, -0.1, 0.1) * H, vy: -rr(sim, 0.08, 0.16) * H,
                                   floor: fl, age: 0, life: 0.4, d: p.d, behind: false })
          continue
        }
        if (p.y > H + 4 || p.x < -12 || p.x > sc.w + 12) { sim.stats.lost++; continue }
      } else {
        p.age += dt
        if (p.k === "s" && p.vy > 0 && p.y >= p.floor) continue
        if (p.age > p.life) continue
      }
    } else if (p.k === "b") {
      p.age += dt
      if (p.age >= p.hold) {
        // it runs to the clump's lower edge and lets go from there
        var cc = sc.clumps[p.c], u = clamp((p.x - cc.cx) / cc.rx, -0.95, 0.95)
        var by = cc.cy + cc.ry * Math.sqrt(1 - u * u) * 0.85
        sim.stats.dripped++
        out.push({ k: "w", x: p.x, y: Math.max(p.y, by), vx: 0, vy: 0.04 * H, d: p.d,
                   behind: p.behind, hit: p.hit, size: 1, drip: true })
        continue
      }
    } else if (p.k === "r" || p.k === "wet") {
      p.age += dt
      if (p.k === "r" && p.age > p.life) continue
      if (p.k === "wet" && sim.t - sim.lastImpact > 0.6 && p.age > 0.5) {
        p.soak += dt
        if (p.soak > 2.4) continue
      }
    } else if (p.k === "p") {
      if (!stepPellet(sim, p, dt, out)) continue
    } else if (p.k === "seep" || p.k === "fl") {
      p.age += dt
      if (p.age > p.life) continue
    } else if (p.k === "n") {
      p.age += dt
      if (p.age < 0) { out.push(p); continue }
      var FC = sim.feedCfg
      if (p.phase === 0) {
        // through the soil to the trunk foot
        p.u += dt / p.toFoot
        if (p.u >= 1) { p.phase = 1; p.s = 0 }
      } else {
        // up the sap path, a little quicker as the wood narrows
        p.s += p.v.len / p.climb * dt * (0.8 + 0.5 * p.s / p.v.len)
        if (p.s >= p.v.len) {
          sim.stats.arrived++
          var key = p.v.id, f = sim.flushes[key]
          if (!f || f.age > f.life * 0.5) {
            f = { k: "fl", x: p.v.cx, y: p.v.cy, r: p.v.r, age: 0, life: FC.flush, behind: false }
            sim.flushes[key] = f
            out.push(f)
          } else f.age = Math.min(f.age, 0.1)
          for (var sp2 = 0; sp2 < 2; sp2++)
            out.push({ k: "m", x: p.v.cx + rr(sim, -1, 1) * p.v.r * 0.5, y: p.v.cy + rr(sim, -1, 0.3) * p.v.r * 0.4,
                       vx: rr(sim, -0.05, 0.05) * H, vy: -rr(sim, 0.04, 0.1) * H, age: 0, life: rr(sim, 0.25, 0.45),
                       c: "nutrient", behind: false, float: true })
          continue
        }
      }
    } else if (p.k === "g") {
      p.age += dt
      if (p.age > p.life) continue
    } else if (p.k === "f") {
      p.age += dt
      if (p.state === 0) {
        p.y += p.vy * dt
        p.x = p.x0 + Math.sin(p.age * p.sw + p.sph) * p.sway / p.sw
        var cls = sc.clumps
        for (var f = 0; f < cls.length; f++) {
          if (p.hit[f] || !inClump(cls[f], p.x, p.y)) continue
          p.hit[f] = true
          if (sim.rng() < L.settle) { p.state = 1; p.stuck = rr(sim, 0.9, 1.8); p.age2 = 0 }
          break
        }
        var fy = soilY(sc, p.x, p.d)
        if (p.state === 0 && fy !== null && p.y >= fy) { p.state = 1; p.stuck = rr(sim, 0.5, 1.1); p.age2 = 0 }
        // missing the pot, it goes out as it drops past the rim toward the floor
        if (p.state === 0 && fy === null && p.y > rimTop(sc)) { p.state = 1; p.stuck = 0.35; p.age2 = 0 }
        if (p.y > H + 2) continue
      } else {
        p.age2 += dt
        if (p.age2 > p.stuck) continue
      }
    }
    out.push(p)
  }
  sim.parts = out
}

// a pellet: falls, may be knocked aside by the leaves, bounces on the soil
// (and off the rim wall), settles, sits, dissolves into a seep that feeds motes
function stepPellet(sim, p, dt, out) {
  var F = sim.feedCfg, sc = sim.scene, H = sc.h, W = sim.water
  p.age += dt
  if (p.state === 0) {
    var g = W.g * H, k = W.g / (F.vT * F.vT * H)
    var sp = Math.sqrt(p.vx * p.vx + p.vy * p.vy)
    p.vx += -k * sp * p.vx * dt
    p.vy += (g - k * sp * p.vy) * dt
    p.x += p.vx * dt; p.y += p.vy * dt
    if (p.bounces === 0) {
      var cl = sc.clumps
      for (var c = 0; c < cl.length; c++) {
        if (p.hit[c] || !inClump(cl[c], p.x, p.y)) continue
        p.hit[c] = true
        if (sim.rng() < F.skitter) { p.vy *= 0.35; p.vx += rr(sim, -0.16, 0.16) * H }
      }
    }
    // the rim wall turns it back in rather than letting it roll off the soil
    var span = rimSpan(sc, p.x)
    if (p.bounces > 0 && !span) { p.x -= p.vx * dt; p.vx = -p.vx * 0.5; span = rimSpan(sc, p.x) }
    var sy = soilY(sc, p.x, p.d)
    if (sy !== null && p.y >= sy && p.vy > 0) {
      p.y = sy
      if (p.bounces < 2 && p.vy > 0.12 * H) {
        p.bounces++
        p.vy = -p.vy * F.bounce
        p.vx = p.vx * 0.5 + rr(sim, -0.08, 0.08) * H * (p.bounces === 1 ? 1 : 0.5)
      } else {
        p.state = 1; p.vx = 0; p.vy = 0; p.restT = rr(sim, F.rest[0], F.rest[1]); p.age = 0
      }
    }
    var fl = floorY(sc, p.d)
    if (sy === null && fl !== null && p.y >= fl) { p.y = fl; p.state = 3; p.age = 0; return true }
    if (sy === null && p.y > H + 2) return false
    return true
  }
  // knocked off the pot onto the table: it lies there a moment and is gone
  if (p.state === 3) return p.age < 1.2
  if (p.state === 1) {
    if (p.age >= p.restT) {
      p.state = 2; p.age = 0
      out.push({ k: "seep", x: p.x, y: p.y + 0.5, age: 0, life: F.dissolve + 1.4, asp: soilAspect(sc), behind: false })
      if (sim.veins && sim.veins.length) {
        var foot = sim.veins[0].pts[0]
        for (var m = 0; m < F.motes; m++) {
          var v = pickVein(sim)
          var dx = foot[0] - p.x, dy = foot[1] - p.y
          sim.stats.motes++
          out.push({ k: "n", x: p.x, y: p.y, x0: p.x, y0: p.y, v: v, phase: 0, u: 0, s: 0,
                     toFoot: clamp(Math.sqrt(dx * dx + dy * dy) / (0.35 * H), 0.12, 0.6),
                     age: -rr(sim, 0.1, F.dissolve), wob: sim.rng() * TAU, lane: rr(sim, -0.85, 0.85), behind: false,
                     climb: rr(sim, F.climb[0], F.climb[1]) })
        }
      }
    }
    return true
  }
  return p.age < F.dissolve
}

function impact(sim, out, p, sy, speed) {
  var W = sim.water, H = sim.scene.h
  sim.lastImpact = sim.t
  var aspect = soilAspect(sim.scene)
  if (W.ring) out.push({ k: "r", x: p.x, y: sy, age: 0, life: 0.34, asp: aspect, d: p.d, behind: false })
  if (W.wet) {
    // one patch per neighbourhood: a pour darkens an area, not 34 dots
    var near = null
    for (var i = 0; i < out.length && !near; i++) {
      var o = out[i]
      if (o.k === "wet" && Math.abs(o.x - p.x) < 5 && Math.abs(o.y - sy) < 3) near = o
    }
    for (var j = 0; j < sim.parts.length && !near; j++) {
      var o2 = sim.parts[j]
      if (o2.k === "wet" && Math.abs(o2.x - p.x) < 5 && Math.abs(o2.y - sy) < 3) near = o2
    }
    if (near) { near.amt = Math.min(1, near.amt + 0.3); near.x += (p.x - near.x) * 0.3 }
    else out.push({ k: "wet", x: p.x, y: sy, age: 0, soak: 0, amt: 0.55, asp: aspect, behind: false })
  }
  if (W.splash) {
    var crown = speed > 0.9 * H ? 3 : 2
    for (var c = 0; c < crown; c++) {
      var up = Math.min(0.5, 0.11 + speed / H * 0.09)
      out.push({ k: "s", x: p.x, y: sy - 0.5, vx: rr(sim, -0.16, 0.16) * H, vy: -rr(sim, 0.5, 1) * up * H,
                 floor: sy, age: 0, life: 0.5, d: p.d, behind: false })
    }
  }
}
function soilAspect(scene) {
  var m = scene.mound
  return m && m.rx > 0 ? clamp(m.ry / m.rx, 0.2, 0.6) : 0.35
}

// drops a viewer can actually see right now (in the air, not hidden)
function visibleDrops(sim) {
  var n = 0
  for (var i = 0; i < sim.parts.length; i++) {
    var p = sim.parts[i]
    if (p.k === "w" && !occluded(sim.scene, p)) n++
  }
  return n
}

function alive(sim) { return sim.parts.length > 0 || sim.pend.length > 0 }

// ---- drawing ----------------------------------------------------------------
// Colours are keys the caller maps to its theme:
//   water waterHi splash wet glint gold star pellet pelletHi nutrient nutrientHi flush
function prims(sim) {
  var out = [], sc = sim.scene, W = sim.water, H = sc.h
  for (var i = 0; i < sim.parts.length; i++) {
    var p = sim.parts[i]
    if (p.k === "wet") {
      var fadeIn = clamp(p.age / 0.35, 0, 1), soak = 1 - clamp(p.soak / 2.4, 0, 1)
      var rx = 1.2 + 1.8 * fadeIn + p.amt * 1.2
      ellipseFill(out, p.x, p.y, rx, Math.max(0.6, rx * p.asp), "wet", 0.42 * p.amt * fadeIn * soak * soak)
    }
  }
  for (var s2 = 0; s2 < sim.parts.length; s2++) {
    var sp2 = sim.parts[s2]
    if (sp2.k === "seep") {
      var ks = sp2.age / sp2.life
      ellipseFill(out, sp2.x, sp2.y, 1.2 + 2.2 * Math.sqrt(ks), Math.max(0.6, (1.2 + 2.2 * Math.sqrt(ks)) * sp2.asp), "wet", 0.34 * (1 - ks))
    }
  }
  for (var j = 0; j < sim.parts.length; j++) {
    var q = sim.parts[j]
    if (occluded(sc, q)) continue
    if (q.k === "w") {
      // a streak as long as the drop travels in one exposure, head brightest
      var tx = q.x - q.vx * W.exposure, ty = q.y - q.vy * W.exposure
      var len = Math.sqrt((q.x - tx) * (q.x - tx) + (q.y - ty) * (q.y - ty))
      if (len > 6) { tx = q.x - (q.x - tx) * 6 / len; ty = q.y - (q.y - ty) * 6 / len }
      line(out, tx, ty, q.x, q.y, "water", q.drip ? 0.7 : 0.8, q.size)
      out.push(px(q.x, q.y, "waterHi", 0.95, q.size))
    } else if (q.k === "b") {
      out.push(px(q.x, q.y, "waterHi", 0.55 + 0.4 * Math.sin(q.age * 20), 1))
    } else if (q.k === "m" || q.k === "s") {
      out.push(px(q.x, q.y, q.c || "splash", q.k === "m" ? 0.8 * (1 - q.age / q.life) : 0.85, 1))
    } else if (q.k === "r") {
      var k = q.age / q.life, rxr = 1 + 3.2 * Math.sqrt(k)
      ellipseRing(out, q.x, q.y, rxr, Math.max(0.5, rxr * q.asp), "splash", 0.75 * (1 - k))
    } else if (q.k === "p") {
      var fade = q.state === 2 ? 1 - q.age / sim.feedCfg.dissolve : q.state === 3 ? 1 - q.age / 1.2 : 1
      if (q.big && fade > 0.5) {
        out.push({ x: Math.floor(q.x) - 1, y: Math.floor(q.y) - 1, w: 2, h: 2, c: "pellet", a: fade })
        out.push({ x: Math.floor(q.x) - 1, y: Math.floor(q.y) - 1, w: 1, h: 1, c: "pelletHi", a: 0.8 * fade })
      } else out.push({ x: Math.floor(q.x), y: Math.floor(q.y) - 1, w: 1, h: 1, c: "pellet", a: fade })
    } else if (q.k === "n") {
      nutrient(out, q)
    } else if (q.k === "fl") {
      var k2 = q.age / q.life, glow = Math.sin(Math.PI * Math.min(1, k2 * 1.6)) * (1 - k2 * 0.4)
      // the leaves themselves brightening — their own colour, lifted — not a
      // tint laid over them (the accent read as a grey smudge on teal leaves)
      ellipseFill(out, q.x, q.y, q.r * 0.8, q.r * 0.6, "flush", 0.34 * glow)
    } else if (q.k === "g") {
      spark(out, q)
    } else if (q.k === "f") {
      flake(out, q)
    }
  }
  return out
}

// a mote of food: a bright head and a short fading tail back along its path
function nutrient(out, q) {
  if (q.age < 0) return
  var a = clamp(q.age / 0.15, 0, 1)
  var head, t1, t2
  if (q.phase === 0) {
    var foot = q.v.pts[0], u = q.u, u1 = Math.max(0, u - 0.18), u2 = Math.max(0, u - 0.36)
    head = [q.x0 + (foot[0] - q.x0) * u, q.y0 + (foot[1] - q.y0) * u]
    t1 = [q.x0 + (foot[0] - q.x0) * u1, q.y0 + (foot[1] - q.y0) * u1]
    t2 = [q.x0 + (foot[0] - q.x0) * u2, q.y0 + (foot[1] - q.y0) * u2]
    a *= 0.7                        // still in the soil: dimmer
  } else {
    // each mote keeps to its own channel across the wood, drifting a little
    var ln = q.lane + Math.sin(q.s * 0.35 + q.wob) * 0.12
    head = alongVein(q.v, q.s, ln); t1 = alongVein(q.v, q.s - 2, ln); t2 = alongVein(q.v, q.s - 4, ln)
  }
  q.x = head[0]; q.y = head[1]
  out.push({ x: Math.floor(t2[0]), y: Math.floor(t2[1]), w: 1, h: 1, c: "nutrient", a: 0.25 * a })
  out.push({ x: Math.floor(t1[0]), y: Math.floor(t1[1]), w: 1, h: 1, c: "nutrient", a: 0.5 * a })
  out.push({ x: Math.floor(head[0]), y: Math.floor(head[1]), w: 1, h: 1, c: "nutrientHi", a: 0.95 * a })
}

function spark(out, q) {
  // an envelope in and out, and inside it an uneven twinkle: sin² of one rate
  // beating against a second, so no two sparks wink in step and none wink
  // evenly. (sin³ was crisper but left each spark dark two-thirds of the time.)
  var env = clamp(q.age / 0.18, 0, 1) * clamp((q.life - q.age) / 0.35, 0, 1)
  var w1 = Math.max(0, Math.sin(q.age * q.hz * TAU + q.ph))
  var w2 = 0.5 + 0.5 * Math.sin(q.age * q.hz * 1.73 * TAU + q.ph * 2.1)
  var b = env * (0.26 + 0.74 * w1 * w1 * (0.6 + 0.4 * w2))
  if (b < 0.04) return
  var sz = q.big && b > 0.5 ? 2 : 1
  out.push(px(q.x, q.y, b > 0.8 ? "star" : "glint", Math.min(1, b * 1.1), sz))
  if (q.star && b > 0.55) {
    var arm = b > 0.88 ? 2 : 1, a = Math.min(1, (b - 0.55) / 0.3)
    var cx = Math.floor(q.x) + (sz > 1 ? 0.5 : 0), cy = Math.floor(q.y) + (sz > 1 ? 0.5 : 0)
    out.push({ x: Math.floor(cx - arm), y: Math.floor(q.y), w: arm, h: 1, c: "glint", a: 0.65 * a })
    out.push({ x: Math.floor(q.x) + sz, y: Math.floor(q.y), w: arm, h: 1, c: "glint", a: 0.65 * a })
    out.push({ x: Math.floor(q.x), y: Math.floor(cy - arm), w: 1, h: arm, c: "glint", a: 0.65 * a })
    out.push({ x: Math.floor(q.x), y: Math.floor(q.y) + sz, w: 1, h: arm, c: "glint", a: 0.65 * a })
  }
}

function flake(out, q) {
  // a tumbling flat flake: dim edge-on, a hard glint each time a face turns to
  // the light — |cos|^8 makes the flash short, which is what reads as glitter
  var face = Math.abs(Math.cos(q.age * q.spin + q.spp))
  var flash = Math.pow(face, 8)
  var env = clamp(q.age / 0.3, 0, 1)
  if (q.state === 1) env *= 1 - clamp(q.age2 / q.stuck, 0, 1)
  var b = env * (0.28 + 0.72 * flash)
  if (b < 0.05) return
  var c = flash > 0.7 ? "star" : q.gold ? "gold" : "glint"
  out.push(px(q.x, q.y, c, Math.min(1, b), 1))
  if (flash > 0.7 && env > 0.5) {
    out.push({ x: Math.floor(q.x) - 1, y: Math.floor(q.y), w: 1, h: 1, c: "glint", a: 0.45 * b })
    out.push({ x: Math.floor(q.x) + 1, y: Math.floor(q.y), w: 1, h: 1, c: "glint", a: 0.45 * b })
    out.push({ x: Math.floor(q.x), y: Math.floor(q.y) - 1, w: 1, h: 1, c: "glint", a: 0.45 * b })
    out.push({ x: Math.floor(q.x), y: Math.floor(q.y) + 1, w: 1, h: 1, c: "glint", a: 0.45 * b })
  }
}

// ---- pixel-grid primitives ----------------------------------------------------
function px(x, y, c, a, size) {
  var s = size || 1
  return { x: Math.floor(x - (s - 1) / 2), y: Math.floor(y - (s - 1) / 2), w: s, h: s, c: c, a: a }
}
// a 1-px line from (x0,y0) to (x1,y1), merged into runs so a near-vertical
// streak is one rect rather than a stack of squares
function line(out, x0, y0, x1, y1, c, a, thick) {
  var X0 = Math.floor(x0), Y0 = Math.floor(y0), X1 = Math.floor(x1), Y1 = Math.floor(y1)
  var dx = X1 - X0, dy = Y1 - Y0, n = Math.max(Math.abs(dx), Math.abs(dy))
  var w = thick > 1 ? 2 : 1
  if (n === 0) return
  var runX = X0, runY = Y0, runLen = 1
  for (var i = 1; i < n; i++) {             // the head pixel is drawn by the caller
    var x = Math.round(X0 + dx * i / n), y = Math.round(Y0 + dy * i / n)
    if (x === runX && y === runY + runLen) { runLen++; continue }
    out.push({ x: runX, y: runY, w: w, h: runLen, c: c, a: a * 0.75 })
    runX = x; runY = y; runLen = 1
  }
  out.push({ x: runX, y: runY, w: w, h: runLen, c: c, a: a })
}
// a filled ellipse as ONE rect flagged oval (o: 1): the panel draws it as a
// fully rounded Rectangle, the lab as a true pixel ellipse. Row-by-row it cost
// a rect per scanline, and a feed's flushing clumps alone ran past 200.
function ellipseFill(out, cx, cy, rx, ry, c, a) {
  if (a <= 0.01) return
  var x0 = Math.round(cx - rx), y0 = Math.round(cy - ry)
  out.push({ x: x0, y: y0, w: Math.max(1, Math.round(cx + rx) - x0), h: Math.max(1, Math.round(cy + ry) - y0), c: c, a: a, o: 1 })
}
function ellipseRing(out, cx, cy, rx, ry, c, a) {
  if (a <= 0.02) return
  var y0 = Math.floor(cy - ry), y1 = Math.floor(cy + ry)
  for (var y = y0; y <= y1; y++) {
    var v = (y + 0.5 - cy) / ry
    if (v * v >= 1) continue
    var hw = rx * Math.sqrt(1 - v * v)
    var xa = Math.round(cx - hw), xb = Math.round(cx + hw) - 1
    if (y === y0 || y === y1) { out.push({ x: xa, y: y, w: Math.max(1, xb - xa + 1), h: 1, c: c, a: a }); continue }
    out.push({ x: xa, y: y, w: 1, h: 1, c: c, a: a })
    if (xb > xa) out.push({ x: xb, y: y, w: 1, h: 1, c: c, a: a })
  }
}
