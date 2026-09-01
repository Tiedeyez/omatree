// Raster.js — draw list -> a data: image URL for a QtQuick Image.
//
// Quickshell has no working QtQuick Canvas, so instead of blitting we rasterise
// the Paint.js draw list into an RGB buffer (shared pixel shaders, identical to
// dev/preview.js) and hand it to an <Image> as an uncompressed image data URL.
// The Image is shown scaled up with smooth:false for the chunky pixel look, so
// we only ever encode at art resolution.
//
// Two encoders:
//   bmpUrl  — 24-bit BGR, opaque. Used in the panel, where the tree sits on a
//             solid HUD background.
//   pngUrl  — 32-bit RGBA, per-pixel alpha (stored/uncompressed DEFLATE, so no
//             zlib needed). Used for the on-desktop ornament, where the
//             wallpaper must show through the glass case and around the tree.
// A shader may return [r,g,b] (opaque) or [r,g,b,a]; the RGBA rasteriser honours
// the 4th channel, the RGB one ignores it.

.pragma library

function _shader(Paint, op) {
  return op.op === "blob" ? Paint.blobPixel
    : op.op === "mound" ? Paint.moundPixel
    : op.op === "stroke" ? Paint.strokePixel : Paint.polyPixel
}

// rasterise ops into an rgb Uint8-ish array (length w*h*3), top-down.
// bg: [r,g,b]. reveal 0..1 clips to the bottom fraction (grow-in).
function rasterise(Paint, ops, w, h, bg, reveal) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0)
  if (reveal === undefined) reveal = 1
  var cut = reveal >= 1 ? 0 : Math.floor((1 - Math.max(0, reveal)) * h)
  var buf = new Array(w * h * 3)
  for (var p = 0; p < w * h; p++) {
    var lit = ((p / w) | 0) >= cut
    buf[p * 3] = lit ? bg[0] : 0
    buf[p * 3 + 1] = lit ? bg[1] : 0
    buf[p * 3 + 2] = lit ? bg[2] : 0
  }
  // Depth buffer for the ops that make up the solid body of the tree (see the
  // note in Paint.js). Ops without `depth` paint exactly as before AND clear
  // the depth under themselves, so a pot wall or a foliage mass still covers
  // whatever the painter order says it covers.
  var zbuf = new Array(w * h)
  for (var q = 0; q < w * h; q++) zbuf[q] = -Infinity
  for (var o = 0; o < ops.length; o++) {
    var op = ops[o]
    var bb = Paint.bboxOf(op)
    var x0 = Math.max(0, bb[0]), y0 = Math.max(cut, bb[1])
    var x1 = Math.min(w - 1, bb[2]), y1 = Math.min(h - 1, bb[3])
    var shade = _shader(Paint, op)
    var tested = op.depth === 1
    for (var y = y0; y <= y1; y++) {
      var rowoff = y * w
      for (var x = x0; x <= x1; x++) {
        var c = shade(op, x, y)
        if (!c) continue
        var pi = rowoff + x
        if (tested) {
          var z = Paint.lastZ
          if (z < zbuf[pi]) continue           // something solid is in front
          zbuf[pi] = z
        } else {
          zbuf[pi] = -Infinity
        }
        var i = pi * 3
        buf[i] = c[0] | 0; buf[i + 1] = c[1] | 0; buf[i + 2] = c[2] | 0
      }
    }
  }
  return buf
}

var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

// base64 a byte array directly — Qt.btoa mangles bytes >127 (UTF-8), so we
// never route the binary through a QML string.
function b64(bytes) {
  var out = ""
  var n = bytes.length
  for (var i = 0; i < n; i += 3) {
    var b0 = bytes[i], b1 = i + 1 < n ? bytes[i + 1] : 0, b2 = i + 2 < n ? bytes[i + 2] : 0
    out += B64[b0 >> 2]
    out += B64[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < n ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "="
    out += i + 2 < n ? B64[b2 & 63] : "="
  }
  return out
}

// rgb buffer (top-down) -> "data:image/bmp;base64,..."
function bmpUrl(rgb, w, h) {
  var rowSize = (w * 3 + 3) & ~3
  var dataSize = rowSize * h
  var fileSize = 54 + dataSize
  var out = []
  function u16(v) { out.push(v & 255, (v >> 8) & 255) }
  function u32(v) { out.push(v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >> 24) & 255) }
  out.push(66, 77)                  // "BM"
  u32(fileSize); u32(0); u32(54)
  u32(40); u32(w); u32((-h) >>> 0)  // negative height = top-down rows
  u16(1); u16(24); u32(0); u32(dataSize); u32(2835); u32(2835); u32(0); u32(0)
  var pad = rowSize - w * 3
  for (var y = 0; y < h; y++) {
    var base = y * w * 3
    for (var x = 0; x < w; x++) {
      var i = base + x * 3
      out.push(rgb[i + 2] & 255, rgb[i + 1] & 255, rgb[i] & 255)   // BGR
    }
    for (var q = 0; q < pad; q++) out.push(0)
  }
  return "data:image/bmp;base64," + b64(out)
}

// convenience: ops -> data url
function toUrl(Paint, ops, w, h, bg, reveal) {
  return bmpUrl(rasterise(Paint, ops, w, h, bg, reveal), w, h)
}

// ---- RGBA path (transparent ornament) --------------------------------------

// rasterise ops into an rgba array (length w*h*4). Untouched pixels stay fully
// transparent; a shader's optional 4th channel sets per-op translucency (the
// glass panes). reveal 0..1 clips to the bottom fraction (grow-in).
function rasteriseRGBA(Paint, ops, w, h, reveal, opaque) {
  w = Math.max(1, w | 0); h = Math.max(1, h | 0)
  if (reveal === undefined) reveal = 1
  var cut = reveal >= 1 ? 0 : Math.floor((1 - Math.max(0, reveal)) * h)
  var buf = new Array(w * h * 4)
  for (var p = 0; p < w * h * 4; p++) buf[p] = 0
  var zbuf = new Array(w * h)
  for (var q = 0; q < w * h; q++) zbuf[q] = -Infinity
  for (var o = 0; o < ops.length; o++) {
    var op = ops[o]
    var bb = Paint.bboxOf(op)
    var x0 = Math.max(0, bb[0]), y0 = Math.max(cut, bb[1])
    var x1 = Math.min(w - 1, bb[2]), y1 = Math.min(h - 1, bb[3])
    var shade = _shader(Paint, op)
    var tested = op.depth === 1
    for (var y = y0; y <= y1; y++) {
      var rowoff = y * w
      for (var x = x0; x <= x1; x++) {
        var c = shade(op, x, y)
        if (!c) continue
        var a = opaque ? 255 : (c.length > 3 ? (c[3] | 0) : 255)
        if (a <= 0) continue
        var pi = rowoff + x
        if (tested) {
          var z = Paint.lastZ
          if (z < zbuf[pi]) continue           // something solid is in front
          zbuf[pi] = z
        } else {
          zbuf[pi] = -Infinity
        }
        var i = pi * 4
        if (a >= 255) {
          buf[i] = c[0] | 0; buf[i + 1] = c[1] | 0; buf[i + 2] = c[2] | 0; buf[i + 3] = 255
        } else {
          // src-over onto whatever's already there (transparent or a prior op)
          var da = buf[i + 3], sa = a / 255
          var na = sa + da / 255 * (1 - sa)
          if (na <= 0) continue
          buf[i]     = Math.round((c[0] * sa + buf[i]     * (da / 255) * (1 - sa)) / na)
          buf[i + 1] = Math.round((c[1] * sa + buf[i + 1] * (da / 255) * (1 - sa)) / na)
          buf[i + 2] = Math.round((c[2] * sa + buf[i + 2] * (da / 255) * (1 - sa)) / na)
          buf[i + 3] = Math.round(na * 255)
        }
      }
    }
  }
  return buf
}

// CRC-32 (PNG) — tiny on-the-fly table
var _crcT = null
function _crc32(bytes, start, end) {
  if (!_crcT) {
    _crcT = new Array(256)
    for (var n = 0; n < 256; n++) {
      var c = n
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1)
      _crcT[n] = c >>> 0
    }
  }
  var crc = 0xFFFFFFFF
  for (var i = start; i < end; i++) crc = (_crcT[(crc ^ bytes[i]) & 0xFF] ^ (crc >>> 8)) >>> 0
  return (crc ^ 0xFFFFFFFF) >>> 0
}

// rgba buffer (top-down) -> "data:image/png;base64,..." using stored (level-0)
// DEFLATE blocks, so no compressor is needed. Fine at art resolution (~150px).
function pngUrl(rgba, w, h) {
  var out = []
  function u8(v) { out.push(v & 255) }
  function u32be(v) { out.push((v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255) }
  function chunk(type, data) {
    var start = out.length
    u32be(data.length)
    for (var i = 0; i < type.length; i++) out.push(type.charCodeAt(i))
    for (var j = 0; j < data.length; j++) out.push(data[j] & 255)
    out.push(0, 0, 0, 0)                       // CRC placeholder
    var crc = _crc32(out, start + 4, out.length - 4)
    out[out.length - 4] = (crc >>> 24) & 255
    out[out.length - 3] = (crc >>> 16) & 255
    out[out.length - 2] = (crc >>> 8) & 255
    out[out.length - 1] = crc & 255
  }
  out.push(137, 80, 78, 71, 13, 10, 26, 10)    // PNG signature

  var ihdr = []
  ihdr.push((w >>> 24) & 255, (w >>> 16) & 255, (w >>> 8) & 255, w & 255)
  ihdr.push((h >>> 24) & 255, (h >>> 16) & 255, (h >>> 8) & 255, h & 255)
  ihdr.push(8, 6, 0, 0, 0)                      // 8-bit, colour type 6 (RGBA)
  chunk("IHDR", ihdr)

  // raw scanlines: filter byte 0 + RGBA, then wrap in stored DEFLATE blocks
  var raw = []
  for (var y = 0; y < h; y++) {
    raw.push(0)
    var base = y * w * 4
    for (var x = 0; x < w; x++) {
      var s = base + x * 4
      raw.push(rgba[s] & 255, rgba[s + 1] & 255, rgba[s + 2] & 255, rgba[s + 3] & 255)
    }
  }
  var z = [0x78, 0x01]                          // zlib header
  var pos = 0
  while (pos < raw.length) {
    var n = Math.min(65535, raw.length - pos)
    var last = pos + n >= raw.length ? 1 : 0
    z.push(last)
    z.push(n & 255, (n >>> 8) & 255)
    z.push((~n) & 255, ((~n) >>> 8) & 255)
    for (var q = 0; q < n; q++) z.push(raw[pos + q])
    pos += n
  }
  // adler-32 of raw
  var a1 = 1, a2 = 0
  for (var r = 0; r < raw.length; r++) { a1 = (a1 + raw[r]) % 65521; a2 = (a2 + a1) % 65521 }
  z.push((a2 >>> 8) & 255, a2 & 255, (a1 >>> 8) & 255, a1 & 255)
  chunk("IDAT", z)
  chunk("IEND", [])

  return "data:image/png;base64," + b64(out)
}

// convenience: ops -> transparent png data url
function toPngUrl(Paint, ops, w, h, reveal, opaque) {
  return pngUrl(rasteriseRGBA(Paint, ops, w, h, reveal, opaque), w, h)
}
