pragma ComponentBehavior: Bound

import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// Omatree panel — a clean, quiet HUD. The living pixel tree sits in the panel
// (no frame); below it, the mood, the life stage, and four slim care meters,
// each with a pill to tend it. Plant from seed or cutting; prune by hand.
Panel {
  id: root
  moduleName: "jimmie.bonsai"

  property var anchorItem: null
  property var hostWidget: null
  property var bonsaiService: null
  readonly property var barIdentity: hostWidget || root

  readonly property bool ready: !!bonsaiService && bonsaiService.initialized === true
  readonly property color fg: Color.popups.text
  readonly property color bg: Color.popups.background
  readonly property color accent: Color.accent
  readonly property color warn: Color.urgent
  readonly property string uiFont: "monospace"
  readonly property real capSize: Style.font.caption !== undefined ? Style.font.caption : Style.font.bodySmall
  readonly property real rad: Style.cornerRadius > 0 ? Style.space(10) : 0

  readonly property real worst: root.ready ? root.bonsaiService.worstNeed : 0
  readonly property bool planted: root.ready && root.bonsaiService.planted
  readonly property bool pruning: bonsaiView.pruneMode

  // brief "+ watered" confirmation after a care action
  property string flash: ""
  Timer { id: flashTimer; interval: 1400; onTriggered: root.flash = "" }

  // the care hint for whichever meter pill is hovered (shown in the mood line)
  property string hoverHint: ""
  onOpenedChanged: {
    if (!opened) { hoverHint = ""; kbActive = false; kbFocus = ""; return }
    Qt.callLater(root.playGreeting)
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
    root.greetLine = ("good morning — I am " + root.bonsaiService.treeName).toLowerCase()
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
  //   trimming     -> Bonsai.kbPrune owns the cluster cursor
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
    if (!root.planted) return root.bonsaiService.seedAvailable
      ? ["berrySeed", "seed", "cutting"] : ["seed", "cutting"]
    if (settingsCol.open) {
      var s = ["settings"]
      if (root.bonsaiService.prune && Object.keys(root.bonsaiService.prune).length > 0)
        s.push("growback")
      s.push("startover")
      return s
    }
    return ["tree", "water", "lamp", "feed", "prune", "desktop", "settings"]
  }

  function kbWake() {
    var t = kbTargets()
    if (t.length === 0) return false
    root.kbActive = true
    if (t.indexOf(root.kbFocus) < 0) root.kbFocus = t[0]
    return true
  }

  function kbStep(delta) {
    if (root.pruning) { bonsaiView.kbPruneCycle(delta); return }
    if (!root.kbActive) { kbWake(); return }
    var t = kbTargets()
    var i = t.indexOf(root.kbFocus)
    if (i < 0) { if (t.length) root.kbFocus = t[0]; return }
    root.kbFocus = t[Math.max(0, Math.min(t.length - 1, i + delta))]
  }

  function kbHoriz(delta) {
    if (root.pruning) { bonsaiView.kbPruneCycle(delta); return }
    if (!root.kbActive) { kbWake(); return }
    if (root.kbFocus === "tree") { bonsaiView.stepYaw(delta > 0 ? 1 : -1); return }
    if (!root.planted) kbStep(delta)
  }

  function kbActivate() {
    if (root.pruning) { bonsaiView.kbPruneCut(); return }
    if (!root.kbActive) { kbWake(); return }
    switch (root.kbFocus) {
    case "berrySeed":
      if (root.ready && !root.planted) { root.bonsaiService.plant("berrySeed"); root.flashNote("berry seed sown") }
      break
    case "seed":
      if (root.ready && !root.planted) { root.bonsaiService.plant("seed"); root.flashNote("seed sown") }
      break
    case "cutting":
      if (root.ready && !root.planted) { root.bonsaiService.plant("cutting"); root.flashNote("cutting struck") }
      break
    case "water": root.runAction("water"); break
    case "lamp": root.runAction("lamp"); break
    case "feed": root.runAction("feed"); break
    case "prune":
      bonsaiView.pruneMode = true
      bonsaiView.kbPrune = 0
      break
    case "settings":
      settingsCol.open = !settingsCol.open
      root.kbFocus = "settings"
      break
    case "desktop":
      if (root.ready) {
        var putOut = !root.bonsaiService.desktopEnabled
        root.bonsaiService.setDesktop(putOut)
        root.flashNote(putOut ? "out on your desktop" : "home in the bar")
      }
      break
    case "growback":
      if (root.ready) { root.bonsaiService.pruneReset(); root.flashNote("growing back") }
      break
    case "startover": replantConfirm.opened = true; break
    }
  }

  function kbEscape() {
    if (replantConfirm.opened) { replantConfirm.opened = false; return }
    if (root.pruning) { bonsaiView.pruneMode = false; root.kbFocus = "prune"; return }
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
  readonly property bool byDaylight: root.ready && root.bonsaiService.daylight
  readonly property bool lightOn: root.ready && root.bonsaiService.lampOn
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
    return ({ water: bonsaiService.thirst, lamp: bonsaiService.light,
              feed: bonsaiService.soil, prune: bonsaiService.untidiness })[action] || 0
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
        // trunk pushes the panel tall (Bonsai caps itself at ~half the screen).
        Item {
          id: house
          width: parent.width
          readonly property real _screenH: Screen.height > 0 ? Screen.height : 1200
          height: root.planted
            ? Math.max(Style.space(140),
                Math.min(bonsaiView.implicitHeight + strip.height + Style.space(18), _screenH * 0.52))
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
                text: root.ready ? root.bonsaiService.treeName : "…"
                color: Qt.alpha(root.fg, 0.8)
                font.family: root.uiFont
                font.pixelSize: root.capSize
                font.letterSpacing: 1.5
                renderType: Text.QtRendering
              }
              Text {
                anchors.verticalCenter: parent.verticalCenter
                visible: root.ready
                text: root.ready ? root.bonsaiService.genusLabel.toLowerCase() : ""
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
              readonly property bool on: root.ready && root.bonsaiService.lampOn
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
                onClicked: bonsaiView.pruneMode = false
              }
            }
          }

          Bonsai {
            id: bonsaiView
            inHousing: false
            anchors {
              top: strip.bottom; left: parent.left
              right: parent.right; bottom: parent.bottom
            }
            anchors.margins: Style.space(6)
            anchors.topMargin: Style.space(2)
            visible: root.planted
            active: root.opened && root.planted
            tree: root.planted ? root.bonsaiService.treeSpec : null
            tint: root.accent
            textColor: root.fg
            bgColor: root.bg
            onPruneRequested: function (id) {
              if (root.ready) root.bonsaiService.pruneNode(id)
            }
            onOrbitChanged: function (yaw) {
              if (root.ready) root.bonsaiService.setOrbit(yaw)
            }
            // shallow zoom: scroll over the tree, persisted like the pose
            zoom: root.ready ? root.bonsaiService.viewZoom : 1
            onZoomChanged2: function (z) {
              if (root.ready) root.bonsaiService.setZoom(z)
            }
          }

          // keyboard focus ring on the tree — arrows turn the turntable
          Rectangle {
            anchors.fill: bonsaiView
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
                if (root.bonsaiService && root.bonsaiService.seedAvailable)
                  choices.push({ how: "berrySeed", title: "FROM BERRY SEED", sub: "carry my own fruit forward — begin me again from it" })
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
                    root.bonsaiService.plant(card.modelData.how)
                    root.flashNote(card.modelData.how === "berrySeed" ? "berry seed sown"
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
            text: root.ready ? root.bonsaiService.moodLabel : "I am waking up…"
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
            ? (root.bonsaiService.stageLabel + "   ·   " + root.bonsaiService.genusLabel
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
                    visible: root.bonsaiService && root.bonsaiService.fruitVisible
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
                        onClicked: root.bonsaiService.harvestFruit()
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
                    if (meterRow.modelData.action === "prune") bonsaiView.pruneMode = true
                    else root.runAction(meterRow.modelData.action)
                  }
                }
              }
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
          readonly property bool on: root.ready && root.bonsaiService.desktopEnabled
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
                var putOut = !root.bonsaiService.desktopEnabled
                root.bonsaiService.setDesktop(putOut)
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
              visible: root.ready && root.bonsaiService.prune
                && Object.keys(root.bonsaiService.prune).length > 0
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
                onClicked: { root.bonsaiService.pruneReset(); root.flashNote("growing back") }
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
        message: "Begin again? " + (root.ready ? root.bonsaiService.treeName : "I")
          + " will be retired, and you start me over from nothing."
        confirmText: "Start over"
        onConfirmed: {
          opened = false
          settingsCol.open = false
          if (root.ready) root.bonsaiService.replant()
        }
        onCanceled: opened = false
      }
    }
  }

  readonly property string ageLabel: root.ready ? root.formatAge(root.bonsaiService) : ""

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
    var svc = root.bonsaiService
    if (kind === "water") { svc.waterNow(); root.flashNote("watered"); bonsaiView.water() }
    else if (kind === "lamp") {
      svc.lampOn = !svc.lampOn
      if (svc.lampOn) {
        // What the gesture actually is, in daylight, is opening the tree to
        // the sun — the light comes in from wherever the sun really is right
        // now. After dark the same beams run cold and quiet: some light still
        // reaches it, that is all.
        bonsaiView.light()
        root.flashNote(root.byDaylight ? "the blinds are open" : "the grow lamp warms me")
      } else {
        root.flashNote(root.byDaylight ? "the blinds are drawn" : "the lamp goes out")
      }
    }
    else if (kind === "feed") { svc.feedNow(); root.flashNote("fed"); bonsaiView.feed() }
    else if (kind === "prune") { svc.pruneNow(); root.flashNote("pruned") }
  }

  // ---- growth milestones: a wash + a toast when the stage steps up ------
  property string _stage: ""
  function _stageRank(s) { return ["seedling", "young", "adolescent", "mature"].indexOf(s) }
  function _stageWord(s) {
    return ({ seedling: "a seedling", young: "a young tree",
              adolescent: "an adolescent", mature: "a mature bonsai" })[s] || s
  }
  Connections {
    target: root.ready ? root.bonsaiService : null
    function onStageChanged() {
      var s = root.bonsaiService.stage
      if (root.planted && root._stage !== "" && s !== root._stage
          && root._stageRank(s) > root._stageRank(root._stage)) {
        root.flashNote(root.bonsaiService.treeName + " is now " + root._stageWord(s))
        bonsaiView.milestone()
      }
      root._stage = s
    }
  }
}
