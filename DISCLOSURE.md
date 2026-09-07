# What Omatree does to your computer

Omatree is a tree that lives on your bar. It is also software you are installing
into your desktop shell, and the screenshot cannot tell you what that means.
This file can.

Every path and command below is greppable in this repository. If the code
contradicts something written here, that is a bug — please open an issue.

## What it is, and what runs it

An **Omarchy shell plugin**. It is not a separate application with its own
window; it loads into the Omarchy desktop shell (Quickshell) and runs **inside
that process**. Three parts:

| Part | What it is |
|---|---|
| `BarWidget.qml` | the mark on your bar, and the panel it opens |
| `Service.qml` | a headless service that keeps the tree growing whether or not the panel is open |
| `Desktop.qml` | a layer-shell window, only when you set the tree on your desktop |

Two consequences worth stating plainly:

- **It runs unsandboxed, with your user account's access.** Omarchy's own plugin
  documentation says this about added plugins. A small tree on a bar has the
  same reach as any program you run. That is not unique to Omatree — it is true
  of every shell plugin — but you should decide with it in mind rather than
  infer safety from the size of the icon.
- **It shares a process with your shell.** A crash in plugin code can take the
  bar, menus and notifications down with it. It has been stable in daily use on
  the author's machine, which is evidence, not a guarantee.

## What it writes

Everything lives under `$XDG_STATE_HOME/omarchy/` (by default
`~/.local/state/omarchy/`). Writes are atomic.

| Path | When | What |
|---|---|---|
| `omatree-state.json` | continuously | your tree: seed, species, age, growth, water and light history, name, settings |
| `omatree-grafts/outbox/*.omatree-graft.json` | when you export a cutting | a cutting you chose to share |
| `omagotchi-platforms.d/tiedeyez.omatree.json` | when the tree is on the desktop | where the tree's branches are, so a companion pet can find a perch. Geometry only |

It writes nothing outside that directory, nothing in `/etc` or `/usr`, and never
uses `sudo`.

**One historical deletion.** On first run after updating to 1.2.3 it removes
`~/.local/state/omarchy/omatree-companion.json`, its own obsolete file from an
earlier version. It deletes nothing else, ever.

## What it reads

Its own state and graft inbox, the active Omarchy theme (through the shell's
own `Color`/`Style`, so the tree matches your desktop) — **and two files that
belong to other plugins**, which deserves an explanation rather than a footnote:

| Path | Why |
|---|---|
| `~/.local/state/omarchy/settings/weather-current.json` | the weather where you are affects how the tree grows. Written by Omarchy's weather widget; Omatree only reads it |
| `~/.local/state/omarchy/omagotchi-state.json` | so the tree knows whether a companion pet is present and whether it is asleep — a sleeping pet means the tree keeps still and does not sparkle |

Both are read-only, both are other plugins' own state files on your disk, and
both are ignored if absent. Omatree reads no documents, no browser data, no
shell history, and nothing outside the paths listed here.

## What other programs it runs

| Command | When |
|---|---|
| `mkdir -p` | creating its own state directories |
| `rm -f` | the one-time removal of the obsolete file described above |
| `omarchy-notification-send` | a desktop notification — the tree is thirsty, a graft took |
| `omarchy-shell -q shell summon tiedeyez.omatree` | opening its own panel from the desktop ornament |

No shell is ever invoked, nothing downloaded is executed, and nothing in a state
or graft file is run as code.

## Network

**None.** Omatree makes no network connections of any kind — no telemetry, no
analytics, no update check, no asset fetching, no phoning home. Your tree is
grown from a seed derived from your own machine and never leaves it.

Grafts are files. If you send someone a cutting, you send it yourself, the way
you would send any file.

## What it does not do

No credentials, keyring or password access. No camera, microphone, location or
clipboard. No reading of other applications' data beyond the two state files
named above. No auto-update. No background process outside the shell it is part
of. No code execution from data.

## Who maintains it

Tiedeyez. MIT licensed. Source in this repository — the tree, the growth model
and the renderer are all here to read.

## Check it yourself

```sh
grep -rn "Process\|execDetached\|command:" *.qml     # every program it runs
grep -rn "FileView\|setText\|statePath\|stateDir" *.qml   # every file it touches
grep -rn "XMLHttpRequest\|fetch(\|http" *.qml        # returns nothing
```

You can also open **Super + Space → Setup → Plugins** to see what is installed
and disable or remove anything, without installing or changing anything by
looking.
