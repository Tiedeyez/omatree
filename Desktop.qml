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
  readonly property real maxDesktopH: Math.max(220, Screen.height * 0.72)
  readonly property real maxDesktopW: Math.max(180, Screen.width * 0.42)
  readonly property real targetScale: 3.33
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

  // ---- the journey ----------------------------------------------------
  // Moving the tree out to the desktop is the one moment this thing gets to be
  // playful, so it is choreographed rather than faded: the potted tree swings
  // down out of the bar on an arc, lands with real weight (squash, rebound, a
  // puff of dust), and its canopy keeps swaying for a beat afterwards while a
  // few leaves it shook loose flutter down. Sending it home plays the same
  // beats backwards — a crouch, a spring, and it is gone the way it came.
  //
  // PanelWindow is not an Item (no states/transitions on the window itself),
  // so the choreography lives in plain numeric properties here and is applied
  // through transforms on the bed's children.
  property real _fly: 0        // 0 = still up in the bar, 1 = seated in the corner
  property real _lean: 0       // canopy sway, degrees
  property real _squash: 0     // >0 compressed on landing, <0 stretched on rebound
  property real _dust: 0       // 0..1 landing puff
  property real _leaf: 1       // 0..1 shaken-leaf flutter (1 = spent)
  readonly property bool _airborne: root._fly < 0.999

  // The arc: falls from above and drifts in from the right, the way something
  // handed down gently out of the bar would travel.
  readonly property real _travelY: -(1 - root._fly) * (root.flightPadY + root.bedH * 0.22)
  readonly property real _travelX: Math.sin((1 - root._fly) * Math.PI * 0.5) * root.bedW * 0.30
  readonly property real _flyScale: 0.42 + 0.58 * root._fly

  function shakeLeaves() { root._leaf = 0; leafFall.restart() }
  NumberAnimation {
    id: leafFall
    target: root; property: "_leaf"; from: 0; to: 1
    duration: 1500; easing.type: Easing.InOutSine
  }

  SequentialAnimation {
    id: arriveAnim
    PropertyAction { target: root; property: "_squash"; value: 0 }
    PropertyAction { target: root; property: "_dust"; value: 0 }
    ParallelAnimation {
      NumberAnimation {
        target: root; property: "_fly"; to: 1
        duration: 460; easing.type: Easing.InQuad          // gravity, not a glide
      }
      NumberAnimation {
        target: root; property: "_lean"; from: -13; to: 6
        duration: 460; easing.type: Easing.OutCubic
      }
    }
    ParallelAnimation {
      // touchdown: the pot takes the weight, then springs back through
      SequentialAnimation {
        NumberAnimation { target: root; property: "_squash"; to: 1; duration: 80; easing.type: Easing.OutQuad }
        NumberAnimation { target: root; property: "_squash"; to: -0.34; duration: 140; easing.type: Easing.OutQuad }
        NumberAnimation { target: root; property: "_squash"; to: 0; duration: 260; easing.type: Easing.OutBack }
      }
      SequentialAnimation {
        NumberAnimation { target: root; property: "_dust"; to: 1; duration: 560; easing.type: Easing.OutCubic }
        PropertyAction { target: root; property: "_dust"; value: 0 }
      }
      // the canopy keeps going after the pot has stopped, and settles down
      SequentialAnimation {
        NumberAnimation { target: root; property: "_lean"; to: -3.6; duration: 230; easing.type: Easing.InOutSine }
        NumberAnimation { target: root; property: "_lean"; to: 2.0; duration: 270; easing.type: Easing.InOutSine }
        NumberAnimation { target: root; property: "_lean"; to: -0.9; duration: 250; easing.type: Easing.InOutSine }
        NumberAnimation { target: root; property: "_lean"; to: 0; duration: 230; easing.type: Easing.InOutSine }
      }
      ScriptAction { script: root.shakeLeaves() }
    }
  }

  SequentialAnimation {
    id: departAnim
    // anticipation — it crouches before it goes
    NumberAnimation { target: root; property: "_squash"; to: 0.85; duration: 170; easing.type: Easing.OutQuad }
    ParallelAnimation {
      NumberAnimation { target: root; property: "_squash"; to: -0.45; duration: 150; easing.type: Easing.OutQuad }
      NumberAnimation { target: root; property: "_fly"; to: 0; duration: 400; easing.type: Easing.InCubic }
      NumberAnimation { target: root; property: "_lean"; to: 15; duration: 400; easing.type: Easing.InQuad }
      SequentialAnimation {
        NumberAnimation { target: root; property: "_dust"; to: 1; duration: 380; easing.type: Easing.OutCubic }
        PropertyAction { target: root; property: "_dust"; value: 0 }
      }
      ScriptAction { script: root.shakeLeaves() }
    }
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
      opacity: Math.min(1, root._fly * 4)
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

      // Squash/stretch and lean both pivot on the pot's base, so the pot stays
      // planted on the screen edge and it is the canopy that swings.
      transform: [
        Scale {
          origin.x: tree.width / 2; origin.y: tree.height
          xScale: 1 + root._squash * 0.16
          yScale: 1 - root._squash * 0.20
        },
        Rotation {
          origin.x: tree.width / 2; origin.y: tree.height
          angle: root._lean
        },
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

    // ---- leaves it shook loose ------------------------------------------
    // They peel off the canopy, sway on the way down, and are gone before you
    // can count them — the point is that you half-catch it happening.
    Repeater {
      model: 6
      delegate: Rectangle {
        required property int index
        readonly property real seedX: 0.30 + 0.11 * ((index * 5) % 4)
        readonly property real drift: (index % 2 === 0 ? 1 : -1) * (0.06 + 0.05 * (index % 3))
        readonly property real lag: index * 0.07
        readonly property real t: Math.max(0, Math.min(1, (root._leaf - lag) / (1 - lag)))
        visible: root._leaf < 1 && t > 0 && root._fly > 0.2
        width: 3; height: 2
        radius: 1
        color: Qt.alpha(Color.accent, 0.75 * (1 - t * t))
        x: bed.width * (seedX + drift * t) + Math.sin(t * 7 + index) * bed.width * 0.035
        y: bed.height * (0.30 + 0.66 * t * t)
        rotation: Math.sin(t * 9 + index) * 55
      }
    }

    // a thin accent line right at the screen edge the pot rests on
    Rectangle {
      visible: root.showTree
      width: Math.round(bed.width * 0.34); height: 2; radius: 1
      anchors.horizontalCenter: parent.horizontalCenter
      anchors.bottom: parent.bottom
      color: Qt.alpha(Color.accent, 0.16 + 0.22 * root._fly)
      opacity: root._fly
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
