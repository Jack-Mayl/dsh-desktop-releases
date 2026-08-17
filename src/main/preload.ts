/**
 * Preload — the only bridge between the sandboxed renderer and the main process.
 * Exposes a tiny `dsh` object on window; nothing else. contextIsolation on.
 *
 * The dsh web UI itself is served by the engine and does NOT use this bridge —
 * it talks to its own backend over http. This bridge is only for OUR chrome
 * (loading screen, engine status overlay, updater notifications).
 */
import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('dsh', {
  engine: {
    getState: (): Promise<string> => ipcRenderer.invoke('engine:getState'),
    getUrl: (): Promise<string | null> => ipcRenderer.invoke('engine:getUrl'),
    getVersion: (): Promise<string | null> => ipcRenderer.invoke('engine:getVersion'),
    getLogs: (): Promise<string[]> => ipcRenderer.invoke('engine:getLogs'),
    restart: (): Promise<void> => ipcRenderer.invoke('engine:restart'),
    onState: (cb: (s: string) => void) => ipcRenderer.on('engine:state', (_e, s) => cb(s)),
    onUrl: (cb: (u: string) => void) => ipcRenderer.on('engine:url', (_e, u) => cb(u)),
    onError: (cb: (m: string) => void) => ipcRenderer.on('engine:error', (_e, m) => cb(m)),
    onLog: (cb: (l: string) => void) => ipcRenderer.on('engine:log', (_e, l) => cb(l)),
    onVersion: (cb: (v: string) => void) => ipcRenderer.on('engine:version', (_e, v) => cb(v)),
  },
  updater: {
    check: (): Promise<unknown> => ipcRenderer.invoke('updater:check'),
    install: (): Promise<void> => ipcRenderer.invoke('updater:install'),
    state: (): Promise<unknown> => ipcRenderer.invoke('updater:state'),
  },
})
