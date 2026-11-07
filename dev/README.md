# Omatree — dev / time travel

The tree grows over weeks of use and its light follows the wall clock, so the
full arc never plays live. Three ways to see it.

## Pipeline

`TreeGen.genesis` (identity) → `Grow.js` (3D skeleton) → `Paint.js` (project +
turntable + shade → draw list) → `Raster.js` (BMP data URL for a QtQuick Image;
Quickshell has no working Canvas). `dev/preview.js` runs the same draw list
through a software rasteriser to ANSI half-blocks, so the terminal and the panel
can't drift.

## 0. The care clock — `dev/sim.js`, `dev/test-life.js`

Everything the tree lives by (need pacing, the day, care, growth, its voice)
is `Life.js`, the same file the shell runs. These live a year of it in a
second, minute by minute, for several kinds of user — a 9-to-5 desk, weekdays
only, a night owl with and without the lamp, someone who never tends it, a
weekly visitor — and only present minutes move the tree, as on the desk.

```sh
node dev/sim.js                                   # every schedule, planted today
node dev/sim.js --start 2027-01-15 --origin seed  # a seed sown in midwinter
node dev/sim.js --legacy                          # the pre-1.5 rules, for comparison
node dev/test-life.js                             # the promises, as assertions
```

Change a rate in `Life.js` and run the tests: each one is a sentence about how
the tree should feel to live with, so a failure is a decision to make on
purpose.

## 1. Still frames as PNG — `dev/shot.js`

```sh
node dev/shot.js out.png --seed me --maturity 0.8 --yaw 0.6
node dev/shot.js grid.png --gallery 12 --maturity 0.85 --scale 3
node dev/shot.js old.png  --age 400 --maturity 1        # the ancient-tree size creep
```

```sh
node dev/shot.js desk.png --desktop                     # the on-wallpaper ornament
```

Flags: `--seed N|me  --gallery N  --genus juniper|pine|maple  --style formal|informal|slant|cascade|windswept|literati|broom|twin`
`--maturity F  --age YEARS  --yaw RAD  --pitch RAD  --hour F  --thirst F  --health F  --lamp`
`--light  --accent "#rrggbb"  --scale N  --art N  --case  --desktop`.

`--case` and `--desktop` pin the yaw/pitch that `Omatree.qml` uses for the cased
panel view and the desktop ornament respectively, so a change can be checked in
the viewpoint it actually ships in. `--yaw`/`--pitch` override either.

## 2. Scrub the arc in the terminal — `dev/timelapse.js`

```sh
node dev/timelapse.js                 # life: seed→mature, clock cycling
node dev/timelapse.js --spin          # hold growth, rotate the turntable
node dev/timelapse.js --still --maturity 0.4 --hour 19
node dev/timelapse.js --gallery 12
```

Same flags as `shot.js` plus `--secs N --fps N --loop`. Needs a truecolor
terminal. Ctrl-C to quit.

## 3. Freeze the real panel — `dev/override.json`

Drop an `override.json` next to this file and restart the shell; the live panel
holds that state. Empty it (`{}`) or delete it to go back to normal.

```jsonc
{ "maturity": 1, "age": 200, "yaw": 1.4, "clock": "20:30", "water": 70 }
```

| key | meaning |
|-----|---------|
| `maturity` | 0..1 — growth (omit → live) |
| `age` | years — extra asymptotic size creep on top of maturity (omit → live) |
| `yaw` | radians — pin the turntable angle (omit → the persisted `yaw`) |
| `clock` | `"HH:MM"` or hour — pins the sun / day-night (omit → wall clock) |
| `water` `light` `soil` `upkeep` | 0..100 need levels (omit → live) |
| `season` | `"early-spring"` `"spring"` `"summer"` `"autumn"` `"late-autumn"` `"winter"`, or a day of the year 0..364 (omit → the calendar) |

Overrides only touch what's displayed; the persisted state file is left alone.
`override.json` is gitignored.

## 4. Tune the care effects — `dev/fxlab.js`

Water and light are particle physics in `Fx.js` (gravity with drag, the canopy
catching and dripping water, drops passing behind foliage, impacts on the real
soil from Paint's `scene`; twinkling sparkles and falling glitter). The lab runs
that same file over the real tree:

```sh
node dev/fxlab.js out/ --set water                 # every water variant
node dev/fxlab.js out/ --set light --only L0,L2    # today's baseline vs the new
node dev/fxlab.js out/ --set water --at 0.4,0.8,1.2   # those moments, full size
```

Per variant: a GIF, a contact sheet of the active window, a "trail" (every frame
stacked, so trajectories show in one image), and a metrics line — duration,
peak rects (the panel's Rectangle pool is 240), visible drops or lit points per
frame, and where the water went (landed / caught / dripped / lost).

In the live shell, `qs ipc -p /usr/share/omarchy/shell call tiedeyez.omatree.fx
preview water` (or `light`, `ambient`) plays an effect in the open panel without
watering anything.

## 5. Seasons, styles and the README images

`TreeGen.seasonOf(doy)` turns a day of the year into smooth 0..1 curves
(`turn`, `cover`, `fresh`, `bloom`, `dormant`, `snow`, `dark`); Service
computes the day, Paint draws from the curves, the care clock slows with
`dormant`, and the light need follows `dark` (shorter days, faster need).

```sh
node dev/shot.js fall.png --seed 7 --genus maple --season autumn
node dev/shot.js plum.png --seed 7 --genus plum --season early-spring
node dev/shot.js c.png --seed 7 --style cascade          # any style, trained as a planting would be
node dev/sweep.js --n 4000 --maturity 1 --train          # the pool new plantings roll from
node dev/sweep.js --n 3000 --maturity 0.4 --style cascade
node dev/gallery.js                                      # rebuild docs/*.png
```

A cascade is judged on its own bands in `sweep.js`: its fall must clear the pot
wall (`clear`, in rims) and end down the pot's side (`drop`, in pot depths).

## State file

`~/.local/state/omarchy/omatree-state.json` carries `origin` (""|"seed"|"cutting"),
the one-time fruit lifecycle, and `seedAvailable` for a berry seed carried
between pots on the same machine,
`prune` (`{ clumpId: 0..1 }` — clump-id strings from Grow.js), `yaw` (the
turntable pose), and `trainStyle` (the style chosen at planting; empty for a
tree planted before 1.4, which keeps its identity's style). Clear `origin` to get the planting chooser back.

## Panel controls

- **Rotate**: drag the tree, or middle-click (scroll-wheel click) to step it 30°.
  Keyboard: focus the tree (arrow-key once to wake the cursor) then ← →.
- **Keyboard**: ↑↓/jk move between the tree and the water/lamp/feed/trim/settings
  targets, Enter/Space activates, letters w/f/p are shortcuts. In trim mode ↑↓
  pick a cluster, Enter cuts, Esc leaves trim (Esc again closes the panel).
- The render loop is paced to ~30fps (`Omatree.qml frameInterval`); the BMP
  re-encode is coalesced so a fast drag or held key never stalls input.
- The **official Omarchy logo** from `https://omarchy.org/brand/omarchy-logo.svg` is etched into the front-facing wall of the pot so it reads cleanly in the desktop ornament and stays visible to the user.

## Desktop controls

Out on the wallpaper there is no panel chrome, so the tree carries its own:

- **Click** the tree to open a small quick menu above it — WATER / TRIM / LIGHT.
  Clicking again (or acting) closes it; clicking with the menu closed and no
  action taken summons the full panel.
- **TRIM** puts the tree into prune mode in place. A **DONE** tab appears at the
  top-right of the bed to leave it — it deliberately lives outside the quick
  menu, which closes the moment TRIM is pressed.
- **Middle-click and drag** to rotate the turntable; the angle is persisted
  through the Service like any other orbit change.
- **Hover** to reveal `◂ TAKE ME HOME`, which puts the tree back in the bar.

`~/.local/state/omarchy/omatree-companion.json` publishes the tree's screen-space
footprint (saucer rim + two branch platforms) so a bar pet can walk on it.

## Companion (Omagotchi) fusion

`Creature.qml` is the companion, shared by `BarWidget.qml` (a perch in the
canopy) and `Panel.qml` (a strip below the care meters). It renders only when
`bar.shell.serviceFor("slcode777.omagotchi")` is non-null and initialized.

**The snapshot.** When the pet's directory is reachable —
`petService.manifest.__sourceDir`, stamped on every manifest by the shell — the
Creature shows the *real* sprite:
`<__sourceDir>/assets/sprites/<form>_<anim>_<a|b>.png`, where `form =
petService.form` and `anim` is `sleep` / `eat` / `idle` (from
`petService.sleeping` / `petService.eating`), flat-tinted with `MultiEffect`
the way Omagotchi tints it. A missing anim falls back to `idle` (every form
ships it); if the folder can't be reached at all, a geometric glyph in
Omatree's own hand takes over so the strip still reads.

**The actions.** The panel strip *calls* the pet service — `feedNow()`,
`scrub(25)`, `petThePet()`, `wakeUp()`, the same calls Omagotchi's own bar
widget makes, so no state races. `sendOff()` / farewell is never wired. Every
access is guarded; if upstream renames a function the pill just no-ops. Never
patch Omagotchi's QML — couple only through its service API and its published
asset-path convention. `Service.qml` separately *reads* `omagotchi-state.json`
for the fruit shortcut and shared-birthday line — that predates this.

Feed/wash rows appear only when `petValue(act) >= 8`; "a hand on its back"
(→ `petThePet`) is always offered, becoming "wake it" (→ `wakeUp`) when the pet
is sleeping. All three join the panel keyboard cursor as `petfeed` / `petwash`
/ `pethand`, in reading order under the tree's own meters (`kbTargets()` /
`kbActivate()`). `companionClock` animates only while the panel is open.

## Reload after editing plugin QML/JS

`rescanPlugins` does **not** hot-reload plugin QML. Use `omarchy-restart-shell`
(refuses while the session is locked — unlock first). Preview:
`qs -p /usr/share/omarchy/shell ipc call shell summon tiedeyez.omatree '{}'`
