# Changelog

Every release here is a real `git log` you can read yourself — nothing ships
that isn't in the diff. `omarchy plugin update` shows you this diff before it
asks you to confirm; this file is the same story in plain language.

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
