/**
 * 투명 여백 자동 트림 IPC — 이미지 임포트 시 알파 바운딩 박스 크롭.
 *
 * 흐름: 렌더러가 원본 경로만 전달 → 사이드카 ``auto_trim``(autotrim.py —
 * numpy bbox 스캔이라 Electron 메인·렌더러 스레드 지연 없음) → 잘린 PNG를
 * ``userData/autotrim/<uuid>.png``에 기록 → makePreview로 ≤2,048px 프리뷰를
 * 재생성해 반환.
 *
 * no-op 계약(완전 투명·여백 없음·알파 없는 포맷): 원본 경로·치수를
 * ``trimmed=false``로 그대로 돌려주고 새 파일을 만들지 않는다. 처리 파일은
 * .dtf 프로젝트가 참조할 수 있으므로 세션 후에도 삭제하지 않는다(removeBg 정책).
 */
import { app, ipcMain } from 'electron'
import { mkdirSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { autoTrimViaSidecar } from './export'
import { makePreview } from './imageImport'
import { AUTO_TRIM_ALPHA_THRESHOLD } from '../../core/autoTrim'
import type { TrimmedImage } from '../../types/ipc'

async function autoTrim(absPath: string): Promise<TrimmedImage> {
  const outDir = join(app.getPath('userData'), 'autotrim')
  mkdirSync(outDir, { recursive: true })
  const outputPath = join(outDir, `${randomUUID()}.png`)

  const result = await autoTrimViaSidecar(absPath, outputPath, AUTO_TRIM_ALPHA_THRESHOLD)
  const preview = makePreview(result.trimmed ? result.output_path : absPath)
  return {
    filePath: result.output_path,
    trimmed: result.trimmed,
    ...preview
  }
}

export function registerAutoTrimIpc(): void {
  ipcMain.handle('image:auto-trim', (_event, filePath: unknown): Promise<TrimmedImage> => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('잘못된 파일 경로 요청')
    }
    return autoTrim(filePath)
  })
}
