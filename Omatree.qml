import QtQuick
import Quickshell
import qs.Commons
import qs.Ui
import "TreeGen.js" as TreeGen
import "Grow.js" as Grow
import "Paint.js" as Paint
import "Raster.js" as Raster

// The tree as a higher-res pixel-art turntable model. Grow.js builds a 3D
// skeleton from the machine seed; Paint.js projects + shades it into a draw
// list; Raster.js encodes that as a BMP data URL for a plain <Image>, shown
// scaled up with smooth:false for the chunky pixel look (Quickshell has no
// working QtQuick Canvas). The phase timer re-encodes only the foliage wobble;
// the trunk ops don't change frame to frame, so it stays dead still.
// Drag left/right to spin it; it holds the angle (persisted by the Service).
Item {
  id: root

  property var tree: null                 // treeSpec from Service.qml
  property bool forceFront: false
  property bool inHousing: false
  property color tint: Color.accent
  property color textColor: Color.foreground
  property color bgColor: Qt.rgba(0.06, 0.07, 0.08, 1)
  property bool active: true
  // Out on the wallpaper rather than inside the panel. This is about the
  // viewpoint, not the yaw lock: the desktop tree still turns (middle-drag), so
  // it cannot key off forceFront.
  property bool onDesktop: false
  readonly property real renderYaw: root.forceFront ? 0 : root.yaw
  // The desktop keeps a flatter, more front-on viewpoint so it reads like a
  // person standing in front of the tree rather than peeking in from the side.
  readonly property real renderPitch: root.inHousing ? 0.34 : (root.onDesktop ? 0.12 : 0.26)
  readonly property real housingScale: root.inHousing ? 1.08 : 1.0
  // Render on a transparent RGBA buffer (the on-desktop ornament) so the
  // wallpaper shows through the empty bed and the glass case. Opaque BMP by
  // default, matching the panel's solid HUD background.
  property bool transparent: false
  // Keep the desktop layer transparent around the tree while making each
  // rendered tree pixel a solid surface.
  property bool solidObject: false

  // device pixels per art-pixel — the chunk size
  readonly property int artScale: 2
  property real artUnits: 2.6              // art-px per Grow art-unit
  // A shallow zoom: it scales the art RESOLUTION, not the finished image, so
  // the pixels stay square and crisp at every step — and pulling out is how
  // you see a tall old tree whole when the panel can no longer grow for it.
  property real zoom: 1
  readonly property real minZoom: 0.62
  readonly property real maxZoom: 1.30
  readonly property real artScaleUnits: root.artUnits * root.zoom
  signal zoomChanged2(real z)
  function stepZoom(dir) {
    var z = Math.max(root.minZoom, Math.min(root.maxZoom,
      root.zoom * (dir > 0 ? 1.08 : 1 / 1.08)))
    if (Math.abs(z - root.zoom) < 0.0005) return
    root.zoom = z
    root.zoomChanged2(z)
  }
  onZoomChanged: { root._recomputeSize(); root.fullFrame() }

  // hand-pruning
  property bool pruneMode: false
  signal pruneRequested(string id)
  onPruneModeChanged: if (!pruneMode) root.kbPrune = -1
  // turntable — emitted on drag release / step so the Service can persist it
  signal orbitChanged(real yaw)

  // keyboard trim: which prune cluster the key cursor sits on (-1 = none).
  // Panel.qml drives this through its key catcher.
  property int kbPrune: -1
  function kbPruneCycle(step) {
    var n = root.hitAreas.length
    if (n === 0) return
    root.kbPrune = root.kbPrune < 0 ? (step < 0 ? n - 1 : 0)
      : (((root.kbPrune + (step < 0 ? -1 : 1)) % n) + n) % n
  }
  function kbPruneCut() {
    if (root.kbPrune < 0 || root.kbPrune >= root.hitAreas.length) return
    var r = root.hitAreas[root.kbPrune]
    root.pruneRequested(r.id)
    leaves.burst((r.x + r.w / 2) * root.artScale, (r.y + r.h / 2) * root.artScale, root.palette.frond)
    snipAnim.restart()
    root.kbPrune = 0        // the map rebuilds; land the cursor somewhere valid
  }

  readonly property bool isLight: {
    var c = root.bgColor
    return (0.299 * c.r + 0.587 * c.g + 0.114 * c.b) > 0.5
  }

  // ---- palette: a plant tinted to the running theme -------------------
  function _mixHue(base, target, t) {
    var d = target - base
    if (d > 0.5) d -= 1; else if (d < -0.5) d += 1
    return ((base + d * t) % 1 + 1) % 1
  }
  function _rgb(c) { return { r: c.r, g: c.g, b: c.b } }
  readonly property var palette: {
    var a = root.tint
    var lite = root.isLight
    var aSat = a.hsvSaturation
    var grey = aSat < 0.14
    var ah = grey ? 0.33 : a.hsvHue
    var leafH = grey ? 0.32 : root._mixHue(0.30, ah, 0.34)
    var frond = Qt.hsva(leafH, grey ? 0.14 : (lite ? 0.62 : 0.52), lite ? 0.54 : 0.80, 1)
    var woodH = grey ? 0.07 : root._mixHue(0.075, ah, 0.14)
    var trunk = Qt.hsva(woodH, grey ? 0.08 : 0.36, lite ? 0.46 : 0.56, 1)
    // Earthen terracotta, warm and distinct from the trunk/roots so it reads as
    // a deliberate pot rather than a continuation of the wood mass. The active
    // theme is allowed to tint it only very slightly.
    var potC = Qt.rgba(
      0.71 + 0.10 * a.r,
      0.46 + 0.10 * a.g,
      0.33 + 0.10 * a.b, 1)
    var soil = Qt.hsva(woodH, grey ? 0.10 : 0.24, lite ? 0.40 : 0.34, 1)
    var u = Color.urgent
    var fruit = Qt.hsva(u.hsvSaturation < 0.12 ? leafH : u.hsvHue, 0.55, lite ? 0.72 : 0.9, 1)
    return {
      frond: root._rgb(frond), trunk: root._rgb(trunk), pot: root._rgb(potC),
      soil: root._rgb(soil), fruit: root._rgb(fruit)
    }
  }
  onPaletteChanged: root.fullFrame()

  // ---- time of day ---------------------------------------------------
  property var sun: Paint.sunForTime(12, 0)
  // The sun's position comes from the machine's own clock and timezone —
  // nothing is fetched, and nothing needs to be. Paint does the shading from it
  // (and from lampDir() when the lamp is on); the fx layer no longer needs a
  // screen-space light vector of its own, because the light effect is glitter
  // sitting on the canopy rather than beams raked in from an angle. lightX /
  // lightY / rayAngle / beamTone went with the shafts.
  readonly property bool lampLit: !!(root.tree && root.tree.lamp === true)
  readonly property bool sunUp: !(root.sun && root.sun.night)
  // What the glitter is made of. Daylight is warm, the dark is cold and thin —
  // but a lit grow lamp is its own warm source, not moonlight, so it must not
  // fall through to the night tone just because the sun is down.
  readonly property color moteTone: root.sunUp ? "#fff3c9" : (root.lampLit ? "#ffeccb" : "#dbe8ff")
  readonly property bool litBright: root.sunUp || root.lampLit
  function refreshSun() {
    var dc = root.tree && root.tree.devClock !== undefined ? root.tree.devClock : -1
    var h, mi
    if (dc >= 0) { h = Math.floor(dc); mi = Math.round((dc - h) * 60) }
    else { var d = new Date(); h = d.getHours(); mi = d.getMinutes() }
    root.sun = Paint.sunForTime(h, mi)
  }
  Timer {
    interval: 60000; repeat: true; running: true
    onTriggered: { root.refreshSun(); root.fullFrame() }
  }

  // ---- skeleton --------------------------------------------------
  property var gen: null
  property var skeleton: null
  property string _builtKey: ""
  property string _prevOrigin: ""

  onTreeChanged: root.rebuild()
  onInHousingChanged: root.rebuild()
  onArtUnitsChanged: root.rebuild()
  Component.onCompleted: root.rebuild()

  function _bucket(v, step) { return Math.round((v || 0) / step) }

  function rebuild() {
    if (!root.tree) { root.skeleton = null; return }
    var t = root.tree
    if (t.gen) root.gen = t.gen
    else if (!root.gen || root.gen.seed !== t.seed)
      root.gen = TreeGen.genesis("seed:" + t.seed, "seed:" + t.seed)
    if (t.style) root.gen.style = t.style
    if (t.genus) root.gen.genus = t.genus

    if (!root.dragging && !yawAnim.running) {
      root.yawTarget = root.normalizeYaw(t.yaw || 0)
      root.yaw = root.yawTarget
    }
    root.refreshSun()

    var key = [t.seed, root.gen.style, root._bucket(t.maturity, 0.015),
      root._bucket(t.ageYears || 0, 0.15), root._bucket(t.thirst, 0.12),
      root._bucket(t.health, 0.12), t.origin || "", JSON.stringify(t.prune || {})].join("|")
    key += "|" + (t.fruit === true ? "fruit" : "no-fruit")
    var fresh = key.split("|")[0] !== root._builtKey.split("|")[0]
      || (t.origin || "") !== root._prevOrigin
    if (key !== root._builtKey) {
      root._builtKey = key
      root.skeleton = Grow.grow(root.gen, {
        maturity: t.maturity || 0, ageYears: t.ageYears || 0,
        thirst: t.thirst || 0, health: (t.health === 0 || t.health > 0) ? t.health : 1,
        prune: t.prune || {}, origin: t.origin || "", weather: t.weather || {},
        fruit: t.fruit === true
      })
      root._recomputeSize()
    }
    // "types itself in" from the soil up — once per panel open (and on a fresh
    // planting), never on a routine growth tick
    if (fresh && (t.origin || "") !== "") {
      root.reveal = 0
      growAnim.restart()
    }
    root._prevOrigin = t.origin || ""
    root.fullFrame()
  }

  // ---- dynamic size: grows with the tree, capped -------------------
  // hard ceiling in art-px; Panel also clamps the house to ~half the screen.
  property real maxArtH: 360
  property int artW: 90
  property int artH: 150
  property real originX: 45
  property real originY: 140
  function _recomputeSize() {
    if (!root.skeleton) return
    var mz = Paint.measureStable(root.skeleton, {
      art: root.artScaleUnits, showCase: root.inHousing, yaw: root.renderYaw,
      pitch: root.renderPitch
    })
    root.artW = Math.max(40, Math.min(root.maxArtH * 0.9, mz.w))
    root.artH = Math.max(40, Math.min(root.maxArtH, mz.h))
    root.originX = mz.originX + (root.artW - mz.w) / 2
    root.originY = Math.min(mz.originY, root.artH - 2)
  }

  implicitWidth: root.artW * root.artScale
  implicitHeight: root.artH * root.artScale

  // ---- turntable ------------------------------------------------
  property real yaw: 0
  property real yawTarget: 0
  property bool dragging: false
  property real _lastX: 0
  readonly property real yawStep: Math.PI / 6      // 30° per wheel-click / arrow

  function normalizeYaw(value) {
    return ((value % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)
  }

  function shortestYawTarget(from, target) {
    var delta = root.normalizeYaw(target) - root.normalizeYaw(from)
    if (delta > Math.PI) delta -= 2 * Math.PI
    if (delta < -Math.PI) delta += 2 * Math.PI
    return from + delta
  }

  function animateToYaw(target) {
    if (!root.skeleton) return
    root.yawTarget = root.shortestYawTarget(root.yaw, target)
    if (root.dragging) return
    yawAnim.stop()
    yawAnim.from = root.yaw
    yawAnim.to = root.yawTarget
    yawAnim.start()
  }

  // stepped rotate (scroll-wheel click, keyboard ← →): ease to the new angle,
  // then normalise + persist once it settles. onYawChanged pushes each step
  // through the render pacer; the rebuild guard below keeps a persisted (mod
  // 2π) yaw from snapping the property mid-animation.
  NumberAnimation {
    id: yawAnim
    target: root; property: "yaw"; duration: 220; easing.type: Easing.OutCubic
    onFinished: {
      root.yaw = root.normalizeYaw(root.yaw)
      root.yawTarget = root.normalizeYaw(root.yawTarget)
      root.orbitChanged(root.yaw)
    }
  }
  function stepYaw(dir) {
    if (!root.skeleton) return
    root.animateToYaw(root.yaw + (dir < 0 ? -root.yawStep : root.yawStep))
  }

  // ---- grow-in reveal ----------------------------------------------
  property real reveal: 1
  NumberAnimation {
    id: growAnim
    target: root; property: "reveal"; from: 0; to: 1
    duration: 2400; easing.type: Easing.OutCubic
  }
  onRevealChanged: root.frame()

  // ---- phase clock: gentle foliage shimmer ---------------------
  // Low rate + double-buffered images (below), so re-encoding the frame never
  // blanks the picture. Off while dragging and while the panel is hidden.
  property real phase: 0
  Timer {
    id: lifeTimer
    interval: 260; repeat: true
    running: root.active && root.animate && !!root.skeleton && !root.dragging
    onTriggered: { root.phase += 0.26; root.frame() }
  }
  // A touch of ambient sparkle while the sun is out and the light is actually on.
  // It stays subtle so the tree feels alive without turning into a lens flare.
  //
  // Except while the bar pet is asleep, when the tree keeps still and does not
  // sparkle at all. Nothing says so, and nothing about the pet changes — this
  // side simply reads that it is sleeping and lets it sleep.
  Timer {
    interval: 300000; repeat: true
    running: root.active && root.sunUp && !!root.skeleton && !!root.tree
      && root.tree.lamp === true && !root.dragging
      && root.tree.companionAsleep !== true
    onTriggered: fx.light(true)
  }
  property bool animate: true
  onActiveChanged: if (root.active) root.fullFrame()

  // ---- the frame: build the draw list, re-encode the image -------
  property var hitAreas: []
  function _view() {
    return {
      yaw: root.renderYaw, pitch: root.renderPitch, showCase: root.inHousing,
      art: root.artScaleUnits,
      w: root.artW, h: root.artH, originX: root.originX, originY: root.originY,
      sun: root.sun, lamp: root.tree && root.tree.lamp === true,
      palette: root.palette, time: root.animate ? root.phase : 0
    }
  }
  // ---- render pacing --------------------------------------------
  // Paint.build + the BMP re-encode is ~15-25ms of main-thread JS. A drag or a
  // held arrow key can ask for far more frames than that budget allows, so the
  // requests are coalesced onto a timer: render at once when idle, then hold
  // any further requests until the next tick. Rotation stays smooth instead of
  // encodes queuing up and stalling pointer input.
  property bool _dirty: false
  // Pace to what this machine can actually encode instead of a fixed ceiling.
  // A hardcoded 33ms throws away real smoothness on a box that encodes a frame
  // in 12ms, and still queues up on one that needs 45 — the cost is paid during
  // exactly the gestures that need to be fluid: dragging and stepping the
  // turntable. Measured per frame, smoothed, and quantised so the binding is
  // not re-evaluated on every single encode.
  property real _encodeMs: 24
  readonly property int minFrameInterval: 8
  readonly property int maxFrameInterval: 48
  readonly property int frameInterval: {
    var q = Math.round((root._encodeMs * 1.15) / 4) * 4
    return Math.max(root.minFrameInterval, Math.min(root.maxFrameInterval, q))
  }
  Timer {
    id: renderTimer
    interval: root.frameInterval; repeat: false
    onTriggered: {
      if (!root._dirty) return
      root._dirty = false
      root._encode()
      renderTimer.start()                          // keep pacing while updates keep coming
    }
  }
  function requestFrame() {
    if (!root.skeleton) { imgA.source = ""; imgB.source = ""; return }
    if (renderTimer.running) { root._dirty = true; return }
    root._encode()
    renderTimer.start()
  }
  // names the rest of the component (and Panel.qml) already call
  function frame() { root.requestFrame() }
  function fullFrame() { root.requestFrame() }

  // The foliage sways ~4 times a second, forever, in every visible view. Paint
  // has always split the draw list into a static half (pot, soil, trunk, thick
  // branches) and a leaf half, and its own header says the static half should
  // "repaint rarely" — but _encode concatenated the two and re-rasterised the
  // whole tree every tick, redrawing a trunk and a pot that had not moved.
  //
  // The static half is now rasterised once and cached WITH ITS Z-BUFFER, and
  // each wobble paints only the leaves onto a copy of it. Carrying the z-buffer
  // is what makes this exact rather than merely close: about a third of the leaf
  // ops are depth-tested twigs that occlude against the trunk, and a fresh
  // z-buffer loses that silently. Verified byte-identical to the single pass
  // across both encoders, five yaws, two scales and three grow-in values.
  property var _bake: null
  property string _bakeKey: ""
  function _bakeKeyFor(v) {
    // everything the STATIC half depends on. `time` is deliberately absent —
    // that is the wobble, and it only moves leaves.
    return [root._builtKey, v.yaw, v.pitch, v.art, v.w, v.h, v.originX, v.originY,
            v.showCase, v.lamp, root.reveal, root.transparent, root.solidObject,
            String(root.bgColor), JSON.stringify(v.palette), JSON.stringify(v.sun)].join("|")
  }

  function _encode() {
    if (!root.skeleton) { imgA.source = ""; imgB.source = ""; return }
    var _t0 = Date.now()
    var v = root._view()
    var dl = Paint.build(root.skeleton, v)
    root.hitAreas = dl.hitAreas || []
    var key = root._bakeKeyFor(v)
    var url
    if (root.transparent) {
      if (!root._bake || key !== root._bakeKey) {
        root._bake = Raster.bakeRGBA(Paint, dl.staticOps,
          root.artW, root.artH, root.reveal, root.solidObject)
        root._bakeKey = key
      }
      url = Raster.overPngUrl(Paint, dl.leafOps,
        root.artW, root.artH, root._bake, root.solidObject, root.reveal)
    } else {
      var bg = [Math.round(root.bgColor.r * 255), Math.round(root.bgColor.g * 255), Math.round(root.bgColor.b * 255)]
      if (!root._bake || key !== root._bakeKey) {
        root._bake = Raster.bake(Paint, dl.staticOps, root.artW, root.artH, bg, root.reveal)
        root._bakeKey = key
      }
      url = Raster.overUrl(Paint, dl.leafOps, root.artW, root.artH, root._bake, root.reveal)
    }
    // hand the URL to whichever buffer is currently hidden; it flips visible
    // once decoded, so there is always a finished frame on screen
    if (root._front === 0) imgB.source = url
    else imgA.source = url
    root._encodeMs = root._encodeMs * 0.75 + (Date.now() - _t0) * 0.25
  }
  onYawChanged: root.requestFrame()

  property int _front: 0     // which buffer is showing (0=A, 1=B)

  // ---- the picture: two art-res buffers, scaled up nearest -----
  Item {
    id: stage
    width: root.artW * root.artScale
    height: root.artH * root.artScale
    anchors.horizontalCenter: parent.horizontalCenter
    anchors.bottom: parent.bottom
    scale: root.housingScale
    transformOrigin: Item.Bottom

    Image {
      id: imgA
      anchors.fill: parent
      smooth: false; mipmap: false; fillMode: Image.Stretch
      cache: false; asynchronous: false
      visible: root._front === 0
      onStatusChanged: if (status === Image.Ready) root._front = 0
    }
    Image {
      id: imgB
      anchors.fill: parent
      smooth: false; mipmap: false; fillMode: Image.Stretch
      cache: false; asynchronous: false
      visible: root._front === 1
      onStatusChanged: if (status === Image.Ready) root._front = 1
    }

    // ---- tiny, algorithmic bumble bees ---------------------------
    // Bees only find the tree when it is out on the wallpaper. Inside the panel
    // it is indoors, and a bee in there would be a bug in the room.
    Item {
      id: beeLayer
      anchors.fill: parent
      visible: root.onDesktop && root.active && !!root.skeleton
      property string dayKey: ""
      property int visitsToday: 0
      property int maxVisitsPerDay: 4
      function todayStamp() {
        var d = new Date()
        return d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate()
      }
      function maybeVisit() {
        var key = beeLayer.todayStamp()
        if (beeLayer.dayKey !== key) {
          beeLayer.dayKey = key
          beeLayer.visitsToday = 0
        }
        if (beeLayer.visitsToday >= beeLayer.maxVisitsPerDay || !root.onDesktop) return
        if (Math.random() < 0.22) {
          var bee = beePool.itemAt(beeLayer.visitsToday % beePool.count)
          if (bee && !bee.busy) {
            bee.launch()
            beeLayer.visitsToday += 1
          }
        }
      }
      Timer {
        interval: 180000
        repeat: true
        running: beeLayer.visible
        onTriggered: beeLayer.maybeVisit()
      }
      Repeater {
        id: beePool
        model: 3
        Item {
          id: bee
          width: 10; height: 8
          visible: false
          property bool busy: false
          property real startX: 0
          property real startY: 0
          property real endX: 0
          property real endY: 0
          function launch() {
            bee.busy = true
            bee.visible = true
            bee.startX = Math.random() * (parent.width - width)
            bee.startY = 8 + Math.random() * (parent.height * 0.5)
            bee.endX = bee.startX + (-18 + Math.random() * 36)
            bee.endY = bee.startY + (-16 + Math.random() * 28)
            beeAnim.restart()
          }
          Rectangle {
            x: 2; y: 1; width: 3; height: 3; radius: 1.5
            color: "#f3d75e"
            antialiasing: false
          }
          Rectangle {
            x: 4; y: 2; width: 3; height: 2; radius: 1
            color: "#1a1b1e"
            antialiasing: false
          }
          Rectangle {
            x: 0; y: 1; width: 2; height: 1.5; radius: 0.75
            color: "#f6f1d8"
            antialiasing: false
            rotation: 22
          }
          Rectangle {
            x: 5; y: 1; width: 2; height: 1.5; radius: 0.75
            color: "#f6f1d8"
            antialiasing: false
            rotation: -22
          }
          SequentialAnimation {
            id: beeAnim
            ParallelAnimation {
              NumberAnimation { target: bee; property: "x"; from: bee.startX; to: bee.endX; duration: 2000; easing.type: Easing.InOutSine }
              NumberAnimation { target: bee; property: "y"; from: bee.startY; to: bee.endY; duration: 2000; easing.type: Easing.InOutSine }
              NumberAnimation { target: bee; property: "opacity"; from: 0.75; to: 1; duration: 260; easing.type: Easing.OutQuad }
            }
            NumberAnimation { target: bee; property: "opacity"; to: 0; duration: 240; easing.type: Easing.InQuad }
            ScriptAction { script: { bee.visible = false; bee.busy = false; bee.opacity = 1 } }
          }
        }
      }
    }

    // ---- effects the panel triggers on a care action -------------
    Item {
      id: fx
      anchors.fill: parent
      // The beams are longer than the view so they can cross it completely;
      // clipping keeps them on the tree instead of raking over the readouts.
      clip: true
      // Water comes from above the canopy, falls THROUGH the tree, and lands —
      // each drop finishes on the soil with a small ring rather than dissolving
      // in mid-air. Staggered arrivals so it reads as a pour and not a pulse.
      function water() {
        var soil = fx.height * 0.74
        for (var i = 0; i < dropPool.count; i++) {
          var d = dropPool.itemAt(i)
          if (!d || d.live) continue
          var px = fx.width * (0.24 + 0.52 * Math.random())
          // the soil mounds in the middle, so drops at the edges land lower
          var edge = Math.abs(px / fx.width - 0.5) * 2
          d.fire(px, -10 - Math.random() * 34, soil + edge * fx.height * 0.04,
                 i * 42 + Math.random() * 55)
        }
      }
      // Feeding is two halves, and the second is the point: granules land on the
      // soil, then the tree TAKES THEM UP — motes rising out of the soil, climbing
      // the trunk, fading out into the canopy.
      function feed() {
        var soil = fx.height * 0.76
        for (var i = 0; i < grainPool.count; i++) {
          var g = grainPool.itemAt(i)
          if (!g || g.live) continue
          var gx = fx.width * (0.33 + 0.34 * Math.random())
          g.fire(gx, soil - 30 - Math.random() * 18, soil + Math.random() * 6, i * 38)
        }
        for (var j = 0; j < glintPool.count; j++) {
          var q = glintPool.itemAt(j)
          if (!q || q.live) continue
          q.fire(fx.width * (0.40 + 0.20 * Math.random()), soil, 340 + j * 66)
        }
      }
      function milestone() { washAnim.restart() }

      // Light let in — glitter, not beams. There used to be long raked shafts
      // crossing the whole frame at the sun's angle, with dust riding down
      // them; the bars read as an effect laid OVER the tree rather than as
      // light on it. Now it is only the sparkle: points catching the light all
      // over the canopy, winking, and going out. Nothing sweeps across.
      //
      // ambient = the idle sparkle the tree throws off on its own, at a
      // fraction of the count. A light() the user actually asked for always
      // plays at full strength.
      function light(ambient) {
        // Land the sparks ON THE FOLIAGE. Scattering across fx's own box — even
        // biased toward the middle — still fills a rectangle, and a rectangle of
        // glitter around a tree just draws a box. hitAreas are the screen rects
        // of the actual foliage clumps (the same ones trim mode offers you), so
        // picking a clump and a point inside it means the sparkle follows the
        // tree's real shape and never lights an empty corner.
        var areas = root.hitAreas
        var s = root.artScale
        // Occasional, not a burst: a handful of points, spread over a couple of
        // seconds, so it twinkles rather than flashes.
        var budget = ambient === true ? 4 : 12
        var n = 0
        for (var i = 0; i < motePool.count && n < budget; i++) {
          var m = motePool.itemAt(i)
          if (!m || m.live) continue
          var px, py
          if (areas && areas.length > 0) {
            var r = areas[Math.floor(Math.random() * areas.length)]
            px = (r.x + Math.random() * r.w) * s
            py = (r.y + Math.random() * r.h) * s
          } else {
            // no clump map yet (a bare sprout): keep it tight to the middle
            px = fx.width * (0.35 + 0.30 * Math.random())
            py = fx.height * (0.20 + 0.30 * Math.random())
          }
          m.fire(px, py, Math.random() * 1800)
          n++
        }
      }

      // The grow lamp used to also paint a warm pool over the tree. QML
      // Rectangle gradients are linear only, so that pool was a full-width box
      // with hard left, right and bottom edges — it read as a lit rectangle
      // sitting around the tree rather than as light. Removed: the lamp still
      // lights the tree properly through Paint's shading (lampDir(), from
      // overhead), and the only thing the fx layer adds now is the glitter.


      // The glitter itself. Each spark appears somewhere on the canopy, drifts
      // barely at all — it is a catch of light, not a falling particle — winks
      // several times and goes out. Staggered starts are what make it read as
      // sparkle rather than as one synchronised flash.
      Repeater {
        id: motePool
        model: 46
        Rectangle {
          id: mote
          required property int index
          property bool live: false
          property real _tx: 0
          property real _ty: 0
          width: 1 + (mote.index % 3); height: width
          radius: width > 2 ? 1 : 0
          visible: live; opacity: 0
          color: root.moteTone
          antialiasing: false
          function fire(px, py, delay) {
            live = true
            x = px; y = py
            // a hair of drift, so it shimmers in place instead of travelling
            mote._tx = px + (Math.random() - 0.5) * 9
            mote._ty = py + (Math.random() - 0.5) * 7
            moteHold.duration = delay
            moteAnim.restart()
          }
          SequentialAnimation {
            id: moteAnim
            PauseAnimation { id: moteHold; duration: 0 }
            ParallelAnimation {
              NumberAnimation { target: mote; property: "x"; to: mote._tx; duration: 900; easing.type: Easing.InOutSine }
              NumberAnimation { target: mote; property: "y"; to: mote._ty; duration: 900; easing.type: Easing.InOutSine }
              SequentialAnimation {
                NumberAnimation { target: mote; property: "opacity"; from: 0; to: root.litBright ? 1.0 : 0.66; duration: 110; easing.type: Easing.OutQuad }
                // the wink: quick and uneven, which is what glitter looks like
                SequentialAnimation {
                  loops: 3
                  NumberAnimation { target: mote; property: "opacity"; to: root.litBright ? 0.16 : 0.10; duration: 105 }
                  NumberAnimation { target: mote; property: "opacity"; to: root.litBright ? 1.0 : 0.66; duration: 105 }
                }
                NumberAnimation { target: mote; property: "opacity"; to: 0; duration: 180; easing.type: Easing.InQuad }
              }
            }
            ScriptAction { script: mote.live = false }
          }
        }
      }

      Repeater {
        id: dropPool
        model: 22
        Item {
          id: drop
          property bool live: false
          property real _landY: 0
          width: 3; height: 8
          visible: live
          function fire(px, py, landY, delay) {
            live = true
            x = px; y = py
            drop._landY = landY
            streak.opacity = 0
            splash.opacity = 0
            dropHold.duration = delay
            fallAnim.duration = 500 + Math.random() * 280
            dAnim.restart()
          }
          Rectangle {
            id: streak
            width: 2; height: parent.height; radius: 1
            color: root.isLight ? "#3a6ea8" : "#8fc7ff"
            opacity: 0
            antialiasing: false
          }
          Rectangle {
            id: splash
            x: -4; y: parent.height - 3
            width: 11; height: 4; radius: 2
            color: "transparent"
            border.width: 1
            border.color: root.isLight ? "#3a6ea8" : "#a8d8ff"
            opacity: 0
            transformOrigin: Item.Center
          }
          SequentialAnimation {
            id: dAnim
            PauseAnimation { id: dropHold; duration: 0 }
            ParallelAnimation {
              NumberAnimation { id: fallAnim; target: drop; property: "y"; to: drop._landY; duration: 600; easing.type: Easing.InQuad }
              NumberAnimation { target: streak; property: "opacity"; to: 0.9; duration: 110 }
            }
            ScriptAction { script: streak.opacity = 0 }
            ParallelAnimation {
              NumberAnimation { target: splash; property: "opacity"; from: 0.85; to: 0; duration: 380; easing.type: Easing.OutQuad }
              NumberAnimation { target: splash; property: "scale"; from: 0.4; to: 1.7; duration: 380; easing.type: Easing.OutQuad }
            }
            ScriptAction { script: drop.live = false }
          }
        }
      }
      // feed, part one: granules dropped onto the soil
      Repeater {
        id: grainPool
        model: 12
        Rectangle {
          id: grain
          property bool live: false
          property real _ty: 0
          width: 2; height: 2
          visible: live; opacity: 0
          color: Qt.rgba(root.tint.r * 0.62 + 0.24, root.tint.g * 0.62 + 0.20, root.tint.b * 0.44 + 0.12, 1)
          antialiasing: false
          function fire(px, py, ty, delay) {
            live = true; x = px; y = py; grain._ty = ty
            grainHold.duration = delay
            grainAnim.restart()
          }
          SequentialAnimation {
            id: grainAnim
            PauseAnimation { id: grainHold; duration: 0 }
            ParallelAnimation {
              NumberAnimation { target: grain; property: "y"; to: grain._ty; duration: 300; easing.type: Easing.InQuad }
              NumberAnimation { target: grain; property: "opacity"; from: 0; to: 0.95; duration: 120 }
            }
            NumberAnimation { target: grain; property: "opacity"; to: 0; duration: 430; easing.type: Easing.InQuad }
            ScriptAction { script: grain.live = false }
          }
        }
      }
      // feed, part two: the uptake — out of the soil and up into the canopy
      Repeater {
        id: glintPool
        model: 14
        Rectangle {
          id: glint
          property bool live: false
          property real _tx: 0
          property real _ty: 0
          width: 2; height: 2; radius: 1
          visible: live; opacity: 0
          color: root.tint
          antialiasing: false
          function fire(px, py, delay) {
            live = true; x = px; y = py
            glint._tx = px + (Math.random() - 0.5) * 28
            glint._ty = py - fx.height * (0.34 + 0.26 * Math.random())
            glintHold.duration = delay
            gAnim.restart()
          }
          SequentialAnimation {
            id: gAnim
            PauseAnimation { id: glintHold; duration: 0 }
            ParallelAnimation {
              NumberAnimation { target: glint; property: "y"; to: glint._ty; duration: 1150; easing.type: Easing.OutQuad }
              NumberAnimation { target: glint; property: "x"; to: glint._tx; duration: 1150; easing.type: Easing.InOutSine }
              SequentialAnimation {
                NumberAnimation { target: glint; property: "opacity"; from: 0; to: 0.95; duration: 220 }
                PauseAnimation { duration: 500 }
                NumberAnimation { target: glint; property: "opacity"; to: 0; duration: 430; easing.type: Easing.InQuad }
              }
            }
            ScriptAction { script: glint.live = false }
          }
        }
      }
      Rectangle {
        id: wash
        anchors.fill: parent
        color: root.tint; opacity: 0
        SequentialAnimation {
          id: washAnim
          NumberAnimation { target: wash; property: "opacity"; from: 0; to: 0.18; duration: 160; easing.type: Easing.OutQuad }
          NumberAnimation { target: wash; property: "opacity"; to: 0; duration: 1000; easing.type: Easing.OutQuad }
        }
      }
    }

    // ---- turntable drag ------------------------------------------
    MouseArea {
      id: spinMa
      anchors.fill: parent
      enabled: !root.pruneMode && !!root.skeleton
      acceptedButtons: Qt.LeftButton | Qt.MiddleButton
      cursorShape: pressed ? Qt.ClosedHandCursor : Qt.OpenHandCursor
      onWheel: function (w) {
        // Scroll is the shallow zoom; the wheel CLICK still steps the
        // turntable, so both gestures live on the same hand.
        root.stepZoom(w.angleDelta.y > 0 ? 1 : -1)
        w.accepted = true
      }
      onPressed: function (m) {
        // scroll-wheel click steps the turntable one notch
        if (m.button === Qt.MiddleButton) { root.stepYaw(1); return }
        yawAnim.stop()
        root.dragging = true; root._lastX = m.x
      }
      onPositionChanged: function (m) {
        if (!root.dragging) return
        root.yawTarget += (m.x - root._lastX) * 0.013
        root.yaw = root.yawTarget
        root._lastX = m.x
        root.fullFrame()
      }
      onReleased: {
        if (root.dragging) {
          root.dragging = false
          root.yawTarget = root.normalizeYaw(root.yawTarget)
          root.yaw = root.yawTarget
          root.orbitChanged(root.yaw)
          root.fullFrame()
        }
      }
      onCanceled: {
        root.dragging = false
        root.yawTarget = root.normalizeYaw(root.yawTarget)
        root.yaw = root.yawTarget
      }
    }

    // ---- prune overlay: click a foliage cluster to trim it -------
    Item {
      id: pruneLayer
      anchors.fill: parent
      visible: root.pruneMode && !!root.skeleton
      property int hoveredIndex: -1

      function rectAt(px, py) {
        var best = -1, bestD = 1e9
        var s = root.artScale
        for (var i = 0; i < root.hitAreas.length; i++) {
          var r = root.hitAreas[i]
          var x0 = r.x * s - 4, x1 = (r.x + r.w) * s + 4
          var y0 = r.y * s - 4, y1 = (r.y + r.h) * s + 4
          if (px < x0 || px > x1 || py < y0 || py > y1) continue
          var cx = (r.x + r.w / 2) * s, cy = (r.y + r.h / 2) * s
          var d = Math.abs(px - cx) + Math.abs(py - cy)
          if (d < bestD) { bestD = d; best = i }
        }
        return best
      }

      Repeater {
        model: root.pruneMode ? root.hitAreas : []
        Rectangle {
          required property var modelData
          required property int index
          readonly property bool hot: pruneLayer.hoveredIndex === index || root.kbPrune === index
          x: modelData.x * root.artScale - 3
          y: modelData.y * root.artScale - 3
          width: modelData.w * root.artScale + 6
          height: modelData.h * root.artScale + 6
          radius: 3
          color: hot ? Qt.alpha(root.tint, 0.16) : "transparent"
          border.width: 1
          border.color: hot ? Qt.alpha(root.tint, 0.85) : Qt.alpha(root.textColor, 0.28)
          Behavior on color { ColorAnimation { duration: 110 } }
          Behavior on border.color { ColorAnimation { duration: 110 } }
        }
      }


      Item {
        id: snip
        width: 14; height: 16; z: 20
        x: trackMa.mouseX - 7
        y: trackMa.mouseY - 8
        visible: trackMa.containsMouse
        QtObject { id: snipOpen; property real a: 15 }
        Rectangle { x: 6; y: 0; width: 2; height: 9; radius: 1; color: root.tint; transformOrigin: Item.Bottom; rotation: snipOpen.a }
        Rectangle { x: 6; y: 0; width: 2; height: 9; radius: 1; color: root.tint; transformOrigin: Item.Bottom; rotation: -snipOpen.a }
        Rectangle { x: 4; y: 8; width: 3; height: 3; radius: 1.5; color: "transparent"; border.width: 1; border.color: root.tint; rotation: 12 }
        Rectangle { x: 7; y: 8; width: 3; height: 3; radius: 1.5; color: "transparent"; border.width: 1; border.color: root.tint; rotation: -12 }
        SequentialAnimation {
          id: snipAnim
          NumberAnimation { target: snipOpen; property: "a"; to: 3; duration: 70 }
          NumberAnimation { target: snipOpen; property: "a"; to: 15; duration: 170; easing.type: Easing.OutBack }
        }
      }

      MouseArea {
        id: trackMa
        anchors.fill: parent
        hoverEnabled: true
        cursorShape: Qt.BlankCursor
        onPositionChanged: pruneLayer.hoveredIndex = pruneLayer.rectAt(mouseX, mouseY)
        onExited: pruneLayer.hoveredIndex = -1
        onClicked: {
          var i = pruneLayer.rectAt(mouseX, mouseY)
          if (i < 0) return
          var r = root.hitAreas[i]
          root.pruneRequested(r.id)
          leaves.burst((r.x + r.w / 2) * root.artScale, (r.y + r.h / 2) * root.artScale, root.palette.frond)
          snipAnim.restart()
        }
      }
    }

    Item {
      id: leaves
      anchors.fill: parent
      // A cut throws more than a few specks, and what is cut off LEAVES: the
      // clippings tumble the whole way down and out of the frame instead of
      // dissolving in mid-air over the tree. A short bright ring marks the
      // cut itself so the eye knows where the loss happened.
      function burst(px, py, col) {
        cutRing.flash(px, py)
        var n = 0
        for (var j = 0; j < leafPool.count && n < 13; j++) {
          var p = leafPool.itemAt(j)
          if (p && !p.live) {
            p.fire(px + (Math.random() - 0.5) * 17, py + (Math.random() - 0.5) * 12, col, n * 22)
            n++
          }
        }
      }
      Rectangle {
        id: cutRing
        width: 16; height: 16; radius: 8
        color: "transparent"
        border.width: 1
        border.color: root.tint
        opacity: 0
        visible: opacity > 0.01
        transformOrigin: Item.Center
        function flash(px, py) { x = px - 8; y = py - 8; ringAnim.restart() }
        ParallelAnimation {
          id: ringAnim
          NumberAnimation { target: cutRing; property: "opacity"; from: 0.9; to: 0; duration: 360; easing.type: Easing.OutQuad }
          NumberAnimation { target: cutRing; property: "scale"; from: 0.35; to: 1.5; duration: 360; easing.type: Easing.OutQuad }
        }
      }
      Repeater {
        id: leafPool
        model: 22
        Rectangle {
          id: leaf
          property bool live: false
          property real _tx: 0
          property real _ty: 0
          property real _tr: 0
          width: 3; height: 3; radius: 1
          visible: live; opacity: 0
          color: "#6c6"
          antialiasing: false
          function fire(px, py, col, delay) {
            live = true; x = px; y = py
            rotation = Math.random() * 90
            if (col) color = Qt.rgba(col.r, col.g, col.b, 1)
            leaf._ty = py + leaves.height * (0.55 + 0.45 * Math.random())
            leaf._tx = px + (Math.random() - 0.5) * 48
            leaf._tr = leaf.rotation + (Math.random() - 0.5) * 540
            leafHold.duration = delay || 0
            anim.restart()
          }
          SequentialAnimation {
            id: anim
            PauseAnimation { id: leafHold; duration: 0 }
            ParallelAnimation {
              NumberAnimation { target: leaf; property: "y"; to: leaf._ty; duration: 1450; easing.type: Easing.InQuad }
              NumberAnimation { target: leaf; property: "x"; to: leaf._tx; duration: 1450; easing.type: Easing.InOutSine }
              NumberAnimation { target: leaf; property: "rotation"; to: leaf._tr; duration: 1450 }
              SequentialAnimation {
                NumberAnimation { target: leaf; property: "opacity"; from: 0; to: 0.95; duration: 90 }
                PauseAnimation { duration: 780 }
                NumberAnimation { target: leaf; property: "opacity"; to: 0; duration: 580; easing.type: Easing.InQuad }
              }
            }
            ScriptAction { script: leaf.live = false }
          }
        }
      }
    }
  }

  // ---- effects the panel calls -----------------------------------
  function water() { fx.water() }
  function feed() { fx.feed() }
  function milestone() { fx.milestone() }
  function light() { fx.light() }
}
