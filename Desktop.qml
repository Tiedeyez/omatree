import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons

// The "desktop snapshot": the Omatree itself, set out to live in the lower-right
// corner of the desktop as a quiet ornament rather than kept in the bar. It sits on the front-most
// layer so it remains fully visible, and is click-through except a small tap
// around the tree that summons the main Omatree panel. State stays single-source
// in Service.qml — this window just re-renders the same treeSpec, so it never
// diverges from the bar.
PanelWindow {
  id: root

  property var bonsaiService: null

  readonly property bool ready: !!bonsaiService && bonsaiService.initialized === true
  readonly property bool showTree: root.ready && bonsaiService.planted === true
    && bonsaiService.desktopEnabled === true

  // ---- corner placement ----------------------------------------------
  // The desktop ornament is deliberately much larger than the bar mark, but
  // remains bounded so it never consumes the whole desktop.
  property string horizontalAnchor: "right" // left | right
  anchors { bottom: true; right: root.horizontalAnchor === "right"; left: root.horizontalAnchor === "left" }
  // Actually the corner. A margin proportional to the screen put the tree ~860px
  // in from the edge of a 3440px display — sitting over usable screen instead of
  // the dead corner it is supposed to occupy. A fixed inset keeps it tucked into
  // the corner on any display, wide or not.
  margins {
    bottom: 0
    right: root.horizontalAnchor === "right" ? 16 : 0
    left: root.horizontalAnchor === "left" ? 16 : 0
  }

  // The window hugs the ornament: sized to the scaled tree bounding box, so
  // there is minimal transparent click-through surface on the desktop.
  // Caps only — they exist to stop an ancient tree taking over the screen, and
  // they are NOT the footprint. Sizing the stage to a fraction of the screen is
  // what put a ~990x700 input-blocking rectangle on a 3440x1440 desktop, most of
  // it empty, swallowing clicks and drags meant for the window behind it.
  readonly property real maxDesktopH: Math.max(150, Screen.height * 0.30)
  readonly property real maxDesktopW: Math.max(120, Screen.width * 0.14)
  // 1:1. artScale already gives a clean 2x, so the ornament is drawn at exactly
  // the size it was rendered and the pixel grid stays exact. Making the tree
  // smaller is done by rendering FEWER art pixels (the Bonsai's artUnits below),
  // never by scaling the finished picture down — a fractional downscale is what
  // turns crisp pixel art into mush.
  readonly property real targetScale: 1.0
  readonly property real naturalW: Math.max(1, tree.artW * tree.artScale)
  readonly property real naturalH: Math.max(1, tree.artH * tree.artScale)
  readonly property real desktopScale: Math.min(
    targetScale, maxDesktopW / naturalW, maxDesktopH / naturalH)
  // The bed is the tree's own bounding box, and the bed is what takes clicks.
  readonly property real bedH: Math.min(maxDesktopH, naturalH * desktopScale)
  readonly property real bedW: Math.min(maxDesktopW, naturalW * desktopScale)

  // Headroom above the bed: the shaft the tree comes down. A layer-shell
  // surface clips its children, which is exactly what makes the descent read
  // as sliding out from under something rather than fading in — so the window
  // reaches as high as the output allows (a surface taller than the screen
  // gets pushed off the top edge instead). It is transparent and outside the
  // input mask, so it costs the desktop nothing.
  readonly property real flightPadY: Math.max(24,
    Math.round(Screen.height - root.bedH - 34))
  implicitWidth: Math.round(bedW)
  implicitHeight: Math.round(bedH + flightPadY)

  color: "transparent"
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.layer: WlrLayer.Top
  WlrLayershell.namespace: "jimmie.bonsai.desktop"
  // Same layer as a roaming companion. The ornament still sits in front of the
  // wallpaper/background, but it does not fully block a companion: the pet can
  // walk in front of or behind the tree and even climb the pot/window stack.
  mask: Region {
    Region { item: tapArea }
    Region { item: desktopQuickMenu }
    Region { item: returnTab }
    Region { item: trimDone }
  }

  // ---- the arrival ----------------------------------------------------
  // The tree does not grow, shrink, tumble or bounce its way out here. The
  // whole sprite, at its true size, simply comes down out of the panel and
  // keeps coming until it is standing in the corner — the way something slides
  // out when a lid opens above it. The window reaches up to just under the bar
  // and clips anything above it, so the tree is genuinely revealed edge-first
  // rather than faded in.
  //
  // PanelWindow is not an Item (no states/transitions on the window itself),
  // so the choreography lives in plain numeric properties here and is applied
  // through a translate on the bed's children. On desktop, the sprite should
  // appear to dissolve into the wallpaper surface rather than pop in, so the
  // transition includes a soft fade plus a short drift.
  property real _fly: 0        // 0 = still up inside the panel, 1 = standing in the corner
  readonly property bool _airborne: root._fly < 0.999

  // one straight, unhurried descent — no arc, no scale, no rotation
  readonly property real _travelY: -(1 - root._fly) * (root.bedH + root.flightPadY)
  readonly property real _fade: root.showTree ? root._fly : 1 - root._fly

  NumberAnimation {
    id: arriveAnim
    target: root; property: "_fly"; to: 1
    duration: 620; easing.type: Easing.OutCubic
  }
  NumberAnimation {
    id: departAnim
    target: root; property: "_fly"; to: 0
    duration: 480; easing.type: Easing.InCubic
  }

  onShowTreeChanged: {
    arriveAnim.stop(); departAnim.stop()
    if (root.showTree) arriveAnim.restart()
    else departAnim.restart()
    root.publishCompanionBridge()
  }
  Component.onCompleted: {
    root._fly = 0
    if (root.showTree) arriveAnim.start()
    root.publishCompanionBridge()
  }

  // ---- the bed: the corner the tree actually sits in -------------------
  Item {
    id: bed
    width: root.bedW
    height: root.bedH
    anchors.bottom: parent.bottom
    anchors.right: parent.right

    // a soft contact shadow that tightens as the pot takes its weight
    Rectangle {
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      width: Math.round(bed.width * (0.16 + 0.30 * root._fly))
      height: 4
      radius: 2
      color: Qt.alpha(Color.accent, 0.05 + 0.16 * root._fly)
    }

    Bonsai {
      id: tree
      forceFront: false
      inHousing: false
      onDesktop: true
      // Sized against the reference shot: 2.2 art-units renders ~97x123 art px,
      // which at artScale 2 lands the ornament at ~194x246 on screen. The panel
      // keeps its own larger art resolution; only the desktop tile shrinks.
      artUnits: 2.2
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      scale: root.desktopScale
      opacity: root._fade
      transformOrigin: Item.Bottom
      active: root.showTree
      transparent: true
      solidObject: true
      tree: root.ready ? bonsaiService.treeSpec : null
      pruneMode: root.desktopPruning
      tint: Color.accent
      textColor: Color.foreground
      onPruneRequested: function (id) { if (root.ready) bonsaiService.pruneNode(id) }
      onOrbitChanged: function (yaw) { if (root.ready) bonsaiService.setOrbit(yaw) }
      Component.onCompleted: {
        if (root.ready && root.bonsaiService && typeof root.bonsaiService.yaw !== "undefined")
          tree.yaw = root.bonsaiService.yaw
        else tree.yaw = 0
      }

      transform: Translate { y: root._travelY }
    }

    // a thin accent line right at the screen edge the pot rests on
    Rectangle {
      visible: root.showTree
      width: Math.round(bed.width * 0.34); height: 2; radius: 1
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      color: Qt.alpha(Color.accent, 0.16 + 0.22 * root._fly)
      opacity: Math.max(0, root._fly * 3 - 2)
    }

    // ---- tap to summon the full panel -----------------------------------
    // A small hit box around the tree. Quiet — discovered by tapping — but a
    // hover now also reveals the way back to its housing (below).
    Item {
      id: tapArea
      // Every pixel of this is a pixel the desktop underneath cannot receive, so
      // the grab margin stays small — enough to catch a near-miss on the canopy,
      // not a moat around the tree.
      x: -6; y: -3
      width: bed.width + 12; height: bed.height + 6
      MouseArea {
        id: tapMa
        anchors.fill: parent
        enabled: !root.desktopPruning
        hoverEnabled: true
        acceptedButtons: Qt.LeftButton | Qt.MiddleButton
        cursorShape: Qt.PointingHandCursor
        onPressed: function (m) {
          if (m.button === Qt.MiddleButton && root.ready && root.showTree) {
            root._rotating = true
            root._rotLastX = m.x
            m.accepted = true
            return
          }
        }
        onPositionChanged: function (m) {
          if (!root._rotating || m.buttons !== Qt.MiddleButton || !root.ready || !root.showTree) return
          var delta = (m.x - root._rotLastX) * 0.018
          root._rotLastX = m.x
          tree.animateToYaw(tree.yaw + delta)
          m.accepted = true
        }
        onReleased: function (m) {
          if (m.button === Qt.MiddleButton) {
            root._rotating = false
            root._rotLastX = 0
            if (root.ready) root.bonsaiService.setOrbit(tree.yaw)
            m.accepted = true
          }
        }
        onClicked: function (m) {
          if (m.button === Qt.MiddleButton) return
          if (root.ready && root.showTree) {
            root.quickMenuOpen = !root.quickMenuOpen
            if (root.quickMenuOpen) return
          }
          root.summonPanel()
        }
      }
    }
  }

  // ---- "take me home" tab ---------------------------------------------
  // Fades in along the top of the bed while the ornament (or the tab) is
  // hovered. It is the tree asking, in its own voice, to be brought back in —
  // clicking it returns it to the bar (desktopEnabled = false), the same as
  // switching "SET ME OUT" off in the panel.
  property bool quickMenuOpen: false
  property bool desktopPruning: false
  property bool _rotating: false
  property real _rotLastX: 0
  readonly property string companionBridgePath:
    (Quickshell.env("XDG_STATE_HOME") || ((Quickshell.env("HOME") || "") + "/.local/state"))
      + "/omarchy/omatree-companion.json"

  function publishCompanionBridge() {
    if (!root.ready || !root.showTree || !isFinite(root.bedW) || !isFinite(root.bedH)) return
    var baseX = bed.x
    var baseY = Screen.height - root.implicitHeight + bed.y
    var floor = baseY + bed.height
    var center = baseX + bed.width / 2
    var span = Math.max(28, bed.width * 0.18)
    companionBridge.setText(JSON.stringify({
      version: 1,
      screen: Screen.name,
      platforms: [
        { x1: center - span, x2: center + span, y: floor - 5, id: "saucer" },
        { x1: center - span * 0.72, x2: center + span * 0.72, y: floor - bed.height * 0.22, id: "lower-branch" },
        { x1: center - span * 0.48, x2: center + span * 0.48, y: floor - bed.height * 0.43, id: "upper-branch" }
      ]
    }, null, 2) + "\n")
  }

  FileView {
    id: companionBridge
    path: root.companionBridgePath
    preload: false
    watchChanges: false
    atomicWrites: true
    printErrors: false
  }

  onImplicitHeightChanged: root.publishCompanionBridge()
  onImplicitWidthChanged: root.publishCompanionBridge()

  function doDesktopAction(kind) {
    if (!root.ready || !root.showTree) return
    var svc = root.bonsaiService
    if (kind === "water") { svc.waterNow(); tree.water(); }
    // desktopPruning drives tree.pruneMode through its binding — assigning the
    // property here as well would break that binding and strand trim mode on.
    else if (kind === "trim") root.desktopPruning = true
    else if (kind === "blinds") {
      svc.lampOn = !svc.lampOn
      if (svc.lampOn) tree.light()
    }
    root.quickMenuOpen = false
  }

  readonly property bool _tabShown:
    root.showTree && !root._airborne && (tapMa.containsMouse || returnMa.containsMouse)

  Item {
    id: desktopQuickMenu
    x: bed.x + (bed.width - width) / 2
    y: bed.y - height
    width: actionRow.width + 16
    height: actionRow.height + 10
    opacity: root.showTree && root.quickMenuOpen ? 1 : 0
    visible: opacity > 0.01
    Behavior on opacity { NumberAnimation { duration: 140 } }

    Rectangle {
      anchors.fill: parent
      radius: 8
      color: Qt.rgba(0, 0, 0, 0.54)
      border.width: 1
      border.color: Qt.alpha(Color.accent, 0.55)
    }

    Row {
      id: actionRow
      anchors.centerIn: parent
      spacing: 6
      property real btnW: 52

      Repeater {
        model: [
          { key: "water", label: "WATER" },
          { key: "trim", label: "TRIM" },
          { key: "blinds", label: "LIGHT" }
        ]

        Rectangle {
          id: quickAction
          required property var modelData
          width: actionRow.btnW
          height: 22
          radius: 6
          color: ma.containsMouse ? Qt.alpha(Color.accent, 0.18) : Qt.rgba(0, 0, 0, 0.18)
          border.width: 1
          border.color: Qt.alpha(Color.accent, 0.5)
          Text {
            anchors.centerIn: parent
            text: quickAction.modelData.label
            color: Color.accent
            font.family: "monospace"
            font.pixelSize: 9
            font.letterSpacing: 1.2
            renderType: Text.QtRendering
          }
          MouseArea {
            id: ma
            anchors.fill: parent
            hoverEnabled: true
            cursorShape: Qt.PointingHandCursor
            onClicked: root.doDesktopAction(quickAction.modelData.key)
          }
        }
      }
    }
  }

  // The way out of trim mode. It is a sibling of the quick menu, not a child:
  // pressing TRIM closes that menu, and a DONE button living inside it would
  // vanish with it the instant it became the only way back.
  Item {
    id: trimDone
    x: bed.x + bed.width - width
    y: bed.y - height
    width: trimDoneLabel.implicitWidth + 14
    height: trimDoneLabel.implicitHeight + 8
    visible: root.showTree && root.desktopPruning

    Rectangle {
      anchors.fill: parent
      radius: 3
      color: Qt.rgba(0, 0, 0, 0.58)
      border.width: 1
      border.color: Qt.alpha(Color.accent, 0.65)
    }
    Text {
      id: trimDoneLabel
      anchors.centerIn: parent
      text: "DONE"
      color: Color.accent
      font.family: "monospace"
      font.pixelSize: 10
      font.letterSpacing: 1.5
    }
    MouseArea {
      anchors.fill: parent
      cursorShape: Qt.PointingHandCursor
      onClicked: root.desktopPruning = false
    }
  }

  Item {
    id: returnTab
    anchors { top: bed.top; right: bed.right }
    width: returnLabel.implicitWidth + 14
    height: returnLabel.implicitHeight + 8
    opacity: root._tabShown ? 1 : 0
    visible: opacity > 0.01
    Behavior on opacity { NumberAnimation { duration: 160 } }

    Rectangle {
      anchors.fill: parent
      radius: 3
      color: Qt.rgba(0, 0, 0, 0.55)
      border.width: 1
      border.color: Qt.alpha(Color.accent, returnMa.containsMouse ? 0.8 : 0.4)
    }
    Text {
      id: returnLabel
      anchors.centerIn: parent
      text: "◂ TAKE ME HOME"
      color: Qt.alpha(Color.accent, returnMa.containsMouse ? 1 : 0.8)
      font.family: "monospace"
      font.pixelSize: 10
      font.letterSpacing: 1.5
      renderType: Text.QtRendering
    }
    MouseArea {
      id: returnMa
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: if (root.ready) root.bonsaiService.setDesktop(false)
    }
  }

  function summonPanel() {
    Quickshell.execDetached(
      ["omarchy-shell", "-q", "shell", "summon", "jimmie.bonsai", "{}"])
  }
}
