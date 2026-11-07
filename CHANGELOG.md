# Changelog

Every release here is a real `git log` you can read yourself — nothing ships
that isn't in the diff. `omarchy plugin update` shows you this diff before it
asks you to confirm; this file is the same story in plain language.

## 1.5.0 — 2026-11-07

A care-mechanics audit. Every rule the tree lives by now sits in one file,
`Life.js`, and a year of living with it is simulated and tested under node
(`dev/sim.js`, `dev/test-life.js`: 48 checks, every schedule planted in every
season). What that found, and fixed:

- **Only time you are actually here counts.** The tree's needs and growth were
  meant to move per minute of use, but they ran every minute the shell was up,
  idle, locked or not. On a desktop left on overnight the tree was parched and
  "reaching for the light" every morning however well it was kept. Now an
  idle, locked or sleeping machine advances nothing; Omatree asks the shell's
  own idle service (or, without one, the Wayland idle protocol) whether you
  are here, and learns nothing else.
- **The sun shines whether you are there or not.** Daylight now clears the
  light need on the real clock, including across a suspend or a restart (up
  to three days). Someone who works nights no longer has a tree that never
  sees the day; in the short days of winter the lamp still has its job.
- **"Well kept" means how the tree actually felt.** Growth and fruit used an
  average sampled only when you tended it, so a tree nobody ever touched
  counted as perfectly kept and outgrew a cared-for one (in the simulation it
  matured in 11 days against 84). Care is now a time-weighted average of the
  tree's wellbeing over about three days of use. A minute counts fully while
  nothing is urgent, so one visit a day, a little late, is still a well-kept
  tree. A neglected tree still grows, about a sixth as fast, and never dies.
  Your existing tree keeps its history: the old average carries over.
- **Water asks at the end of the day, as promised.** It turned urgent after
  6 h 54 min of use; now it does at 8 h.
- **Blinds by day, lamp by night, never both.** Opening the blinds at noon
  used to leave a grow lamp burning all night. The lever is now put out at
  dusk and at dawn.
- **The day turns on the minute.** Sunrise and sunset compared the whole hour,
  so the day began up to 59 minutes late. The painted sun now rises and sets
  on the same seasonal day as the care clock (the tree is no longer drawn in
  sunshine while the panel says it is dark), and the winter sun rides lower
  and warmer.
- **Shoots follow the season.** The need to trim slows in the winter rest and
  quickens in spring's flush; over a year the pace is unchanged.
- **Snow only where it is cold.** When Omarchy's weather widget has a reading,
  snow fades out between 0 and 6 °C and is gone above. With no reading the
  calendar stands.
- **The bar says what the panel says.** The bar mark kept its own copy of the
  rules, with a fixed 06:00-20:00 day and different words. It now reads the
  same `Life.js`.
- **The companion's "twin"** is the same date, not the same day of any year.
- **Panel.** The age line no longer runs off both edges; all four care bars
  end at the same place; an urgent need is marked on its label and bar, not
  only by a bar that has shrunk to a dot; the grafts row shows pips and an
  "n of 3" and has a real button; the header no longer repeats "open blinds";
  every line of text meets WCAG AAA contrast (7:1) on the panel; "SET ME OUT"
  is now "SET ME ON THE DESKTOP".

## 1.4.0 — 2026-11-02

- **The tree keeps the seasons.** It follows the real calendar, turned half a
  year when your locale is in the southern hemisphere. Maple, zelkova, willow
  and plum turn in autumn (each clump in its own time), let a few leaves go,
  and hold the rest through the winter, dusky but still coloured; in spring
  new green leaves replace them clump by clump. Pine and juniper keep their
  needles, and a juniper bronzes a little in the cold. A flowering plum
  flowers in early spring. From December to March snow settles on the foliage
  and drifts on the soil. The tree says so in its own voice when nothing more
  pressing needs saying ("I am turning for autumn", "Snow on my branches. I am
  resting."), and the panel's age line names the season.
- **Winter asks for light.** The days draw in: the daylight that clears the
  light need shrinks toward the solstice, and the dark builds it faster, so
  the lamp is the winter ritual ("The days are short. I would like more
  light."). Water and feed ask less while the tree rests and it grows slowly;
  spring growth makes up for it, so over a year the pace is exactly what it
  was. Winter never harms the tree.
- **Each genus wears its own leaf.** Pine grows flat, dark, layered pads with
  a lit top and a shaded underside; juniper spiky, flame-shaped blue-green
  tufts; maple bright, lobed, coarse-leaved masses; zelkova a fine smooth dome.
  They used to share one green clump.
- **Cascade and twin.** A tree's style is now chosen when it is planted, the
  way a real one is trained, and kept in the save. Two styles that were never
  reachable before are in the pool: a cascade climbs out of a deep pot, turns
  over the rim and falls past the pot's side in pads; a twin splits into two
  trunks just above the soil, opening as a V. Your current tree keeps exactly
  the style it has; this only applies to the next tree you plant.
- **Fixes.** A tree grafted with plum no longer fails to draw (its blossom
  colour was never defined). Crimson maple and zelkova now show the colours
  the grafting notes always promised; they were drawn plain green. Foliage at
  the edge of a wide or leaning crown is no longer cut off at some turntable
  angles. The new leaf shading costs about a fifth more per frame than before,
  most of it won back by rejecting pixels outside a clump before any trig.
- **Housekeeping.** The theme palette math lives in one place,
  `Paint.paletteFor`, used by the panel and every dev tool. The graft outbox
  `mkdir` is now `/usr/bin/mkdir`, the one helper 1.2.16 missed. The shell's
  colour singleton is imported qualified (`Commons.Color`), so another
  module's `Color` can never shadow it.
- New gallery and seasons images in the README, generated by `dev/gallery.js`.
  `dev/shot.js` takes `--season`/`--doy`, `--train` and the graft-only genera,
  and uses the shipped palette. `dev/fxlab.js` takes `--light` and `--frames`
  (transparent frames for compositing). `dev/sweep.js` takes `--train` and `--style`,
  and judges a cascade on its own terms (the fall clears the pot wall and ends
  down its side). `dev/override.json` accepts `"season"`.

## 1.2.16 — 2026-09-26

- **Graft reads can't be raced.** Picking a file from the graft inbox now opens
  it exactly once with `O_NOFOLLOW` and checks and reads that same descriptor,
  so a file swapped for a symlink between the check and the read is refused.
  FIFOs, directories and devices are refused too, and the 16 KiB + 1 byte cap
  is kept.
- **No PATH lookups for helpers.** Every helper Omatree runs itself is called
  by absolute path (`/usr/bin/python3 -I`, `/usr/bin/sh`, `/usr/bin/mkdir`,
  `/usr/bin/rm`). The pets directory reaches `find` as an argument instead of
  being pasted into the shell script.

## 1.2.15 — 2026-09-23

- **Watering is water now.** Drops used to slide down to a fixed line on the
  screen, which sat below the soil, so every drop finished on the pot's front
  face and rippled on the terracotta. Now it falls straight down from above
  under gravity with air drag, some of it behind the foliage and trunk. The leaves catch about a third of
  the water, and it beads there and then drips. Each drop lands where the soil
  actually is, with a ripple, a small splash and a wet patch that soaks in.
  Drips off an overhanging bough come down on the table beside the pot. The
  soil darkens and the crown lifts when the water arrives, not the moment you
  press the button.
- **Feeding feeds the tree.** Granules used to fade on the same wrong fixed
  line as the water, and "uptake" motes rose in a box around the middle of
  the frame. Now pellets are sprinkled straight down onto the soil, and one
  may get knocked aside by the leaves. They bounce once or twice (the rim
  wall turns them back in), settle, and dissolve into a dark seep. Then the
  tree takes them up. Motes of food run from each pellet to the trunk foot and
  climb the real path the sap takes, spread across the width of the trunk and
  out along each bough to its foliage. Each clump brightens in its own colour
  as the food reaches it, and the crown greens then too, not the moment you
  press the button.
- **Light twinkles, and glitter falls.** Points of light across the foliage
  twinkle unevenly, most of them flaring into a small four-point sparkle, since
  a single pale pixel disappeared on bright leaves. Glitter drifts down out of
  the sky, tumbling so it flashes as it falls, and some catches in the leaves.
  About four times as many lit points as before. The idle sparkle while the
  lamp is on comes every 2.5 minutes instead of 5.
- All three run on one shared particle file (`Fx.js`) drawn with a pool of
  pixel rects, at about 0.2 ms a frame, and only while an effect is playing.
  `dev/fxlab.js` renders the same code over the real tree for tuning.
  `qs ipc … tiedeyez.omatree.fx preview water` plays an effect with no care
  behind it. See DISCLOSURE.md.

## 1.2.14 — 2026-09-23

- **The trunk stands inside its pot.** On a grown tree the flare and surface
  roots could hang over the lip of the pot, on two-thirds of all trees. The
  pot slides under a leaning crown so the tree doesn't topple, and that slide
  ignored where the trunk stood, so a crown thrown one way carried the rim out
  from under the foot. The foot now sets how far the pot may slide. If the
  crown still needs more, the pot widens (never so far that the tree looks
  squat) instead of leaving the trunk hanging. The dev sweep has a new `foot`
  band to guard this: 0% out of band at every maturity and age, down from 67%.
- **The roots and the trunk are one thing.** The roots started at the trunk's
  centre and reached less far than its own radius. They never broke its
  surface, so all that showed were stubs poking out under it. Each root now
  leaves flush with the flare, runs out over the soil and dives in at the tip.
  Roots are grown after the pot is fitted, so each one reaches as far as the
  rim allows in its direction. They also start from where the trunk actually
  comes out of the soil: a leaning trunk leans from below the soil line, so
  roots grown from its buried base came up a hand's width away from it.
- **A nebari, not a jar.** The trunk is widest at the soil line and eases into
  the shaft above it. It used to swell into a belly, run straight up as a
  cylinder and drop in one step at the first bough. The flare is no longer
  clamped against a pot size that aging trees outgrow, which pinched old
  trunks into an onion-shaped bulb on a thin neck. Each bough's girth now
  leaves the trunk gradually, and the trunk is drawn in 16 segments
  instead of 9.
- **Old trunks stay in proportion.** Girth grew as age^0.62 on top of length,
  so an 800-year trunk was wider than it was tall. It is now age^0.45, and a
  trunk that is already stout flares less. Across every maturity and age
  from sprout to 800 years, the sweep is at most 1.1% out of band, down from
  as much as 11%.
- `dev/shot.js --seed live` renders the tree on this desktop, grafts included.

## 1.2.13 — 2026-09-22

- **The age label tells one coherent clock.** The line used to read "3d 425h
  31m" — wall-clock days from a lossy gap counter jammed against active-clock
  hours, two clocks side by side. It now shows the tree's real calendar age
  (days since planting, in d/h/m) as one number, the way a person would say
  it: "21d 16h". The active clock still drives growth and maturity; it just
  isn't smuggled into the age line anymore.
- **Wall age is recomputed, not summed from gap roundings.** The old wall
  counter added `round(elapsedDays)` on every hourly tick and reset its
  reference timestamp each tick, so any gap under half a day — a night's
  sleep, a workday — added 0 and the tree lost most of its real age (3 days
  counted against ~22 real days since planting). Wall age is now a function
  of the planting timestamp: exact, keeps ageing while the box is off, and
  self-heals the undercount every machine that ran the old counter has saved.
  Fruit gating, which unlocks by wall age, now happens at the honest day
  count.

## 1.2.12 — 2026-09-10

- **The picked pet lives WITH the tree, at its side.** Its place is the front
  of the pot itself: standing in the moss at the pot's near-left rim, right
  where a friend would perch to keep it company — and drawn in front of
  whatever the tree painted beneath it. The spot is the renderer's own
  landmark (the projected soil geometry, not an invented offset), so the pet
  sits the painted ground and turns with the pot as the tree is spun. If the
  tree folds back into the bar, the pet is gone with it.
- **It reacts to being tended.** Watering the desktop tree with the pet looking
  on triggers a single happy hop before it settles again — its only way to
  answer, since a Codex pet has no needs of its own to feed. The bar mark's
  rim pet picks up the tree's breath too, swaying gently when the tree is doing
  well.

## 1.2.11 — 2026-09-09

- **The Omagotchi snapshot draws in the bar and panel for real.** The sprite
  directory came from the pet service's `manifest.__sourceDir` — but the
  shell strips that field from third-party plugin manifests before handing
  them out (publicPluginManifest, a privacy rule for the shell), so the
  lookup was always empty and the creature appeared with no sprite at all
  (in panel and bar widget alike; the squad's Codex sheet had been masking
  it in the panel). Both hosts now keep `__sourceDir` where present and
  fall back to the plugin's standard install dir (`~/.config/omarchy/
  plugins/<id>`) where the shell removed it. Verified live: the mood row
  shows the tinted gremlin, the squad row shows Buddhist's own sheet.

## 1.2.10 — 2026-09-09

- **The creature line shows the creature its line is about.** With Omagotchi
  and Omarchy Pets both installed, the mood row's sprite was gated on the
  squad's presence — so the line said "the creature is at ease" next to the
  Omarchy Pets sheet instead of the Omagotchi it was describing. The row now
  shows the Omagotchi whenever it is here; the Codex pet's sheet only
  appears when the squad is the sole companion.
- **The squad line stopped guessing where it sits.** "Sits on the pot" was
  hardcoded; the line now follows the truth — out with the desktop
  ornament it stands at the pot, kept in the bar it lives with the bar
  mark. (Hovering it still gets a pointer cursor; it leads to nothing.)
- **Removed "a moment with it".** The pet button offered a hand but had
  nothing behind it — the action went to the pet service, but the panel
  showed no state the click ever changed, so it read as a control that did
  nothing. It is gone, along with its keyboard cursor target (pethand) and
  the now-dead wake/pet handling; feed and wash remain, and still only
  appear when they're actually needed.
- **"SET ME OUT" speaks for itself.** The italic location caption beneath
  the toggle ("out in your lower-right corner" / "kept here in the bar")
  is removed; the toggle's own state — colored when out — is the whole
  message.

## 1.2.9 — 2026-09-09

- **Light finally answers to the sun.** The light need rose by the minute no
  matter what the sky was doing, so the tree could sit "shaded" at noon with
  full sun, and clicking the lamp was the only relief ever — even in
  daylight, where its own copy says it is "sunshine on demand" for the dark.
  Now daylight stalls the need and slowly drains stored dimness (−0.11 per
  active minute); only after dark does it climb (+0.085), which is exactly
  when the lamp lever means something. Clicking it at noon no longer moves a
  number the sun already paid.
- **The save file kept up with the tree.** The heartbeat's flush was gated
  on `careCount % 5` — but careCount only moves when you tend the tree, so
  the gate was permanently open for one careCount value and permanently
  shut for the next: hours could pass with no save at all (caught live:
  `careCount=137`, no flush for the whole session since the last care
  click). Saving now runs on the heartbeat's own count — every 5th minute —
  so needs are written whatever happened between care actions.

## 1.2.7 — 2026-09-09

- **The panel takes external commands.** The panel base only registers its
  IPC handler when the widget declares a target — and Omatree never had.
  That left `omarchy-shell tiedeyez.omatree open` (and any script or
  keybind that wanted to pop the tree open) talking to nothing. It now
  declares `ipcTarget: "tiedeyez.omatree"`, the same pattern every other
  plugin panel uses, so other things on the desktop can call it in. The
  desktop ornament's summon flow already worked by a roundabout
  (`omarchy-shell summon`); this makes the front door real.

## 1.2.8 — 2026-09-09

- **Give it a squad.** Omarchy Pets used to send only the pet the bar shows;
  now every installed Codex pet comes to the tree. The picked pet (the one
  your bar widget shows) stands on the pot's rim; up to two companions keep
  to the saucer edges. The panel's companion strip names the squad — "the
  squad — Buddhist and Stamuk — sits on the pot".
- **Both pets share the tree.** Until now Omagotchi won outright and Omarchy
  Pets went dark if both were installed. They now have their own areas that
  best fit them: Omagotchi keeps the canopy and its roam (the branch and
  saucer perch bridge still publishes, for its walking), while the Omarchy
  Pets squad has the pot and the saucer. Omagotchi's tend panel — feed,
  wash, a moment — stays Omagotchi's, since the Codex squad has no needs to
  tend.
- New read path, documented in [DISCLOSURE.md](DISCLOSURE.md): a bounded
  read-only sweep of `~/.codex/pets/*/pet.json` (first 500 entries, 8 valid
  pets) to find each squad member's name and sprite sheet.

## 1.2.6 — 2026-09-08

- **Omarchy Pets can perch in the canopy too.** Until now only Omagotchi's
  companion came to live in the tree. If you have
  [Omarchy Pets](https://plugins.omarchy.org/plugin.html?id=raiden-meixelysia.omarchy-pets)
  (`raiden-meixelysia.omarchy-pets`) in your bar instead, its pet now sits up
  in Omatree's leaves, playing its idle animation from the same Codex Pets
  sprite sheet the bar shows.
- This one is **visual only** — Omarchy Pets has no hunger, mood or lifecycle
  to read and no service to call, so there's nothing to tend and nothing to
  feed. Omagotchi's deeper coupling (the tend panel, berry feeding, the
  desktop roam-perch) is unchanged and still Omagotchi-only. If both are
  installed, Omagotchi wins the perch.
- New file `CodexPet.qml`, and two new read paths — both other plugins' own
  files, both ignored when absent: `~/.config/omarchy/shell.json` (only to see
  which pet you picked) and `~/.codex/pets/<id>/pet.json` + its sprite sheet.
  See [DISCLOSURE.md](DISCLOSURE.md).

## 1.2.5 — 2026-09-07

- **[DISCLOSURE.md](DISCLOSURE.md)** — a plain account of what Omatree does to
  your machine: every path it writes, every path it reads, every program it
  runs, and the fact that it makes no network connections at all. Written from
  a grep of this source, not from memory of the design, and it includes the
  parts that are worth pausing over — a shell plugin runs unsandboxed with your
  user account's access, inside the shell's own process.
- It also explains the two files Omatree reads that belong to *other* plugins:
  the weather widget's current reading (weather affects how the tree grows) and
  Omagotchi's state (so the tree keeps still while a companion sleeps). Both
  read-only, both ignored when absent — but a tree quietly reading your weather
  is exactly the kind of thing a screenshot cannot tell you.

No code changes in this release.

## 1.2.4 — 2026-09-07

Performance. A tree on your desktop should be a quiet thing, not a load on
your machine — this release roughly halves what Omatree costs while it sits
there.

- **The foliage shimmer re-encodes less often.** Every visible tree redraws
  its leaves on a timer, and each tick is a real re-raster of the canopy.
  That timer ran ~4 times a second; it's ~1.5 times a second now. The sway
  moves at exactly the same speed — the steps between are just wider, and at
  this size the eye can't tell. This is the bulk of the saving.
- **The desktop tree holds still when you're not there.** Once the session
  goes idle — screensaver, lock — the ornament stops animating until you come
  back; nobody is watching a shimmer behind a screensaver. It follows
  Omarchy's own idle state, so "stay awake" keeps it moving, and on a
  non-Omarchy shell it falls back to its own idle check.
- **The bar mark's sway slowed from ~11 to ~4 ticks a second**, and no longer
  animates at all while the tree is still waking up. Same motion, far fewer
  repaints.

Nothing about the tree, its growth, or how you tend it changes.

## 1.2.3 — 2026-09-05

- The companion perch moved to Omagotchi's new shared "external platform
  providers" location (`omagotchi-platforms.d/`), so it works through a
  documented hook any plugin can use rather than a private arrangement. Each
  spot now carries a hint — the saucer and soil edge are `ledge`, the branches
  `surface`, the canopy `perch`. Old single `omatree-companion.json` is removed
  on first run. Needs a build of Omagotchi that reads the directory; without
  one, nothing changes.
- Publishing an empty set when the tree is back in the bar, so a stale perch
  can't linger in the pet's world.

## 1.2.2 — 2026-09-05

Turntable and companion fixes, again from a real user rotating the desktop
tree:

- **Rotating the desktop ornament actually works now.** It was routing every
  fidget of the mouse through a short animation, so the tree lurched — a
  full-screen drag might barely turn it, a tiny nudge might spin it half a
  turn. Now the angle tracks the cursor one-to-one, the same as the panel.
- **The mouse wheel spins the desktop tree** a notch at a time — the corner
  is a cramped place for a big drag, so the wheel is the dependable way
  round. Hold Shift and the wheel still does the shallow zoom.
- **A left-drag on the desktop tree spins it too**, not just middle-drag; a
  plain tap still opens the quick menu.
- Mid-drag, the tree no longer loses the rotation when the cursor slides off
  it.
- Groundwork for the Omagotchi companion: the tree now offers a
  perch up in its canopy, so a companion that comes down from the bar can
  settle in the leaves rather than at the pot. Purely a spot published for
  the pet to find — the tree still sends and receives nothing.

## 1.2.1 — 2026-09-05

Small fixes from a real early user's screenshots, where the tree had the
Omagotchi companion but the pet was roaming on the desktop floor, not
perched in the branches:

- The companion strip stopped claiming the pet was "in my branches" for
  every mood — it now just says what the creature is (hungry, settled, …),
  since the pet roams and is only actually up in the tree when it's kept
  well enough to climb there.
- "a hand on its back" → "a moment with it", same reason.
- The "SET ME OUT" toggle's subtitle no longer repeats the toggle's own
  label back at you when it's off — it only ever states where the tree
  currently is.
- The desktop ornament briefly grew a screen-tall border box: a stale key
  in a separate window-border overlay that stopped matching after the
  plugin's rename. Fixed in that overlay.
- The desktop ornament is now drawn twice as large.

## 1.2.0 — 2026-09-04

- **Grafting.** A tree can now accept up to 3 grafts from a small
  `.omatree-graft.json` file someone else gave you — any way you like
  (chat, AirDrop, USB); the plugin itself never sends or receives anything
  over a network. Open it from the panel's GRAFTS row, under trim: give a
  cutting (free, unlimited — writes a file to
  `~/.local/state/omarchy/omatree-grafts/outbox`) or graft one in (reads
  `~/.local/state/omarchy/omatree-grafts/inbox`, previews before
  confirming). Fully keyboard-navigable.
- **Four graft-only genera** — willow, crimson maple, gold zelkova,
  flowering plum — reachable only through grafting, never a solo tree's own
  roll. Two break the usual theme-tinted green (crimson maple, gold
  zelkova); plum scatters real blossoms on the canopy; willow grows real
  cascading strands, not just a droopy round tree.
- A graft file carries a recipe (a base genus + a non-identifying alias
  seed, never your tree's real identity), not the resulting numbers — every
  value is recomputed from the seed on import, the same way the tree itself
  has always worked. Stress-tested at 200k seeds per genus and against
  adversarial input (corrupted files, huge numbers, deeply nested chains);
  full write-up of what a graft file can and can't prove is in `TreeGen.js`.
- Bar: right-click now toggles "set on desktop" directly.
- Desktop tile: its quick-menu gains FEED (when the Omagotchi companion is
  present) and GRAFT (opens the panel's walkthrough).
- Two small bug fixes that shipped invisibly until this release exercised
  them: the render cache never noticed a genus change (a graft would have
  silently kept its old shape), and the once-in-a-lifetime heirloom fruit
  was being painted underneath the canopy that covers it, every time — it
  may never have actually been visible on a real tree before now.

## 1.1.0 — 2026-09-04

- **Berries.** A well-kept tree now grows up to 2 berries — small, on the
  canopy, distinct from the rare heirloom fruit. They ripen slowly and only
  while the tree is genuinely well tended, faster while the Omagotchi
  companion living in the branches is hungry.
- Feeding the companion now costs a real berry. No ripe berry, no free feed —
  the tree can't give what it hasn't grown.
- Renamed the heirloom fruit's replant option from "FROM BERRY SEED" to
  "FROM HEIRLOOM SEED" so "berries" means the new food exclusively.
- No new dependencies, no new data read or sent anywhere. The only new
  cross-read is the companion's own `hungerLevel`, from the same local state
  file Omatree already reads for `companionCare`/`companionAsleep`.

## 1.0.0 — 2026-09-03

First public release. Earlier history (the companion arriving in the tree,
the seed/cutting/heirloom-fruit lineage system, the render pipeline) is in
the git log — nothing before 1.1.0 was retroactively summarized here.
