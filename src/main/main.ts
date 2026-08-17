/**
 * Main process entry. Wires the window, engine, tray, menu, and updater.
 *
 * Lifecycle:
 *  app.whenReady -> ensure single instance -> create window -> start engine
 *  engine 'running' -> load its URL into the renderer
 *  window-all-closed -> stop engine -> quit (except on macOS keepalive)
 *
 * The engine runs as a long-lived child; the renderer is just a framed view of
 * the dsh web UI. All chrome (menu/tray/dock) lives here.
 */
import { app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, shell } from 'electron'
import { join } from 'node:path'
import { EventEmitter } from 'node:events'
import { DshEngine } from './dsh-engine'
import { createUpdater } from './updater'
import { buildTray, buildAppMenu } from './chrome'

// Dev: point ELECTRON_RENDERER_URL at `vite dev`. For now we load the engine URL.
const isDev = !app.isPackaged

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
const engine = new DshEngine()
const updater = createUpdater()
const bus = new EventEmitter()
// Buffer logs so the renderer (which connects late) can request recent history.
const logBuffer: string[] = []
const LOG_CAP = 500

function pushLog(line: string): void {
  const ts = new Date().toISOString().slice(11, 19)
  const entry = `[${ts}] ${line}`
  logBuffer.push(entry)
  if (logBuffer.length > LOG_CAP) logBuffer.shift()
  mainWindow?.webContents.send('engine:log', entry)
  bus.emit('log', entry)
}

engine.on('log', pushLog)
engine.on('state', s => mainWindow?.webContents.send('engine:state', s))
engine.on('url', url => mainWindow?.webContents.send('engine:url', url))
engine.on('version', v => mainWindow?.webContents.send('engine:version', v))

const DSH_PORT = 3080

async function createWindow(): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    title: 'DeepSeek Harness',
    icon: join(app.getAppPath(), 'build', 'tray.png'),
    backgroundColor: '#1a1a1a',
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // Loading splash is the local loader.html; swapped to engine URL once healthy.
  // loader.html ships beside the compiled main (copied by build:ts-postbuild).
  win.loadFile(join(__dirname, 'loader.html'))
  win.once('ready-to-show', () => win.show())

  // Open external links (model docs, etc.) in the system browser, not in-app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http://127.0.0.1:') || url.startsWith('http://localhost:')) {
      return { action: 'allow' }
    }
    shell.openExternal(url)
    return { action: 'deny' }
  })

  win.on('close', e => {
    // Minimize to tray instead of quitting, unless user chose to quit.
    if (!forceQuit) {
      e.preventDefault()
      win.hide()
    }
  })

  return win
}

let forceQuit = false
// Single before-quit handler: flag forceQuit (so the window-close handler
// stops intercepting) and stop the engine before the process actually exits.
app.on('before-quit', async e => {
  forceQuit = true
  if (engine.state === 'running' || engine.state === 'starting') {
    e.preventDefault()
    await engine.stop()
    app.quit()
  }
})

// --- Single instance lock: second launch just focuses the existing window. ---
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = mainWindow
    if (win) {
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
    }
  })
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(buildAppMenu(updater))
  mainWindow = await createWindow()
  tray = buildTray({ engine, onShow: () => mainWindow?.show(), onQuit: () => { forceQuit = true; app.quit() } })

  // IPC surface for the renderer
  ipcMain.handle('engine:getState', () => engine.state)
  ipcMain.handle('engine:getUrl', () => engine.resolvedUrl)
  ipcMain.handle('engine:getVersion', () => engine.engineVersion)
  ipcMain.handle('engine:getLogs', () => logBuffer.slice(-200))
  ipcMain.handle('engine:restart', async () => {
    await engine.stop()
    return startEngine()
  })
  ipcMain.handle('updater:check', () => updater.check())
  ipcMain.handle('updater:install', () => updater.install())
  ipcMain.handle('updater:state', () => updater.state)

  await startEngine()
  updater.autoCheck()
})

async function startEngine(): Promise<void> {
  try {
    const url = await engine.start(DSH_PORT)
    mainWindow?.webContents.send('engine:url', url)
    mainWindow?.loadURL(url).catch(err => pushLog(`loadURL failed: ${err.message}`))
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    pushLog(`ENGINE FAILED: ${msg}`)
    mainWindow?.webContents.send('engine:error', msg)
  }
}

// --- Shutdown: on non-macOS, closing all windows stops the engine and quits. ---
app.on('window-all-closed', async () => {
  if (process.platform !== 'darwin') {
    await engine.stop()
    app.quit()
  }
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  } else {
    mainWindow?.show()
  }
})
