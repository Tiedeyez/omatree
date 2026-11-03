#!/usr/bin/env node
// gallery.js — rebuild the README images, deterministically.
//
//   node dev/gallery.js            # writes docs/omatree-gallery.png + docs/omatree-seasons.png
//
// docs/omatree-gallery.png  twelve trees as new plantings get them (trained
//                           styles, so cascade and twin are in it), high summer
// docs/omatree-seasons.png  one maple through the year, then a flowering plum
//                           and a juniper in winter, labelled
//
// Every input is fixed (gallery seed 13 is the first that shows all eight
// styles and all three genera), so re-running only changes the images when the
// renderer changes. Needs ImageMagick (`magick`).

'use strict'
const cp = require('child_process')
const FS = require('fs')
const OS = require('os')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const DOCS = path.join(ROOT, 'docs')
const SHOT = path.join(__dirname, 'shot.js')
const TMP = FS.mkdtempSync(path.join(OS.tmpdir(), 'omatree-gallery-'))
const FONT = ['/usr/share/fonts/noto/NotoSansMono-Regular.ttf',
  '/usr/share/fonts/TTF/DejaVuSansMono.ttf'].find(f => FS.existsSync(f))

function shot (out, args) {
  const r = cp.spawnSync('node', [SHOT, out, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('shot.js failed: ' + r.stderr)
}
function magick (args) {
  const r = cp.spawnSync('magick', args, { encoding: 'utf8' })
  if (r.status !== 0) throw new Error('magick failed: ' + r.stderr)
}

// 1. the gallery
shot(path.join(DOCS, 'omatree-gallery.png'),
  ['--gallery', '12', '--gallery-seed', '13', '--train', '--maturity', '0.85', '--scale', '3'])

// 2. the seasons strip: same tree, same pose, five days of the year
const cells = [
  ['--doy', '103', '--genus', 'maple', 'NEW LEAVES'],
  ['--doy', '140', '--genus', 'maple', 'SPRING'],
  ['--season', 'summer', '--genus', 'maple', 'SUMMER'],
  ['--season', 'autumn', '--genus', 'maple', 'AUTUMN'],
  ['--season', 'winter', '--genus', 'maple', 'WINTER'],
  ['--doy', '86', '--genus', 'plum', 'PLUM IN FLOWER'],
  ['--season', 'autumn', '--genus', 'crimson-maple', 'CRIMSON MAPLE'],
  ['--season', 'winter', '--genus', 'pine', 'PINE IN WINTER']
]
const files = cells.map((c, i) => {
  const out = path.join(TMP, `s${i}.png`)
  shot(out, ['--seed', '4242', '--style', 'informal', '--maturity', '1', '--scale', '3', ...c.slice(0, 4)])
  if (!FONT) return out
  const lab = path.join(TMP, `l${i}.png`)
  magick([out, '-background', '#0f1114', '-fill', '#8a9099', '-font', FONT, '-pointsize', '22',
    '-gravity', 'south', '-splice', '0x40', '-annotate', '+0+8', c[4], lab])
  return lab
})
const row1 = path.join(TMP, 'r1.png'), row2 = path.join(TMP, 'r2.png')
magick([...files.slice(0, 4), '-background', '#0f1114', '-gravity', 'south', '+append', row1])
magick([...files.slice(4), '-background', '#0f1114', '-gravity', 'south', '+append', row2])
magick([row1, row2, '-background', '#0f1114', '-gravity', 'center', '-append',
  '-resize', '1600x>', path.join(DOCS, 'omatree-seasons.png')])

FS.rmSync(TMP, { recursive: true, force: true })
process.stderr.write('wrote docs/omatree-gallery.png, docs/omatree-seasons.png\n')
