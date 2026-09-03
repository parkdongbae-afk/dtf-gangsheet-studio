/**
 * 대화상자 마지막 폴더 기억 — userData에 키별(가져오기·프로젝트·내보내기) 경로를
 * 저장해 다음 대화상자를 같은 폴더에서 연다 (재시작 후에도 유지).
 * 기억된 폴더가 삭제된 경우(USB 반출 등)는 undefined를 돌려 기본 위치로 폴백한다.
 */
import { app } from 'electron'
import { readFileSync, statSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'

export type DialogMemoryKey = 'import' | 'project' | 'export'

const memoryFile = (key: DialogMemoryKey): string =>
  join(app.getPath('userData'), `last-${key}-dir.txt`)

/** 기억된 폴더 — 기록 없음·삭제됨은 undefined */
export function readLastDir(key: DialogMemoryKey): string | undefined {
  try {
    const dir = readFileSync(memoryFile(key), 'utf8').trim()
    if (dir.length === 0) return undefined
    return statSync(dir).isDirectory() ? dir : undefined
  } catch {
    return undefined
  }
}

/** 확정된 파일 경로의 폴더를 기록 — 기록 실패는 무시(다음 대화상자는 기본 동작) */
export function saveLastDir(key: DialogMemoryKey, ...filePaths: string[]): void {
  if (filePaths.length === 0) return
  try {
    writeFileSync(memoryFile(key), dirname(filePaths[0]), 'utf8')
  } catch {
    // 사용 권한 등 기록 실패는 치명적이지 않다
  }
}

/** 저장 대화상자용 defaultPath — 기억된 폴더와 기본 파일명 힌트를 결합 */
export function saveDefaultPath(key: DialogMemoryKey, fileName: string): string {
  const dir = readLastDir(key)
  return dir === undefined ? fileName : join(dir, fileName)
}
