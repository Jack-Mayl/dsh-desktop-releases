// Download + extract electron binary into node_modules/electron/dist.
// Bypasses MSYS /tmp issues and AV-flagged curl cache by streaming straight
// from the mirror into the target dir via node's zlib-unaware unzip (yauzl not
// available; use the 'unzipper' fallback or PowerShell Expand-Archive).
import { createWriteStream, mkdirSync, existsSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join } from 'node:path'
import https from 'node:https'

const VER = '33.4.11'
const DIST = join(process.cwd(), 'node_modules', 'electron', 'dist')
const ZIP = join(process.cwd(), '_electron.bin.zip')
const URL = `https://cdn.npmmirror.com/binaries/electron/${VER}/electron-v${VER}-win32-x64.zip`

if (existsSync(join(DIST, 'electron.exe'))) {
  console.log('electron.exe already present, skipping.')
  process.exit(0)
}

console.log(`downloading ${URL}`)
await new Promise((resolve, reject) => {
  const f = createWriteStream(ZIP)
  https.get(URL, res => {
    if (res.statusCode === 302 || res.statusCode === 301) {
      https.get(res.headers.location, r2 => r2.pipe(f).on('finish', resolve)).on('error', reject)
    } else {
      res.pipe(f).on('finish', resolve)
    }
  }).on('error', reject)
})
console.log('downloaded, extracting...')
mkdirSync(DIST, { recursive: true })
// PowerShell Expand-Archive is reliable on Windows and handles large zips.
execSync(`powershell -NoProfile -Command "Expand-Archive -LiteralPath '${ZIP}' -DestinationPath '${DIST}' -Force"`, { stdio: 'inherit' })
rmSync(ZIP, { force: true })
console.log(existsSync(join(DIST, 'electron.exe')) ? 'OK: electron.exe present' : 'FAIL')
