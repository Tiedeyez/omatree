import QtQuick
import Quickshell
import Quickshell.Io
import "TreeGen.js" as TreeGen

// Headless bonsai brain. Loaded once at shell startup, independent of the bar
// widget, so the tree keeps living (growing, aging, thirsty) with the panel
// closed.
//
// The tree is unique per machine and user: identity (machine-id + user) is
// hashed into a deterministic seed and the whole plant is generated from it
// (see TreeGen.js). Two users can never have the same tree; the same user
// always keeps theirs.
//
// Age counts two things, because the plant should age with the system AND
// with you:
//   - activeAge: minutes the shell has been awake (the machine being on)
//   - wallAge:   real elapsed calendar time since planting, so it keeps
//                ageing across days even when the box is off at night
// Growth (maturity) moves with the slower, gentler of the two, flavoured by
// how well the tree is cared for.
Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string stateHome: Quickshell.env("XDG_STATE_HOME")
    || ((Quickshell.env("HOME") || "") + "/.local/state")
  readonly property string stateDir: stateHome + "/omarchy"
  readonly property string statePath: stateDir + "/bonsai-state.json"

  // Identity -> the seed that makes this tree theirs. machine-id + hostname are
  // read straight off disk in wake() (see below) — no subprocess to wait on.
  property string userName: Quickshell.env("USER") || ""
  property string hostName: ""
  property string machineIdLoaded: ""

  // The generated personality, loaded as soon as identity is known.
  property var genesis: null
  property string genusLabel: ""
  property string treeName: ""

  // A little name, drawn from the seed — cute, and it reinforces that this one
  // is yours.
  readonly property var _names: [
    "Sprout", "Sage", "Moss", "Pip", "Juno", "Bodhi", "Clover", "Reed",
    "Sorrel", "Bram", "Elowen", "Dax", "Koa", "Yuki", "Bean", "Wren",
    "Fenn", "Tomo", "Nori", "Suki", "Bex", "Pax", "Rue", "Ozzie", "Mika", "Tao"
  ]
  function nameFor(seed) {
    var s = (seed >>> 0)
    return _names[s % _names.length]
  }

  // --- long-lived tree facts (persisted) -----------------------------------
  property double plantedAtMs: 0
  property double lastSeenMs: 0
  property double lastActiveMs: 0
  property int wallAgeDays: 0
  property real activeAgeMinutes: 0
  property real maturity: 0        // 0..1 -> how grown the tree is
  property real careAverage: 100   // rolling care quality
  property int careCount: 0
  property real careSum: 0
  property string form: "neat"     // neat | tangled — from pruning upkeep
  property bool fruitFound: false
  property bool fruitHarvested: false
  property bool seedAvailable: false

  readonly property int fruitThresholdDays:
    75 + (((genesis ? genesis.seed : 0) >>> 0) % 106)
  readonly property bool fruitVisible:
    planted && fruitFound && !fruitHarvested

  // How it was started: "" = not chosen yet (bare soil + a seed), "seed" = misho
  // (slow, from nothing), "cutting" = a rooted snip with a head start.
  property string origin: ""
  readonly property bool planted: origin === "seed" || origin === "cutting"

  // Hand-pruning: per-cluster cut-back, 0..1 (1 = removed). Persisted — your
  // shape sticks. Keyed by the clump/branch id string from Grow.js.
  property var prune: ({})
  function pruneNode(id) {
    var m = {}
    for (var k in prune) m[k] = prune[k]
    m[id] = Math.min(1, (m[id] || 0) + 0.5)
    prune = m
    untidinessLevel = Math.max(0, untidinessLevel - 14)
    if (untidinessLevel <= 20 && form !== "neat") form = "neat"
    recordCare()
    flush()
  }
  function pruneReset() { prune = ({}); flush() }

  // Which way the turntable is left facing (radians). It's your tree's pose, so
  // it's persisted like everything else.
  property real yaw: 0
  function setOrbit(y) {
    if (!isFinite(y)) return
    yaw = ((y % 6.2831853) + 6.2831853) % 6.2831853
    flush()
  }

  // The "desktop snapshot" — keep a live copy of the tree in the lower-right
  // corner of the desktop, as a quiet background ornament (real windows cover
  // it). Set from the panel's settings; persisted. The Desktop window reads
  // this binding and shows itself while planted && desktopEnabled.
  property bool desktopEnabled: false
  function setDesktop(on) {
    if (desktopEnabled === (on === true)) return
    desktopEnabled = on === true
    flush()
  }

  // Need levels, 0 = fine, 100 = critical.
  property real thirstLevel: 0
  property real lightLevel: 0
  property real soilLevel: 0
  property real untidinessLevel: 0
  property bool wateredRecently: false

  // --- runtime --------------------------------------------------------------
  property double nowMs: Date.now()
  property bool initialized: false
  property bool identityReady: false
  readonly property int maxStateBytes: 65536

  // A short "good morning" pulse the bar mark and panel celebrate the wake with.
  property double wokeAtMs: 0
  property bool justWoke: false
  Timer { id: justWokeTimer; interval: 1800; onTriggered: root.justWoke = false }

  // Derived, drives the mood line and the renderer. A dev/override.json may pin
  // any need (water/light/soil/upkeep, 0..100) so the whole panel — bars, mood,
  // and the wilting palm — previews a neglected tree.
  readonly property real thirst: {
    var v = devOverride && devOverride.water
    return Math.max(0, Math.min(100, (v === 0 || v > 0) ? v : thirstLevel))
  }
  readonly property real light: {
    var v = devOverride && devOverride.light
    return Math.max(0, Math.min(100, (v === 0 || v > 0) ? v : lightLevel))
  }
  readonly property real soil: {
    var v = devOverride && devOverride.soil
    return Math.max(0, Math.min(100, (v === 0 || v > 0) ? v : soilLevel))
  }
  readonly property real untidiness: {
    var v = devOverride && devOverride.upkeep
    return Math.max(0, Math.min(100, (v === 0 || v > 0) ? v : untidinessLevel))
  }
  readonly property real worstNeed: Math.max(thirst, light, soil, untidiness)
  readonly property real wellbeing: Math.round(100 - worstNeed)

  readonly property real currentCareAverage: careCount > 0 ? careSum / careCount : 100
  readonly property string formLabel: form === "tangled" ? "tangled" : "neat"

  // Effective maturity — the dev override (dev/override.json) wins so the whole
  // panel, not just the render, reflects the frozen life stage.
  readonly property real effMaturity: devMaturity >= 0 ? devMaturity : maturity

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
    case "waking": return "Waking up…"
    case "unsown": return "Bare soil, waiting. Plant something."
    case "germinating": return "A seed underground, taking its time."
    case "sapling": return origin === "cutting"
      ? "A cutting, finding its feet." : "A brave little sprout."
    case "thirsty": return "The soil is dry — water me."
    case "shaded": return "Stretching toward the light…"
    case "hungry": return "Hungry for fresh nutrients."
    case "wild": return "Getting shaggy — time to trim."
    case "meh": return "Doing alright, growing quietly."
    default: return "Flourishing."
    }
  }

  // The stage of life, for the age line.
  readonly property string stage: {
    if (effMaturity >= 0.95) return "mature"
    if (effMaturity >= 0.6)  return "adolescent"
    if (effMaturity >= 0.25) return "young"
    return "seedling"
  }
  readonly property string stageLabel: ({
    seedling: "Seedling", young: "Young tree", adolescent: "Adolescent",
    mature: "Mature bonsai"
  })[stage] || "Seedling"

  // --- identity -------------------------------------------------------------
  // machine-id + hostname are the second half of the seed (user is the first).
  // Both are read straight off disk, synchronously, when the service is built —
  // no subprocess round-trips to wait on while the shell is busy booting, so
  // the tree is awake on the first frame instead of a few seconds later. The
  // files are tiny and always present on a systemd box; wake() has env + literal
  // fallbacks so a missing one still yields a stable seed.
  FileView {
    id: machineIdFile
    path: "/etc/machine-id"
    preload: true
    blockLoading: true
    watchChanges: false
    printErrors: false
  }
  FileView {
    id: hostNameFile
    path: "/etc/hostname"
    preload: true
    blockLoading: true
    watchChanges: false
    printErrors: false
  }

  // Dev "time travel": drop a dev/override.json next to this file —
  //   { "maturity": 0..1, "tangled": 0..1, "clock": "HH:MM" | hour }
  // — and restart the shell to freeze the panel at that life stage / time of
  // day. Absent or empty file = normal living behaviour. dev/timelapse.js
  // scrubs the whole arc without touching the shell.
  property var devOverride: ({})
  readonly property real devMaturity: {
    var v = devOverride && devOverride.maturity
    return (v === 0 || v > 0) ? Math.max(0, Math.min(1, Number(v))) : -1
  }
  readonly property real devTangled: {
    var v = devOverride && devOverride.tangled
    return (v === 0 || v > 0) ? Math.max(0, Math.min(1, Number(v))) : -1
  }
  readonly property real devHour: {
    if (!devOverride || devOverride.clock === undefined || devOverride.clock === null) return -1
    var p = String(devOverride.clock).split(":")
    var h = parseInt(p[0], 10)
    if (isNaN(h)) return -1
    var mi = p.length > 1 ? (parseInt(p[1], 10) || 0) : 0
    return Math.max(0, Math.min(24, h + mi / 60))
  }

  // The weather plugin publishes its last successful local report here. This
  // is deliberately a cache read, not a network dependency: Omatree keeps
  // working with neutral weather when the provider is unavailable.
  readonly property string weatherCachePath:
    stateDir + "/settings/weather-current.json"
  property var localWeather: ({})

  function loadLocalWeather() {
    var raw = ""
    try { raw = weatherCacheFile.text() || "" } catch (eW) {}
    if (!raw.trim()) {
      localWeather = ({})
      return
    }
    try {
      var parsed = JSON.parse(raw)
      var fetched = Number(parsed.fetchedAtMs)
      var temperatureC = Number(parsed.temperatureC)
      var humidity = Number(parsed.humidity)
      var windKmph = Number(parsed.windKmph)
      var fresh = isFinite(fetched) && fetched > 0
        && Date.now() - fetched <= 6 * 60 * 60 * 1000
      localWeather = fresh && isFinite(temperatureC) && isFinite(humidity)
        && isFinite(windKmph)
        ? {
            temperatureC: temperatureC,
            humidity: Math.max(0, Math.min(100, humidity)),
            windKmph: Math.max(0, windKmph)
          }
        : ({})
    } catch (eP) {
      localWeather = ({})
    }
  }

  FileView {
    id: weatherCacheFile
    path: root.weatherCachePath
    preload: true
    blockLoading: true
    watchChanges: true
    printErrors: false
    onLoaded: root.loadLocalWeather()
    onFileChanged: {
      reload()
      root.loadLocalWeather()
    }
    onLoadFailed: root.localWeather = ({})
  }

  readonly property string devOverridePath:
    Qt.resolvedUrl("dev/override.json").toString().replace(/^file:\/\//, "")
  FileView {
    id: devOverrideFile
    path: root.devOverridePath
    preload: true
    blockLoading: true
    watchChanges: false
    printErrors: false
  }

  // Everything Bonsai.qml needs to grow (Grow.js) and paint (Paint.js) the tree:
  // the identity, how grown/old/cared-for it is, the hand-pruning map, the
  // turntable angle, the lamp, and devClock so the sun can be pinned in preview.
  // Combined age in years: mostly the machine's awake-time, with a slower nod to
  // real calendar time. Feeds Grow.js's asymptotic size creep (decades -> a big
  // old tree, centuries -> the cap).
  readonly property real ageYears:
    (activeAgeMinutes / (60 * 24 * 365)) * 0.6 + (wallAgeDays / 365) * 0.4

  readonly property var treeSpec: genesis
    ? {
        seed: genesis.seed,
        gen: genesis,                          // the full identity for Grow.js
        genus: genesis.genus,
        style: genesis.style,
        origin: origin,                        // "" | "seed" | "cutting"
        maturity: devMaturity >= 0 ? devMaturity : maturity,
        ageYears: devOverride && devOverride.age >= 0 ? Number(devOverride.age) : ageYears,
        // 1 = parched, 0 = well watered -> the crown sags.
        thirst: thirst / 100,
        // 1 = every need met, 0 = badly neglected -> fronds yellow and thin.
        health: wellbeing / 100,
        // hand-pruning: per-cluster cut-back the renderer applies + can un-apply.
        prune: prune,
        // which way the turntable is facing (radians), + a dev override.
        yaw: devOverride && (devOverride.yaw === 0 || devOverride.yaw > 0) ? Number(devOverride.yaw) : yaw,
        // the grow lamp: when on, the tree is lit warm and bright even at night.
        lamp: lampOn,
        // Optional local weather handoff. No network access is required here;
        // a weather provider may supply windKmph, humidity, and temperatureC.
        weather: devOverride && devOverride.weather ? devOverride.weather : localWeather,
        fruit: fruitVisible,
        devClock: devHour
      }
    : null

  // --- ageing ---------------------------------------------------------------
  // On the minute tick we fold one active minute in, and the daily tick folds
  // wall age in. Growth is gentle: it follows the better-fed, calmer clock.
  function accumulateAge(daysDelta) {
    wallAgeDays = wallAgeDays + Math.max(0, Math.round(daysDelta))
    checkFruit()
  }

  function applyActiveMinute() {
    if (!planted) { lastActiveMs = nowMs; return }   // nothing sown yet

    // Needs rise with active time; the machine being on means the plant must
    // be tended. No absolute machine performance.
    thirstLevel = Math.min(100, thirstLevel + 0.24)
    // Sunlight is window-dependent in the real world; here it fades a touch
    // slower because the glass house gets ambient light.
    lightLevel = Math.min(100, lightLevel + 0.18)
    soilLevel = Math.min(100, soilLevel + 0.22)
    untidinessLevel = Math.min(100, untidinessLevel + 0.10)

    activeAgeMinutes += 1
    // Growth rate depends on wellbeing: a looked-after tree grows; a parched
    // one stalls. We want a young tree to mature over weeks of use, so the
    // per-minute pull is tiny. Misho (from seed) dawdles until it has roots;
    // a cutting is already established and races ahead early on.
    var care = currentCareAverage / 100
    var g = 0.00002 + 0.00010 * care
    if (origin === "seed" && maturity < 0.14) g *= 0.45
    else if (origin === "cutting" && maturity < 0.4) g *= 1.4
    maturity = Math.min(1, maturity + g)
    lastActiveMs = nowMs
    checkFruit()
  }

  // --- care -----------------------------------------------------------------
  function waterNow() {
    thirstLevel = 0
    wateredRecently = true
    recordCare()
  }

  function lightNow(amount) {
    lightLevel = Math.max(0, lightLevel - amount)
    recordCare()
  }

  function feedNow() {
    soilLevel = 0
    recordCare()
  }

  // Pruning is the art: it trims untidiness and nudges the form toward neat.
  function pruneNow() {
    untidinessLevel = Math.max(0, untidinessLevel - 45)
    if (untidinessLevel <= 15 && form !== "neat") form = "neat"
    recordCare()
    flush()
  }

  function recordCare() {
    careSum += wellbeing
    careCount += 1
    // Rolling average, reset once past a window so a bad week can heal.
    if (careCount > 320) { careSum = wellbeing; careCount = 1 }
    // Tangled trees let the wild run away; keep cared-for ones neat.
    if (form === "tangled" && untidinessLevel <= 10 && careCount > 120) form = "neat"
    checkFruit()
  }

  function checkFruit() {
    if (fruitFound || fruitHarvested || !planted) return
    if (maturity < 0.78 || wallAgeDays < fruitThresholdDays
        || currentCareAverage < 82 || wellbeing < 65) return
    fruitFound = true
    flush()
    notify("Omatree", treeName + " has grown a fruit.")
  }

  function harvestFruit() {
    if (!fruitVisible) return
    fruitHarvested = true
    seedAvailable = true
    flush()
    notify("Omatree", "You harvested " + treeName + "'s fruit. One seed is yours to keep.")
  }

  // --- moods that reflect real system state --------------------------------
  // Sunlight edges toward warm in the daytime and low at night, so the tree
  // visibly "sleeps" with the system clock. This is the one tie to the host.
  readonly property int hour: {
    if (devHour >= 0) return Math.floor(devHour)
    var d = new Date(nowMs)
    return d.getHours()
  }
  readonly property bool daylight: hour >= 6 && hour < 20

  // The lamp in the panel is really just sunshine on demand: click it and the
  // light need drops a notch.
  property bool lampOn: false
  Timer {
    id: lampTimer
    interval: 1000
    repeat: true
    running: root.lampOn
    onTriggered: {
      // 1% a second: 100s of lamp to fully clear sunlight need.
      root.lightLevel = Math.max(0, root.lightLevel - 1)
    }
  }

  // --- planting -----------------------------------------------------------
  // Start over: back to bare soil, waiting for the user to choose seed or cutting.
  function replant() {
    plantedAtMs = 0
    lastSeenMs = Date.now()
    lastActiveMs = lastSeenMs
    wallAgeDays = 0
    activeAgeMinutes = 0
    maturity = 0
    form = "neat"
    origin = ""
    fruitFound = false
    fruitHarvested = false
    prune = ({})
    yaw = 0
    thirstLevel = 0; lightLevel = 0; soilLevel = 0; untidinessLevel = 0
    careSum = 0; careCount = 0
    flush()
  }

  // The user picks how to start it.
  function plant(how) {
    var berrySeed = how === "berrySeed"
    if (berrySeed && !seedAvailable) return
    origin = berrySeed ? "seed" : (how === "cutting" ? "cutting" : "seed")
    fruitFound = false
    fruitHarvested = false
    if (berrySeed) seedAvailable = false
    plantedAtMs = Date.now()
    lastSeenMs = plantedAtMs
    lastActiveMs = plantedAtMs
    wallAgeDays = 0
    activeAgeMinutes = 0
    maturity = origin === "cutting" ? 0.17 : 0.004
    form = "neat"
    prune = ({})
    thirstLevel = 0; lightLevel = 0; soilLevel = 0; untidinessLevel = 0
    careSum = 0; careCount = 0
    flush()
    notify("Omatree",
      origin === "cutting"
        ? treeName + " takes root — a cutting with a head start on its shape."
        : treeName + " is sown. Misho: the slow way. Water it and wait.")
  }

  function flush() {
    stateFile.setText(JSON.stringify({
      plantedAtMs: plantedAtMs,
      lastSeenMs: lastSeenMs,
      lastActiveMs: lastActiveMs,
      wallAgeDays: wallAgeDays,
      activeAgeMinutes: activeAgeMinutes,
      maturity: maturity,
      careSum: careSum,
      careCount: careCount,
      form: form,
      origin: origin,
      prune: prune,
      yaw: yaw,
      desktopEnabled: desktopEnabled === true,
      thirstLevel: thirstLevel,
      lightLevel: lightLevel,
      soilLevel: soilLevel,
      untidinessLevel: untidinessLevel,
      fruitFound: fruitFound,
      fruitHarvested: fruitHarvested,
      seedAvailable: seedAvailable
    }, null, 2) + "\n")
  }

  FileView {
    id: stateFile
    path: root.statePath
    preload: true
    blockLoading: true
    watchChanges: false
    atomicWrites: true
    printErrors: false
  }

  // --- waking up ----------------------------------------------------------
  // One synchronous pass, the moment the service is built: settle the identity,
  // read the save off disk, catch the wall clock up, start the heartbeats. No
  // async fan-out to wait on, so `initialized` is true on the first frame and
  // the bar mark never sits there "waking…" for seconds on a cold start.
  Component.onCompleted: root.wake()

  function wake() {
    if (initialized) return

    // --- identity, straight off disk (env / literal fallbacks) ---
    var mid = ""
    try { mid = (machineIdFile.text() || "").trim() } catch (eM) {}
    if (mid === "") mid = (Quickshell.env("MACHINE_ID") || "").trim()
    machineIdLoaded = mid

    var hn = ""
    try { hn = (hostNameFile.text() || "").trim() } catch (eH) {}
    if (hn === "") hn = (Quickshell.env("HOSTNAME") || "").trim()
    if (hn === "") hn = "localhost"
    hostName = hn

    // --- dev "time travel" override, if one is sitting in dev/ ---
    try {
      var dv = (devOverrideFile.text() || "").trim()
      if (dv !== "") devOverride = JSON.parse(dv) || {}
    } catch (eD) { console.warn("bonsai: dev/override.json is not valid JSON —", eD) }

    genesis = TreeGen.genesis(machineIdLoaded, userName + "@" + hostName)
    genusLabel = genesis.genus
    treeName = nameFor(genesis.seed)
    identityReady = true

    // --- the saved tree, straight off disk ---
    var raw = ""
    try { raw = stateFile.text() || "" } catch (eS) {}
    var saveProblem = ""
    if (raw.length >= maxStateBytes) { raw = ""; saveProblem = "exceeds " + maxStateBytes + " bytes" }

    function num(v) { var n = Number(v); return isFinite(n) && n > 0 ? n : 0 }
    try {
      var s = raw !== "" ? JSON.parse(raw) : {}
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
      // prune keys are now clump-id strings (Grow.js). Drop the old numeric
      // pad-index keys from the sprite renderer — pruning is cosmetic + rare.
      var pr = {}
      if (s.prune && typeof s.prune === "object")
        for (var pk in s.prune) if (!/^\d+$/.test(pk)) pr[pk] = s.prune[pk]
      prune = pr
      yaw = (typeof s.yaw === "number" && isFinite(s.yaw)) ? s.yaw : 0
      desktopEnabled = s.desktopEnabled === true
      thirstLevel = num(s.thirstLevel)
      lightLevel = num(s.lightLevel)
      soilLevel = num(s.soilLevel)
      untidinessLevel = num(s.untidinessLevel)
      fruitFound = s.fruitFound === true
      fruitHarvested = s.fruitHarvested === true
      seedAvailable = s.seedAvailable === true
    } catch (e) {
      saveProblem = "not valid JSON (" + e + ")"
    }

    var fresh = plantedAtMs === 0 && origin === ""
    if (fresh) {
      // Nothing sown yet — bare soil, waiting on the user to choose.
      lastSeenMs = Date.now()
      lastActiveMs = lastSeenMs
      wallAgeDays = 0
      activeAgeMinutes = 0
      maturity = 0
      form = "neat"
      thirstLevel = 0; lightLevel = 0; soilLevel = 0; untidinessLevel = 0
    }

    if (saveProblem !== "") {
      console.warn("bonsai: state file " + statePath + " " + saveProblem + " — starting over")
      notify("Bonsai couldn't read its save",
             "It was corrupt or oversized, so a fresh seed takes over.")
    }

    initialized = true
    if (fresh) flush()

    // Wall age: the tree went on ageing while the box was off. Guard against
    // clock jumps.
    var elapsedDays = 0
    if (lastSeenMs > 0) {
      var delta = Math.abs(nowMs - lastSeenMs)
      if (delta < 60 * 24 * 60 * 60 * 1000) // < 60 days
        elapsedDays = delta / (24 * 60 * 60 * 1000)
    }
    root.accumulateAge(elapsedDays)
    root.nowMs = Date.now()
    lastSeenMs = nowMs

    heartbeat.running = true
    daily.running = true

    // ...and it's awake. A brief flag the bar mark + panel bloom on.
    wokeAtMs = Date.now()
    justWoke = true
    justWokeTimer.restart()
  }

  function notify(title, body) {
    var omarchyPath = Quickshell.env("OMARCHY_PATH") || ""
    var exec = omarchyPath !== "" ? omarchyPath + "/bin/omarchy-notification-send"
      : "omarchy-notification-send"
    Quickshell.execDetached([exec, "--app-name", "bonsai", "-u", "normal", title, body])
  }

  // -------------------------------------------------------------------------
  // Heartbeats. The minute tick runs the plant's life; the daily tick crosses
  // real calendar days so the tree keeps ageing "with you" overnight.
  Timer {
    id: heartbeat
    interval: 60 * 1000
    running: false
    repeat: true
    onTriggered: {
      root.nowMs = Date.now()
      root.applyActiveMinute()
      if (root.careCount % 5 === 0) root.flush()
    }
  }

  Timer {
    id: daily
    interval: 60 * 60 * 1000
    running: false
    repeat: true
    onTriggered: {
      root.nowMs = Date.now()
      // Cross-calendar-day accounting: fold what truly elapsed since last
      // heartbeat into the wall clock, then update lastSeen.
      if (root.lastSeenMs > 0) {
        var del = (root.nowMs - root.lastSeenMs) / 86400000
        root.accumulateAge(Math.max(0, Math.min(del, 3)))
      }
      root.lastSeenMs = root.nowMs
      root.flush()
    }
  }

  // ---- desktop snapshot ornament -----------------------------------------
  // The quiet lower-right desktop copy of the tree. Loaded lazily and behind a
  // Loader so (a) its layer-shell surface only exists while the snapshot is
  // actually switched on, and (b) a problem inside Desktop.qml can never take
  // the whole service down with it — the bar mark and panel keep working.
  Loader {
    active: root.initialized && root.planted && root.desktopEnabled
    source: Qt.resolvedUrl("Desktop.qml")
    onLoaded: if (item) item.bonsaiService = root
  }
}
