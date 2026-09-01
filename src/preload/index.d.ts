import { ElectronAPI } from '@electron-toolkit/preload'
import type { DtfApi } from '../types/ipc'

declare global {
  interface Window {
    electron: ElectronAPI
    api: DtfApi
  }
}
