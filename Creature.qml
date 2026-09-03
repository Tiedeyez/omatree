import QtQuick
import QtQuick.Effects

// The companion that comes to live in the tree when the Omagotchi bar pet
// (slcode777.omagotchi) is installed.
//
// When we can reach the pet's sprite folder (`petDir`, from its stamped
// manifest.__sourceDir) this is a live snapshot of the actual companion —
// its real 1-bit sprite for its current form, idle / asleep / eating,
// flat-tinted the way Omagotchi tints it. If the sprite can't be found we
// fall back to a geometric glyph drawn in Omatree's own hand, so the strip
// still reads with no hard dependency on the pet's file layout.
//
// No sound, no emote bubbles — the tree's text line carries the mood.
Item {
  id: g

  // --- snapshot inputs (host passes these straight from the pet service) ---
  property string petDir: ""        // absolute dir, from manifest.__sourceDir
  property string form: ""          // e.g. "adult_gremlin"
  property string anim: "idle"      // "idle" | "sleep" | "eat"

  // --- fallback glyph inputs ---
  property string mood: "happy"
  property color tint: "#888888"    // host foreground
  property color accent: "#7bd88f"  // host accent
  property real phase: 0            // host animation clock
  property real unit: 3             // px scale unit

  readonly property bool asleep: anim === "sleep" || mood === "sleeping" || mood === "egg"
  readonly property bool settled: mood === "happy" || mood === "meh"
  readonly property color body: asleep ? Qt.alpha(tint, 0.5)
    : settled ? accent
    : Qt.rgba(0.95, 0.72, 0.32, 1)          // amber when it wants something
  readonly property real bob: asleep ? 0 : Math.sin(phase * 1.1) * unit * 0.5

  implicitWidth: 8 * unit
  implicitHeight: 8 * unit

  // Whether the real sprite is loaded and showing.
  readonly property bool haveSprite: g.petDir !== "" && g.form !== ""
    && sprite.status === Image.Ready

  // ---- the real snapshot ------------------------------------------------
  property string resolvedAnim: anim
  onAnimChanged: resolvedAnim = anim
  onFormChanged: resolvedAnim = anim
  property int frame: 0

  Timer {
    running: g.visible && !g.asleep
    interval: 520
    repeat: true
    onTriggered: g.frame = g.frame === 0 ? 1 : 0
  }

  Image {
    id: sprite
    anchors.fill: parent
    visible: false
    smooth: false
    mipmap: false
    fillMode: Image.PreserveAspectFit
    source: (g.petDir === "" || g.form === "") ? "" :
      "file://" + g.petDir + "/assets/sprites/" + g.form + "_" + g.resolvedAnim
      + "_" + (g.frame === 0 ? "a" : "b") + ".png"
    // Missing anim for this form -> fall back to idle, which every form ships.
    onStatusChanged: if (status === Image.Error && g.resolvedAnim !== "idle")
      Qt.callLater(function () { g.resolvedAnim = "idle" })
  }

  MultiEffect {
    anchors.fill: sprite
    source: sprite
    visible: g.haveSprite
    colorization: 1
    colorizationColor: g.body
    transform: Translate { y: g.bob }
  }

  // ---- geometric fallback --------------------------------------------
  Item {
    anchors.centerIn: parent
    width: 8 * g.unit
    height: 8 * g.unit
    visible: !g.haveSprite
    transform: Translate { y: g.bob }

    Repeater {          // ears
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

    Rectangle {         // body
      anchors.centerIn: parent
      width: 5.4 * g.unit
      height: 4.8 * g.unit
      radius: width / 2
      color: g.body
    }

    Row {               // eye(s)
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
  }

  // a drifting z while it sleeps, over whichever body is showing
  Text {
    visible: g.asleep && Math.sin(g.phase * 0.5) > 0
    text: "z"
    x: parent.width * 0.72
    y: (parent.height / 2 - 3 * g.unit) + Math.sin(g.phase * 0.5) * g.unit
    color: Qt.alpha(g.tint, 0.6)
    font.pixelSize: Math.max(6, 3.2 * g.unit)
    font.family: "monospace"
  }
}
