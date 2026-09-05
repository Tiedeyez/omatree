# Changelog

Every release here is a real `git log` you can read yourself — nothing ships
that isn't in the diff. `omarchy plugin update` shows you this diff before it
asks you to confirm; this file is the same story in plain language.

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
