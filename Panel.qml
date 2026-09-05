pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import Quickshell.Io
import Qt.labs.folderlistmodel
import qs.Commons
import qs.Ui

// Omatree panel — a clean, quiet HUD. The living pixel tree sits in the panel
// (no frame); below it, the mood, the life stage, and four slim care meters,
// each with a pill to tend it. Plant from seed or cutting; prune by hand.
Panel {
  id: root
  moduleName: "tiedeyez.omatree"

  property var anchorItem: null
  property var hostWidget: null
  property var treeService: null
  // Set by the bar widget only when the Omagotchi pet is installed. The panel
  // grows a companion strip that tends it — feed, wash, a hand on its back —
  // by calling the pet's own service functions (the same calls its own bar
  // pill makes). Its pill still works and stays in step; this is the shared
  // window onto both. Nothing here reads the pet's files or opens its UI.
  property var petService: null
  readonly property bool petHere: !!petService && petService.initialized === true
  // For the live sprite snapshot: the pet plugin's own directory (stamped onto
  // its manifest by the shell), its current form, and idle/sleep/eat.
  readonly property string petDir: petHere && petService.manifest
    ? String(petService.manifest.__sourceDir || "") : ""
  readonly property string petForm: petHere ? String(petService.form || "") : ""
  readonly property string petAnim: !petHere ? "idle"
    : petService.sleeping ? "sleep"
    : (petService.eating === true ? "eat" : "idle")
  readonly property var barIdentity: hostWidget || root

  readonly property bool ready: !!treeService && treeService.initialized === true
  readonly property color fg: Color.popups.text
  readonly property color bg: Color.popups.background
  readonly property color accent: Color.accent
  readonly property color warn: Color.urgent
  readonly property string uiFont: "monospace"
  readonly property real capSize: Style.font.caption !== undefined ? Style.font.caption : Style.font.bodySmall
  readonly property real rad: Style.cornerRadius > 0 ? Style.space(10) : 0

  readonly property real worst: root.ready ? root.treeService.worstNeed : 0
  readonly property bool planted: root.ready && root.treeService.planted
  readonly property bool pruning: treeView.pruneMode

  // brief "+ watered" confirmation after a care action
  property string flash: ""
  Timer { id: flashTimer; interval: 1400; onTriggered: root.flash = "" }

  // the care hint for whichever meter pill is hovered (shown in the mood line)
  property string hoverHint: ""
  onOpenedChanged: {
    if (!opened) { hoverHint = ""; kbActive = false; kbFocus = ""; return }
    Qt.callLater(root.playGreeting)
    // The desktop tile's "graft" quick-action summons the panel via a
    // separate window entirely (Quickshell.execDetached), so this flag on
    // the shared service is the only handoff available — cleared either
    // way so it can never fire again on a later, unrelated open.
    if (root.ready && root.treeService.pendingGraftOpen) {
      root.treeService.pendingGraftOpen = false
      Qt.callLater(function () { graftFlow.opened = true })
    }
  }
  onPruningChanged: if (pruning) hoverHint = ""
  onReadyChanged: if (ready && opened) Qt.callLater(root.playGreeting)

  // ---- first-open "good morning" -----------------------------------------
  // The first time the glass house opens after the shell (re)starts, the tree
  // has just woken: a soft sunrise wash sweeps the house and the mood line
  // greets you by name for a beat. Once per session — every later open is
  // business as usual.
  property bool _greeted: false
  property string greetLine: ""
  Timer { id: greetTimer; interval: 2600; onTriggered: root.greetLine = "" }
  function playGreeting() {
    if (root._greeted || !root.ready || !root.planted) return
    root._greeted = true
    sunriseAnim.restart()
    // Once a year, and only if the bar pet happens to have hatched on the same
    // day this tree was started, the greeting is a different one. Nothing else
    // marks it, nothing explains it, and it is gone with the greeting timer.
    root.greetLine = root.treeService.companionBirthday
      ? "we are the same age today"
      : ("good morning — I am " + root.treeService.treeName).toLowerCase()
    greetTimer.restart()
  }

  // waking placeholder: a cycling caption while the service settles (rare now
  // that the wake is synchronous, but graceful when the disk is slow)
  readonly property var wakeLines: ["warming the soil", "finding the light", "unfurling", "waking"]
  property int wakeStep: 0
  readonly property string wakeLine:
    wakeLines[wakeStep % wakeLines.length].toUpperCase() + "…"
  Timer {
    running: !root.ready && root.opened
    interval: 850; repeat: true
    onTriggered: root.wakeStep++
  }

  // ---- keyboard navigation -------------------------------------------------
  // One cursor for the whole panel. kbActive gates the highlight (first arrow
  // press just wakes it, like the other omarchy panels); kbFocus names the
  // target. Mouse hover keeps them in sync so only one thing is ever lit.
  //   not planted  -> "seed" | "cutting"
  //   trimming     -> Omatree.kbPrune owns the cluster cursor
  //   settings open-> "settings" | "growback" | "startover"
  //   otherwise    -> "tree" | "water" | "lamp" | "feed" | "prune" | "settings"
  property bool kbActive: false
  property string kbFocus: ""
  readonly property string treeHint: "← → turn me   ·   scroll to zoom   ·   ↑ ↓ move"

  onKbFocusChanged: {
    if (kbFocus === "tree" && kbActive) hoverHint = treeHint
    else if (hoverHint === treeHint) hoverHint = ""
  }

  function kbTargets() {
    if (!root.ready) return []
    if (!root.planted) return root.treeService.seedAvailable
      ? ["berrySeed", "seed", "cutting"] : ["seed", "cutting"]
    if (settingsCol.open) {
      var s = ["settings"]
      if (root.treeService.prune && Object.keys(root.treeService.prune).length > 0)
        s.push("growback")
      s.push("startover")
      return s
    }
    var main = ["tree", "water", "lamp", "feed", "prune", "graft"]
    // the companion, when the pet is installed: its rows join the cursor in
    // reading order, right where they sit under the tree's own meters
    if (root.petHere) {
      if (root.petValue("feed") >= 8) main.push("petfeed")
      if (root.petValue("wash") >= 8) main.push("petwash")
      main.push("pethand")
    }
    main.push("desktop", "settings")
    return main
  }

  function kbWake() {
    var t = kbTargets()
    if (t.length === 0) return false
    root.kbActive = true
    if (t.indexOf(root.kbFocus) < 0) root.kbFocus = t[0]
    return true
  }

  function kbStep(delta) {
    if (graftFlow.opened) { graftFlow.kbMove(delta); return }
    if (root.pruning) { treeView.kbPruneCycle(delta); return }
    if (!root.kbActive) { kbWake(); return }
    var t = kbTargets()
    var i = t.indexOf(root.kbFocus)
    if (i < 0) { if (t.length) root.kbFocus = t[0]; return }
    root.kbFocus = t[Math.max(0, Math.min(t.length - 1, i + delta))]
  }

  function kbHoriz(delta) {
    if (graftFlow.opened) { graftFlow.kbMove(delta); return }
    if (root.pruning) { treeView.kbPruneCycle(delta); return }
    if (!root.kbActive) { kbWake(); return }
    if (root.kbFocus === "tree") { treeView.stepYaw(delta > 0 ? 1 : -1); return }
    if (!root.planted) kbStep(delta)
  }

  function kbActivate() {
    if (graftFlow.opened) { graftFlow.kbActivate(); return }
    if (root.pruning) { treeView.kbPruneCut(); return }
    if (!root.kbActive) { kbWake(); return }
    switch (root.kbFocus) {
    case "berrySeed":
      if (root.ready && !root.planted) { root.treeService.plant("berrySeed"); root.flashNote("heirloom seed sown") }
      break
    case "seed":
      if (root.ready && !root.planted) { root.treeService.plant("seed"); root.flashNote("seed sown") }
      break
    case "cutting":
      if (root.ready && !root.planted) { root.treeService.plant("cutting"); root.flashNote("cutting struck") }
      break
    case "water": root.runAction("water"); break
    case "lamp": root.runAction("lamp"); break
    case "feed": root.runAction("feed"); break
    case "prune":
      treeView.pruneMode = true
      treeView.kbPrune = 0
      break
    case "graft": graftFlow.opened = true; break
    case "settings":
      settingsCol.open = !settingsCol.open
      root.kbFocus = "settings"
      break
    case "desktop":
      if (root.ready) {
        var putOut = !root.treeService.desktopEnabled
        root.treeService.setDesktop(putOut)
        root.flashNote(putOut ? "out on your desktop" : "home in the bar")
      }
      break
    case "petfeed": root.companionAction("feed"); break
    case "petwash": root.companionAction("wash"); break
    case "pethand":
      root.companionAction(root.petHere && root.petService.sleeping ? "wake" : "pet")
      break
    case "growback":
      if (root.ready) { root.treeService.pruneReset(); root.flashNote("growing back") }
      break
    case "startover": replantConfirm.opened = true; break
    }
  }

  function kbEscape() {
    if (graftFlow.opened) { graftFlow.kbBack(); return }
    if (replantConfirm.opened) { replantConfirm.opened = false; return }
    if (root.pruning) { treeView.pruneMode = false; root.kbFocus = "prune"; return }
    if (settingsCol.open) { settingsCol.open = false; root.kbFocus = "settings"; return }
    root.close()
  }

  function kbShortcut(t) {
    if (!root.ready || !root.planted || root.pruning) return
    var map = { w: "water", f: "feed", p: "prune" }
    var target = map[t]
    if (!target) return
    root.kbActive = true
    root.kbFocus = target
    kbActivate()
  }
  readonly property color statusColor: !root.ready ? Qt.alpha(root.fg, 0.4)
    : root.worst >= 60 ? root.warn
    : root.worst >= 35 ? Qt.rgba(0.95, 0.73, 0.32, 1)
    : root.accent

  // Structural only — a fixed reference so the meter Repeater never rebuilds its
  // delegates (a rebuild on every service tick was making the pill rows jump and
  // the hover state stick to the wrong pill). Live values + hints come through
  // needValue()/needHint() bindings inside the delegate.
  // Light means two different things depending on the hour, and the control
  // should say which. In daylight you are opening a window onto the sun; after
  // dark you are switching on a grow lamp over the tree. Same toggle, same
  // state — but the tree is not pretending a lamp is the sun, or the other way
  // round.
  readonly property bool byDaylight: root.ready && root.treeService.daylight
  readonly property bool lightOn: root.ready && root.treeService.lampOn
  readonly property string lightWord: root.byDaylight
    ? (root.lightOn ? "close blinds" : "open blinds")
    : "lamp"
  readonly property string lightCaps: root.byDaylight
    ? (root.lightOn ? "CLOSE BLINDS" : "OPEN BLINDS")
    : "LAMP"

  readonly property var needs: [
    { label: "water", action: "water" },
    { label: "light", action: "lamp" },
    { label: "soil", action: "feed" },
    { label: "form", action: "prune" }
  ]

  function needValue(action) {
    if (!root.ready) return 0
    return ({ water: treeService.thirst, lamp: treeService.light,
              feed: treeService.soil, prune: treeService.untidiness })[action] || 0
  }
  function needHint(action) {
    if (action === "lamp")
      return root.byDaylight
        ? (root.lightOn ? "close the blinds to soften the light" : "open the blinds — I have good light today")
        : "it is dark out — leave the grow lamp on?"
    return ({ water: "my soil dries while you work",
              feed: "my roots would like something to eat",
              prune: "trim me and I will hold the shape" })[action] || ""
  }

  // ---- the companion (Omagotchi pet, when installed) --------------------
  // Fixed rows so the Repeater never rebuilds; live values come through
  // petValue() the way the tree's own meters use needValue().
  readonly property var petRows: [
    { label: "food", pill: "feed", act: "feed" },
    { label: "bath", pill: "wash", act: "wash" }
  ]
  function petValue(act) {
    if (!root.petHere) return 0
    return act === "feed" ? root.petService.hunger : root.petService.dirtiness
  }
  function petLine() {
    if (!root.petHere) return ""
    switch (root.petService.mood) {
    case "egg": return "something small is waiting to hatch in my branches"
    case "sleeping": return "something small is asleep in my branches"
    case "hungry": return "the creature in my branches is hungry"
    case "dirty": return "the creature in my branches would like washing"
    case "sleepy": return "the creature in my branches is drowsy"
    case "bored": return "the creature in my branches is restless"
    case "lonely": return "the creature in my branches wants your hand"
    case "meh": return "the creature in my branches is settled"
    default: return "the creature in my branches is happy here"
    }
  }
  // "food" only feeds from what the tree has actually grown: a real berry,
  // picked and handed over. No berry ripe yet -> nothing to give, and the
  // note says so rather than feeding for free.
  function petRowLabel(row) {
    if (row.act === "feed") {
      var n = root.ready ? root.treeService.berries : 0
      return "FOOD" + (n > 0 ? "  ·  " + n + (n === 1 ? " BERRY" : " BERRIES") : "")
    }
    return row.label.toUpperCase()
  }
  function companionAction(kind) {
    if (!root.petHere) return
    var p = root.petService
    if (kind === "feed") {
      if (!root.treeService || !root.treeService.pickBerry()) {
        root.flashNote("no berries ripe yet")
        return
      }
      p.feedNow()
      root.flashNote("gave it a berry")
    }
    else if (kind === "wash") { p.scrub(25); root.flashNote("I rinsed it clean") }
    else if (kind === "pet") { p.petThePet(); root.flashNote("it settles against the bark") }
    else if (kind === "wake") { p.wakeUp(); root.flashNote("it stirs awake") }
  }
  Timer {
    id: companionClock
    property real t: 0
    running: root.opened && root.petHere
    repeat: true
    interval: 90
    onTriggered: t += 0.09
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    padding: Style.space(16)
    contentWidth: panel.fittedContentWidth(Style.space(400))
    contentHeight: panel.fittedContentHeight(col.implicitHeight + Style.space(20))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function (dx, dy) {
        if (dy !== 0) root.kbStep(dy)
        else if (dx !== 0) root.kbHoriz(dx)
      }
      onActivateRequested: root.kbActivate()
      onCloseRequested: root.kbEscape()
      onTextKey: function (t) { root.kbShortcut(t) }
      onTabRequested: function (direction) { root.switchPanel(direction) }

      Column {
        id: col
        anchors { left: parent.left; right: parent.right; top: parent.top }
        spacing: Style.space(14)

        // a gentle settle when the panel opens
        opacity: root.opened ? 1 : 0
        Behavior on opacity { NumberAnimation { duration: 300; easing.type: Easing.OutSine } }
        transform: Translate {
          y: root.opened ? 0 : Style.space(8)
          Behavior on y { NumberAnimation { duration: 340; easing.type: Easing.OutSine } }
        }

        // ---- the tree, sitting in the panel (no frame) -----------------
        // Height follows the tree: a seedling gets a small box, a decades-old
        // trunk pushes the panel tall (Tree caps itself at ~half the screen).
        Item {
          id: house
          width: parent.width
          readonly property real _screenH: Screen.height > 0 ? Screen.height : 1200
          height: root.planted
            ? Math.max(Style.space(140),
                Math.min(treeView.implicitHeight + strip.height + Style.space(18), _screenH * 0.52))
            : Style.space(190)
          Behavior on height { NumberAnimation { duration: 540; easing.type: Easing.OutSine } }
          clip: true

          // top strip: identity + light toggle, or the trim controls
          Item {
            id: strip
            anchors { top: parent.top; left: parent.left; right: parent.right }
            anchors.margins: Style.space(10)
            height: Style.space(14)
            opacity: root.planted ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: 160 } }

            Row {
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(6)
              visible: !root.pruning
              Rectangle {
                id: statusDot
                width: Style.space(6); height: width; radius: width / 2
                anchors.verticalCenter: parent.verticalCenter
                color: root.statusColor
                SequentialAnimation on scale {
                  running: root.ready && root.worst < 20
                  loops: Animation.Infinite
                  NumberAnimation { to: 1.35; duration: 1400; easing.type: Easing.InOutSine }
                  NumberAnimation { to: 1.0; duration: 1400; easing.type: Easing.InOutSine }
                }
              }
              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: root.ready ? root.treeService.treeName : "…"
                color: Qt.alpha(root.fg, 0.8)
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1.5
                renderType: Text.QtRendering
              }
              Text {
                anchors.verticalCenter: parent.verticalCenter
                visible: root.ready
                text: root.ready ? root.treeService.genusLabel.toLowerCase() : ""
                color: Qt.alpha(root.fg, 0.4)
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1
                renderType: Text.QtRendering
              }
            }

            // light toggle — a small drawn indicator, no glyph
            Item {
              id: lampToggle
              anchors { right: parent.right; verticalCenter: parent.verticalCenter }
              width: lampRow.width
              height: parent.height
              visible: !root.pruning
              readonly property bool on: root.ready && root.treeService.lampOn
              Row {
                id: lampRow
                anchors.verticalCenter: parent.verticalCenter
                spacing: Style.space(5)
                // Drawn marks, no glyphs: by day a window (a pane with its
                // mullions), by night a grow lamp (a head on a stem throwing
                // light down). Lit when it is on.
                Item {
                  id: lightMark
                  anchors.verticalCenter: parent.verticalCenter
                  width: Style.space(9); height: Style.space(9)
                  readonly property color ink: lampToggle.on ? root.accent : Qt.alpha(root.fg, 0.45)

                  // -- window --
                  Rectangle {
                    visible: root.byDaylight
                    anchors.fill: parent
                    color: lampToggle.on ? Qt.alpha(root.accent, 0.22) : "transparent"
                    border.width: 1
                    border.color: lightMark.ink
                    Behavior on color { ColorAnimation { duration: 160 } }
                  }
                  Rectangle {
                    visible: root.byDaylight
                    anchors.horizontalCenter: parent.horizontalCenter
                    y: 1; width: 1; height: parent.height - 2
                    color: lightMark.ink
                  }
                  Rectangle {
                    visible: root.byDaylight
                    anchors.verticalCenter: parent.verticalCenter
                    x: 1; height: 1; width: parent.width - 2
                    color: lightMark.ink
                  }

                  // -- grow lamp --
                  Rectangle {          // stem
                    visible: !root.byDaylight
                    anchors.horizontalCenter: parent.horizontalCenter
                    y: 0; width: 1; height: Math.round(parent.height * 0.34)
                    color: lightMark.ink
                  }
                  Rectangle {          // hood
                    visible: !root.byDaylight
                    anchors.horizontalCenter: parent.horizontalCenter
                    y: Math.round(parent.height * 0.34)
                    width: parent.width; height: Math.max(2, Math.round(parent.height * 0.24))
                    color: lightMark.ink
                  }
                  Rectangle {          // the light it throws
                    visible: !root.byDaylight && lampToggle.on
                    anchors.horizontalCenter: parent.horizontalCenter
                    y: Math.round(parent.height * 0.62)
                    width: Math.round(parent.width * 0.62)
                    height: Math.round(parent.height * 0.34)
                    color: Qt.alpha(root.accent, 0.35)
                  }
                }
                Text {
                  anchors.verticalCenter: parent.verticalCenter
                  text: root.lightCaps
                  color: lampToggle.on ? root.accent : Qt.alpha(root.fg, 0.45)
                  font.family: root.uiFont
                  font.pixelSize: root.capSize
                  font.letterSpacing: 1.5
                  renderType: Text.QtRendering
                }
              }
              MouseArea {
                anchors.fill: parent
                anchors.margins: -Style.space(6)
                cursorShape: Qt.PointingHandCursor
                enabled: root.ready
                onClicked: root.runAction("lamp")
              }
            }

            // trim mode: instruction + done
            Text {
              anchors { left: parent.left; verticalCenter: parent.verticalCenter }
              visible: root.pruning
              text: "TRIM  —  CLICK OR  ↑ ↓ · ENTER"
              color: Qt.alpha(root.accent, 0.9)
              font.family: root.uiFont
              font.pixelSize: root.capSize
              font.letterSpacing: 1.5
              renderType: Text.QtRendering
            }
            Text {
              anchors { right: parent.right; verticalCenter: parent.verticalCenter }
              visible: root.pruning
              text: "DONE"
              color: root.accent
              font.family: root.uiFont
              font.pixelSize: root.capSize
              font.letterSpacing: 1.5
              renderType: Text.QtRendering
              MouseArea {
                anchors.fill: parent
                anchors.margins: -Style.space(8)
                cursorShape: Qt.PointingHandCursor
                onClicked: treeView.pruneMode = false
              }
            }
          }

          Omatree {
            id: treeView
            inHousing: false
            anchors {
              top: strip.bottom; left: parent.left
              right: parent.right; bottom: parent.bottom
            }
            anchors.margins: Style.space(6)
            anchors.topMargin: Style.space(2)
            visible: root.planted
            active: root.opened && root.planted
            tree: root.planted ? root.treeService.treeSpec : null
            tint: root.accent
            textColor: root.fg
            bgColor: root.bg
            onPruneRequested: function (id) {
              if (root.ready) root.treeService.pruneNode(id)
            }
            onOrbitChanged: function (yaw) {
              if (root.ready) root.treeService.setOrbit(yaw)
            }
            // shallow zoom: scroll over the tree, persisted like the pose
            zoom: root.ready ? root.treeService.viewZoom : 1
            onZoomChanged2: function (z) {
              if (root.ready) root.treeService.setZoom(z)
            }
          }

          // keyboard focus ring on the tree — arrows turn the turntable
          Rectangle {
            anchors.fill: treeView
            visible: root.kbActive && root.kbFocus === "tree"
              && root.planted && !root.pruning
            color: "transparent"
            radius: Style.space(6)
            border.width: 1
            border.color: Qt.alpha(root.accent, 0.7)
          }

          // first-wake sunrise: a soft accent wash that sweeps the house the
          // first time it opens after the shell (re)starts
          Rectangle {
            id: sunrise
            anchors.fill: parent
            color: root.accent
            opacity: 0
            visible: opacity > 0.001
            SequentialAnimation {
              id: sunriseAnim
              NumberAnimation {
                target: sunrise; property: "opacity"
                from: 0; to: 0.16; duration: 220; easing.type: Easing.OutQuad
              }
              NumberAnimation {
                target: sunrise; property: "opacity"
                to: 0; duration: 1100; easing.type: Easing.OutCubic
              }
            }
          }

          // waking up — a seed in the soil, breathing, while the service settles
          Column {
            anchors.centerIn: parent
            visible: !root.ready
            spacing: Style.space(9)

            Item {
              width: Style.space(46); height: Style.space(24)
              anchors.horizontalCenter: parent.horizontalCenter

              Rectangle {                 // soil mound
                anchors.bottom: parent.bottom
                anchors.horizontalCenter: parent.horizontalCenter
                width: parent.width; height: Style.space(9)
                radius: height
                color: Qt.alpha(root.fg, 0.13)
              }
              Rectangle {                 // the seed, just under the surface
                id: wakeSeed
                anchors.horizontalCenter: parent.horizontalCenter
                y: Style.space(8)
                width: Style.space(9); height: Style.space(7)
                radius: width
                color: Qt.alpha(root.accent, 0.9)
                SequentialAnimation on scale {
                  running: !root.ready; loops: Animation.Infinite
                  NumberAnimation { to: 1.16; duration: 900; easing.type: Easing.InOutSine }
                  NumberAnimation { to: 1.0;  duration: 900; easing.type: Easing.InOutSine }
                }
                Rectangle {               // a breath of glow around it
                  anchors.centerIn: parent
                  width: parent.width + Style.space(9); height: width
                  radius: width / 2
                  color: "transparent"
                  border.width: 1
                  border.color: Qt.alpha(root.accent, 0.32)
                  opacity: 2.0 - wakeSeed.scale * 1.6
                }
              }
            }

            Text {
              anchors.horizontalCenter: parent.horizontalCenter
              text: root.wakeLine
              color: Qt.alpha(root.fg, 0.5)
              font.family: root.uiFont
              font.pixelSize: root.capSize
              font.letterSpacing: 2
              renderType: Text.QtRendering
            }
          }

          // ---- planting chooser: seed or cutting -----------------------
          Column {
            id: chooser
            anchors.centerIn: parent
            width: parent.width - Style.space(40)
            spacing: Style.space(10)
            visible: root.ready && !root.planted
            opacity: visible ? 1 : 0
            Behavior on opacity { NumberAnimation { duration: 200 } }

            Text {
              anchors.horizontalCenter: parent.horizontalCenter
              text: "BARE SOIL  —  BEGIN ME"
              color: Qt.alpha(root.fg, 0.55)
              font.family: root.uiFont
              font.pixelSize: root.capSize
              font.letterSpacing: 2
              renderType: Text.QtRendering
            }

            Repeater {
              model: {
                var choices = []
                if (root.treeService && root.treeService.seedAvailable)
                  choices.push({ how: "berrySeed", title: "FROM HEIRLOOM SEED", sub: "carry my own fruit forward — begin me again from it" })
                choices.push(
                { how: "seed", title: "FROM SEED", sub: "misho — start me from nothing, and wait with me" },
                { how: "cutting", title: "FROM CUTTING", sub: "a rooted snip of me — I arrive already finding my shape" })
                return choices
              }
              Rectangle {
                id: card
                required property var modelData
                readonly property bool lit: cardMa.containsMouse
                  || (root.kbActive && root.kbFocus === card.modelData.how)
                width: parent.width
                height: Style.space(44)
                radius: root.rad > 0 ? Style.space(7) : 0
                color: card.lit ? Qt.alpha(root.accent, 0.12) : Qt.alpha(root.fg, 0.04)
                border.width: 1
                border.color: Qt.alpha(root.accent, card.lit ? 0.6 : 0.25)
                scale: card.lit ? 1.015 : 1
                Behavior on color { ColorAnimation { duration: 210 } }
                Behavior on border.color { ColorAnimation { duration: 210 } }
                Behavior on scale { NumberAnimation { duration: 210; easing.type: Easing.OutSine } }

                // drawn mark: seed = filled dot; cutting = angled stem + node
                Item {
                  id: mark
                  width: Style.space(18); height: parent.height
                  anchors.left: parent.left; anchors.leftMargin: Style.space(12)
                  Rectangle {
                    visible: card.modelData.how === "seed"
                    anchors.centerIn: parent
                    width: Style.space(8); height: Style.space(6); radius: width
                    color: Qt.alpha(root.accent, 0.9)
                  }
                  Rectangle {
                    visible: card.modelData.how === "cutting"
                    anchors.centerIn: parent
                    width: 2; height: Style.space(16); radius: 1
                    color: Qt.alpha(root.accent, 0.9)
                    rotation: 20
                    Rectangle {
                      width: Style.space(5); height: Style.space(5); radius: width / 2
                      color: Qt.alpha(root.accent, 0.9)
                      x: -Style.space(3); y: -Style.space(1)
                    }
                  }
                }

                Column {
                  anchors.left: mark.right; anchors.leftMargin: Style.space(6)
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: 2
                  Text {
                    text: card.modelData.title
                    color: Qt.alpha(root.fg, 0.9)
                    font.family: root.uiFont
                    font.pixelSize: Style.font.bodySmall
                    font.letterSpacing: 1.5
                    renderType: Text.QtRendering
                  }
                  Text {
                    text: card.modelData.sub
                    color: Qt.alpha(root.fg, 0.5)
                    font.family: root.uiFont
                    font.pixelSize: root.capSize
                    renderType: Text.QtRendering
                  }
                }

                MouseArea {
                  id: cardMa
                  anchors.fill: parent
                  hoverEnabled: true
                  enabled: root.opened && root.ready
                  cursorShape: Qt.PointingHandCursor
                  onContainsMouseChanged: if (containsMouse && root.kbActive)
                    root.kbFocus = card.modelData.how
                  onClicked: {
                    if (!root.opened || !root.ready || root.planted) return
                    root.treeService.plant(card.modelData.how)
                    root.flashNote(card.modelData.how === "berrySeed" ? "heirloom seed sown"
                      : card.modelData.how === "cutting" ? "cutting struck" : "seed sown")
                  }
                }
              }
            }
          }

        }

        // ---- mood (+ a quick confirmation chip after you tend it) ------
        Item {
          width: parent.width
          height: moodText.implicitHeight
          visible: !settingsCol.open

          Text {
            id: moodText
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            opacity: (root.flash === "" && root.hoverHint === "" && root.greetLine === "") ? 1 : 0
            text: root.ready ? root.treeService.moodLabel : "I am waking up…"
            color: root.fg
            font.family: root.uiFont
            font.pixelSize: Style.font.body
            wrapMode: Text.Wrap
            renderType: Text.QtRendering
            Behavior on opacity { NumberAnimation { duration: 180 } }
          }

          // a one-time "good morning" by name, right after the tree wakes
          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            anchors.verticalCenter: parent.verticalCenter
            opacity: root.greetLine === "" ? 0 : 1
            text: root.greetLine
            color: root.accent
            font.family: root.uiFont
            font.pixelSize: Style.font.body
            font.letterSpacing: 1
            renderType: Text.QtRendering
            Behavior on opacity { NumberAnimation { duration: 220 } }
          }

          // care hint for the hovered meter pill — replaces a popup tooltip
          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            anchors.verticalCenter: parent.verticalCenter
            opacity: (root.flash === "" && root.hoverHint !== "") ? 1 : 0
            text: root.hoverHint
            color: Qt.alpha(root.fg, 0.6)
            font.family: root.uiFont
            font.pixelSize: Style.font.bodySmall
            font.italic: true
            elide: Text.ElideRight
            renderType: Text.QtRendering
            Behavior on opacity { NumberAnimation { duration: 140 } }
          }

          Row {
            anchors.centerIn: parent
            spacing: Style.space(5)
            opacity: root.flash === "" ? 0 : 1
            Behavior on opacity { NumberAnimation { duration: 180 } }
            Text {
              text: "+"
              color: root.accent
              font.family: root.uiFont
              font.pixelSize: Style.font.body
              renderType: Text.QtRendering
            }
            Text {
              text: root.flash
              color: Qt.alpha(root.fg, 0.85)
              font.family: root.uiFont
              font.pixelSize: Style.font.body
              renderType: Text.QtRendering
            }
          }
        }

        Text {
          width: parent.width
          visible: !settingsCol.open && root.planted && !root.pruning
          horizontalAlignment: Text.AlignHCenter
          text: root.planted
            ? (root.treeService.stageLabel + "   ·   " + root.treeService.genusLabel
               + "   ·   " + root.ageLabel).toUpperCase()
            : ""
          color: Qt.alpha(root.fg, 0.45)
          font.family: root.uiFont
          font.pixelSize: root.capSize
          font.letterSpacing: 1.5
          renderType: Text.QtRendering
        }

        // ---- care meters ------------------------------------------
        Column {
          width: parent.width
          spacing: Style.space(12)
          visible: !settingsCol.open && root.planted
          opacity: root.pruning ? 0.25 : 1
          enabled: !root.pruning
          Behavior on opacity { NumberAnimation { duration: 160 } }

          Repeater {
            model: root.needs

            Item {
              id: meterRow
              required property var modelData
              width: parent.width
              height: Style.space(28)

              readonly property real value: root.needValue(meterRow.modelData.action)
              readonly property real wellbeing: 1 - meterRow.value / 100
              readonly property bool urgent: meterRow.value >= 60
              readonly property bool kbOn: root.kbActive && root.kbFocus === meterRow.modelData.action
              onKbOnChanged: {
                var h = root.needHint(meterRow.modelData.action)
                if (kbOn) root.hoverHint = h
                else if (root.hoverHint === h) root.hoverHint = ""
              }

              Text {
                id: mLabel
                anchors { left: parent.left; verticalCenter: parent.verticalCenter }
                width: Style.space(50)
                text: meterRow.modelData.label.toUpperCase()
                color: Qt.alpha(root.fg, 0.78)
                font.family: root.uiFont
                font.pixelSize: Style.font.bodySmall
                font.letterSpacing: 1.5
                renderType: Text.QtRendering
              }

              Rectangle {
                id: track
                anchors {
                  left: mLabel.right; leftMargin: Style.space(6)
                  right: actionPill.left; rightMargin: Style.space(12)
                  verticalCenter: parent.verticalCenter
                }
                height: Style.space(4)
                radius: height / 2
                color: Qt.alpha(root.fg, 0.12)

                Rectangle {
                  id: meterFill
                  height: parent.height
                  radius: parent.radius
                  width: Math.max(parent.height, parent.width * meterRow.wellbeing)
                  color: meterRow.urgent ? root.warn : root.accent
                  Behavior on width { NumberAnimation { duration: 620; easing.type: Easing.InOutSine } }
                  Behavior on color { ColorAnimation { duration: 320 } }
                  SequentialAnimation on opacity {
                    running: meterRow.urgent
                    loops: Animation.Infinite
                    NumberAnimation { to: 0.45; duration: 620; easing.type: Easing.InOutSine }
                    NumberAnimation { to: 1.0; duration: 620; easing.type: Easing.InOutSine }
                  }

                  Item {
                    width: parent.width
                    height: fruitLabel.implicitHeight + Style.space(8)
                    visible: root.treeService && root.treeService.fruitVisible
                    Text {
                      id: fruitLabel
                      anchors.left: parent.left
                      text: "FRUIT  ·  I made you something"
                      color: root.accent
                      font.family: root.uiFont
                      font.pixelSize: Style.font.bodySmall
                      font.letterSpacing: 1.2
                      renderType: Text.QtRendering
                    }
                    Rectangle {
                      anchors.right: parent.right
                      width: harvestText.implicitWidth + Style.space(18)
                      height: Style.space(20)
                      radius: root.rad > 0 ? height / 2 : 0
                      color: harvestMouse.containsMouse ? Qt.alpha(root.accent, 0.16) : "transparent"
                      border.width: 1
                      border.color: Qt.alpha(root.accent, harvestMouse.containsMouse ? 0.55 : 0.28)
                      Text {
                        id: harvestText
                        anchors.centerIn: parent
                        text: "▸ harvest"
                        color: root.accent
                        font.family: root.uiFont
                        font.pixelSize: root.capSize
                        renderType: Text.QtRendering
                      }
                      MouseArea {
                        id: harvestMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        cursorShape: Qt.PointingHandCursor
                        onClicked: root.treeService.harvestFruit()
                      }
                    }
                  }
                }
              }

              Rectangle {
                id: actionPill
                anchors { right: parent.right; verticalCenter: parent.verticalCenter }
                width: Math.max(Style.space(60), pillText.implicitWidth + Style.space(18))
                height: Style.space(20)
                radius: root.rad > 0 ? height / 2 : 0
                readonly property bool lit: pillHover.containsMouse || meterRow.kbOn
                color: lit ? Qt.alpha(root.accent, 0.16) : "transparent"
                border.width: 1
                border.color: Qt.alpha(root.accent, lit ? 0.55 : 0.28)
                scale: pillHover.pressed ? 0.93 : 1
                Behavior on scale { NumberAnimation { duration: 180; easing.type: Easing.OutSine } }

                Text {
                  id: pillText
                  anchors.centerIn: parent
                  text: "▸ " + ({ water: "water", lamp: root.lightWord,
                                  feed: "feed", prune: "trim" })[meterRow.modelData.action]
                  color: Qt.alpha(root.accent, 0.92)
                  font.family: root.uiFont
                  font.pixelSize: root.capSize
                  font.letterSpacing: 1
                  renderType: Text.QtRendering
                }

                MouseArea {
                  id: pillHover
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  enabled: root.ready
                  // The care hint shows in the shared line below the meters
                  // (see moodRow), not a popup: a QQC2 ToolTip here reflows the
                  // panel as it opens/closes and makes the pill hover flicker.
                  onContainsMouseChanged: {
                    var h = root.needHint(meterRow.modelData.action)
                    if (containsMouse) root.hoverHint = h
                    else if (root.hoverHint === h && !meterRow.kbOn) root.hoverHint = ""
                    if (containsMouse && root.kbActive) root.kbFocus = meterRow.modelData.action
                  }
                  onClicked: {
                    if (meterRow.modelData.action === "prune") treeView.pruneMode = true
                    else root.runAction(meterRow.modelData.action)
                  }
                }
              }
            }
          }
        }

        // ---- grafting: a submenu right where trimming lives -------------
        // Grafting shapes the tree the same way pruning does — it isn't a
        // care need with a meter, it's an occasional, deliberate act, so it
        // sits directly under the trim row rather than among the four
        // meters. "give a cutting" is free and unlimited; "graft one in" is
        // capped at 3 and walks through choosing a file.
        Item {
          width: parent.width
          height: graftLabel.implicitHeight + Style.space(6)
          visible: !settingsCol.open && root.planted && !root.pruning && root.ready

          Text {
            id: graftLabel
            anchors.left: parent.left
            text: root.ready
              ? "GRAFTS  ·  " + root.treeService.grafts + "/" + root.treeService.maxGrafts
                + (root.treeService.grafts > 0 ? "   ·   " + root.treeService.genusLabel : "")
              : ""
            color: Qt.alpha(root.fg, 0.55)
            font.family: root.uiFont
            font.pixelSize: Style.font.bodySmall
            font.letterSpacing: 1.2
            renderType: Text.QtRendering
          }

          Text {
            id: graftLinkText
            anchors.right: parent.right
            readonly property bool lit: graftLinkMa.containsMouse
              || (root.kbActive && root.kbFocus === "graft")
            text: "▸ graft"
            color: Qt.alpha(root.accent, lit ? 0.95 : 0.75)
            font.family: root.uiFont
            font.pixelSize: root.capSize
            font.letterSpacing: 1
            renderType: Text.QtRendering
            MouseArea {
              id: graftLinkMa
              anchors.fill: parent
              anchors.margins: -Style.space(8)
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onContainsMouseChanged: if (containsMouse && root.kbActive) root.kbFocus = "graft"
              onClicked: graftFlow.opened = true
            }
          }
        }

        // ---- the companion ---------------------------------------
        // Only when the Omagotchi bar pet is installed: its creature has come
        // to live in the tree. Tend it here — feed, wash, a hand on its back —
        // without leaving the panel. Fully in the panel's keyboard cursor
        // (petfeed / petwash / pethand), and its own pill still works too.
        Column {
          id: companion
          width: parent.width
          spacing: Style.space(10)
          visible: root.petHere && !settingsCol.open && root.planted && !root.pruning

          Rectangle {   // hairline: set apart from the tree's own meters
            width: parent.width; height: 1
            color: Qt.alpha(root.fg, 0.12)
          }

          Row {
            width: parent.width
            spacing: Style.space(10)

            Creature {
              anchors.verticalCenter: parent.verticalCenter
              unit: Style.space(3)
              petDir: root.petDir
              form: root.petForm
              anim: root.petAnim
              mood: root.petHere ? root.petService.mood : "happy"
              tint: root.fg
              accent: root.accent
              phase: companionClock.t
            }

            Text {
              anchors.verticalCenter: parent.verticalCenter
              width: parent.width - Style.space(52)
              text: root.petLine()
              color: Qt.alpha(root.fg, 0.6)
              font.family: root.uiFont
              font.pixelSize: Style.font.bodySmall
              font.italic: true
              wrapMode: Text.Wrap
              renderType: Text.QtRendering
            }
          }

          Repeater {
            model: root.petRows

            Item {
              id: petRow
              required property var modelData
              width: parent.width
              height: Style.space(24)
              visible: root.petValue(petRow.modelData.act) >= 8

              Text {
                id: cLabel
                anchors { left: parent.left; verticalCenter: parent.verticalCenter }
                width: Math.max(Style.space(50), implicitWidth)
                text: root.petRowLabel(petRow.modelData)
                color: Qt.alpha(root.fg, 0.78)
                font.family: root.uiFont
                font.pixelSize: Style.font.bodySmall
                font.letterSpacing: 1.5
                renderType: Text.QtRendering
              }

              Rectangle {
                anchors {
                  left: cLabel.right; leftMargin: Style.space(6)
                  right: cPill.left; rightMargin: Style.space(12)
                  verticalCenter: parent.verticalCenter
                }
                height: Style.space(4); radius: height / 2
                color: Qt.alpha(root.fg, 0.12)

                Rectangle {
                  height: parent.height; radius: parent.radius
                  width: Math.max(parent.height,
                    parent.width * (1 - root.petValue(petRow.modelData.act) / 100))
                  color: root.petValue(petRow.modelData.act) >= 60 ? root.warn : root.accent
                  Behavior on width { NumberAnimation { duration: 620; easing.type: Easing.InOutSine } }
                }
              }

              Rectangle {
                id: cPill
                anchors { right: parent.right; verticalCenter: parent.verticalCenter }
                width: Math.max(Style.space(60), cPillText.implicitWidth + Style.space(18))
                height: Style.space(20)
                radius: root.rad > 0 ? height / 2 : 0
                readonly property string kbName: "pet" + petRow.modelData.act
                readonly property bool lit: cPillMa.containsMouse
                  || (root.kbActive && root.kbFocus === cPill.kbName)
                color: lit ? Qt.alpha(root.accent, 0.16) : "transparent"
                border.width: 1
                border.color: Qt.alpha(root.accent, lit ? 0.55 : 0.28)
                scale: cPillMa.pressed ? 0.93 : 1
                Behavior on scale { NumberAnimation { duration: 180; easing.type: Easing.OutSine } }

                Text {
                  id: cPillText
                  anchors.centerIn: parent
                  text: "▸ " + petRow.modelData.pill
                  color: Qt.alpha(root.accent, 0.92)
                  font.family: root.uiFont
                  font.pixelSize: root.capSize
                  font.letterSpacing: 1
                  renderType: Text.QtRendering
                }

                MouseArea {
                  id: cPillMa
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onContainsMouseChanged: if (containsMouse && root.kbActive)
                    root.kbFocus = cPill.kbName
                  onClicked: root.companionAction(petRow.modelData.act)
                }
              }
            }
          }

          // a hand on its back — or a nudge awake — always offered
          Item {
            anchors.horizontalCenter: parent.horizontalCenter
            width: handText.implicitWidth + Style.space(16)
            height: handText.implicitHeight + Style.space(8)
            readonly property bool lit: handMa.containsMouse
              || (root.kbActive && root.kbFocus === "pethand")

            Text {
              id: handText
              anchors.centerIn: parent
              text: (root.petHere && root.petService.sleeping)
                ? "▸ wake it" : "▸ a hand on its back"
              color: Qt.alpha(root.accent, parent.lit ? 0.95 : 0.7)
              font.family: root.uiFont
              font.pixelSize: root.capSize
              font.letterSpacing: 1
              renderType: Text.QtRendering
            }

            MouseArea {
              id: handMa
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onContainsMouseChanged: if (containsMouse && root.kbActive)
                root.kbFocus = "pethand"
              onClicked: root.companionAction(
                (root.petHere && root.petService.sleeping) ? "wake" : "pet")
            }
          }
        }

        // ---- set me out ------------------------------------------
        // Putting the tree on the desktop is something you do to live with it,
        // not a setting you configure once — so it sits in the panel proper,
        // alongside the care actions, rather than behind the settings link.
        Column {
          id: desktopToggle
          width: parent.width
          // Same gate as the rest of the panel body: settings swaps the page
          // out, and there is nothing to set out before anything is planted.
          visible: !settingsCol.open && root.planted && !root.pruning && root.ready
          spacing: Style.space(4)
          readonly property bool on: root.ready && root.treeService.desktopEnabled
          readonly property bool lit: deskMa.containsMouse
            || (root.kbActive && root.kbFocus === "desktop")

          Item {
            anchors.horizontalCenter: parent.horizontalCenter
            width: desktopRow.width + Style.space(16)
            height: desktopRow.height + Style.space(10)

            Row {
              id: desktopRow
              anchors.centerIn: parent
              spacing: Style.space(7)
              Text {
                anchors.verticalCenter: parent.verticalCenter
                text: "SET ME OUT"
                color: (desktopToggle.on || desktopToggle.lit)
                  ? root.accent : Qt.alpha(root.fg, 0.55)
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1.5
                renderType: Text.QtRendering
              }
              Rectangle {
                anchors.verticalCenter: parent.verticalCenter
                width: Style.space(22); height: Style.space(11)
                radius: height / 2
                color: desktopToggle.on ? Qt.alpha(root.accent, 0.28) : Qt.alpha(root.fg, 0.1)
                border.width: 1
                border.color: (desktopToggle.on || desktopToggle.lit)
                  ? root.accent : Qt.alpha(root.fg, 0.35)
                Behavior on color { ColorAnimation { duration: 160 } }
                Rectangle {
                  anchors.verticalCenter: parent.verticalCenter
                  x: desktopToggle.on ? parent.width - width - 2 : 2
                  width: Style.space(7); height: Style.space(7); radius: width / 2
                  color: desktopToggle.on ? root.accent : Qt.alpha(root.fg, 0.5)
                  Behavior on x { NumberAnimation { duration: 160; easing.type: Easing.OutCubic } }
                  Behavior on color { ColorAnimation { duration: 160 } }
                }
              }
            }

            MouseArea {
              id: deskMa
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              enabled: root.ready
              onContainsMouseChanged: if (containsMouse && root.kbActive) root.kbFocus = "desktop"
              onClicked: {
                var putOut = !root.treeService.desktopEnabled
                root.treeService.setDesktop(putOut)
                root.flashNote(putOut ? "out on your desktop" : "home in the bar")
              }
            }
          }

          // The long explainer belonged to the settings page. Out here the
          // toggle is read at a glance, so it only says where the tree is.
          Text {
            anchors.horizontalCenter: parent.horizontalCenter
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: desktopToggle.on ? "out in your lower-right corner"
                                   : "or set me out on your desktop"
            color: Qt.alpha(root.fg, 0.45)
            font.family: root.uiFont
            font.pixelSize: root.capSize
            font.italic: true
            wrapMode: Text.Wrap
            renderType: Text.QtRendering
          }
        }

        // ---- footer toggle ---------------------------------------
        Text {
          anchors.horizontalCenter: parent.horizontalCenter
          visible: !root.pruning && root.ready
          text: settingsCol.open ? "‹ back" : "settings"
          color: (root.kbActive && root.kbFocus === "settings")
            ? root.accent : Qt.alpha(root.fg, 0.5)
          font.family: root.uiFont
          font.pixelSize: root.capSize
          font.letterSpacing: 1.5
          renderType: Text.QtRendering
          MouseArea {
            anchors.fill: parent
            anchors.margins: -Style.space(8)
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            enabled: root.ready
            onContainsMouseChanged: if (containsMouse && root.kbActive) root.kbFocus = "settings"
            onClicked: settingsCol.open = !settingsCol.open
          }
        }

        // ---- settings -------------------------------------------
        Column {
          id: settingsCol
          width: parent.width
          spacing: Style.space(14)
          visible: open
          property bool open: false

          Text {
            width: parent.width
            text: "I grew from a seed that belongs to this machine alone — no "
              + "one else has me. I age alongside your system, my light follows "
              + "your clock, and I keep the shape you prune me into."
            color: Qt.alpha(root.fg, 0.6)
            font.family: root.uiFont
            font.pixelSize: Style.font.bodySmall
            lineHeight: 1.35
            wrapMode: Text.Wrap
            renderType: Text.QtRendering
          }

          Row {
            anchors.horizontalCenter: parent.horizontalCenter
            spacing: Style.space(10)

            Rectangle {
              id: growBackBtn
              visible: root.ready && root.treeService.prune
                && Object.keys(root.treeService.prune).length > 0
              readonly property bool lit: resetMa.containsMouse
                || (root.kbActive && root.kbFocus === "growback")
              width: resetText.implicitWidth + Style.space(20)
              height: Style.space(24)
              radius: root.rad > 0 ? height / 2 : 0
              color: growBackBtn.lit ? Qt.alpha(root.accent, 0.14) : "transparent"
              border.width: 1
              border.color: Qt.alpha(root.accent, growBackBtn.lit ? 0.5 : 0.28)
              Text {
                id: resetText
                anchors.centerIn: parent
                text: "let me grow back"
                color: Qt.alpha(root.accent, 0.9)
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1
                renderType: Text.QtRendering
              }
              MouseArea {
                id: resetMa
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onContainsMouseChanged: if (containsMouse && root.kbActive) root.kbFocus = "growback"
                onClicked: { root.treeService.pruneReset(); root.flashNote("growing back") }
              }
            }

            Rectangle {
              id: startOverBtn
              readonly property bool lit: replantHover.containsMouse
                || (root.kbActive && root.kbFocus === "startover")
              width: replantText.implicitWidth + Style.space(20)
              height: Style.space(24)
              radius: root.rad > 0 ? height / 2 : 0
              color: startOverBtn.lit ? Qt.alpha(root.warn, 0.16) : "transparent"
              border.width: 1
              border.color: Qt.alpha(root.warn, startOverBtn.lit ? 0.55 : 0.3)

              Text {
                id: replantText
                anchors.centerIn: parent
                text: "start over"
                color: Qt.alpha(root.warn, 0.92)
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1
                renderType: Text.QtRendering
              }
              MouseArea {
                id: replantHover
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                enabled: root.ready
                onContainsMouseChanged: if (containsMouse && root.kbActive) root.kbFocus = "startover"
                onClicked: replantConfirm.opened = true
              }
            }
          }
        }
      }

      ConfirmDialog {
        id: replantConfirm
        anchors.fill: parent
        message: "Begin again? " + (root.ready ? root.treeService.treeName : "I")
          + " will be retired, and you start me over from nothing."
        confirmText: "Start over"
        onConfirmed: {
          opened = false
          settingsCol.open = false
          if (root.ready) root.treeService.replant()
        }
        onCanceled: opened = false
      }

      // ---- grafting: give a cutting, or graft one in --------------------
      // A small walkthrough, not a single button — matches how planting
      // (seed vs cutting vs heirloom) is already a chooser rather than a
      // dropdown. Reading the inbox is entirely local (Qt.labs.folderlistmodel
      // over a plain directory): nothing here ever touches a network.
      Item {
        id: graftFlow
        anchors.fill: parent
        visible: opened
        property bool opened: false
        property string step: "choose"   // choose | give | pick | preview
        property var pendingParsed: null
        property var pendingPreview: null
        property string exportedPath: ""
        property string pickError: ""
        // A second, small cursor nested inside the panel's own kbFocus
        // system — same idea as treeView.kbPrune's own cluster cursor while
        // pruning: the main cursor hands off entirely while this is open
        // (see kbStep/kbHoriz/kbActivate/kbEscape above) rather than the
        // wizard being mouse-only.
        property int kbIndex: 0
        // FolderListModel genuinely flickers Ready-with-count-0 before its
        // real listing settles (measured live: status cycles Ready(0) ->
        // Loading(0) -> Ready(0) -> count:2, all within one open) — real
        // enough to show a real user "nothing waiting" for a moment on a
        // populated inbox. This is a floor, not a real load time: it only
        // delays showing the EMPTY state, never the real listing once it
        // arrives (that binds directly off inboxModel.count, no gate).
        property bool inboxSettling: false
        Timer { id: inboxSettleTimer; interval: 350; onTriggered: graftFlow.inboxSettling = false }

        onOpenedChanged: if (opened) {
          step = "choose"; pendingParsed = null; pendingPreview = null
          exportedPath = ""; pickError = ""; kbIndex = 0
        }
        onStepChanged: {
          kbIndex = 0
          if (step === "pick") { inboxSettling = true; inboxSettleTimer.restart() }
        }

        function close() { opened = false }

        // Reads straight off the Repeater's own live delegate rather than a
        // separately-tracked index->path table — that table raced
        // FolderListModel's own reload cycles (measured live: it flickers
        // Loading/Ready more than once per open, destroying and recreating
        // delegates each time), so a path recorded a moment earlier could
        // already belong to a delegate that no longer exists. itemAt() is
        // never stale because there is nothing to go stale — it's read at
        // the moment of use, not cached ahead of it.
        function pickFile(idx) {
          var item = inboxRepeater.itemAt(idx)
          if (!item) return
          var path = item.filePath
          if (!path) return
          graftPickFile.path = path
          var raw = ""
          try { raw = graftPickFile.text() || "" } catch (e) {}
          var parsed = root.treeService.parseGraftFile(raw)
          var preview = parsed ? root.treeService.previewGraft(parsed) : null
          if (!preview) { pickError = "that file isn't a graft this version understands"; return }
          pickError = ""
          pendingParsed = parsed
          pendingPreview = preview
          step = "preview"
        }

        function confirmGraft() {
          if (root.treeService.acceptGraft(pendingParsed)) {
            root.flashNote("took a graft")
            close()
          } else {
            pickError = "couldn't take that graft"
            step = "pick"
          }
        }

        function kbCount() {
          if (step === "choose") return 2
          if (step === "pick") return inboxModel.count
          if (step === "preview") return 2
          return 1
        }
        function kbMove(delta) {
          var n = kbCount()
          if (n <= 0) return
          kbIndex = ((kbIndex + delta) % n + n) % n
        }
        function kbActivate() {
          if (step === "choose") {
            var how = kbIndex === 0 ? "give" : "pick"
            if (how === "pick" && root.ready && !root.treeService.graftsAvailable) return
            step = how
          } else if (step === "give") {
            if (exportedPath === "") exportedPath = root.treeService.writeGraftExport()
            else close()
          } else if (step === "pick") {
            pickFile(kbIndex)
          } else if (step === "preview") {
            if (kbIndex === 0) confirmGraft(); else step = "pick"
          }
        }
        function kbBack() {
          if (step === "preview") { step = "pick"; return }
          if (step !== "choose") { step = "choose"; return }
          close()
        }

        Rectangle { anchors.fill: parent; color: Qt.alpha(root.bg, 0.94) }

        MouseArea { anchors.fill: parent }   // swallow clicks to whatever's behind

        // close (x)
        Text {
          anchors { right: parent.right; top: parent.top; margins: Style.space(14) }
          text: "✕"
          color: Qt.alpha(root.fg, closeMa.containsMouse ? 0.9 : 0.5)
          font.family: root.uiFont
          font.pixelSize: Style.font.bodySmall
          MouseArea {
            id: closeMa
            anchors.fill: parent
            anchors.margins: -Style.space(10)
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: graftFlow.close()
          }
        }

        Column {
          anchors.centerIn: parent
          width: parent.width - Style.space(64)
          spacing: Style.space(18)

          Text {
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: "GRAFTING"
            color: Qt.alpha(root.fg, 0.5)
            font.family: root.uiFont
            font.pixelSize: Style.font.bodySmall
            font.letterSpacing: 3
            renderType: Text.QtRendering
          }

          // ---- step: choose ------------------------------------------
          Column {
            width: parent.width
            spacing: Style.space(10)
            visible: graftFlow.step === "choose"

            Repeater {
              model: [
                { how: "give", title: "GIVE A CUTTING", sub: "export " + (root.ready ? root.treeService.treeName : "this tree") + " — free, unlimited, share it any way you like" },
                { how: "pick", title: "GRAFT ONE IN", sub: root.ready && root.treeService.graftsAvailable
                    ? "bring in a cutting someone gave you — " + (root.treeService.maxGrafts - root.treeService.grafts) + " of " + root.treeService.maxGrafts + " slots left"
                    : "no slots left — this tree already carries " + (root.ready ? root.treeService.maxGrafts : 3) + " grafts" }
              ]
              delegate: Rectangle {
                id: card
                required property var modelData
                required property int index
                readonly property bool disabledCard: card.modelData.how === "pick" && root.ready && !root.treeService.graftsAvailable
                readonly property bool lit: (cardMa.containsMouse || graftFlow.kbIndex === card.index) && !disabledCard
                width: parent.width
                height: cardCol.implicitHeight + Style.space(20)
                radius: root.rad > 0 ? Style.space(8) : 0
                color: lit ? Qt.alpha(root.accent, 0.10) : "transparent"
                border.width: 1
                border.color: Qt.alpha(root.accent, disabledCard ? 0.15 : (lit ? 0.55 : 0.28))
                opacity: disabledCard ? 0.45 : 1

                Column {
                  id: cardCol
                  anchors { left: parent.left; right: parent.right; verticalCenter: parent.verticalCenter }
                  anchors.margins: Style.space(14)
                  spacing: Style.space(4)
                  Text {
                    text: card.modelData.title
                    color: root.accent
                    font.family: root.uiFont
                    font.pixelSize: root.capSize
                    font.letterSpacing: 1.5
                    renderType: Text.QtRendering
                  }
                  Text {
                    width: cardCol.width
                    text: card.modelData.sub
                    wrapMode: Text.Wrap
                    color: Qt.alpha(root.fg, 0.6)
                    font.family: root.uiFont
                    font.pixelSize: Style.font.bodySmall
                    renderType: Text.QtRendering
                  }
                }
                MouseArea {
                  id: cardMa
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: card.disabledCard ? Qt.ArrowCursor : Qt.PointingHandCursor
                  onContainsMouseChanged: if (containsMouse) graftFlow.kbIndex = card.index
                  onClicked: if (!card.disabledCard) graftFlow.step = card.modelData.how
                }
              }
            }
          }

          // ---- step: give ---------------------------------------------
          Column {
            width: parent.width
            spacing: Style.space(12)
            visible: graftFlow.step === "give"

            Text {
              width: parent.width
              wrapMode: Text.Wrap
              horizontalAlignment: Text.AlignHCenter
              text: graftFlow.exportedPath === ""
                ? "writes a small file — nothing but genus and shape, never your machine or name."
                : "written to:\n" + graftFlow.exportedPath
              color: Qt.alpha(root.fg, 0.65)
              font.family: root.uiFont
              font.pixelSize: Style.font.bodySmall
              renderType: Text.QtRendering
            }

            Rectangle {
              anchors.horizontalCenter: parent.horizontalCenter
              width: writeText.implicitWidth + Style.space(24)
              height: Style.space(26)
              radius: root.rad > 0 ? height / 2 : 0
              visible: graftFlow.exportedPath === ""
              color: writeMa.containsMouse ? Qt.alpha(root.accent, 0.16) : "transparent"
              border.width: 1
              border.color: Qt.alpha(root.accent, writeMa.containsMouse ? 0.6 : 0.32)
              Text {
                id: writeText
                anchors.centerIn: parent
                text: "▸ write the cutting"
                color: root.accent
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1
                renderType: Text.QtRendering
              }
              MouseArea {
                id: writeMa
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: graftFlow.exportedPath = root.treeService.writeGraftExport()
              }
            }

            Text {
              anchors.horizontalCenter: parent.horizontalCenter
              visible: graftFlow.exportedPath !== ""
              text: "▸ done"
              color: Qt.alpha(root.accent, doneMa.containsMouse ? 0.95 : 0.75)
              font.family: root.uiFont
              font.pixelSize: root.capSize
              font.letterSpacing: 1
              renderType: Text.QtRendering
              MouseArea {
                id: doneMa
                anchors.fill: parent
                anchors.margins: -Style.space(8)
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onClicked: graftFlow.close()
              }
            }
          }

          // ---- step: pick — what's sitting in the inbox ----------------
          Column {
            width: parent.width
            spacing: Style.space(10)
            visible: graftFlow.step === "pick"

            FolderListModel {
              id: inboxModel
              folder: root.ready ? "file://" + root.treeService.graftInboxDir : ""
              nameFilters: ["*.omatree-graft.json", "*.json"]
              showDirs: false
              sortField: FolderListModel.Time
              sortReversed: true
            }

            Text {
              width: parent.width
              wrapMode: Text.Wrap
              horizontalAlignment: Text.AlignHCenter
              visible: inboxModel.count === 0 && !graftFlow.inboxSettling
              text: "nothing waiting — drop a .omatree-graft.json someone gave you into\n"
                + (root.ready ? root.treeService.graftInboxDir : "")
              color: Qt.alpha(root.fg, 0.55)
              font.family: root.uiFont
              font.pixelSize: Style.font.bodySmall
              renderType: Text.QtRendering
            }

            Text {
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              visible: graftFlow.pickError !== ""
              text: graftFlow.pickError
              color: root.warn
              font.family: root.uiFont
              font.pixelSize: Style.font.bodySmall
              renderType: Text.QtRendering
            }

            Repeater {
              id: inboxRepeater
              model: inboxModel
              delegate: Rectangle {
                id: fileRow
                required property int index
                required property string fileName
                required property string filePath
                readonly property bool lit: fileMa.containsMouse || graftFlow.kbIndex === fileRow.index
                width: parent.width
                height: fileText.implicitHeight + Style.space(14)
                color: lit ? Qt.alpha(root.accent, 0.10) : "transparent"
                border.width: 1
                border.color: Qt.alpha(root.accent, lit ? 0.5 : 0.22)
                radius: root.rad > 0 ? Style.space(6) : 0
                Text {
                  id: fileText
                  anchors { left: parent.left; verticalCenter: parent.verticalCenter; margins: Style.space(10) }
                  text: fileRow.fileName
                  color: Qt.alpha(root.fg, 0.8)
                  font.family: root.uiFont
                  font.pixelSize: Style.font.bodySmall
                  renderType: Text.QtRendering
                }
                MouseArea {
                  id: fileMa
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onContainsMouseChanged: if (containsMouse) graftFlow.kbIndex = fileRow.index
                  onClicked: graftFlow.pickFile(fileRow.index)
                }
              }
            }

            FileView {
              id: graftPickFile
              path: ""
              blockLoading: true
              printErrors: false
            }
          }

          // ---- step: preview — confirm before it's spent ----------------
          Column {
            width: parent.width
            spacing: Style.space(14)
            visible: graftFlow.step === "preview" && graftFlow.pendingPreview !== null

            Text {
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              wrapMode: Text.Wrap
              text: (graftFlow.pendingPreview ? graftFlow.pendingPreview.genus : "")
                + (graftFlow.pendingPreview && graftFlow.pendingPreview.treeName
                   ? "\nfrom " + graftFlow.pendingPreview.treeName : "")
              color: root.accent
              font.family: root.uiFont
              font.pixelSize: root.capSize
              font.letterSpacing: 1.5
              renderType: Text.QtRendering
            }

            Row {
              anchors.horizontalCenter: parent.horizontalCenter
              spacing: Style.space(20)
              Text {
                readonly property bool lit: confirmMa.containsMouse || graftFlow.kbIndex === 0
                text: "▸ graft it in"
                color: Qt.alpha(root.accent, lit ? 0.95 : 0.8)
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1
                renderType: Text.QtRendering
                MouseArea {
                  id: confirmMa
                  anchors.fill: parent
                  anchors.margins: -Style.space(8)
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onContainsMouseChanged: if (containsMouse) graftFlow.kbIndex = 0
                  onClicked: graftFlow.confirmGraft()
                }
              }
              Text {
                readonly property bool lit: backMa.containsMouse || graftFlow.kbIndex === 1
                text: "▸ back"
                color: Qt.alpha(root.fg, lit ? 0.8 : 0.5)
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1
                renderType: Text.QtRendering
                MouseArea {
                  id: backMa
                  anchors.fill: parent
                  anchors.margins: -Style.space(8)
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onContainsMouseChanged: if (containsMouse) graftFlow.kbIndex = 1
                  onClicked: graftFlow.step = "pick"
                }
              }
            }
          }
        }
      }
    }
  }

  readonly property string ageLabel: root.ready ? root.formatAge(root.treeService) : ""

  function formatAge(svc) {
    var d = svc.wallAgeDays
    var h = Math.floor(svc.activeAgeMinutes / 60)
    var m = Math.floor(svc.activeAgeMinutes % 60)
    var parts = []
    if (d > 0) parts.push(d + "d")
    if (h > 0 || d > 0) parts.push(h + "h")
    parts.push(m + "m")
    return parts.join(" ")
  }

  function flashNote(text) {
    root.flash = text
    flashTimer.restart()
  }

  function runAction(kind) {
    if (!root.ready) return
    var svc = root.treeService
    if (kind === "water") { svc.waterNow(); root.flashNote("watered"); treeView.water() }
    else if (kind === "lamp") {
      svc.lampOn = !svc.lampOn
      if (svc.lampOn) {
        // What the gesture actually is, in daylight, is opening the tree to
        // the sun — the light comes in from wherever the sun really is right
        // now. After dark the same beams run cold and quiet: some light still
        // reaches it, that is all.
        treeView.light()
        root.flashNote(root.byDaylight ? "the blinds are open" : "the grow lamp warms me")
      } else {
        root.flashNote(root.byDaylight ? "the blinds are drawn" : "the lamp goes out")
      }
    }
    else if (kind === "feed") { svc.feedNow(); root.flashNote("fed"); treeView.feed() }
    else if (kind === "prune") { svc.pruneNow(); root.flashNote("pruned") }
  }

  // ---- growth milestones: a wash + a toast when the stage steps up ------
  property string _stage: ""
  function _stageRank(s) { return ["seedling", "young", "adolescent", "mature"].indexOf(s) }
  function _stageWord(s) {
    return ({ seedling: "a seedling", young: "a young tree",
              adolescent: "an adolescent", mature: "a mature tree" })[s] || s
  }
  Connections {
    target: root.ready ? root.treeService : null
    function onStageChanged() {
      var s = root.treeService.stage
      if (root.planted && root._stage !== "" && s !== root._stage
          && root._stageRank(s) > root._stageRank(root._stage)) {
        root.flashNote(root.treeService.treeName + " is now " + root._stageWord(s))
        treeView.milestone()
      }
      root._stage = s
    }
  }
}
