#!/usr/bin/env node
// sim.js — live a tree's year in a second, through the real Life.js.
//
//   node dev/sim.js                       # every schedule, planted today
//   node dev/sim.js --schedule nightowl --start 2026-12-21 --days 200
//   node dev/sim.js --legacy              # the pre-1.5 rules, for comparison
//
// A schedule says when someone is at the machine and what they do when they
// look in. The tree only lives through PRESENT minutes (idle, locked, asleep
// or away advance nothing), exactly as Service.qml runs it. Reported: days to
// each life stage, how often a need sat urgent, care, fruit and berries — the
// things a person would actually notice over a year.
'use strict'
const P = require('./preview.js')
const Life = P.loadLib('Life.js',
  'RATE,URGENT,UNEASY,GROW_BASE,GROW_CARE,GROW_NORM,FORM_NORM,CARE_TAU,MAX_BERRIES,' +
  'clamp100,dayWindow,hourOf,isDaylight,minute,quality,growth,worstOf,wellbeingOf,stageOf,' +
  'STAGE_LABEL,moodOf,seasonalLine,moodLine,localSeason,ageYears,fruitThresholdDays,sameDate,' +
  'sameDay,careFromLegacy,sun,daylightMinutes')
const T = P.TreeGen

// ---- schedules ---------------------------------------------------------------
// present(dow, hourF) -> bool; visits: hours (fractional) at which they look in
const SCHEDULES = {
  // 9-5 at the desk on weekdays, an hour or two most evenings, a visit each morning
  workday: {
    present: (dow, h) => (dow >= 1 && dow <= 5 && h >= 9 && h < 17) || (h >= 20 && h < 22),
    visits: [9.1]
  },
  // same desk, but the tree only gets looked at on weekdays
  weekdays_only: {
    present: (dow, h) => dow >= 1 && dow <= 5 && h >= 9 && h < 17,
    visits: [9.1], visitDays: [1, 2, 3, 4, 5]
  },
  // works nights, sleeps days: the case the grow lamp exists for
  nightowl: {
    present: (dow, h) => h >= 21 || h < 2,
    visits: [21.1]
  },
  // the same night owl, who never touches the lamp
  nightowl_nolamp: {
    present: (dow, h) => h >= 21 || h < 2,
    visits: [21.1], noLamp: true
  },
  // at the desk but never tends it
  neglect: {
    present: (dow, h) => dow >= 1 && dow <= 5 && h >= 9 && h < 17,
    visits: []
  },
  // looks in once a week, Sunday evening
  weekly: {
    present: (dow, h) => (dow >= 1 && dow <= 5 && h >= 9 && h < 17) || (dow === 0 && h >= 19 && h < 21),
    visits: [19.1], visitDays: [0]
  }
}

// What a person does when they look in: only what the tree is asking for.
function tend (s, env, sched, lampState) {
  const did = []
  if (s.thirst >= 25) { s.thirst = 0; did.push('water') }
  if (s.soil >= 40) { s.soil = 0; did.push('feed') }
  if (s.untidy >= 45) { s.untidy = Math.max(0, s.untidy - 45); did.push('trim') }
  // the lamp after dark when light is asked for; opening the blinds by day
  if (!sched.noLamp && s.light >= 30) { lampState.on = true; did.push('light') }
  return did
}

function run ({ schedule = 'workday', startMs = Date.now(), days = 365, origin = 'cutting',
  deciduous = true, legacy = false, south = false } = {}) {
  const sched = SCHEDULES[schedule]
  if (!sched) throw new Error('no schedule ' + schedule)
  let s = { thirst: 0, light: 0, soil: 0, untidy: 0, care: 100,
    maturity: origin === 'cutting' ? 0.17 : 0.004, berries: 0, berryProgress: 0 }
  // legacy (pre-1.5) care: sampled on care actions only, reset past 320
  let careSum = 0, careCount = 0
  const lamp = { on: false }
  let wasDay = null
  const out = { schedule, origin, legacy, stageDay: {}, presentMin: 0, urgentMin: 0,
    urgentBy: { thirst: 0, light: 0, soil: 0, untidy: 0 }, visits: 0, actions: {},
    berriesGrown: 0, fruitDay: -1, careAt: {}, peak: { thirst: 0, light: 0, soil: 0, untidy: 0 },
    moods: {} }
  const fruitDays = 128   // the middle of fruitThresholdDays' 75..180
  let wallDays = 0
  for (let m = 0; m < days * 1440; m++) {
    const ms = startMs + m * 60000
    const d = new Date(ms)
    const h = d.getHours() + d.getMinutes() / 60
    const dow = d.getDay()
    const season = T.seasonOf(T.dayOfYear(ms, south))
    const day = Life.isDaylight(h, season)
    if (wasDay !== null && day !== wasDay) lamp.on = false   // M3: dusk/dawn put the lamp out
    wasDay = day
    wallDays = m / 1440
    const present = legacy ? true : sched.present(dow, h)   // legacy ticked 24/7
    if (lamp.on) s.light = Math.max(0, s.light - 60)        // 1 %/s
    // the sun runs on the wall clock (1.5+); legacy only drained it while ticking
    if (day && !legacy) s.light = Life.sun(s.light, 1, season)
    if (present) {
      const win = Life.dayWindow(season)
      // legacy compared the WHOLE hour against the fractional window
      const legacyDay = d.getHours() >= win.start && d.getHours() < win.end
      const env = { season, deciduous, daylight: legacy ? legacyDay : day, origin, companionHunger: -1 }
      if (legacy) {
        if (env.daylight) s.light = Life.sun(s.light, 1, season)
        // the old rule: growth on the action-sampled average
        const care = careCount > 0 ? careSum / careCount : 100
        s = Life.minute({ ...s, care }, env)
        s.care = care
      } else {
        s = Life.minute(s, env)
      }
      if (s.berryGrown) out.berriesGrown++
      out.presentMin++
      const w = Life.worstOf(s)
      if (w >= Life.URGENT) {
        out.urgentMin++
        for (const k of ['thirst', 'light', 'soil', 'untidy']) if (s[k] >= Life.URGENT) out.urgentBy[k]++
      }
      for (const k of ['thirst', 'light', 'soil', 'untidy']) out.peak[k] = Math.max(out.peak[k], s[k])
      const mood = Life.moodOf({ initialized: true, planted: true, origin, maturity: s.maturity,
        thirst: s.thirst, light: s.light, soil: s.soil, untidy: s.untidy })
      out.moods[mood] = (out.moods[mood] || 0) + 1
    }
    const isVisitMin = sched.visits.some(v => Math.abs(h - v) < 1 / 120) &&
      (!sched.visitDays || sched.visitDays.includes(dow)) && present
    if (isVisitMin) {
      out.visits++
      if (s.berries >= Life.MAX_BERRIES) { s.berries -= 1; out.actions.pick = (out.actions.pick || 0) + 1 }
      for (const a of tend(s, null, sched, lamp)) {
        out.actions[a] = (out.actions[a] || 0) + 1
        careSum += Life.wellbeingOf(s); careCount++
        if (careCount > 320) { careSum = Life.wellbeingOf(s); careCount = 1 }
      }
    }
    const stage = Life.stageOf(s.maturity)
    if (out.stageDay[stage] === undefined) out.stageDay[stage] = +(m / 1440).toFixed(1)
    if (out.fruitDay < 0 && s.maturity >= 0.78 && wallDays >= fruitDays && s.care >= 82 &&
        Life.wellbeingOf(s) >= 65) out.fruitDay = +(m / 1440).toFixed(1)
    if (m % (30 * 1440) === 0 && m > 0) out.careAt[m / 1440] = +s.care.toFixed(1)
  }
  out.final = { maturity: +s.maturity.toFixed(3), care: +s.care.toFixed(1), berries: s.berries }
  out.urgentPct = out.presentMin ? +(100 * out.urgentMin / out.presentMin).toFixed(1) : 0
  for (const k in out.urgentBy) out.urgentBy[k] = out.presentMin ? +(100 * out.urgentBy[k] / out.presentMin).toFixed(1) : 0
  for (const k in out.peak) out.peak[k] = Math.round(out.peak[k])
  return out
}

module.exports = { run, SCHEDULES, Life }

if (require.main === module) {
  const argv = process.argv.slice(2)
  const val = (n, d) => { const i = argv.indexOf('--' + n); return i >= 0 ? argv[i + 1] : d }
  const flag = n => argv.includes('--' + n)
  const startMs = val('start') ? new Date(val('start') + 'T08:00:00').getTime() : Date.now()
  const days = +val('days', 365)
  const origin = val('origin', 'cutting')
  const names = val('schedule') ? [val('schedule')] : Object.keys(SCHEDULES)
  console.log(`\nplanted ${new Date(startMs).toDateString()} · ${days} days · ${origin}` +
    (flag('legacy') ? ' · LEGACY rules (24/7 ticks, action-sampled care)' : '') + '\n')
  console.log('schedule          young  adol  mature  urgent%  (thirst light soil form)  care@60 care@180  fruit  berries')
  for (const n of names) {
    const r = run({ schedule: n, startMs, days, origin, legacy: flag('legacy') })
    const sd = k => (r.stageDay[k] === undefined ? '-' : String(Math.round(r.stageDay[k]))).padStart(6)
    console.log(n.padEnd(16) + sd('young') + sd('adolescent') + sd('mature') +
      String(r.urgentPct).padStart(8) + '   (' +
      ['thirst', 'light', 'soil', 'untidy'].map(k => String(r.urgentBy[k]).padStart(5)).join(' ') + ')' +
      String(r.careAt[60] ?? '-').padStart(9) + String(r.careAt[180] ?? '-').padStart(9) +
      String(r.fruitDay < 0 ? '-' : Math.round(r.fruitDay)).padStart(7) + String(r.berriesGrown).padStart(9))
  }
  console.log('')
}
