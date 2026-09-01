import QtQuick
import Quickshell
import Quickshell.Wayland
import qs.Commons

// The "desktop snapshot": a live copy of the Omatree living in the lower-right
// corner of the desktop as a quiet background ornament. It sits on the front-most
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
  readonly property real maxDesktopH: Math.max(220, Screen.height * 0.72)
  readonly property real maxDesktopW: Math.max(180, Screen.width * 0.42)
  readonly property real targetScale: 3.33
  readonly property real naturalW: Math.max(1, tree.artW * tree.artScale)
  readonly property real naturalH: Math.max(1, tree.artH * tree.artScale)
  readonly property real desktopScale: Math.min(
    targetScale, maxDesktopW / naturalW, maxDesktopH / naturalH)
  readonly property real bedH: Math.min(maxDesktopH, naturalH * desktopScale)
  readonly property real bedW: Math.min(maxDesktopW, naturalW * desktopScale)

  implicitWidth: Math.round(bedW)
  implicitHeight: Math.round(bedH)

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

  // ---- snapshot-travel entrance (settle in) ---------------------------
  // A quiet, geometric "the bar sprite took a snapshot and settled here":
  // the tree pops up at the corner and settles with a gentle OutBack ease,
  // a thin dust ring and landing shadow blooming as it lands. No sound, no
  // emoji — on brand.
  // PanelWindow is not an Item, so no states/transitions/Behavior here — drive
  // the settle with a plain animation off the showTree edge.
  property real _travel: 1         // fixed, front-most, fully visible ornament
  ParallelAnimation {
    id: travelAnim
    NumberAnimation {
      target: root; property: "_travel"
      duration: 420; easing.type: Easing.OutCubic
    }
    NumberAnimation {
      target: tree; property: "rotation"
      from: -3.5; to: 0
      duration: 420; easing.type: Easing.OutCubic
    }
  }
  onShowTreeChanged: {
    travelAnim.stop()
    travelAnim.from = root._travel
    travelAnim.to = root.showTree ? 1 : 0
    travelAnim.start()
  }
  Component.onCompleted: {
    root._travel = 0
    if (root.showTree) travelAnim.start()
  }

  // ---- the tree, scaled down to a calm corner ornament ----------------
  Bonsai {
    id: tree
    forceFront: true
    inHousing: false
    artUnits: 4.0
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    // fit the natural-size tree into the bed, bounded by both dimensions so a
    // narrow-tall or wide-flat tree never overflows the corner window
    scale: root.desktopScale * (0.94 + 0.06 * root._travel)
    y: (1 - root._travel) * root.bedH * 0.32
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
  }

  // dust ring that puffs at the base while it settles
  Rectangle {
    width: Math.round(root.bedW * 0.42); height: 3; radius: 1.5
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    visible: root._travel > 0 && root._travel < 0.72
    color: Qt.alpha(Color.accent,
      Math.max(0, (1 - root._travel * 1.35) * 0.42))
  }

  // a thin accent line right at the screen edge the pot rests on
  Rectangle {
    visible: root.showTree
    width: Math.round(root.bedW * 0.34); height: 2; radius: 1
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    color: Qt.alpha(Color.accent, 0.16 + 0.22 * root._travel)
  }

  // ---- tap to summon the full panel -----------------------------------
  // A small hit box around the tree. Quiet — discovered by tapping — but a
  // hover now also reveals the way back to its housing (below).
  Item {
    id: tapArea
    x: -12; y: -4
    width: parent.width + 24; height: parent.height + 8
    MouseArea {
      id: tapMa
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onClicked: root.summonPanel()
    }
  }

  // ---- "back to its housing" tab -------------------------------------
  // Fades in along the top of the bed while the ornament (or the tab) is
  // hovered. Click → the tree returns to the bar (desktopEnabled = false),
  // same as switching "SET ON DESKTOP" off in the panel.
  readonly property bool _tabShown:
    root.showTree && (tapMa.containsMouse || returnMa.containsMouse)
  Item {
    id: returnTab
    anchors { top: parent.top; right: parent.right }
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
      text: "◂ HOUSING"
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
