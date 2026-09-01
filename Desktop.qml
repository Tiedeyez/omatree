import QtQuick
import Quickshell
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
  margins {
    bottom: 0
    right: root.horizontalAnchor === "right" ? 16 : 0
    left: root.horizontalAnchor === "left" ? 16 : 0
  }

  // The window hugs the ornament: sized to the scaled tree bounding box, so
  // there is minimal transparent click-through surface on the desktop.
  readonly property real maxDesktopH: Math.max(150, Screen.height * 0.48)
  readonly property real maxDesktopW: Math.max(120, Screen.width * 0.28)
  readonly property real targetScale: 2.23
  readonly property real naturalW: Math.max(1, tree.artW * tree.artScale)
  readonly property real naturalH: Math.max(1, tree.artH * tree.artScale)
  readonly property real desktopScale: Math.min(
    targetScale, maxDesktopW / naturalW, maxDesktopH / naturalH)
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
    Region { item: returnTab }
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
  // through a translate on the bed's children.
  property real _fly: 0        // 0 = still up inside the panel, 1 = standing in the corner
  readonly property bool _airborne: root._fly < 0.999

  // one straight, unhurried descent — no arc, no scale, no rotation
  readonly property real _travelY: -(1 - root._fly) * (root.bedH + root.flightPadY)

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
  }
  Component.onCompleted: {
    root._fly = 0
    if (root.showTree) arriveAnim.start()
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
      forceFront: true
      inHousing: false
      artUnits: 4.0
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      scale: root.desktopScale
      opacity: 1
      transformOrigin: Item.Bottom
      active: root.showTree
      transparent: true
      solidObject: true
      tree: root.ready ? bonsaiService.treeSpec : null
      tint: Color.accent
      textColor: Color.foreground
      onPruneRequested: function (id) { if (root.ready) bonsaiService.pruneNode(id) }
      onOrbitChanged: function (yaw) { if (root.ready && !root.showTree) bonsaiService.setOrbit(yaw) }
      Component.onCompleted: tree.yaw = 0

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
      x: -12; y: -4
      width: bed.width + 24; height: bed.height + 8
      MouseArea {
        id: tapMa
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.PointingHandCursor
        onClicked: root.summonPanel()
      }
    }
  }

  // ---- "take me home" tab ---------------------------------------------
  // Fades in along the top of the bed while the ornament (or the tab) is
  // hovered. It is the tree asking, in its own voice, to be brought back in —
  // clicking it returns it to the bar (desktopEnabled = false), the same as
  // switching "SET ME OUT" off in the panel.
  readonly property bool _tabShown:
    root.showTree && !root._airborne && (tapMa.containsMouse || returnMa.containsMouse)
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
