import QtQuick
import Quickshell
import Quickshell.Io

// PetBridge — read-only, state-file adapter for the Omagotchi bar pet, used
// by the omatree bar mark's perch and the glass-house tending strip.
//
// Since the 4.0.4 host hardens cross-plugin service delivery
// (`pluginOwnsTarget`), omatree's old `bar.shell.serviceFor("slcode777.omagotchi")`
// is null on every bar. The pet's own service still runs on the host; this
// adapter rebuilds the *display* surface from the pet's persisted state file —
// never writing a byte of it — so the creature perches and the strip reads its
// mood again. Tending actions (feed / wash) need the live pet service and
// deliberately no-op on a hardened bar.
Item {
  id: bridge
  visible: false

  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME")
    || ((Quickshell.env("HOME") || "") + "/.local/state")
  readonly property string statePath: stateHome + "/omarchy/omagotchi-state.json"

  property bool initialized: false

  property string stage: ""
  property string form: ""
  property bool sleeping: false
  property bool eating: false
  property real hungerLevel: 0
  property real dirtLevel: 0
  property real tirednessLevel: 0
  property real boredomLevel: 0
  property real lonelinessLevel: 0
  property int ageMinutes: 0
  property int generation: 0
  property real careSum: 0
  property int careCount: 0

  readonly property var manifest: ({
    __sourceDir: (Quickshell.env("HOME") || "") + "/.config/omarchy/plugins/slcode777.omagotchi"
  })

  function clip100(v) { return Math.max(0, Math.min(100, (v === 0 || v > 0) ? v : 0)) }
  readonly property real hunger: clip100(hungerLevel)
  readonly property real dirtiness: clip100(dirtLevel)
  readonly property real tiredness: clip100(tirednessLevel)
  readonly property real boredom: clip100(boredomLevel)
  readonly property real loneliness: clip100(lonelinessLevel)
  readonly property real worstNeed: Math.max(hunger, dirtiness, tiredness,
    boredom, loneliness)
  readonly property real happiness: Math.round(100 - worstNeed)
  readonly property real careAverage: careCount > 0 ? careSum / careCount : 100
  readonly property bool canRoam: stage !== "egg" && stage !== "baby"

  readonly property string mood: {
    if (!initialized) return "sleeping"
    if (stage === "egg") return "egg"
    if (sleeping) return "sleeping"
    if (hunger >= 60) return "hungry"
    if (dirtiness >= 60) return "dirty"
    if (tiredness >= 60) return "sleepy"
    if (boredom >= 60) return "bored"
    if (loneliness >= 60) return "lonely"
    if (worstNeed >= 35) return "meh"
    return "happy"
  }

  readonly property string moodLabel: {
    switch (mood) {
    case "egg": return "An egg. Something wiggles inside…"
    case "sleeping": return "Zzz…"
    case "hungry": return "Hungry — feed me!"
    case "dirty": return "Feeling gross — bath time?"
    case "sleepy": return "Sleepy — about to doze off…"
    case "bored": return "Bored — let me out to play!"
    case "lonely": return "Lonely — pet me!"
    case "meh": return "Doing okay"
    default: return "Doing great"
    }
  }

  readonly property string stateAnim: {
    if (!initialized || stage === "egg") return "idle"
    if (sleeping) return "sleep"
    switch (mood) {
    case "hungry": return "hungry"
    case "dirty": return "dirty"
    case "sleepy": return "sleepy"
    case "bored": return "bored"
    case "lonely": return "sad"
    default: return "idle"
    }
  }
  readonly property string transientAnim: ""
  readonly property string emoteName: ""

  // Tending needs the live pet service; on a hardened bar these no-op.
  function feedNow() {}
  function scrub(amount) {}

  FileView {
    id: petFile
    path: bridge.statePath
    preload: true
    blockLoading: true
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: bridge._load()
  }

  function _load() {
    var raw = ""
    try { raw = petFile.text() || "" } catch (eP) {}
    if (!raw.trim()) return
    function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0 }
    try {
      var s = JSON.parse(raw)
      stage = typeof s.stage === "string" ? s.stage : ""
      form = typeof s.form === "string" ? s.form : ""
      sleeping = s.sleeping === true
      eating = false
      hungerLevel = num(s.hungerLevel)
      dirtLevel = num(s.dirtLevel)
      tirednessLevel = num(s.tirednessLevel)
      boredomLevel = num(s.boredomLevel)
      lonelinessLevel = num(s.lonelinessLevel)
      ageMinutes = Math.round(num(s.ageMinutes))
      generation = Math.round(num(s.generation))
      careSum = num(s.careSum)
      careCount = Math.round(num(s.careCount))
      initialized = true
    } catch (e) {}
  }
}