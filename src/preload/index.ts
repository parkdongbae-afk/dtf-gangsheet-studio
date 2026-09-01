import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { DtfApi } from '../types/ipc'

// Custom APIs for renderer — 경로만 주고받는다 (바이너리 IPC 금지)
const api: DtfApi = {
  openImages: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:open-images'),
  importImage: (filePath: string) => ipcRenderer.invoke('image:import', filePath),
  getPathForFile: (file: File): string => webUtils.getPathForFile(file)
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
