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

  // Headroom above (and a little beside) the bed so the tree has somewhere to
  // arrive FROM. A layer-shell surface clips its children, so without this the
  // arc would be sliced off at the window edge. The padding is transparent and
  // outside the input mask, so it costs the desktop nothing.
  // Bounded by what is left of the screen above the bed — a surface taller
  // than the output gets pushed off the top edge, and the tree would then
  // start its fall somewhere nobody can see.
  readonly property real flightPadY: Math.max(24, Math.min(
    Math.round(root.bedH * 0.62), Math.round(Screen.height - root.bedH - 34)))
  readonly property real flightPadX: Math.round(root.bedW * 0.34)

  implicitWidth: Math.round(bedW + flightPadX)
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
  // It does not get thrown out here. It comes forward out of the panel and
  // arrives at full size: a hard, fast enlargement that slams to scale and
  // stops dead. Anything springy or wobbly reads as a toy being tossed; this
  // should read as a thing planting itself.
  //
  // PanelWindow is not an Item (no states/transitions on the window itself),
  // so the choreography lives in plain numeric properties here and is applied
  // through transforms on the bed's children.
  property real _fly: 0        // 0 = still back in the panel, 1 = at full size
  property real _dust: 0       // 0..1 the beat of the impact
  readonly property bool _airborne: root._fly < 0.999

  // It grows out of where the panel is — up and inboard of the corner — and
  // converges straight in. A short, direct travel; no arc, no swing.
  readonly property real _travelY: -(1 - root._fly) * (root.flightPadY * 0.55)
  readonly property real _travelX: -(1 - root._fly) * (root.bedW * 0.10)
  // the slam itself: tiny to full, with just enough overshoot to land hard
  property real _pop: 0        // 0..1, eased separately from the travel
  readonly property real _flyScale: 0.10 + 0.90 * root._pop

  SequentialAnimation {
    id: arriveAnim
    PropertyAction { target: root; property: "_dust"; value: 0 }
    ParallelAnimation {
      NumberAnimation {
        target: root; property: "_fly"; to: 1
        duration: 240; easing.type: Easing.OutQuart
      }
      NumberAnimation {
        target: root; property: "_pop"; to: 1.06
        duration: 240; easing.type: Easing.OutQuart       // rushes to size
      }
    }
    ParallelAnimation {
      // and stops dead on the mark — one hard settle, no bounce back and forth
      NumberAnimation {
        target: root; property: "_pop"; to: 1
        duration: 110; easing.type: Easing.OutQuad
      }
      SequentialAnimation {
        NumberAnimation { target: root; property: "_dust"; to: 1; duration: 420; easing.type: Easing.OutCubic }
        PropertyAction { target: root; property: "_dust"; value: 0 }
      }
    }
  }

  SequentialAnimation {
    id: departAnim
    // a short lean in before it goes, then it collapses back into the panel
    NumberAnimation { target: root; property: "_pop"; to: 1.07; duration: 90; easing.type: Easing.OutQuad }
    ParallelAnimation {
      NumberAnimation { target: root; property: "_pop"; to: 0; duration: 230; easing.type: Easing.InQuart }
      NumberAnimation { target: root; property: "_fly"; to: 0; duration: 230; easing.type: Easing.InQuart }
      SequentialAnimation {
        NumberAnimation { target: root; property: "_dust"; to: 1; duration: 300; easing.type: Easing.OutCubic }
        PropertyAction { target: root; property: "_dust"; value: 0 }
      }
    }
  }

  onShowTreeChanged: {
    arriveAnim.stop(); departAnim.stop()
    if (root.showTree) arriveAnim.restart()
    else departAnim.restart()
  }
  Component.onCompleted: {
    root._fly = 0; root._pop = 0
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
      width: Math.round(bed.width * (0.16 + 0.30 * root._pop))
      height: 4
      radius: 2
      color: Qt.alpha(Color.accent, 0.05 + 0.16 * root._pop)
    }

    Bonsai {
      id: tree
      forceFront: true
      inHousing: false
      artUnits: 4.0
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      scale: root.desktopScale
      opacity: Math.min(1, root._pop * 5)
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

      // The enlargement pivots on the pot's base, so the pot arrives planted
      // on the screen edge rather than dropping onto it.
      transform: [
        Scale {
          origin.x: tree.width / 2; origin.y: tree.height
          xScale: root._flyScale; yScale: root._flyScale
        },
        Translate { x: root._travelX; y: root._travelY }
      ]
    }

    // ---- landing puff: a ring that opens out and thins away -------------
    Rectangle {
      visible: root._dust > 0.01
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      anchors.bottomMargin: -1
      width: Math.round(bed.width * (0.14 + 0.58 * root._dust))
      height: Math.max(3, Math.round(bed.width * 0.055 * (1 - root._dust * 0.55)))
      radius: height / 2
      color: "transparent"
      border.width: 1
      border.color: Qt.alpha(Color.accent, Math.max(0, 0.5 * (1 - root._dust)))
    }
    // motes thrown out sideways by the impact
    Repeater {
      model: 7
      delegate: Rectangle {
        required property int index
        readonly property real dir: (index % 2 === 0 ? 1 : -1)
        readonly property real spread: 0.12 + 0.09 * (index % 4)
        visible: root._dust > 0.01
        width: 2; height: 2
        color: Qt.alpha(Color.accent, Math.max(0, 0.55 * (1 - root._dust)))
        x: bed.width / 2 - 1 + dir * bed.width * spread * root._dust * 3.2
        y: bed.height - 3 - bed.height * 0.06 * Math.sin(root._dust * Math.PI) * (1 + (index % 3))
      }
    }

    // a thin accent line right at the screen edge the pot rests on
    Rectangle {
      visible: root.showTree
      width: Math.round(bed.width * 0.34); height: 2; radius: 1
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      color: Qt.alpha(Color.accent, 0.16 + 0.22 * root._pop)
      opacity: root._pop
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
