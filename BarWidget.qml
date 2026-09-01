import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

// Bar mark: a tiny living bonsai. Its canopy grows with the tree, sways in the
// breeze, sparkles when it's thriving and wilts amber when it needs you; after
// dark a firefly blinks beside it. Left-click opens the glass house,
// middle-click waters.
BarWidget {
  id: root
  moduleName: "jimmie.bonsai"

  readonly property var bonsaiService: bar && bar.shell
    ? bar.shell.serviceFor(moduleName)
    : null
  readonly property bool serviceReady: !!bonsaiService && bonsaiService.initialized === true

  // Panel lifecycle forwarding, required by the bar's popout switching.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item
    ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: content.implicitWidth
  readonly property real openPanelIndicatorHeight: content.implicitHeight

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("settings" in target) target.settings = root.settings
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
    if ("bonsaiService" in target) target.bonsaiService = root.bonsaiService
  }

  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function toggle() { if (panelLoader.item) panelLoader.item.toggle() }
  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: Qt.callLater(injectPanel)
  onSettingsChanged: Qt.callLater(injectPanel)
  onBonsaiServiceChanged: Qt.callLater(injectPanel)
  Component.onCompleted: Qt.callLater(injectPanel)

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: root.injectPanel()
  }

  // ---- derived state -------------------------------------------------
  readonly property real maturity: root.serviceReady
    ? (root.bonsaiService.effMaturity !== undefined
       ? root.bonsaiService.effMaturity : root.bonsaiService.maturity)
    : 0
  readonly property real worst: root.serviceReady ? root.bonsaiService.worstNeed : 0
  readonly property bool night: root.serviceReady ? !root.bonsaiService.daylight : false
  readonly property bool lampOn: root.serviceReady && root.bonsaiService.lampOn
  readonly property bool thriving: root.serviceReady && root.worst < 20

  readonly property color canopyColor: !root.serviceReady ? Qt.alpha(button.foreground, 0.4)
    : root.worst >= 60 ? Color.urgent
    : root.worst >= 34 ? Qt.rgba(0.95, 0.72, 0.32, 1)
    : Color.accent
  readonly property color woodColor: Qt.alpha(button.foreground, 0.55)

  // ---- animation clock --------------------------------------------
  property real phase: 0
  Timer {
    interval: 90
    repeat: true
    running: root.visible
    onTriggered: root.phase += 0.09
  }
  readonly property bool thirstyStill: root.worst >= 55
  readonly property real swayX: root.serviceReady && !root.thirstyStill
    ? Math.sin(root.phase * 0.7) : 0
  readonly property real breathe: 1 + 0.05 * Math.sin(root.phase * 0.9)
  readonly property bool fireflyNow: root.night && !root.lampOn
  readonly property real fireflyTw: 0.15 + 0.85 * Math.max(0, Math.sin(root.phase * 1.3))

  function splash() { splashAnim.restart() }
  SequentialAnimation {
    id: splashAnim
    NumberAnimation { target: content; property: "scale"; to: 1.22; duration: 90; easing.type: Easing.OutQuad }
    NumberAnimation { target: content; property: "scale"; to: 1.0; duration: 220; easing.type: Easing.OutBack }
  }

  // ---- wake bloom -------------------------------------------------------
  // The mark swells softly to life the moment the tree finishes waking (every
  // shell start / restart), with a dew glint at the crown. `wakePulse` runs
  // 0 → 1 → 0 over the animation so it's a single breath, not a step.
  property real wake: 1
  NumberAnimation {
    id: wakeAnim
    target: root; property: "wake"; from: 0; to: 1
    duration: 1100; easing.type: Easing.OutCubic
  }
  onServiceReadyChanged: if (serviceReady) { root.wake = 0; wakeAnim.restart() }
  readonly property real wakePulse: Math.sin(Math.max(0, Math.min(1, root.wake)) * Math.PI)

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    labelVisible: false
    hasVisualContent: true
    dimmed: !root.serviceReady
    tooltipText: root.serviceReady
      ? root.bonsaiService.treeName + " · " + root.bonsaiService.moodLabel
      : "Omatree · waking…"
    fixedWidth: root.vertical ? -1 : Math.round(content.implicitWidth + scaledHorizontalMargin * 2)
    fixedHeight: root.vertical ? Math.round(content.implicitHeight + scaledVerticalPadding * 2) : -1

    onPressed: function (buttonCode) {
      if (buttonCode === Qt.LeftButton) root.toggle()
      else if (buttonCode === Qt.MiddleButton && root.serviceReady) {
        root.bonsaiService.waterNow()
        root.splash()
      }
    }

    // The mark, drawn with shapes so it stays crisp at any bar size: a rounded
    // canopy that grows + breathes + sways, a slim trunk, a pot bar. A firefly
    // fades in beside it after dark.
    Item {
      id: content
      anchors.centerIn: parent
      implicitHeight: Math.round(Style.bar.iconSlot * 0.82)
      implicitWidth: Math.round(implicitHeight * 1.45)
      width: implicitWidth
      height: implicitHeight
      opacity: root.serviceReady ? 1 : 0.55
      Behavior on opacity { NumberAnimation { duration: 420; easing.type: Easing.OutCubic } }

      // a single soft swell as the tree wakes (origin at the pot, so it grows up)
      transform: Scale {
        origin.x: content.width / 2
        origin.y: content.height
        xScale: 1 + 0.13 * root.wakePulse
        yScale: 1 + 0.19 * root.wakePulse
      }

      readonly property real u: implicitHeight / 18              // scale unit
      readonly property real trunkW: Math.max(2, 3 * u)
      readonly property real potH: Math.max(2, 2.6 * u)
      readonly property real padH: Math.max(2, 3.2 * u)
      // pruned into pads: 1 when a seedling, 2 young, 3 grown
      readonly property int pads: root.maturity < 0.16 ? 1 : root.maturity < 0.55 ? 2 : 3
      readonly property real trunkH: (content.pads - 1) * content.padH * 0.66 + content.padH * 0.55

      Rectangle {          // pot — wide + shallow
        id: pot
        anchors.horizontalCenter: parent.horizontalCenter
        anchors.bottom: parent.bottom
        width: parent.width * 0.66
        height: content.potH
        radius: Math.min(2 * content.u, height / 2)
        color: root.woodColor
      }
      Rectangle {          // trunk
        id: trunk
        anchors.horizontalCenter: parent.horizontalCenter
        y: pot.y - content.trunkH
        width: content.trunkW
        height: content.trunkH + 1
        color: root.woodColor
      }

      // canopy = stacked pruned pads (bottom widest-ish, top narrowest),
      // alternating a hair left/right for that bonsai asymmetry; they sway,
      // more at the top.
      Repeater {
        model: content.pads
        Rectangle {
          required property int index
          readonly property int fromTop: content.pads - 1 - index
          readonly property real wFactor: [1.0, 0.82, 0.6][Math.min(2, fromTop)]
          width: content.canWFull * wFactor
          height: root.thirstyStill ? content.padH * 0.7 : content.padH
          radius: height / 2
          color: root.canopyColor
          x: parent.width / 2 - width / 2
             + (fromTop % 2 === 0 ? 1 : -1) * content.u
             + root.swayX * (1 + fromTop) * 0.9 * content.u
          y: trunk.y - (fromTop + 1) * content.padH * 0.82 + content.padH * 0.3
          scale: root.thriving ? root.breathe : 1
          transformOrigin: Item.Bottom
          Behavior on x { NumberAnimation { duration: 340; easing.type: Easing.InOutSine } }
          Behavior on width { NumberAnimation { duration: 420; easing.type: Easing.OutCubic } }

          Rectangle {      // darker underside for depth
            anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
            height: parent.height * 0.5
            radius: parent.radius
            color: Qt.darker(root.canopyColor, 1.5)
            opacity: 0.45
          }
        }
      }
      readonly property real canWFull: (root.maturity < 0.16 ? 5
        : root.maturity < 0.55 ? 10 : 13) * content.u

      Rectangle {          // dew glint the moment it wakes
        visible: root.wakePulse > 0.02
        width: Math.max(2, 2.2 * content.u); height: width; radius: width / 2
        x: parent.width / 2 - width / 2
        y: trunk.y - content.pads * content.padH * 0.72
        color: Qt.lighter(root.canopyColor, 1.9)
        opacity: root.wakePulse
      }
      Rectangle {          // sparkle when thriving
        visible: root.thriving && Math.sin(root.phase * 0.6) > 0.9
        width: Math.max(2, 2 * content.u); height: width; radius: width / 2
        x: parent.width * 0.72
        y: trunk.y - content.pads * content.padH * 0.7
        color: Qt.lighter(root.canopyColor, 1.9)
      }
      Rectangle {          // firefly after dark
        visible: root.fireflyNow
        width: Math.max(1.5, 1.7 * content.u); height: width; radius: width / 2
        x: parent.width - width
        y: (trunk.y - content.pads * content.padH)
           + content.pads * content.padH * (0.1 + 0.7 * (0.5 + 0.5 * Math.cos(root.phase * 0.8)))
        color: Qt.rgba(1.0, 0.87, 0.45, root.fireflyTw)
      }
    }
  }
}
