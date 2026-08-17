/**
 * Updater — wraps electron-updater with a state machine the renderer can poll.
 *
 * Update provider: GitHub Releases (private mode) or a static file host.
 * Configure via publish config in electron-builder.yml + the UPDATE_PROVIDER
 * env at build time. electron-updater reads app-update.yml embedded by
 * electron-builder, so at runtime this needs NO hard-coded URLs.
 *
 * Supports delta updates automatically (blockmap-based) for small payloads.
 */
import { autoUpdater } from 'electron-updater'
import { EventEmitter } from 'node:events'

export interface UpdaterState {
  status: 'idle' | 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error'
  info?: { version?: string; releaseNotes?: unknown; releaseName?: string }
  progress?: { percent: number; transferred: number; total: number }
  error?: string
}

class Updater extends EventEmitter {
  state: UpdaterState = { status: 'idle' }
  private autoCheckTimer: NodeJS.Timeout | null = null
  /** Download-retry state: github.com is intermittently blocked in CN; a
   *  failed download auto-retries with backoff instead of waiting 4h. */
  private retryTimer: NodeJS.Timeout | null = null
  private retryCount = 0
  private static readonly MAX_RETRIES = 10
  private static readonly RETRY_DELAY_MS = 60_000

  constructor() {
    super()
    // electron-updater emits these regardless of provider.
    autoUpdater.on('checking-for-update', () => this.set({ status: 'checking' }))
    autoUpdater.on('update-available', info => {
      this.retryCount = 0
      this.set({ status: 'available', info: this.clean(info) })
    })
    autoUpdater.on('update-not-available', info => {
      this.cancelRetry()
      this.set({ status: 'not-available', info: this.clean(info) })
    })
    autoUpdater.on('error', err => {
      this.set({ status: 'error', error: err.message })
      this.scheduleRetry()
    })
    autoUpdater.on('download-progress', p => {
      this.set({ status: 'downloading', progress: { percent: Math.round(p.percent), transferred: p.transferred, total: p.total } })
    })
    autoUpdater.on('update-downloaded', info => {
      this.cancelRetry()
      this.retryCount = 0
      this.set({ status: 'downloaded', info: this.clean(info) })
    })

    // Don't auto-install on quit by default — let the user choose via tray/menu.
    autoUpdater.autoDownload = true
    autoUpdater.autoInstallOnAppQuit = true
  }

  /** Retry the update check/download after a network failure (60s backoff). */
  private scheduleRetry(): void {
    if (this.retryTimer || this.retryCount >= Updater.MAX_RETRIES) return
    this.retryCount++
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.check().catch(() => {})
    }, Updater.RETRY_DELAY_MS)
  }

  private cancelRetry(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  /** Normalize electron-updater's info object for IPC (drops functions). */
  private clean(info: unknown): UpdaterState['info'] {
    if (!info || typeof info !== 'object') return undefined
    const i = info as Record<string, unknown>
    return {
      version: typeof i.version === 'string' ? i.version : undefined,
      releaseName: typeof i.releaseName === 'string' ? i.releaseName : undefined,
      releaseNotes: typeof i.releaseNotes === 'string' ? i.releaseNotes : undefined,
    }
  }

  private set(patch: Partial<UpdaterState>): void {
    this.state = { ...this.state, ...patch }
    this.emit('state', this.state)
  }

  /** Trigger a manual check now. Returns the resulting state. */
  async check(): Promise<UpdaterState> {
    try {
      await autoUpdater.checkForUpdates()
    } catch (err) {
      this.set({ status: 'error', error: err instanceof Error ? err.message : String(err) })
    }
    return this.state
  }

  /** Schedule a background check every 4 hours while the app runs. */
  autoCheck(): void {
    this.check().catch(() => {})
    this.autoCheckTimer = setInterval(() => this.check().catch(() => {}), 4 * 60 * 60 * 1000)
  }

  /** Quit and install a downloaded update. No-op if nothing downloaded. */
  install(): void {
    if (this.state.status === 'downloaded') {
      // setImmediate lets the renderer ack before the process dies.
      setImmediate(() => autoUpdater.quitAndInstall(true, true))
    }
  }
}

let instance: Updater | null = null
export function createUpdater(): Updater {
  if (!instance) instance = new Updater()
  return instance
}
