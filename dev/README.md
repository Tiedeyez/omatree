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

Flags: `--seed N|me  --gallery N  --genus juniper|pine|maple  --style formal|informal|slant|cascade|windswept|literati|broom|twin`
`--maturity F  --age YEARS  --yaw RAD  --hour F  --thirst F  --health F  --lamp`
`--light  --accent "#rrggbb"  --scale N  --art N`.

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

## Reload after editing plugin QML/JS

`rescanPlugins` does **not** hot-reload plugin QML. Use `omarchy-restart-shell`
(refuses while the session is locked — unlock first). Preview:
`qs -p /usr/share/omarchy/shell ipc call shell summon jimmie.bonsai '{}'`
