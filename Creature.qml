import QtQuick

// The companion that comes to live in the tree when the Omagotchi bar pet
// (slcode777.omagotchi) is installed. Drawn here in Omatree's own geometric
// hand — no sprite sheet, no sound — so it sits inside the panel and on the
// bar mark without breaking the quiet. Colour and posture follow the pet's
// mood; `phase` is the host's animation clock.
//
// Absent the pet this is never instantiated. It reads nothing itself; the
// host passes `mood` straight through from the pet service.
Item {
  id: g

  property string mood: "happy"     // pet service mood string
  property color tint: "#888888"    // host foreground, for the quiet states
  property color accent: "#7bd88f"  // host accent, for the content states
  property real phase: 0            // host animation clock
  property real unit: 3             // px scale unit

  readonly property bool asleep: mood === "sleeping" || mood === "egg"
  readonly property bool settled: mood === "happy" || mood === "meh"
  readonly property color body: asleep ? Qt.alpha(tint, 0.5)
    : settled ? accent
    : Qt.rgba(0.95, 0.72, 0.32, 1)          // amber when it wants something
  readonly property real bob: asleep ? 0 : Math.sin(phase * 1.1) * unit * 0.5

  implicitWidth: 8 * unit
  implicitHeight: 8 * unit

  Item {
    anchors.centerIn: parent
    width: 8 * g.unit
    height: 8 * g.unit
    transform: Translate { y: g.bob }

    // ears
    Repeater {
      model: 2
      Rectangle {
        required property int index
        width: 2 * g.unit
        height: 2 * g.unit
        radius: width / 2
        color: g.body
        x: parent.width / 2 + (index === 0 ? -3.4 : 1.4) * g.unit
        y: parent.height / 2 - 3.6 * g.unit
      }
    }

    // body
    Rectangle {
      anchors.centerIn: parent
      width: 5.4 * g.unit
      height: 4.8 * g.unit
      radius: width / 2
      color: g.body
    }

    // eye — a dash when asleep, one dot when needy, two when settled
    Row {
      anchors.centerIn: parent
      spacing: g.settled && !g.asleep ? 1.4 * g.unit : 0
      Repeater {
        model: g.settled && !g.asleep ? 2 : 1
        Rectangle {
          width: g.asleep ? 2.4 * g.unit : 1.1 * g.unit
          height: g.asleep ? Math.max(1, 0.5 * g.unit) : 1.1 * g.unit
          radius: height / 2
          color: Qt.darker(g.body, 2.4)
        }
      }
    }

    // a drifting z while it sleeps
    Text {
      visible: g.asleep && Math.sin(g.phase * 0.5) > 0
      text: "z"
      x: parent.width * 0.72
      y: -g.unit + Math.sin(g.phase * 0.5) * g.unit
      color: Qt.alpha(g.tint, 0.6)
      font.pixelSize: Math.max(6, 3.2 * g.unit)
      font.family: "monospace"
    }
  }
}
