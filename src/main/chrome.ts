/**
 * Chrome — tray icon and application menu.
 *
 * Tray exposes engine state + updater + show/quit. Menu adds reload, devtools,
 * and "check for updates". Both are thin so the real logic stays in main.ts.
 */
import { app, Tray, Menu, MenuItem, BrowserWindow, nativeImage, type Event as EEvent } from 'electron'
import { join } from 'node:path'
import type { DshEngine } from './dsh-engine'

interface UpdaterLike {
  state: { status: string; info?: { version?: string }; error?: string }
  check: () => Promise<unknown>
  install: () => void
  on: (e: string, cb: (...a: unknown[]) => void) => void
}

export function buildTray(opts: { engine: DshEngine; onShow: () => void; onQuit: () => void }): Tray {
  const icon = nativeImage.createFromPath(join(app.getAppPath(), 'build', 'tray.png'))
  const tray = new Tray(icon)
  tray.setToolTip('DeepSeek Harness')

  const rebuild = (): void => {
    const state = opts.engine.state
    const menu = Menu.buildFromTemplate([
      { label: 'DeepSeek Harness', enabled: false },
      { type: 'separator' },
      { label: `引擎状态: ${state}`, enabled: false },
      { label: '显示窗口', click: opts.onShow },
      { type: 'separator' },
      { label: '退出', click: opts.onQuit },
    ])
    tray.setContextMenu(menu)
  }
  rebuild()
  opts.engine.on('state', rebuild)
  tray.on('click', opts.onShow)
  return tray
}

export function buildAppMenu(updater: UpdaterLike): Menu {
  const template: Array<MenuItem | Electron.MenuItemConstructorOptions> = [
    {
      label: 'DeepSeek Harness',
      submenu: [
        { label: '检查更新…', click: () => updater.check() },
        { label: '安装已下载的更新', enabled: updater.state.status === 'downloaded', click: () => updater.install() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: '编辑',
      submenu: [{ role: 'undo' }, { role: 'redo' }, { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: '视图',
      submenu: [{ role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }],
    },
    {
      label: '窗口',
      submenu: [{ role: 'minimize' }, { role: 'close' }],
    },
  ]
  // Reflect updater status into the install menu item.
  updater.on('state', () => {
    const m = Menu.getApplicationMenu()
    const appItem = m?.items.find(i => i.label === 'DeepSeek Harness')
    const installItem = appItem?.submenu?.items.find(i => i.label === '安装已下载的更新')
    if (installItem) installItem.enabled = updater.state.status === 'downloaded'
  })
  return Menu.buildFromTemplate(template)
}
