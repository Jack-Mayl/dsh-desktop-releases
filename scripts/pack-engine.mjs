/**
 * pack-engine.mjs — assemble the bundled dsh engine for electron-builder.
 *
 * Strategy: create a Windows directory junction `engine/dsh -> DSH_SRC` plus a
 * bundled portable node at `engine/node/`. electron-builder's extraResources
 * follows the junction and copies the real tree into the installer at build
 * time, so we avoid an expensive + AV-fragile robocopy of node_modules here.
 *
 * Why junction (not symlink): Windows symlinks need admin/developer-mode;
 * junctions (mklink /J) do not, and node fs.symlinkSync(...,'junction') makes
 * one. electron-builder resolves them during packaging.
 *
 * Result layout under <Resources>/engine/ after install:
 *   dsh/        the full built dsh source tree (bin at apps/cli/lib/bin.js)
 *   node/       portable node.exe
 *   VERSION     provenance
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, lstatSync } from 'node:fs'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const ROOT = process.cwd()
const DSH_SRC = process.env.DSH_SRC || 'G:\\deepseek-harness'
const ENGINE = join(ROOT, 'engine')
const OUT_LINK = join(ENGINE, 'dsh')
const NODE_DIR = join(ENGINE, 'node')
const PKG_VERSION = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version

const log = m => console.log(`[pack-engine] ${m}`)

if (!existsSync(join(DSH_SRC, 'apps', 'cli', 'lib', 'bin.js'))) {
  console.error(`[pack-engine] FATAL: ${DSH_SRC} not built. Run "pnpm run build" there first.`)
  process.exit(1)
}

log(`source: ${DSH_SRC}`)
mkdirSync(ENGINE, { recursive: true })

// 1. Create/refresh the junction engine/dsh -> DSH_SRC.
try { lstatSync(OUT_LINK) } catch { /* not present, fine */ }
if (existsSync(OUT_LINK)) {
  log('engine/dsh exists, reusing')
} else {
  symlinkSync(DSH_SRC, OUT_LINK, 'junction')
  log(`junction: engine/dsh -> ${DSH_SRC}`)
}
// Sanity: the bin must be reachable through the junction.
if (!existsSync(join(OUT_LINK, 'apps', 'cli', 'lib', 'bin.js'))) {
  console.error('[pack-engine] FATAL: bin.js not reachable through junction.')
  process.exit(1)
}
log('bin.js reachable via junction')

// 2. Bundle a portable Node runtime.
mkdirSync(NODE_DIR, { recursive: true })
const nodeDest = join(NODE_DIR, process.platform === 'win32' ? 'node.exe' : 'node')
if (!existsSync(nodeDest)) {
  try {
    copyFileSync(process.execPath, nodeDest)
    log(`bundled node: ${process.execPath}`)
  } catch (e) {
    log(`WARN: could not copy node: ${e.message}`)
  }
} else {
  log('node already bundled')
}

// 3. Provenance.
let rev = 'unknown'
try { rev = execSync(`git -C "${DSH_SRC}" rev-parse --short HEAD`, { encoding: 'utf8' }).trim() } catch { /* */ }
writeFileSync(
  join(ENGINE, 'VERSION'),
  `dsh-desktop ${PKG_VERSION}\nengine: deepseek-harness @ ${rev}\nbuilt: ${new Date().toISOString()}\nsource: ${DSH_SRC}\n`,
  'utf8',
)
log('done.')
