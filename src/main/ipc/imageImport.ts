/**
 * 이미지 임포트 IPC (S4 세션 1).
 *
 * - 렌더러는 경로만 보낸다(webUtils.getPathForFile) — 바이너리 IPC 없음.
 * - 메인에서 nativeImage로 디코딩해 원본 크기(350 DPI 절대 px)와
 *   최대변 2,048px PNG 프리뷰(dataURL)를 반환한다 (sharp 불필요 — S3 summary 사전 결정).
 * - 경로+mtime 키 캐시로 동일 파일 재임포트는 디코딩 비용 0 (절약 패턴 #2).
 *
 * 한계: nativeImage 디코딩은 PNG/JPEG가 보장된 형식. WEBP/TIFF/BMP는
 * 플랫폼별로 실패할 수 있으며, 실패 시 사용자 안내 에러로 응답한다
 * (sharp 도입 여부는 실수요 발생 시 별도 결정).
 */
import { BrowserWindow, dialog, ipcMain, nativeImage } from 'electron'
import { statSync } from 'fs'
import { basename, resolve } from 'path'
import type { ImportedImage } from '../../types/ipc'
import { readLastDir, saveLastDir } from './dialogMemory'

/** 프리뷰 최대 변 길이 (px) */
const PREVIEW_MAX_PX = 2_048

/** 파일 대화상자 필터 — README 지원 포맷 */
const DIALOG_FILTERS = [
  { name: '이미지', extensions: ['png', 'jpg', 'jpeg', 'webp', 'tif', 'tiff', 'bmp'] }
]

/** 프리뷰 캐시 상한 — 초과 시 가장 오래된 항목 제거 (간단 LRU) */
const CACHE_MAX = 64

interface CacheEntry {
  mtimeMs: number
  value: ImportedImage
}

const previewCache = new Map<string, CacheEntry>()

/** 원본을 디코딩해 프리뷰 결과 생성 — getSize()는 리사이즈 전 원본 기준.
 *  removeBg.ts도 재사용한다(배경 제거된 PNG → 새 프리뷰). */
export function makePreview(absPath: string): ImportedImage {
  const source = nativeImage.createFromPath(absPath)
  if (source.isEmpty()) {
    throw new Error(`이미지를 디코딩할 수 없습니다 (보장 포맷: PNG/JPG): ${basename(absPath)}`)
  }
  const { width, height } = source.getSize()

  let preview = source
  if (width > PREVIEW_MAX_PX || height > PREVIEW_MAX_PX) {
    // 큰 변을 2,048px로 맞춘다 — 한 변만 지정하면 비율 유지
    preview = source.resize(
      width >= height
        ? { width: PREVIEW_MAX_PX, quality: 'best' }
        : { height: PREVIEW_MAX_PX, quality: 'best' }
    )
  }
  const previewSize = preview.getSize()
  return {
    dataUrl: preview.toDataURL(),
    widthPx: width,
    heightPx: height,
    previewWidthPx: previewSize.width,
    previewHeightPx: previewSize.height
  }
}

export function registerImageImportIpc(): void {
  /** 파일 대화상자 — 다중 선택, 취소 시 null. 마지막 가져오기 폴더에서 시작 */
  ipcMain.handle('dialog:open-images', async (event) => {
    const owner = BrowserWindow.fromWebContents(event.sender)
    const opts: Electron.OpenDialogOptions = {
      title: '이미지 가져오기',
      filters: DIALOG_FILTERS,
      properties: ['openFile', 'multiSelections'],
      defaultPath: readLastDir('import')
    }
    const result = owner
      ? await dialog.showOpenDialog(owner, opts)
      : await dialog.showOpenDialog(opts)
    if (result.canceled || result.filePaths.length === 0) return null
    saveLastDir('import', ...result.filePaths)
    return result.filePaths
  })

  /** 경로 → 프리뷰 임포트. mtime 일치 캐시 히트 시 즉시 반환 */
  ipcMain.handle('image:import', (_event, filePath: unknown): ImportedImage => {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      throw new Error('잘못된 파일 경로 요청')
    }
    const absPath = resolve(filePath)

    let mtimeMs: number
    try {
      mtimeMs = statSync(absPath).mtimeMs
    } catch {
      throw new Error(`파일을 찾을 수 없습니다: ${absPath}`)
    }

    const cached = previewCache.get(absPath)
    if (cached && cached.mtimeMs === mtimeMs) return cached.value

    const value = makePreview(absPath)
    previewCache.delete(absPath) // 재삽입으로 최근 사용 순서 갱신
    previewCache.set(absPath, { mtimeMs, value })
    if (previewCache.size > CACHE_MAX) {
      const oldest = previewCache.keys().next().value
      if (oldest !== undefined) previewCache.delete(oldest)
    }
    return value
  })
}
