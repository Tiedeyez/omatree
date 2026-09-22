import QtQuick
import Quickshell
import Quickshell.Io
import "TreeGen.js" as TreeGen

// TreeBridge — a state-file adapter for the omatree *bar mark* and *panel*.
//
// The 4.0.4 host hardens service delivery: a replacement/custom bar gets a
// service-less entry facade and `bar.shell.serviceFor(ownId)` returns null,
// so a bar widget can't reach its own service object any more. The tree
// service itself still runs on the host (desktop + roam keep working); this
// bridge gives the BAR SIDE a service-interface object rebuilt from the
// plugin's own persisted state file, so the mark and the glass-house render
// the real tree instead of the "waking" placeholder.
//
// Reads are derived with the exact same rules as Service.qml (worst needle,
// mood ladder, daylight, maturity bands, age years) and the tree spec is
// rebuilt deterministically from machine id + user@host + graft lineage —
// the identical seeds the service replays — so the canvas shows the same tree.
// Write methods deliberately no-op: on a hardened bar there is no live service
// to reach. Nothing here ever writes a file.
Item {
  id: bridge
  visible: false

  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME")
    || ((Quickshell.env("HOME") || "") + "/.local/state")
  readonly property string statePath: stateHome + "/omarchy/omatree-state.json"
  readonly property string graftInboxDir: stateHome + "/omarchy/omatree-grafts/inbox"
  readonly property string graftOutboxDir: stateHome + "/omarchy/omatree-grafts/outbox"

  property string userName: Quickshell.env("USER") || ""
  property string hostName: ""
  property string machineIdLoaded: ""

  property bool identityReady: false
  property bool stateReady: false
  property bool initialized: false
  property double nowMs: Date.now()

  // --- persisted long-lived facts (mirror of Service.qml's load) -----------
  property double plantedAtMs: 0
  property double lastSeenMs: 0
  property double lastActiveMs: 0
  property int wallAgeDays: 0
  property real activeAgeMinutes: 0
  property real maturity: 0
  property real careSum: 0
  property int careCount: 0
  property string form: "neat"
  property bool fruitFound: false
  property bool fruitHarvested: false
  property bool seedAvailable: false
  property int berries: 0
  property real berryProgress: 0
  property int maxBerries: 2
  property var graftLineage: []
  property int maxGrafts: 3
  property string origin: ""
  property var prune: ({})
  property real yaw: 0
  property bool desktopEnabled: false
  property real viewZoom: 0.62
  property real thirstLevel: 0
  property real lightLevel: 0
  property real soilLevel: 0
  property real untidinessLevel: 0
  property string treeName: ""
  property var genesis: null
  property string genusLabel: ""
  property string baseGenus: ""
  property bool lampOn: false
  property bool pendingGraftOpen: false
  property bool companionBirthday: false

  // --- derived needs (exact Service.qml rules) ------------------------------
  function clip100(v) { return Math.max(0, Math.min(100, (v === 0 || v > 0) ? v : 0)) }
  readonly property real thirst: clip100(thirstLevel)
  readonly property real light: clip100(lightLevel)
  readonly property real soil: clip100(soilLevel)
  readonly property real untidiness: clip100(untidinessLevel)
  readonly property real worstNeed: Math.max(thirst, light, soil, untidiness)
  readonly property real wellbeing: Math.round(100 - worstNeed)
  readonly property real currentCareAverage: careCount > 0 ? careSum / careCount : 100
  readonly property string formLabel: form === "tangled" ? "tangled" : "neat"
  readonly property real effMaturity: maturity
  readonly property bool planted: origin === "seed" || origin === "cutting"

  readonly property int hour: { var d = new Date(nowMs); return d.getHours() }
  readonly property bool daylight: hour >= 6 && hour < 20

  readonly property real ageYears:
    (activeAgeMinutes / (60 * 24 * 365)) * 0.6 + (wallAgeDays / 365) * 0.4

  readonly property int fruitThresholdDays:
    75 + (((genesis ? genesis.seed : 0) >>> 0) % 106)
  readonly property bool fruitVisible: planted && fruitFound && !fruitHarvested
  readonly property int grafts: graftLineage.length
  readonly property bool graftsAvailable: planted && grafts < maxGrafts

  readonly property string stage: {
    if (effMaturity >= 0.95) return "mature"
    if (effMaturity >= 0.6)  return "adolescent"
    if (effMaturity >= 0.25) return "young"
    return "seedling"
  }
  readonly property string stageLabel: ({
    seedling: "Seedling", young: "Young tree", adolescent: "Adolescent",
    mature: "Mature tree"
  })[stage] || "Seedling"

  readonly property string mood: {
    if (!initialized) return "waking"
    if (!planted) return "unsown"
    if (origin === "seed" && effMaturity < 0.02) return "germinating"
    if (effMaturity < 0.06) return "sapling"
    if (thirst >= 60) return "thirsty"
    if (light >= 60) return "shaded"
    if (soil >= 60) return "hungry"
    if (untidiness >= 60) return "wild"
    if (worstNeed >= 35) return "meh"
    return "flourishing"
  }

  readonly property string moodLabel: {
    switch (mood) {
    case "waking": return "I am waking up…"
    case "unsown": return "Bare soil. I am not planted yet."
    case "germinating": return "I am underground still. Give me time."
    case "sapling": return origin === "cutting"
      ? "I am finding my feet." : "I am small, but I am here."
    case "thirsty": return "My soil has gone dry."
    case "shaded": return "I need light."
    case "hungry": return "I am hungry."
    case "wild": return "I need trimming."
    case "meh": return "I could use a little care."
    default: return "I am thriving."
    }
  }

  // --- second companion: the Codex squad is service-owned, unreachable ------
  readonly property bool codexHere: false
  readonly property url codexSheetUrl: ""
  readonly property var codexSquad: []
  readonly property string codexPetName: ""

  // --- tree identity + spec, rebuilt deterministically like Service.wake() --
  function _rebuildGenesis() {
    var g = TreeGen.genesis(machineIdLoaded, userName + "@" + hostName)
    baseGenus = g.genus
    for (var i = 0; i < graftLineage.length && i < maxGrafts; i++) {
      var donor = TreeGen.importGraft(graftLineage[i])
      if (donor) g = TreeGen.fuse(g, donor, undefined)
    }
    genesis = g
    genusLabel = g.genus
  }

  readonly property var treeSpec: genesis ? {
    seed: genesis.seed,
    gen: genesis,
    genus: genesis.genus,
    style: genesis.style,
    origin: origin,
    maturity: effMaturity,
    ageYears: ageYears,
    thirst: thirst / 100,
    health: wellbeing / 100,
    prune: prune,
    yaw: yaw,
    lamp: lampOn,
    companionAsleep: false,
    weather: {},
    fruit: fruitVisible,
    berries: berries,
    devClock: -1
  } : null

  // --- write methods: no live service on a hardened bar, so honest no-ops ---
  function waterNow() {}
  function light() {}
  function setDesktop(on) {}
  function plant(how) {}
  function replant() {}
  function pruneReset() {}
  function pruneNow() {}
  function pickBerry() { return false }
  function feedNow() {}
  function harvestFruit() {}
  function pruneNode(id) {}
  function setOrbit(y) {}
  function setZoom(z) {}
  function parseGraftFile(s) { return null }
  function previewGraft() { return null }
  function acceptGraft(f) { return false }
  function writeGraftExport() { return null }

  // --- loading: order-independent (state / identity arrive in any order) ---
  FileView {
    id: stateFile
    path: bridge.statePath
    preload: true
    blockLoading: true
    watchChanges: false
    atomicWrites: true
    printErrors: false
    onLoaded: bridge._loadState()
  }
  FileView {
    id: machineIdFile
    path: "/etc/machine-id"
    preload: true
    blockLoading: true
    watchChanges: false
    printErrors: false
    onLoaded: bridge._loadIdentity()
  }
  FileView {
    id: hostNameFile
    path: "/etc/hostname"
    preload: true
    blockLoading: true
    watchChanges: false
    printErrors: false
    onLoaded: bridge._loadIdentity()
  }

  function _loadState() {
    var raw = ""
    try { raw = stateFile.text() || "" } catch (eS) {}
    if (!raw.trim()) return
    function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0 }
    try {
      var s = JSON.parse(raw)
      plantedAtMs = num(s.plantedAtMs)
      lastSeenMs = num(s.lastSeenMs)
      lastActiveMs = num(s.lastActiveMs)
      wallAgeDays = num(s.wallAgeDays)
      activeAgeMinutes = num(s.activeAgeMinutes)
      maturity = Math.max(0, Math.min(1, num(s.maturity)))
      careSum = num(s.careSum)
      careCount = Math.round(num(s.careCount))
      form = s.form === "tangled" ? "tangled" : "neat"
      origin = (s.origin === "seed" || s.origin === "cutting") ? s.origin : ""
      var pr = {}
      if (s.prune && typeof s.prune === "object")
        for (var pk in s.prune) if (!/^\d+$/.test(pk)) pr[pk] = s.prune[pk]
      prune = pr
      yaw = (typeof s.yaw === "number" && isFinite(s.yaw)) ? s.yaw : 0
      desktopEnabled = s.desktopEnabled === true
      if (s.viewZoom > 0) viewZoom = Math.max(0.62, Math.min(1.30, s.viewZoom))
      thirstLevel = num(s.thirstLevel)
      lightLevel = num(s.lightLevel)
      soilLevel = num(s.soilLevel)
      untidinessLevel = num(s.untidinessLevel)
      fruitFound = s.fruitFound === true
      fruitHarvested = s.fruitHarvested === true
      seedAvailable = s.seedAvailable === true
      berries = Math.max(0, Math.min(maxBerries, Math.round(num(s.berries))))
      berryProgress = Math.max(0, Math.min(1, num(s.berryProgress)))
      if (Array.isArray(s.graftLineage)) graftLineage = s.graftLineage.slice(0, maxGrafts)
      if (typeof s.treeName === "string" && s.treeName !== "") treeName = s.treeName
      stateReady = true
    } catch (e) {}
    _maybeReady()
  }

  function _loadIdentity() {
    machineIdLoaded = ""
    hostName = ""
    try { machineIdLoaded = (machineIdFile.text() || "").trim() } catch (eM) {}
    try { hostName = (hostNameFile.text() || "").trim() } catch (eH) {}
    userName = Quickshell.env("USER") || ""
    identityReady = machineIdLoaded !== "" && hostName !== ""
    _maybeReady()
  }

  function _maybeReady() {
    if (!identityReady || !stateReady || genesis) return
    _rebuildGenesis()
    if (treeName === "" && genesis) treeName = TreeGen.nameFor(genesis.seed)
    initialized = true
  }

  // keep the day/night boundary fresh for the firefly, cheaply
  Timer {
    interval: 60000
    repeat: true
    running: true
    onTriggered: bridge.nowMs = Date.now()
  }
}