/**
 * DshEngine — manages the bundled dsh server as a child process.
 *
 * Design:
 *  - dsh is an ESM Node program that owns its own SIGTERM/SIGINT lifecycle.
 *    We spawn it as a SEPARATE node process (never require() it inside the
 *    Electron main process) so its event loop, signals, and module graph stay
 *    isolated. A crash in the agent runtime never takes the shell down.
 *  - The node binary + the dsh production tree are bundled under resources/.
 *    We resolve them relative to app.getAppPath() so it works in dev (source),
 *    packed (asar-unpacked dir), and packaged (installer) alike.
 *  - We health-check by polling the web server's port until it answers, then
 *    hand the URL to the renderer. Robust against slow first-boot (profile
 *    auto-init, sqlite migrations, etc.).
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { app } from 'electron'

/** Events emitted: 'state' (string), 'log' (string), 'url' (string). */
export class DshEngine extends EventEmitter {
  /** Current lifecycle state. */
  state: EngineState = 'stopped'
  private child: ChildProcess | null = null
  /** The URL the dsh web server is reachable at, once healthy. */
  resolvedUrl: string | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private shuttingDown = false
  /** Detected version of the bundled engine, read once. */
  engineVersion: string | null = null

  /**
   * Root of the bundled engine tree. Layouts, probed in order:
   *   1. packaged-archive: <Resources>/engine/runtime.7z — extracted ONCE to
   *      <userData>/dsh-runtime/ (avoids NSIS packaging hundreds of thousands
   *      of dependency files; the installer ships a single archive).
   *   2. packaged-dir: <Resources>/engine/dsh/apps/cli (a real tree).
   *   3. dev: the source checkout G:\deepseek-harness\apps\cli.
   * Returns the apps/cli dir whose lib/bin.js is the engine entry.
   */
  private resolveEngineRoot(): { root: string; bin: string; sourceLaunch: boolean } {
    const base = process.resourcesPath ?? app.getAppPath()
    const runtimeDir = join(app.getPath('userData'), 'dsh-runtime')
    const candidates = [
      // 1. Extracted archive layout (runtime.7z contains the tree at its root)
      join(runtimeDir, 'apps', 'cli'),
      join(runtimeDir, 'dsh-runtime', 'apps', 'cli'),
      // 2. Packaged plain tree
      join(base, 'engine', 'dsh', 'apps', 'cli'),
      // 3. Dev: source checkout apps/cli
      'G:\\deepseek-harness\\apps\\cli',
    ]
    for (const root of candidates) {
      const built = join(root, 'lib', 'bin.js')
      if (existsSync(built)) return { root, bin: built, sourceLaunch: false }
      const src = join(root, 'src', 'bin.ts')
      if (existsSync(src)) return { root, bin: src, sourceLaunch: true }
    }
    // Last resort: assume the first candidate even if checks failed, so we get a
    // real error from spawn rather than a silent no-op.
    return { root: candidates[0], bin: join(candidates[0], 'lib', 'bin.js'), sourceLaunch: false }
  }

  /**
   * Extract the bundled runtime archive once at first launch.
   * Idempotent: skips when the extracted bin already exists.
   * @returns true when an extracted (or already-present) runtime is ready.
   */
  async ensureRuntimeExtracted(): Promise<boolean> {
    const base = process.resourcesPath ?? app.getAppPath()
    const archive = join(base, 'engine', 'runtime.7z')
    if (!existsSync(archive)) return existsSync(join(app.getPath('userData'), 'dsh-runtime'))
    const runtimeDir = join(app.getPath('userData'), 'dsh-runtime')
    const marker = join(runtimeDir, '.extracted')
    const appVersion = app.getVersion()
    let extractedVersion: string | undefined
    try { extractedVersion = readFileSync(marker, 'utf8').trim() } catch { /* first run or incomplete extraction */ }
    if (extractedVersion === appVersion && existsSync(join(runtimeDir, 'apps', 'cli', 'lib', 'bin.js'))) return true
    if (existsSync(runtimeDir) && extractedVersion !== undefined && extractedVersion !== appVersion) {
      this.log(`engine update: replacing runtime ${extractedVersion} with ${appVersion}`)
      rmSync(runtimeDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    }
    this.log(`first run: extracting engine archive to ${runtimeDir} ...`)
    mkdirSync(runtimeDir, { recursive: true })
    try {
      const tool = join(base, 'engine', 'tools', '7za.exe')
      if (!existsSync(tool)) throw new Error(`extractor missing: ${tool}`)
      require('node:child_process').execSync(`"${tool}" x "${archive}" -o"${runtimeDir}" -y -bd`, { stdio: 'ignore' })
      writeFileSync(marker, appVersion)
      this.log('engine archive extracted')
      return true
    } catch (err) {
      this.log(`archive extraction failed: ${err instanceof Error ? err.message : String(err)}`)
      return false
    }
  }

  /** The node binary: prefer bundled portable node, then system node, never electron. */
  private resolveNodeBinary(): string {
    const base = process.resourcesPath ?? app.getAppPath()
    const exe = process.platform === 'win32' ? 'node.exe' : 'node'
    const portable = join(base, 'engine', 'node', process.platform === 'win32' ? exe : join('bin', exe))
    if (existsSync(portable)) return portable
    // Dev fallback: find a real node on PATH. Electron's own process.execPath is
    // electron.exe, which CANNOT run dsh (wrong binary), so never return it.
    try {
      const which = require('node:child_process').execSync(
        process.platform === 'win32' ? 'where node' : 'which node',
        { encoding: 'utf8' },
      ).split(/\r?\n/)[0].trim()
      if (which) return which
    } catch { /* node not on PATH */ }
    // Last resort: assume 'node' resolves in the spawn env.
    return 'node'
  }

  /** The dsh home dir for this desktop user (profiles, sessions, patches). */
  private resolveDshHome(): string {
    const home = join(app.getPath('userData'), 'dsh-home')
    mkdirSync(home, { recursive: true })
    return home
  }

  /**
   * Wire the bundled VS Code IDE layout (@anoslide plugins) into the web
   * profile. The profile resolves plugins from its own directory, so the
   * runtime copy is exposed through junctions — the same shape the layout's
   * upstream install uses, created automatically here on every boot.
   */
  private ensureVscodeLayout(): void {
    const home = this.resolveDshHome()
    const runtimeNm = join(app.getPath('userData'), 'dsh-runtime', 'node_modules')
    const profileDir = join(home, 'profiles', 'web')
    mkdirSync(join(profileDir, 'node_modules', '@anoslide'), { recursive: true })
    for (const name of ['dsh-host-files', 'dsh-client-vscode-layout']) {
      const link = join(profileDir, 'node_modules', '@anoslide', name)
      const real = join(runtimeNm, '@anoslide', name)
      if (!existsSync(real)) continue // layout not bundled in this runtime
      if (!existsSync(link)) {
        symlinkSync(real, link, 'junction')
        this.log(`vscode layout: linked ${name}`)
      }
    }
    // Host-side file-tree/persona/MCP plugin rides the profile patch layer.
    // The profile's own auto-init writes a template file (possibly `[]`), so
    // merge by content rather than checking existence only.
    const patch = join(profileDir, 'cordis.patch.yml')
    let patchContent = ''
    try { patchContent = readFileSync(patch, 'utf8') } catch { /* not yet created */ }
    if (!patchContent.includes('vscode-host-files')) {
      writeFileSync(patch, [
        '# VS Code IDE layout: host interface for the file tree / viewer / persona / MCP.',
        '- insert:',
        "    - id: vscode-host-files",
        "      name: '@anoslide/dsh-host-files'",
        '',
      ].join('\n'))
      this.log('vscode layout: profile patch written')
    }
  }

  /** Build the env for the child: isolate DSH_HOME, forward network creds. */
  private childEnv(): NodeJS.ProcessEnv {
    const runtimeBin = join(app.getPath('userData'), 'dsh-runtime', 'node_modules', '.bin')
    const delimiter = process.platform === 'win32' ? ';' : ':'
    return {
      ...process.env,
      DSH_HOME: this.resolveDshHome(),
      // Prefer bundled profile-management tools (pnpm) while preserving user
      // tools such as git and bash for plugins that need them.
      PATH: `${runtimeBin}${delimiter}${process.env.PATH ?? ''}`,
    }
  }

  /**
   * Start the dsh web server. Resolves with the URL once healthy.
   * Throws on spawn failure or if the port never comes up in time.
   */
  async start(port = 3080): Promise<string> {
    if (this.child && this.state === 'running') {
      return this.resolvedUrl ?? `http://127.0.0.1:${port}`
    }
    this.setState('starting')
    this.resolvedUrl = null

    // First-run archive mode: extract the bundled runtime before resolving.
    await this.ensureRuntimeExtracted()
    this.ensureVscodeLayout()

    const { root: engineRoot, bin: binPath, sourceLaunch } = this.resolveEngineRoot()
    const nodeBin = this.resolveNodeBinary()
    const args: string[] = []

    // Source launch needs tsx's ESM hook
    if (sourceLaunch) {
      args.push('--import', 'tsx/esm', binPath)
    } else {
      args.push(binPath)
    }
    args.push('web', '--port', String(port))

    this.log(`spawning: ${nodeBin} ${args.join(' ')}`)

    this.child = spawn(nodeBin, args, {
      env: this.childEnv(),
      cwd: engineRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child.stdout?.on('data', d => this.pipe(String(d)))
    this.child.stderr?.on('data', d => this.pipe(String(d)))
    this.child.on('exit', (code, signal) => {
      this.log(`engine exited code=${code} signal=${signal}`)
      this.child = null
      if (!this.shuttingDown) {
        this.setState('crashed')
      } else {
        this.setState('stopped')
      }
    })
    this.child.on('error', err => {
      this.log(`engine spawn error: ${err.message}`)
      this.setState('error')
    })

    // Health-check the port.
    await this.waitForHealth(port)
    return this.resolvedUrl!
  }

  /** Poll the port until the server answers or we time out. */
  private waitForHealth(port: number, timeoutMs = 60_000): Promise<void> {
    const deadline = Date.now() + timeoutMs
    return new Promise((resolve, reject) => {
      const probe = async () => {
        try {
          const res = await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(2000) })
          if (res.ok || res.status < 500) {
            this.resolvedUrl = `http://127.0.0.1:${port}`
            this.setState('running')
            this.emit('url', this.resolvedUrl)
            this.log(`healthy at ${this.resolvedUrl}`)
            return resolve()
          }
        } catch {
          // not up yet
        }
        if (Date.now() > deadline) {
          this.healthTimer = null
          this.setState('error')
          return reject(new Error('dsh engine did not become healthy in time'))
        }
        this.healthTimer = setTimeout(probe, 500)
      }
      probe()
    })
  }

  /** Stop the engine gracefully (SIGTERM), then force-kill after grace. */
  async stop(): Promise<void> {
    this.shuttingDown = true
    if (this.healthTimer) {
      clearTimeout(this.healthTimer)
      this.healthTimer = null
    }
    const child = this.child
    if (!child) {
      this.setState('stopped')
      return
    }
    this.setState('stopping')
    await new Promise<void>(resolve => {
      const force = setTimeout(() => {
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        resolve()
      }, 8000)
      child.once('exit', () => {
        clearTimeout(force)
        resolve()
      })
      try { child.kill('SIGTERM') } catch { /* already gone */ }
    })
    this.child = null
    this.setState('stopped')
  }

  private pipe(chunk: string): void {
    for (const line of chunk.split(/\r?\n/)) {
      if (line.trim()) {
        this.log(line)
        // Capture the version line dsh prints, e.g. "dsh 0.1.0-rc.5"
        const m = line.match(/\bdsh\s+v?([\d][\w.\-]*)/i)
        if (m && !this.engineVersion) {
          this.engineVersion = m[1]
          this.emit('version', this.engineVersion)
        }
      }
    }
  }

  private log(msg: string): void {
    this.emit('log', msg)
  }

  private setState(s: EngineState): void {
    this.state = s
    this.emit('state', s)
  }
}

export type EngineState = 'stopped' | 'starting' | 'running' | 'stopping' | 'crashed' | 'error'
