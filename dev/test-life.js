#!/usr/bin/env node
// test-life.js — the care clock's promises, as assertions.
//
//   node dev/test-life.js        # exits non-zero on the first broken promise
//
// Every number here comes from the same Life.js the shell runs. Each test is
// a sentence about how the tree should feel to live with; if a tuning change
// breaks one, the change is wrong or the sentence is, and that is a decision
// to make on purpose, not to discover from a user.
'use strict'
const assert = require('assert')
const { run, Life } = require('./sim.js')
const T = require('./preview.js').TreeGen

let passed = 0
function test (name, fn) {
  try { fn(); passed++; console.log('  ok   ' + name) } catch (e) {
    console.log('  FAIL ' + name + '\n       ' + e.message); process.exitCode = 1
  }
}
const at = (iso) => new Date(iso + 'T08:00:00').getTime()
const SEASONS = ['2026-11-07', '2027-01-15', '2027-03-20', '2027-06-21', '2027-09-22']
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg}: ${a} vs ${b} (±${eps})`)

console.log('\nLife.js — constants')
test('GROW_NORM is the inverse of the year-mean seasonal growth factor', () => {
  let a = 0; for (let d = 0; d < 365; d++) { const s = T.seasonOf(d); a += 1 - 0.6 * s.dormant + 0.5 * s.fresh }
  near(Life.GROW_NORM, 365 / a, 0.001, 'GROW_NORM')
})
test('FORM_NORM is the inverse of the year-mean shoot factor', () => {
  let a = 0; for (let d = 0; d < 365; d++) { const s = T.seasonOf(d); a += 1 - 0.8 * s.dormant + 0.6 * s.fresh }
  near(Life.FORM_NORM, 365 / a, 0.001, 'FORM_NORM')
})
test('thirst reaches URGENT at the end of an 8 h day', () => {
  near(Life.URGENT / Life.RATE.thirst, 480, 1, 'minutes to urgent')
})

console.log('\nLife.js — one minute')
test('minute() never mutates its input and keeps every need in 0..100', () => {
  const s = { thirst: 99.99, light: 99.99, soil: 99.99, untidy: 99.99, care: 50, maturity: 0.5, berries: 0, berryProgress: 0 }
  const copy = JSON.stringify(s)
  const se = T.seasonOf(200)
  let o = s
  for (let i = 0; i < 2000; i++) o = Life.minute(o, { season: se, deciduous: true, daylight: false, origin: 'seed', companionHunger: -1 })
  assert.strictEqual(JSON.stringify(s), copy)
  for (const k of ['thirst', 'light', 'soil', 'untidy', 'care']) assert.ok(o[k] >= 0 && o[k] <= 100, k + ' ' + o[k])
  assert.ok(o.maturity <= 1)
})
test('garbage in a save cannot poison the clock (NaN, strings, negatives)', () => {
  const o = Life.minute({ thirst: 'x', light: NaN, soil: -40, untidy: 1e9, care: undefined, maturity: 'y', berries: 9, berryProgress: -1 },
    { season: T.seasonOf(10), deciduous: false, daylight: true, origin: 'cutting', companionHunger: 500 })
  for (const k of ['thirst', 'light', 'soil', 'untidy', 'care', 'maturity', 'berries', 'berryProgress']) assert.ok(isFinite(o[k]), k)
  assert.ok(o.berries <= Life.MAX_BERRIES)
})
test('care is time-weighted: a tree nobody tends loses it, one kept well keeps it', () => {
  const se = T.seasonOf(200), env = { season: se, deciduous: true, daylight: true, origin: 'cutting', companionHunger: -1 }
  let left = { thirst: 0, light: 0, soil: 0, untidy: 0, care: 100, maturity: 0.5 }
  for (let i = 0; i < 480 * 10; i++) left = Life.minute(left, env)
  assert.ok(left.care < 40, 'neglected care ' + left.care)
  let kept = { thirst: 0, light: 0, soil: 0, untidy: 0, care: 100, maturity: 0.5 }
  for (let i = 0; i < 480 * 10; i++) { kept = Life.minute(kept, env); if (i % 480 === 0) { kept.thirst = 0; kept.soil = 0; kept.untidy = 0 } }
  assert.ok(kept.care > 95, 'kept care ' + kept.care)
})
test('the sun drains light only by day, and less in winter', () => {
  assert.strictEqual(Life.sun(50, 60, T.seasonOf(200)) < Life.sun(50, 60, T.seasonOf(355)), true)
  assert.strictEqual(Life.sun(0, 600, T.seasonOf(200)), 0)
})

console.log('\nLife.js — the day')
test('the day turns on the minute, not the next whole hour (winter solstice 07:36)', () => {
  const w = T.seasonOf(355)
  assert.strictEqual(Life.isDaylight(7.5, w), false)
  assert.strictEqual(Life.isDaylight(7.65, w), true)
  assert.strictEqual(Life.isDaylight(16.75, w), true)
  assert.strictEqual(Life.isDaylight(16.85, w), false)
})
test('day length runs 14 h at midsummer to ~9.2 h at midwinter', () => {
  const s = Life.dayWindow(T.seasonOf(172)), w = Life.dayWindow(T.seasonOf(355))
  near(s.end - s.start, 14, 0.05, 'summer'); near(w.end - w.start, 9.2, 0.05, 'winter')
})
test('daylightMinutes over one whole summer day is the day length', () => {
  const t0 = new Date('2027-06-21T00:00:00').getTime()
  near(Life.daylightMinutes(t0, t0 + 86400000, T.seasonOf(172)), 14 * 60, 5, 'minutes')
})
test('daylightMinutes is capped at three days and safe on a backwards clock', () => {
  const t0 = new Date('2027-06-21T00:00:00').getTime()
  assert.ok(Life.daylightMinutes(t0, t0 + 30 * 86400000, T.seasonOf(172)) <= 3 * 14 * 60 + 5)
  assert.strictEqual(Life.daylightMinutes(t0, t0 - 3600000, T.seasonOf(172)), 0)
})

console.log('\nLife.js — the calendar where you are')
test('no snow above 6 °C, full snow at or below 0 °C, untouched with no reading', () => {
  const w = T.seasonOf(10)
  assert.strictEqual(Life.localSeason(w, { temperatureC: 12 }).snow, 0)
  assert.strictEqual(Life.localSeason(w, { temperatureC: -3 }).snow, w.snow)
  assert.strictEqual(Life.localSeason(w, {}), w)
  assert.strictEqual(Life.localSeason(w, null), w)
  assert.ok(w.snow > 0.9, 'the calendar itself is never touched')
})
test('a "twin" shares the full date; a birthday only the month and day', () => {
  const a = new Date('2026-03-04T10:00:00').getTime()
  assert.strictEqual(Life.sameDate(a, new Date('2025-03-04T10:00:00').getTime()), false)
  assert.strictEqual(Life.sameDate(a, new Date('2026-03-04T23:00:00').getTime()), true)
  assert.strictEqual(Life.sameDay(a, new Date('2025-03-04T10:00:00').getTime()), true)
})
test('a pre-1.5 save keeps its care history', () => {
  assert.strictEqual(Life.careFromLegacy(900, 10), 90)
  assert.strictEqual(Life.careFromLegacy(0, 0), 100)
})

console.log('\nliving with it — a year in each schedule, planted in every season')
for (const start of SEASONS) {
  const w = run({ schedule: 'workday', startMs: at(start) })
  // 3-9 weeks; one planted in deep winter waits for spring, so up to 11
  test(`${start} workday: a cutting matures in 3-11 weeks`, () => {
    assert.ok(w.stageDay.mature >= 21 && w.stageDay.mature <= 77, 'mature on day ' + w.stageDay.mature)
  })
  test(`${start} workday: light, soil and shape never go urgent with one visit a day`, () => {
    assert.strictEqual(w.urgentBy.light + w.urgentBy.soil + w.urgentBy.untidy, 0, JSON.stringify(w.urgentBy))
  })
  test(`${start} workday: well-kept enough for fruit on its threshold day`, () => {
    assert.ok(w.fruitDay >= 128 && w.fruitDay <= 140, 'fruit on day ' + w.fruitDay)
  })
  const s = run({ schedule: 'workday', startMs: at(start), origin: 'seed' })
  test(`${start} workday: a seed matures in 5-15 weeks, after a cutting would`, () => {
    assert.ok(s.stageDay.mature >= 35 && s.stageDay.mature <= 105, 'mature on day ' + s.stageDay.mature)
    assert.ok(s.stageDay.mature > w.stageDay.mature)
  })
  const n = run({ schedule: 'neglect', startMs: at(start) })
  test(`${start} neglect: still grows, but at least 3x slower; never fruits`, () => {
    assert.ok(n.stageDay.mature === undefined || n.stageDay.mature >= 3 * w.stageDay.mature, 'neglect mature ' + n.stageDay.mature)
    assert.strictEqual(n.fruitDay, -1)
    assert.ok(n.final.maturity > 0.6, 'a neglected tree is not a dead one: ' + n.final.maturity)
  })
  const o = run({ schedule: 'nightowl', startMs: at(start) })
  test(`${start} night owl with the lamp: the dark is not held against them`, () => {
    assert.ok(o.urgentPct < 3, 'urgent ' + o.urgentPct + '%')
  })
}
test('night owl without a lamp: only the dark half of the year asks for it', () => {
  const winter = run({ schedule: 'nightowl_nolamp', startMs: at('2026-12-01'), days: 60 })
  const summer = run({ schedule: 'nightowl_nolamp', startMs: at('2027-06-01'), days: 60 })
  assert.ok(winter.urgentBy.light > 30, 'winter ' + winter.urgentBy.light)
  assert.strictEqual(summer.urgentBy.light, 0, 'summer ' + summer.urgentBy.light)
})
test('the southern hemisphere lives the same year, half a year turned', () => {
  const n = run({ schedule: 'workday', startMs: at('2027-01-15') })
  const s = run({ schedule: 'workday', startMs: at('2027-07-15'), south: true })
  near(n.stageDay.mature, s.stageDay.mature, 4, 'days to mature')
})
test('a weekly visit is not enough, and the tree says so', () => {
  const r = run({ schedule: 'weekly', startMs: at('2027-03-20') })
  assert.ok(r.urgentPct > 50 && r.final.care < 50, JSON.stringify({ u: r.urgentPct, c: r.final.care }))
})
test('the old rules were broken the way the audit says (regression witness)', () => {
  const n = run({ schedule: 'neglect', startMs: at('2026-11-07'), legacy: true })
  const w = run({ schedule: 'workday', startMs: at('2026-11-07'), legacy: true })
  assert.ok(n.stageDay.mature < w.stageDay.mature, 'legacy: neglect out-grew a kept tree')
})

console.log(`\n${passed} passed${process.exitCode ? ', SOME FAILED' : ''}\n`)
