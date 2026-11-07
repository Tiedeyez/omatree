// Life.js — the tree's care clock, in one place.
//
// Everything that decides how the tree lives — how fast each need rises, when
// it is day, how well kept it has been, how fast it grows, what it says — is a
// pure function here. Service.qml runs it once per present minute, TreeBridge
// derives the bar's read-only view from it, and dev/sim.js + dev/test-life.js
// run the very same file under node, so the numbers in the tests are the
// numbers on the desk. No Qt types, no I/O, no clock reads: every input is an
// argument.
//
// Scales: needs are 0 (fine) .. 100 (critical). care is 0..100. maturity 0..1.
// One "minute" is one minute of the person actually being at the machine —
// an idle, locked or sleeping machine does not advance the tree's needs.
.pragma library

// ---- pacing -----------------------------------------------------------------
// Per present minute; ~480 present minutes is a working day. Tuned so ONE
// unhurried visit a day is enough, each need on roughly the rhythm real
// cultivation moves on.
var RATE = {
  thirst: 0.125,      // water: URGENT / 480 — asks right at the end of an 8 h day
  lightDark: 0.085,   // light: rises only while it is dark and you are here
  lightSun: 0.11,     // ...and the day's own light drains it back
  soil: 0.013,        // feeding: every couple of weeks in the growing season
  form: 0.007         // shape: seasonal work, never a nag
}
var URGENT = 60       // a need at or past this is what the tree talks about
var UNEASY = 35       // ...and past this it is merely "alright"

// Growth: a well-kept tree crosses into a mature one in about two months of
// daily use; a neglected one still grows, at a sixth of the pace.
var GROW_BASE = 0.000008
var GROW_CARE = 0.000040
// mean over the calendar year of the seasonal growth factor
// (1 - 0.6 dormant + 0.5 fresh) is 0.8774, so a whole year averages out to
// exactly the unseasoned pace. dev/test-life.js re-derives both constants.
var GROW_NORM = 1.1397
// shoots run in spring and stop in the winter rest; same normalisation idea
// for (1 - 0.8 dormant + 0.6 fresh)
var FORM_NORM = 1.2106

// How well the tree has been kept is a time-weighted average of how it has
// actually felt, minute by minute — not a sample taken only when someone
// happens to tend it (which read a never-tended tree as perfectly kept).
// A minute counts fully while no need is urgent, then fades to nothing as the
// worst need runs from URGENT to 100, so a tree watered once a day, a little
// late, is still a well-kept tree. The window is about three working days.
var CARE_TAU = 1440

var BERRY_RATE = 0.00028
var MAX_BERRIES = 2

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)) }
function clamp100(v) { return clamp((v === 0 || v > 0) ? Number(v) : 0, 0, 100) }

// ---- the day ----------------------------------------------------------------
// The days draw in for winter: sunrise moves later and sunset earlier. At the
// summer solstice the day runs 06:00-20:00, at the winter one about
// 07:36-16:48 — a mid-latitude day on local clock time (the off-centre noon is
// daylight saving, which is what a wall clock actually shows).
function dayWindow(season) {
  var dark = season && season.dark >= 0 ? season.dark : 0.5
  return { start: 6 + 1.6 * dark, end: 20 - 3.2 * dark }
}
// hour as a fraction (14.5 = 14:30), so the day turns on the minute, not on
// the next whole hour after it
function hourOf(ms) {
  var d = new Date(Number(ms) || 0)
  return d.getHours() + d.getMinutes() / 60
}
function isDaylight(hourF, season) {
  var w = dayWindow(season)
  return hourF >= w.start && hourF < w.end
}

// ---- one present minute -----------------------------------------------------
// s:   { thirst, light, soil, untidy, care, maturity, berries, berryProgress }
// env: { season, deciduous, daylight, origin, companionHunger (-1 = none) }
// Returns a NEW state plus { berryGrown } — the input is never mutated.
function minute(s, env) {
  var se = env.season || { dormant: 0, fresh: 0, dark: 0.5 }
  var rest = se.dormant || 0
  var fresh = se.fresh || 0
  var o = {
    thirst: clamp100(s.thirst), light: clamp100(s.light),
    soil: clamp100(s.soil), untidy: clamp100(s.untidy),
    care: (s.care === 0 || s.care > 0) ? clamp100(s.care) : 100,
    maturity: clamp(Number(s.maturity) || 0, 0, 1),
    berries: clamp(Math.round(Number(s.berries) || 0), 0, MAX_BERRIES),
    berryProgress: clamp(Number(s.berryProgress) || 0, 0, 1),
    berryGrown: false
  }

  // Winter rest slows everything a tree asks for: a dormant tree drinks less
  // (a bare one much less) and wants no feeding.
  o.thirst = Math.min(100, o.thirst + RATE.thirst * (1 - (env.deciduous ? 0.45 : 0.25) * rest))
  // Light: the hours you keep it company after dark are hours it spends awake
  // without sun, so the need builds — more in winter, the grow lamp's job.
  // The sun's side of the ledger is sun() below: it runs on the real clock
  // whether or not anyone is at the desk, because a tree on a windowsill gets
  // the day's light while you sleep.
  if (!env.daylight) o.light = Math.min(100, o.light + RATE.lightDark * (1 + 0.7 * se.dark))
  o.soil = Math.min(100, o.soil + RATE.soil * (1 - 0.7 * rest))
  // a dormant tree puts out no shoots; spring's flush puts out the most
  o.untidy = Math.min(100, o.untidy + RATE.form * FORM_NORM * (1 - 0.8 * rest + 0.6 * fresh))

  var worst = Math.max(o.thirst, o.light, o.soil, o.untidy)
  o.care += (100 * quality(worst) - o.care) / CARE_TAU

  o.maturity = Math.min(1, o.maturity + growth(o.maturity, env.origin, o.care, se))

  // Berries ripen slowly, only while the tree is genuinely well right now, so
  // a bad stretch pauses them without erasing progress. A hungry companion
  // pulls them faster, up to double.
  if (o.maturity > 0.30 && o.berries < MAX_BERRIES) {
    var wb = 100 - worst
    var berryCare = Math.max(0, (wb - 45) / 55)
    var pull = env.companionHunger >= 0 ? clamp(env.companionHunger, 0, 100) / 100 : 0
    o.berryProgress += BERRY_RATE * berryCare * (1 + pull)
    if (o.berryProgress >= 1) { o.berryProgress = 0; o.berries += 1; o.berryGrown = true }
  }
  return o
}

// The day's light, for `minutes` minutes of daylight: weaker in the short, low
// days of winter. Applied on the wall clock, present or not.
function sun(light, minutes, season) {
  var dark = season && season.dark >= 0 ? season.dark : 0.5
  return Math.max(0, clamp100(light) - Math.max(0, minutes) * RATE.lightSun * (1 - 0.5 * dark))
}
// How many minutes of [fromMs, toMs) fell in daylight — for the gap after a
// suspend or a shell restart, so the sun that shone meanwhile still counts.
// Capped at three days; season taken as constant across the gap.
function daylightMinutes(fromMs, toMs, season) {
  var a = Number(fromMs) || 0, b = Math.min(Number(toMs) || 0, a + 3 * 86400000)
  if (!(b > a)) return 0
  var n = 0
  for (var t = a; t < b; t += 300000) {
    if (isDaylight(hourOf(t + 150000), season)) n += Math.min(5, (b - t) / 60000)
  }
  return n
}

// 1 while nothing is urgent, falling to 0 as the worst need reaches 100
function quality(worst) {
  return clamp((100 - worst) / (100 - URGENT), 0, 1)
}

// maturity gained this minute. A seed dawdles until it has roots; a cutting
// is already established and races ahead early on.
function growth(maturity, origin, care, season) {
  var se = season || { dormant: 0, fresh: 0 }
  var g = GROW_BASE + GROW_CARE * clamp100(care) / 100
  if (origin === "seed" && maturity < 0.14) g *= 0.45
  else if (origin === "cutting" && maturity < 0.4) g *= 1.4
  return g * GROW_NORM * (1 - 0.6 * (se.dormant || 0) + 0.5 * (se.fresh || 0))
}

// ---- reading the tree -------------------------------------------------------
function worstOf(n) { return Math.max(clamp100(n.thirst), clamp100(n.light), clamp100(n.soil), clamp100(n.untidy)) }
function wellbeingOf(n) { return Math.round(100 - worstOf(n)) }

function stageOf(m) {
  if (m >= 0.95) return "mature"
  if (m >= 0.6) return "adolescent"
  if (m >= 0.25) return "young"
  return "seedling"
}
var STAGE_LABEL = { seedling: "Seedling", young: "Young tree", adolescent: "Adolescent", mature: "Mature tree" }

// o: { initialized, planted, origin, maturity, thirst, light, soil, untidy }
function moodOf(o) {
  if (!o.initialized) return "waking"
  if (!o.planted) return "unsown"
  if (o.origin === "seed" && o.maturity < 0.02) return "germinating"
  if (o.maturity < 0.06) return "sapling"
  if (o.thirst >= URGENT) return "thirsty"
  if (o.light >= URGENT) return "shaded"
  if (o.soil >= URGENT) return "hungry"
  if (o.untidy >= URGENT) return "wild"
  if (worstOf(o) >= UNEASY) return "meh"
  return "flourishing"
}

// What the time of year sounds like when nothing more pressing needs saying —
// only past the sapling stage, and only what is true of this tree: an
// evergreen does not talk about dropping its leaves.
// o: { planted, maturity, season, blossom, deciduous, light }
function seasonalLine(o) {
  if (!o.planted || o.maturity < 0.06) return ""
  var se = o.season || {}
  if (o.blossom && se.bloom > 0.4) return "I am in flower."
  if (se.snow > 0.4)
    return o.light >= 30 ? "The days are short. I would like more light."
      : "Snow on my branches. I am resting."
  if (o.deciduous) {
    if (se.cover < 0.98 && se.dormant > 0) return "I am letting a few leaves go."
    if (se.turn > 0.35 && se.fresh < 0.2) return "I am turning for autumn."
    if (se.fresh > 0.4) return "I am putting out new leaves."
    return ""
  }
  if (se.dormant > 0.6) return "I am keeping my needles through the cold."
  if (se.fresh > 0.4) return "I have new growth at my tips."
  return ""
}

// Everything the tree says, it says as itself.
function moodLine(mood, origin, seasonal) {
  switch (mood) {
  case "waking": return "I am waking up…"
  case "unsown": return "Bare soil. I am not planted yet."
  case "germinating": return "I am underground still. Give me time."
  case "sapling": return origin === "cutting" ? "I am finding my feet." : "I am small, but I am here."
  case "thirsty": return "My soil has gone dry."
  case "shaded": return "I am reaching for the light."
  case "hungry": return "My roots are hungry."
  case "wild": return "I have gone shaggy. Trim me?"
  case "meh": return seasonal !== "" ? seasonal : "I am alright. Growing quietly."
  default: return seasonal !== "" ? seasonal : "I am flourishing."
  }
}

// ---- the calendar, as it actually is where you are -------------------------
// Snow is the one season mark that is plainly false in a warm place. When a
// local weather reading is to hand (the weather plugin's cache), snow fades
// out between 0 and 6 °C and is gone above; with no reading the calendar
// stands as it is. Returns a copy; the calendar itself is never touched.
function localSeason(season, weather) {
  if (!season) return season
  var t = weather && (weather.temperatureC === 0 || weather.temperatureC) ? Number(weather.temperatureC) : NaN
  if (!isFinite(t) || !(season.snow > 0)) return season
  var o = {}
  for (var k in season) o[k] = season[k]
  o.snow = season.snow * clamp((6 - t) / 6, 0, 1)
  return o
}

// Combined age in years: mostly the time spent together, with a slower nod to
// the calendar. Feeds Grow.js's asymptotic size creep.
function ageYears(activeMinutes, wallDays) {
  return (Math.max(0, activeMinutes) / (60 * 24 * 365)) * 0.6 + (Math.max(0, wallDays) / 365) * 0.4
}

function fruitThresholdDays(seed) { return 75 + ((Number(seed) >>> 0) % 106) }

// same calendar day, same year — "struck the day the companion hatched"
function sameDate(aMs, bMs) {
  if (!(aMs > 0) || !(bMs > 0)) return false
  var a = new Date(aMs), b = new Date(bMs)
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
// same month and day, any year — an anniversary
function sameDay(aMs, bMs) {
  if (!(aMs > 0) || !(bMs > 0)) return false
  var a = new Date(aMs), b = new Date(bMs)
  return a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}

// Care quality for a save written before 1.5 (careSum/careCount sampled on
// care actions only): carry it over rather than resetting anyone's history.
function careFromLegacy(careSum, careCount) {
  return careCount > 0 ? clamp100(careSum / careCount) : 100
}
