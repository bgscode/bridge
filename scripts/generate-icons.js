#!/usr/bin/env node
/*
  Generate platform icons from build/icon.svg

  - Creates a macOS iconset in build/icons/icon.iconset
  - Runs `iconutil -c icns` to create build/icon.icns (mac only)
  - Writes build/icon_512.png for Linux/electron

  Usage: `node scripts/generate-icons.js`
*/

const path = require('path')
const fs = require('fs')
const fsp = require('fs').promises
const { execSync } = require('child_process')
let Resvg
try {
  Resvg = require('@resvg/resvg-js').Resvg
} catch (err) {
  console.error(
    'Missing dependency @resvg/resvg-js. Install with `npm install --save-dev @resvg/resvg-js`'
  )
  process.exit(1)
}

function buildIcoFromPngs(pngBuffers, sizes) {
  const count = pngBuffers.length
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0) // reserved
  header.writeUInt16LE(1, 2) // image type (1 = icon)
  header.writeUInt16LE(count, 4)

  const dir = Buffer.alloc(16 * count)
  let offset = 6 + 16 * count
  for (let i = 0; i < count; i++) {
    const buf = Buffer.from(pngBuffers[i])
    const size = sizes && sizes[i] ? sizes[i] : 0
    const w = size >= 256 ? 0 : size
    const h = size >= 256 ? 0 : size
    const entry = i * 16
    dir.writeUInt8(w, entry + 0) // width
    dir.writeUInt8(h, entry + 1) // height
    dir.writeUInt8(0, entry + 2) // color count
    dir.writeUInt8(0, entry + 3) // reserved
    dir.writeUInt16LE(1, entry + 4) // planes
    dir.writeUInt16LE(32, entry + 6) // bit count
    dir.writeUInt32LE(buf.length, entry + 8) // bytes in resource
    dir.writeUInt32LE(offset, entry + 12) // image offset
    offset += buf.length
  }

  return Buffer.concat([header, dir, ...pngBuffers.map((b) => Buffer.from(b))])
}

async function main() {
  const root = path.join(__dirname, '..')
  const svgPath = path.join(root, 'build', 'icon.svg')
  if (!fs.existsSync(svgPath)) {
    console.error('Missing build/icon.svg — create it first or update path')
    process.exit(1)
  }

  const iconsetDir = path.join(root, 'build', 'icons', 'icon.iconset')
  await fsp.rm(path.join(root, 'build', 'icons'), { recursive: true, force: true }).catch(() => {})
  await fsp.mkdir(iconsetDir, { recursive: true })

  const sizes = [
    { name: 'icon_16x16.png', size: 16 },
    { name: 'icon_16x16@2x.png', size: 32 },
    { name: 'icon_32x32.png', size: 32 },
    { name: 'icon_32x32@2x.png', size: 64 },
    { name: 'icon_128x128.png', size: 128 },
    { name: 'icon_128x128@2x.png', size: 256 },
    { name: 'icon_256x256.png', size: 256 },
    { name: 'icon_256x256@2x.png', size: 512 },
    { name: 'icon_512x512.png', size: 512 },
    { name: 'icon_512x512@2x.png', size: 1024 }
  ]

  // Render a dock-friendly icon with an outer transparent margin so the
  // visible badge is slightly smaller than the system icon canvas. This
  // makes the icon appear the same visual size as other apps in the Dock.
  const ICON_BG = '#000' // black background to match login header
  const BG_SCALE = 0.82 // fraction of canvas used by the background rounded rect
  const INNER_SCALE = 0.62 // fraction of the background used by the glyph

  console.log('Rasterizing SVG into icon.iconset (dock-styled) using @resvg/resvg-js...')
  const svgBuffer = fs.readFileSync(svgPath)
  const svgDataUrl = `data:image/svg+xml;utf8,${encodeURIComponent(svgBuffer.toString())}`

  for (const s of sizes) {
    const outFile = path.join(iconsetDir, s.name)
    const size = s.size
    const bgSize = Math.round(size * BG_SCALE)
    const bgPad = Math.floor((size - bgSize) / 2)
    const bgRx = Math.round(bgSize * 0.18)
    const inner = Math.round(bgSize * INNER_SCALE)
    const innerPad = Math.floor((bgSize - inner) / 2)
    const imgX = bgPad + innerPad
    const imgY = bgPad + innerPad

    const wrapper = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect x="${bgPad}" y="${bgPad}" width="${bgSize}" height="${bgSize}" rx="${bgRx}" fill="${ICON_BG}" />
  <image href="${svgDataUrl}" x="${imgX}" y="${imgY}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet" />
</svg>`
    const resvg = new Resvg(Buffer.from(wrapper))
    const png = resvg.render().asPng()
    fs.writeFileSync(outFile, png)
    console.log('  wrote', outFile)
  }

  // Also create a 512 PNG for linux packaging (dock-styled)
  const png512 = path.join(root, 'build', 'icon_512.png')
  const size512 = 512
  const bgSize512 = Math.round(size512 * BG_SCALE)
  const bgPad512 = Math.floor((size512 - bgSize512) / 2)
  const bgRx512 = Math.round(bgSize512 * 0.18)
  const inner512 = Math.round(bgSize512 * INNER_SCALE)
  const innerPad512 = Math.floor((bgSize512 - inner512) / 2)
  const imgX512 = bgPad512 + innerPad512
  const imgY512 = bgPad512 + innerPad512
  const wrapper512 = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${size512}" height="${size512}" viewBox="0 0 ${size512} ${size512}">
  <rect x="${bgPad512}" y="${bgPad512}" width="${bgSize512}" height="${bgSize512}" rx="${bgRx512}" fill="${ICON_BG}" />
  <image href="${svgDataUrl}" x="${imgX512}" y="${imgY512}" width="${inner512}" height="${inner512}" preserveAspectRatio="xMidYMid meet" />
</svg>`
  fs.writeFileSync(png512, new Resvg(Buffer.from(wrapper512)).render().asPng())
  console.log('  wrote', png512)

  // Create Windows .ico (pure-JS) from a set of PNG sizes using the dock-styled rendering
  try {
    console.log('Creating .ico from PNGs (pure-JS)...')
    const icoSizes = [16, 32, 48, 64, 128, 256]
    const pngBuffers = icoSizes.map((s) => {
      const bgSize = Math.round(s * BG_SCALE)
      const bgPad = Math.floor((s - bgSize) / 2)
      const bgRx = Math.round(bgSize * 0.18)
      const inner = Math.round(bgSize * INNER_SCALE)
      const innerPad = Math.floor((bgSize - inner) / 2)
      const imgX = bgPad + innerPad
      const imgY = bgPad + innerPad
      const wrap = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">\n  <rect x="${bgPad}" y="${bgPad}" width="${bgSize}" height="${bgSize}" rx="${bgRx}" fill="${ICON_BG}" />\n  <image href="${svgDataUrl}" x="${imgX}" y="${imgY}" width="${inner}" height="${inner}" preserveAspectRatio="xMidYMid meet" />\n</svg>`
      return new Resvg(Buffer.from(wrap)).render().asPng()
    })
    const icoBuf = buildIcoFromPngs(pngBuffers, icoSizes)
    const icoOut = path.join(root, 'build', 'icon.ico')
    fs.writeFileSync(icoOut, icoBuf)
    console.log('  wrote', icoOut)
  } catch (err) {
    console.warn('ICO generation failed:', err && err.message ? err.message : err)
  }

  // mac .icns
  const icnsOut = path.join(root, 'build', 'icon.icns')
  try {
    console.log('Creating .icns with iconutil...')
    execSync(`iconutil -c icns "${iconsetDir}" -o "${icnsOut}"`, { stdio: 'inherit' })
    console.log('  wrote', icnsOut)
  } catch (err) {
    console.warn(
      'iconutil failed — skipping .icns creation (is this macOS or is iconutil available?)'
    )
  }

  console.log(
    'Icon generation complete. Files in build/ (icon.icns (maybe), icon.ico, icon_512.png, icons/icon.iconset/* )'
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
