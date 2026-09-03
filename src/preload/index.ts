import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import type { DtfApi, ExportProgress, OpenedProject, UpscaleProgress } from '../types/ipc'
// Custom APIs for renderer — 경로만 주고받는다 (바이너리 IPC 금지)
const api: DtfApi = {
  openImages: (): Promise<string[] | null> => ipcRenderer.invoke('dialog:open-images'),
  importImage: (filePath: string) => ipcRenderer.invoke('image:import', filePath),
  removeBackground: (filePath: string) => ipcRenderer.invoke('image:remove-bg', filePath),
  autoTrimImage: (filePath: string) => ipcRenderer.invoke('image:auto-trim', filePath),
  imageInfo: (filePath: string) => ipcRenderer.invoke('image:info', filePath),
  upscaleImage: (filePath: string, options) =>
    ipcRenderer.invoke('image:upscale', filePath, options),
  resumeUpscale: () => ipcRenderer.invoke('image:upscale-resume'),
  getUpscaleResumable: () => ipcRenderer.invoke('upscale:resumable'),
  getUpscaleCalibration: () => ipcRenderer.invoke('upscale:calibration'),
  cancelUpscale: () => ipcRenderer.invoke('upscale:cancel'),
  onUpscaleProgress: (listener: (progress: UpscaleProgress) => void): (() => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, progress: UpscaleProgress): void =>
      listener(progress)
    ipcRenderer.on('upscale:progress', wrapped)
    return () => ipcRenderer.removeListener('upscale:progress', wrapped)
  },
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),
  exportSaveDialog: (format) => ipcRenderer.invoke('export:save-dialog', format),
  exportDocument: (manifest) => ipcRenderer.invoke('export:render', manifest),
  cancelExport: () => ipcRenderer.invoke('export:cancel'),
  onExportProgress: (listener: (progress: ExportProgress) => void): (() => void) => {
    const wrapped = (_e: Electron.IpcRendererEvent, progress: ExportProgress): void =>
      listener(progress)
    ipcRenderer.on('export:progress', wrapped)
    return () => ipcRenderer.removeListener('export:progress', wrapped)
  },
  openGuidePdf: (): Promise<void> => ipcRenderer.invoke('util:open-guide-pdf'),
  openManualPdf: (): Promise<void> => ipcRenderer.invoke('util:open-manual-pdf'),
  openLicenses: (): Promise<void> => ipcRenderer.invoke('util:open-licenses'),
  openBgGuide: (): Promise<void> => ipcRenderer.invoke('util:open-bg-guide'),
  /** 현재 작업을 .dtf 프로젝트로 저장 — 다이얼로그 경로(취소 시 null). path는 E2E 주입용 */
  saveProject: (data, path) => ipcRenderer.invoke('project:save', data, path),
  /** .dtf 프로젝트 열기 — 다이얼로그(취소 시 null). path는 E2E 주입용 */
  openProject: (path?: string): Promise<OpenedProject | null> =>
    ipcRenderer.invoke('project:open', path)
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
