/**
 * 프로젝트 파일(.dtf) IPC — 저장·불러오기 다이얼로그 + 파일 입출력.
 * 경로 계약만 오가며(STDIO_GUIDE와 동일 철학) 프리뷰 dataUrl은 저장하지 않는다 —
 * 로드 시 원본 filePath에서 재생성한다(projectIO.ts).
 * pathOverride는 E2E 자동검증용 선택 인자(DTF_SMOKE_TEST 패턴) — 지정 시 다이얼로그 없이 직접 입출력.
 */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { PROJECT_EXTENSION, validateProjectData, type ProjectData } from '../../core/project'
import { readLastDir, saveDefaultPath, saveLastDir } from './dialogMemory'

const filters: Electron.FileFilter[] = [
  { name: 'DTF 갱시트 프로젝트', extensions: [PROJECT_EXTENSION] }
]

const withExtension = (path: string): string =>
  path.toLowerCase().endsWith(`.${PROJECT_EXTENSION}`) ? path : `${path}.${PROJECT_EXTENSION}`

/** 마지막 프로젝트 폴더 기준 저장 경로 선택 — 확정 시 폴더를 기억한다 */
async function pickSavePath(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return null
  const result = await dialog.showSaveDialog(win, {
    title: '프로젝트 저장',
    defaultPath: saveDefaultPath('project', `갭시트.${PROJECT_EXTENSION}`),
    filters
  })
  if (result.canceled || !result.filePath) return null
  saveLastDir('project', result.filePath)
  return result.filePath
}

/** 마지막 프로젝트 폴더에서 열기 — 확정 시 폴더를 기억한다 */
async function pickOpenPath(): Promise<string | null> {
  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
  if (!win) return null
  const result = await dialog.showOpenDialog(win, {
    title: '프로젝트 열기',
    defaultPath: readLastDir('project'),
    filters,
    properties: ['openFile']
  })
  const picked = result.canceled ? null : (result.filePaths[0] ?? null)
  if (picked) saveLastDir('project', picked)
  return picked
}

export function registerProjectIpc(): void {
  ipcMain.handle(
    'project:save',
    async (_event, data: unknown, pathOverride?: unknown): Promise<string | null> => {
      // 저장 직전 자체 검증 — 손상 파일 생성 차단 (렌더러 상태를 신뢰하지 않는다)
      const project = validateProjectData(data)
      const picked =
        typeof pathOverride === 'string' && pathOverride.length > 0
          ? pathOverride
          : await pickSavePath()
      if (!picked) return null
      const target = withExtension(picked)
      writeFileSync(target, JSON.stringify(project, null, 2), 'utf-8')
      return target
    }
  )

  ipcMain.handle(
    'project:open',
    async (_event, pathOverride?: unknown): Promise<ProjectData | null> => {
      const source =
        typeof pathOverride === 'string' && pathOverride.length > 0
          ? pathOverride
          : await pickOpenPath()
      if (!source) return null
      let raw: unknown
      try {
        raw = JSON.parse(readFileSync(source, 'utf-8'))
      } catch {
        throw new Error('프로젝트 파일을 해석할 수 없습니다 — 손상되었거나 DTF 프로젝트가 아닙니다')
      }
      return validateProjectData(raw)
    }
  )
}
