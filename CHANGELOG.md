# Changelog

Every release here is a real `git log` you can read yourself — nothing ships
that isn't in the diff. `omarchy plugin update` shows you this diff before it
asks you to confirm; this file is the same story in plain language.

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
