import { createRequire } from 'node:module'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

const require = createRequire(import.meta.url)
const sharp = require('../engine-hoisted-v6/node_modules/sharp')
const root = new URL('..', import.meta.url)
const source = new URL('../deepseek-harness/apps/web/public/favicon.svg', root)
const build = new URL('build/', root)
const sizes = [16, 24, 32, 48, 64, 128, 256]

await mkdir(build, { recursive: true })
const svg = await readFile(source)
const images = []
for (const size of sizes) {
  const png = await sharp(svg, { density: 1024 })
    .resize(size, size, { fit: 'contain' })
    .png()
    .toBuffer()
  images.push({ size, png })
  await writeFile(new URL(`icon-${size}.png`, build), png)
}
await writeFile(new URL('icon.png', build), images.at(-1).png)
await writeFile(new URL('tray.png', build), images.find(({ size }) => size === 32).png)

const directorySize = 6 + images.length * 16
let offset = directorySize
const header = Buffer.alloc(directorySize)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)
images.forEach(({ size, png }, index) => {
  const entry = 6 + index * 16
  header.writeUInt8(size === 256 ? 0 : size, entry)
  header.writeUInt8(size === 256 ? 0 : size, entry + 1)
  header.writeUInt8(0, entry + 2)
  header.writeUInt8(0, entry + 3)
  header.writeUInt16LE(1, entry + 4)
  header.writeUInt16LE(32, entry + 6)
  header.writeUInt32LE(png.length, entry + 8)
  header.writeUInt32LE(offset, entry + 12)
  offset += png.length
})
await writeFile(new URL('icon.ico', build), Buffer.concat([header, ...images.map(({ png }) => png)]))
console.log(`Rendered official DeepSeek Harness icon: ${sizes.join(', ')} px -> ${join(new URL(build).pathname, 'icon.ico')}`)
