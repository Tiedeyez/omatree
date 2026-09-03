# Omatree — dev / time travel

The tree grows over weeks of use and its light follows the wall clock, so the
full arc never plays live. Three ways to see it.

## Pipeline

`TreeGen.genesis` (identity) → `Grow.js` (3D skeleton) → `Paint.js` (project +
turntable + shade → draw list) → `Raster.js` (BMP data URL for a QtQuick Image;
Quickshell has no working Canvas). `dev/preview.js` runs the same draw list
through a software rasteriser to ANSI half-blocks, so the terminal and the panel
can't drift.

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

`--case` and `--desktop` pin the yaw/pitch that `Bonsai.qml` uses for the cased
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

Overrides only touch what's displayed; the persisted state file is left alone.
`override.json` is gitignored.

## State file

`~/.local/state/omarchy/bonsai-state.json` carries `origin` (""|"seed"|"cutting"),
the one-time fruit lifecycle, and `seedAvailable` for a berry seed carried
between pots on the same machine,
`prune` (`{ clumpId: 0..1 }` — clump-id strings from Grow.js), and `yaw` (the
turntable pose). Clear `origin` to get the planting chooser back.

## Panel controls

- **Rotate**: drag the tree, or middle-click (scroll-wheel click) to step it 30°.
  Keyboard: focus the tree (arrow-key once to wake the cursor) then ← →.
- **Keyboard**: ↑↓/jk move between the tree and the water/lamp/feed/trim/settings
  targets, Enter/Space activates, letters w/f/p are shortcuts. In trim mode ↑↓
  pick a cluster, Enter cuts, Esc leaves trim (Esc again closes the panel).
- The render loop is paced to ~30fps (`Bonsai.qml frameInterval`); the BMP
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

`Creature.qml` is the geometric companion glyph, shared by `BarWidget.qml` (a
perch in the canopy) and `Panel.qml` (a strip below the care meters). It only
renders when `bar.shell.serviceFor("slcode777.omagotchi")` is non-null and
initialized. `Service.qml` already *reads* `omagotchi-state.json` for the fruit
shortcut and shared-birthday line; the panel strip goes further and *calls* the
pet service — `feedNow()`, `scrub(25)`, `petThePet()`, `wakeUp()`, the same
calls Omagotchi's own bar widget makes, so no state races. `sendOff()` /
farewell is never wired. Every access is guarded; if upstream renames a function
the pill just no-ops. Never patch Omagotchi's QML — couple only through its
service API.

Feed/wash rows appear only when `petValue(act) >= 8`; "a hand on its back"
(→ `petThePet`) is always offered, becoming "wake it" (→ `wakeUp`) when the pet
is sleeping. `companionClock` animates the glyph only while the panel is open.

## Reload after editing plugin QML/JS

`rescanPlugins` does **not** hot-reload plugin QML. Use `omarchy-restart-shell`
(refuses while the session is locked — unlock first). Preview:
`qs -p /usr/share/omarchy/shell ipc call shell summon jimmie.bonsai '{}'`
