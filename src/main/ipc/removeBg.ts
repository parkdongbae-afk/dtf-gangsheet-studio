/**
 * 배경 제거 IPC (v2) — .agent/REMOVEBG.MD 스펙의 Electron 통합 지점.
 *
 * 흐름: 렌더러가 선택 항목의 원본 경로만 전달 → 사이드카 ``remove_bg``
 * (STDIO_GUIDE 경로 계약 — 스펙의 Base64 스트리밍 대신 파일 경로) →
 * 처리된 32-bit RGBA PNG를 ``userData/removebg/<uuid>.png``에 기록 →
 * makePreview로 ≤2,048px 프리뷰를 재생성해 반환.
 *
 * 치환 정책 (DESIGN §8 "마스크 부착" 대신): 알파가 포함된 처리 결과 PNG를
 * 새 에셋으로 치환한다 — 내보내기 파이프라인(알파→픽셀 마스크)을 그대로
 * 재사용하고, 되돌리기는 기존 undo 스냅샷(filePath·dataUrl 포함)으로 작동한다.
 * 처리 파일은 .gsj 프로젝트가 참조할 수 있으므로 세션 후에도 삭제하지 않는다.
 */
import { app, ipcMain } from 'electron'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { removeBackgroundViaSidecar } from './export'
import { makePreview } from './imageImport'
import type { RemoveBgImage } from '../../types/ipc'

async function removeBackground(absPath: string): Promise<RemoveBgImage> {
  const outDir = join(app.getPath('userData'), 'removebg')
  mkdirSync(outDir, { recursive: true })
  const outputPath = join(outDir, `${randomUUID()}.png`)

  const result = await removeBackgroundViaSidecar(absPath, outputPath)
  const preview = makePreview(outputPath)
  return { filePath: result.output_path, ...preview }
}

export function registerRemoveBgIpc(): void {
  ipcMain.handle('image:remove-bg', (_event, filePath: unknown): Promise<RemoveBgImage> => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('잘못된 파일 경로 요청')
    }
    return removeBackground(filePath)
  })
}
