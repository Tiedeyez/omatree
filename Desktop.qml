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

  property var treeService: null

  readonly property bool ready: !!treeService && treeService.initialized === true
  readonly property bool showTree: root.ready && treeService.planted === true
    && treeService.desktopEnabled === true

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
  // Doubled 2026-09-04 (Jimmie: "enlarge 100%") alongside artUnits below --
  // the caps have to grow with it or desktopScale would just claw the extra
  // art pixels back down via a fractional downscale, which is the exact mush
  // the 1:1 comment above is warning against.
  readonly property real maxDesktopH: Math.max(300, Screen.height * 0.60)
  readonly property real maxDesktopW: Math.max(240, Screen.width * 0.28)
  // 1:1. artScale already gives a clean 2x, so the ornament is drawn at exactly
  // the size it was rendered and the pixel grid stays exact. Making the tree
  // smaller is done by rendering FEWER art pixels (the Tree's artUnits below),
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
  // The window is only a canvas — the MASK below is what actually takes input —
  // so making it wider than the tile costs the desktop nothing, and it has to
  // be: the quick menu is a fixed ~184px while a young tree's bed is 138, so a
  // window sized to the bed alone clipped WATER and LIGHT clean off both edges
  // and left TRIM half unreachable. Sizing to whichever is wider keeps the whole
  // menu on screen at every stage of the tree's life.
  implicitWidth: Math.round(Math.max(bedW, desktopQuickMenu.width + 24))
  implicitHeight: Math.round(bedH + flightPadY)

  color: "transparent"
  exclusionMode: ExclusionMode.Ignore
  WlrLayershell.layer: WlrLayer.Top
  WlrLayershell.namespace: "tiedeyez.omatree.desktop"
  // Same layer as a roaming companion. The ornament still sits in front of the
  // wallpaper/background, but it does not fully block a companion: the pet can
  // walk in front of or behind the tree and even climb the pot/window stack.
  // A Region takes an item's geometry, not its visibility, so listing the menu
  // and the DONE tab outright would keep them stealing clicks from the desktop
  // the whole time they are hidden. They are spelled out instead and collapse to
  // nothing unless they are actually on screen.
  mask: Region {
    Region { item: tapArea }
    Region { item: returnTab }
    Region {
      x: desktopQuickMenu.x; y: desktopQuickMenu.y
      width: root.quickMenuOpen ? desktopQuickMenu.width : 0
      height: root.quickMenuOpen ? desktopQuickMenu.height : 0
    }
    Region {
      x: trimDone.x; y: trimDone.y
      width: root.desktopPruning ? trimDone.width : 0
      height: root.desktopPruning ? trimDone.height : 0
    }
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

    Omatree {
      id: tree
      forceFront: false
      inHousing: false
      onDesktop: true
      // Sized against the reference shot: 2.2 art-units renders ~97x123 art px,
      // which at artScale 2 lands the ornament at ~194x246 on screen. The panel
      // keeps its own larger art resolution; only the desktop tile shrinks.
      // Doubled to 4.4 (Jimmie: "enlarge 100%") -- ~194x246 art px, ~388x492 on
      // screen. maxDesktopW/H above were raised to match so this still renders
      // at a clean 1:1, never a fractional downscale.
      artUnits: 4.4
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      scale: root.desktopScale
      opacity: root._fade
      transformOrigin: Item.Bottom
      active: root.showTree
      transparent: true
      solidObject: true
      tree: root.ready ? treeService.treeSpec : null
      pruneMode: root.desktopPruning
      tint: Color.accent
      textColor: Color.foreground
      onPruneRequested: function (id) { if (root.ready) treeService.pruneNode(id) }
      onOrbitChanged: function (yaw) { if (root.ready) treeService.setOrbit(yaw) }
      Component.onCompleted: {
        if (root.ready && root.treeService && typeof root.treeService.yaw !== "undefined")
          tree.yaw = root.treeService.yaw
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
            if (root.ready) root.treeService.setOrbit(tree.yaw)
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
    // bed.x/y are window-local, but the bridge publishes SCREEN coordinates for
    // something else to walk on. The y was already being converted; the x never
    // was, so a right-anchored tile sitting at x=3230 published its footprint at
    // x=41 — the far side of the screen. The window is bottom-anchored and
    // pinned to one edge, so its origin follows from the margins and its size.
    var winLeft = root.horizontalAnchor === "right"
      ? Screen.width - root.margins.right - root.implicitWidth
      : root.margins.left
    var baseX = winLeft + bed.x
    var baseY = Screen.height - root.implicitHeight + bed.y
    var floor = baseY + bed.height
    var center = baseX + bed.width / 2
    var span = Math.max(28, bed.width * 0.18)
    // ---- what the companion is allowed to stand on ---------------------
    // The bar pet already reads this file and turns each entry into somewhere
    // it can walk. So the whole easter egg lives on THIS side: we choose what
    // to publish, the pet just goes where the ground is, and it is never told
    // anything. No change to the pet plugin, and it keeps working untouched if
    // this file is empty or missing.
    //
    // The saucer is always there — anything can come and stand at the foot of a
    // tree. The BRANCHES are the unlock: a pet that is actually being kept well
    // (its own careAverage past the band its own code calls well-kept, grown,
    // and around more than a couple of days) gets to climb up into the tree.
    // A neglected one never finds a way up and no one is ever told why.
    var svc = root.treeService
    var welcome = !!svc && svc.companionThriving === true
    var plats = [
      { x1: center - span, x2: center + span, y: floor - 5, id: "saucer" }
    ]
    if (welcome) {
      plats.push({ x1: center - span * 0.72, x2: center + span * 0.72,
                   y: floor - bed.height * 0.22, id: "lower-branch" })
      plats.push({ x1: center - span * 0.48, x2: center + span * 0.48,
                   y: floor - bed.height * 0.43, id: "upper-branch" })
    }
    // And when the tree is genuinely in want of something, it puts a ledge right
    // at the soil. The pet has no idea the tree is thirsty — it simply finds new
    // ground by the pot and drifts over to it, which from the outside looks
    // exactly like it came to sit with the tree.
    if (!!svc && svc.worstNeed >= 60) {
      plats.push({ x1: center - span * 1.15, x2: center - span * 0.35,
                   y: floor - 3, id: "soil-edge" })
    }
    companionBridge.setText(JSON.stringify({
      version: 1,
      screen: Screen.name,
      platforms: plats
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

  // The bridge is only re-read by the pet when it changes, so the two things
  // that decide what goes in it have to trigger a republish themselves.
  readonly property bool companionWelcome:
    root.ready && root.treeService.companionThriving === true
  readonly property bool treeInWant:
    root.ready && root.treeService.worstNeed >= 60
  onCompanionWelcomeChanged: root.publishCompanionBridge()
  onTreeInWantChanged: root.publishCompanionBridge()

  function doDesktopAction(kind) {
    if (!root.ready || !root.showTree) return
    var svc = root.treeService
    if (kind === "water") { svc.waterNow(); tree.water(); }
    // desktopPruning drives tree.pruneMode through its binding — assigning the
    // property here as well would break that binding and strand trim mode on.
    else if (kind === "trim") root.desktopPruning = true
    else if (kind === "blinds") {
      svc.lampOn = !svc.lampOn
      if (svc.lampOn) tree.light()
    }
    // Same rule as the panel's companion strip: a real berry, or nothing —
    // feeding is never free here either, and it's a live call on the pet's
    // own service (svc.petService), never a write to its state file.
    else if (kind === "feed" && svc.petHere) {
      if (svc.pickBerry()) svc.petService.feedNow()
    }
    // Grafting needs the full walkthrough (a file to pick, a preview to
    // confirm) — too much for this small popup, so this just hands off to
    // the panel's own flow rather than building a second copy of it here.
    else if (kind === "graft") {
      svc.pendingGraftOpen = true
      root.summonPanel()
    }
    root.quickMenuOpen = false
  }

  readonly property bool _tabShown:
    root.showTree && !root._airborne && (tapMa.containsMouse || returnMa.containsMouse)

  Item {
    id: desktopQuickMenu
    // Centred on the tree, but never past the window's own edges. The bed sits
    // flush against the right edge, so a menu wider than the tree — which it is
    // for anything but a big tree — would otherwise hang off that side and lose
    // its last button no matter how wide the window gets.
    x: Math.max(0, Math.min(root.width - width, bed.x + (bed.width - width) / 2))
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
        // feed only when there's a real companion to feed; graft only shown
        // once there's a tree to offer it to at all (root.ready) — matches
        // the panel's own "only what applies" restraint rather than always
        // showing every action regardless of whether it does anything.
        model: {
          var list = [
            { key: "water", label: "WATER" },
            { key: "trim", label: "TRIM" },
            { key: "blinds", label: "LIGHT" }
          ]
          if (root.ready && root.treeService.petHere) list.push({ key: "feed", label: "FEED" })
          if (root.ready) list.push({ key: "graft", label: "GRAFT" })
          return list
        }

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
      onClicked: if (root.ready) root.treeService.setDesktop(false)
    }
  }

  function summonPanel() {
    Quickshell.execDetached(
      ["omarchy-shell", "-q", "shell", "summon", "tiedeyez.omatree", "{}"])
  }
}
