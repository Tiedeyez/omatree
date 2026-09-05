# Omatree

A living tree on your Omarchy bar. It is grown from a seed unique to this
machine and user, ages with your system and with you over weeks, and is shaped
by hand into whatever form you prune it toward. No two are ever alike.

Omatree is a meditation widget, not a pet sim. Decline is slow and forgiving.
It rewards one unhurried visit a day.

![A dozen Omatrees, each grown from a different seed](docs/omatree-gallery.png)

## Install

```sh
omarchy plugin add https://github.com/Tiedeyez/omatree --enable
```

This clones the repo into `~/.config/omarchy/plugins/`, registers the service
and bar widget, and reloads the shell. A small sprout appears in the bar's
right section.

## Remove

```sh
omarchy plugin remove tiedeyez.omatree
```

Removing the plugin deletes its folder. Your tree's saved state lives
separately at `~/.local/state/omarchy/omatree-state.json` — delete that file too
for a completely clean slate, or leave it and the same tree returns if you
reinstall.

## Using it

- **Bar mark.** A tiny tree whose canopy grows with the real tree. It
  sparkles when thriving, wilts amber when it needs you, and a firefly blinks
  beside it after dark.
- **Left-click** opens the panel: the tree, its mood, its life stage, and four
  slim care meters — water, light, feed, form — each with a pill to tend it.
- **Middle-click** the bar mark waters the tree without opening anything;
  **right-click** toggles it out onto the desktop or back to the bar.
- **Plant** from seed or from a cutting the first time. A matured, well-kept
  tree can set a single heirloom fruit once; harvest it for a seed that
  carries its lineage to the next pot on the same machine. (This is separate
  from berries, below — the rare one-time heirloom, not the recurring food.)
- **Prune by hand.** In the panel's trim mode, pick a cluster and cut. Cuts are
  permanent and the tree grows on from them — this is how you give it its form.
- **Rotate** the tree by dragging it, middle-clicking to step 30°, or focusing
  it and using the arrow keys.
- **Set it on the desktop.** From the panel, send the tree out onto the
  wallpaper as a standalone ornament with its own small controls. Hover it for
  `TAKE ME HOME` to bring it back to the bar.

Full keyboard navigation is available throughout the panel (`↑↓`/`jk` to move,
`Enter`/`Space` to act, `w`/`f`/`p` shortcuts), grafting included.

### Care pacing

Growth is deliberately slow — roughly a couple of months of daily use from
sprout to a mature tree. Water is asked for by the end of a day's use; light
over days; feed over weeks; form only seasonally, and it never nags.

## Grafting

A tree can accept up to 3 grafts from a small `.omatree-graft.json` file —
give a cutting of your own tree to a friend any way you like (chat,
AirDrop, USB, whatever), and they graft it into theirs. The plugin never
sends or receives anything itself; the file is the whole exchange.

Open it from the panel's GRAFTS row, under trim:

- **Give a cutting** — free, unlimited. Writes a file to
  `~/.local/state/omarchy/omatree-grafts/outbox` and shows you the path.
  The file carries only your tree's genus and shape — never your machine
  identity, name, or anything else about you.
- **Graft one in** — drop a file someone gave you into
  `~/.local/state/omarchy/omatree-grafts/inbox`; the panel lists what's
  there, previews it, and asks before it's spent. Capped at 3 per tree.

A graft can bring in a genus no solo tree ever rolls on its own — willow,
crimson maple, gold zelkova, flowering plum — each reachable only this way.
Two break the usual theme-tinted green outright; plum grows real blossoms;
willow grows real cascading strands rather than just drooping. Grafting an
already-hybridized tree passes its whole real lineage along, so the pool of
possible grafts grows with who's using it, not with a fixed list.

## If you also run Omagotchi

Install [Omagotchi](https://github.com/slcode777/omagotchi) alongside Omatree and
its creature comes to live in the tree. Its actual sprite — the current form,
awake or asleep — perches in the canopy on the bar mark, and the panel grows a
strip below the care meters where you can feed it, wash it, and rest a hand on
its back, all from the same keyboard cursor as the tree's own care. No sound, no
emotes; the tree just quietly notices.

Feeding it is literal: a well-kept tree slowly grows a small stash of berries
(up to two at a time, rendered right on the canopy, apart from the rare
heirloom fruit) — faster while the creature is hungry — and "food" hands one
over. No ripe berry, no feeding; the tree can't give what it hasn't grown.

The pet's own bar pill keeps working and stays in step, so you can tuck it away
and let the tree be the one place you tend both. Remove Omagotchi and the tree
goes back to being just a tree.

## How it works

Identity (machine-id + user) is hashed into a deterministic seed. From that
seed a 3D skeleton is grown (`Grow.js`), projected and shaded into a draw list
(`Paint.js`), and rasterised to pixel art (`Raster.js`). One grown object —
roots, trunk and branches connect with real physics, not assembled parts. The
Omarchy wordmark is etched into the pot clay.

Genus (juniper, maple, pine), classical style (formal, informal, slant,
cascade, windswept, literati, broom, twin), and a short whimsical one-word
name are all drawn from the seed. The name is generated, not picked from a
list, kept for the life of the tree, and unlikely to be shared by another
machine.

A headless service keeps the tree living — growing, ageing, getting thirsty —
while the panel is closed.

## Dependencies

None at runtime beyond the Omarchy Quattro shell (Quickshell / QML). The tree
renders fully offline; nothing is fetched over the network. Node.js is used
only by the optional developer scripts in `dev/`.

## Changelog

See [`CHANGELOG.md`](CHANGELOG.md) for what changed in each version — the
same thing `omarchy plugin update` shows you as a diff before it asks you to
confirm, in plain language.

## Development

See [`dev/README.md`](dev/README.md) for the render pipeline and the three ways
to time-travel through the tree's life (still frames, terminal timelapse, live
panel override).

Validate a working copy:

```sh
omarchy plugin validate ~/.config/omarchy/plugins/tiedeyez.omatree
```

## Follow

- X — [@officialomatree](https://x.com/officialomatree)
- Instagram — [@theofficialomatree](https://www.instagram.com/theofficialomatree)
- TikTok — [@omatree](https://www.tiktok.com/@omatree)

## License

MIT — see [LICENSE](LICENSE). Authored by Tiedeyez.
