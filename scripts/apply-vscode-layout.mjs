#!/usr/bin/env node
/**
 * apply-vscode-layout.mjs — post-deploy injection of the anoslide VS Code IDE
 * layout into a deployed dsh desktop runtime.
 *
 * Idempotent: safe to re-run after every pnpm deploy. Steps:
 *  1. copy @anoslide plugins (host-files + client-vscode-layout) into the
 *     runtime's node_modules
 *  2. patch host-files path constants to be DSH_HOME-aware (desktop shell
 *     isolates DSH_HOME under userData; upstream hardcodes ~/.dsh)
 *  3. overlay the official-package patch files (image bridge, conversation
 *     polish, zh slash commands) from the vendored patches tree
 *  4. overlay dsh-web-app/cordis.patch.yml so the ui-layout row points at the
 *     vendored VS Code layout client plugin
 *  5. ensure shiki is resolvable inside the runtime
 *
 * Usage: node apply-vscode-layout.mjs <runtimeDir>
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const runtimeDir = resolve(process.argv[2] ?? '')
const srcRoot = resolve(new URL('../vscode-layout-src', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'))
if (!existsSync(join(runtimeDir, 'node_modules'))) {
  console.error(`usage: node apply-vscode-layout.mjs <runtimeDir> — no node_modules under ${runtimeDir}`)
  process.exit(1)
}
if (!existsSync(srcRoot)) {
  console.error(`vendored source missing: ${srcRoot} (clone anoslide/dsh-vscode-layout there first)`)
  process.exit(1)
}

const nm = (...parts) => join(runtimeDir, 'node_modules', ...parts)
const copy = (from, to) => {
  rmSync(to, { recursive: true, force: true })
  mkdirSync(join(to, '..'), { recursive: true })
  cpSync(from, to, { recursive: true })
  console.log(`copied  ${to}`)
}

// ── 1. vendored @anoslide plugins ────────────────────────────────────────────
copy(
  join(srcRoot, 'plugins', 'dsh-host-files'),
  nm('@anoslide', 'dsh-host-files'),
)
copy(
  join(srcRoot, 'plugins', 'dsh-client-vscode-layout'),
  nm('@anoslide', 'dsh-client-vscode-layout'),
)

// ── 2. DSH_HOME-aware path constants in host-files ──────────────────────────
const hostFilesEntry = nm('@anoslide', 'dsh-host-files', 'lib', 'index.js')
let hostFiles = readFileSync(hostFilesEntry, 'utf8')
const PERSONA_RE = /const PERSONA_FILE = join\(homedir\(\), "\.dsh", "global-persona\.md"\);/
const MCP_RE = /const MCP_STATE_FILE = join\(homedir\(\), "\.dsh", "mcp-servers\.json"\);/
const SKILLS_RE = /const SKILLS_ROOT = join\(homedir\(\), "\.dsh", "skills"\);/
const DSH_ROOT_EXPR = 'const DSH_USER_ROOT = process.env.DSH_HOME ?? join(homedir(), ".dsh");'
if (PERSONA_RE.test(hostFiles) && MCP_RE.test(hostFiles) && SKILLS_RE.test(hostFiles)) {
  hostFiles = hostFiles
    .replace(PERSONA_RE, `${DSH_ROOT_EXPR}\nconst PERSONA_FILE = join(DSH_USER_ROOT, "global-persona.md");`)
    .replace(MCP_RE, 'const MCP_STATE_FILE = join(DSH_USER_ROOT, "mcp-servers.json");')
    .replace(SKILLS_RE, 'const SKILLS_ROOT = join(DSH_USER_ROOT, "skills");')
  writeFileSync(hostFilesEntry, hostFiles)
  console.log('patched host-files: DSH_HOME-aware persona/mcp/skills paths')
} else if (!hostFiles.includes('DSH_USER_ROOT')) {
  console.error('host-files path constants not found — upstream changed, review patch')
  process.exit(1)
} else {
  console.log('host-files already DSH_HOME-aware')
}

// ── 3. official-package overlays ─────────────────────────────────────────────
const patchRoot = join(srcRoot, 'patches', 'node_modules', '@deepseek-ai')
const overlayFiles = [
  ['dsh-client-ui-conversation/lib/client.js'],
  ['dsh-client-ui-tool/lib/client.js'],
  ['dsh-command-compact/lib/index.js'],
  ['dsh-command-feedback/lib/index.js'],
  ['dsh-command-goal/lib/index.js'],
  ['dsh-host-apiproxy/lib/index.js'],
  ['dsh-host-apiproxy/lib/types/api-proxy.js'],
  ['dsh-host-directory-picker-native/lib/index.js'],
  ['dsh-llm-deepseek/lib/index.js'],
  ['dsh-llm-pi-ai/lib/index.js'],
  ['dsh-permission-presets/lib/index.js'],
  ['dsh-plan-mode/lib/index.js'],
  ['dsh-session-log-export/lib/index.js'],
  ['dsh-tool-fs/lib/index.js'],
]
let overlaid = 0
for (const [rel] of overlayFiles) {
  const from = join(patchRoot, rel)
  const to = nm('@deepseek-ai', rel)
  if (!existsSync(from)) { console.error(`patch source missing: ${rel}`); process.exit(1) }
  if (!existsSync(to)) { console.error(`runtime target missing: ${rel} (version drift?)`); process.exit(1) }
  cpSync(from, to)
  overlaid += 1
}
console.log(`overlaid ${overlaid} official package files`)

// ── 4. web-app bundle patch: ui-layout row → anoslide layout ────────────────
// The upstream patch file is built from the STOCK web-app yml (plus the
// ui-layout swap), so overlaying it drops our plugin-market rows. Re-insert
// them after the copy so the marketplace tab survives the layout swap.
copy(
  join(patchRoot, 'dsh-web-app', 'cordis.patch.yml'),
  nm('@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml'),
)
const webAppPatchPath = nm('@deepseek-ai', 'dsh-web-app', 'cordis.patch.yml')
let webAppPatch = readFileSync(webAppPatchPath, 'utf8')
// Upstream yml uses CRLF; build anchors with the file's own line ending.
const eol = webAppPatch.includes('\r\n') ? '\r\n' : '\n'
if (!webAppPatch.includes('dsh-host-plugin-market')) {
  webAppPatch = webAppPatch.replace(
    `    - id: plugin-inventory${eol}      name: '@deepseek-ai/dsh-host-plugin-inventory'${eol}`,
    `    - id: plugin-inventory${eol}      name: '@deepseek-ai/dsh-host-plugin-inventory'${eol}${eol}`
      + `    # Plugin marketplace Remote: ecosystem search + profile install.${eol}`
      + `    - id: plugin-market${eol}      name: '@deepseek-ai/dsh-host-plugin-market'${eol}`,
  )
}
if (!webAppPatch.includes('dsh-client-ui-settings-plugin-market')) {
  webAppPatch = webAppPatch.replace(
    `    - id: ui-settings-plugin-inventory${eol}      name: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory'${eol}`,
    `    - id: ui-settings-plugin-inventory${eol}      name: '@deepseek-ai/dsh-client-ui-settings-plugin-inventory'${eol}${eol}`
      + `    # Marketplace tab: search the public dsh-plugin ecosystem and install.${eol}`
      + `    - id: ui-settings-plugin-market${eol}      name: '@deepseek-ai/dsh-client-ui-settings-plugin-market'${eol}`,
  )
}
writeFileSync(webAppPatchPath, webAppPatch)
console.log('re-inserted plugin-market rows into web-app patch')

// ── 5. shiki availability inside the runtime ─────────────────────────────────
const shikiInRuntime = nm('shiki', 'package.json')
if (!existsSync(shikiInRuntime)) {
  const repoShiki = resolve(runtimeDir, '..', '..', 'deepseek-harness', 'node_modules', 'shiki')
  const fallbackShiki = resolve('G:', 'deepseek-harness', 'node_modules', 'shiki')
  const donor = [repoShiki, fallbackShiki].find(p => existsSync(join(p, 'package.json')))
  if (donor) {
    copy(donor, nm('shiki'))
    console.log('injected shiki into runtime')
  } else {
    console.log('shiki absent from runtime and no donor found — highlight endpoint will error (layout still works)')
  }
} else {
  console.log('shiki already present in runtime')
}

console.log('apply-vscode-layout: done')
