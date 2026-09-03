/**
 * 프로젝트 파일(.dtf) 스키마·검증 — UI 라이브러리 의존 없는 순수 함수 (Vitest 선검증).
 * 메인 IPC(파일 입출력)와 렌더러(저장 페이로드 생성)가 공유하는 단일 계약.
 * dataUrl(프리뷰)은 저장하지 않는다 — filePath에서 로드 시 재생성한다(파일 경량화).
 */

import { PSD_MAX_PX } from './math'

export const PROJECT_EXTENSION = 'dtf'
export const PROJECT_FORMAT = 'dtf-gangsheet-project'
export const PROJECT_VERSION = 1

/** PlacedImage에서 dataUrl만 제외한 형태 — 저장 단위 */
export interface ProjectImage {
  id: string
  filePath: string
  widthPx: number
  heightPx: number
  x: number
  y: number
  rotation: number
}

export interface ProjectDocument {
  widthPx: number
  heightPx: number
}

export interface ProjectData {
  format: string
  version: number
  document: ProjectDocument
  images: ProjectImage[]
}

export class ProjectFormatError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ProjectFormatError'
  }
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value)

const requirePositiveInt = (
  container: Record<string, unknown>,
  key: string,
  label: string
): number => {
  const value = container[key]
  if (!isFiniteNumber(value) || !Number.isInteger(value) || value <= 0) {
    throw new ProjectFormatError(`${label} must be a positive integer, got ${String(value)}`)
  }
  return value
}

const requireFinite = (container: Record<string, unknown>, key: string, label: string): number => {
  const value = container[key]
  if (!isFiniteNumber(value)) {
    throw new ProjectFormatError(`${label} must be a finite number, got ${String(value)}`)
  }
  return value
}

/**
 * 외부 입력(.dtf 파일·렌더러 페이로드) → 정규화 ProjectData — 미지 필드 제거.
 * 저장 직전 자체 검증에도 쓰여 손상 파일 생성을 원천 차단한다.
 *
 * @throws ProjectFormatError 스키마 위반·치수 한계(PSD 30,000px) 초과
 */
export function validateProjectData(raw: unknown): ProjectData {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new ProjectFormatError('project must be an object')
  }
  const root = raw as Record<string, unknown>
  if (root.format !== PROJECT_FORMAT) {
    throw new ProjectFormatError(`unsupported format: ${String(root.format)}`)
  }
  if (root.version !== PROJECT_VERSION) {
    // 버전 불일치 — 마이그레이션 지점이 생기면 여기서 변환한다
    throw new ProjectFormatError(`unsupported version: ${String(root.version)}`)
  }
  const docRaw = root.document
  if (typeof docRaw !== 'object' || docRaw === null || Array.isArray(docRaw)) {
    throw new ProjectFormatError('document must be an object')
  }
  const doc = docRaw as Record<string, unknown>
  const widthPx = requirePositiveInt(doc, 'widthPx', 'document.widthPx')
  const heightPx = requirePositiveInt(doc, 'heightPx', 'document.heightPx')
  if (widthPx > PSD_MAX_PX || heightPx > PSD_MAX_PX) {
    throw new ProjectFormatError(`document exceeds PSD ${PSD_MAX_PX}px limit`)
  }
  if (!Array.isArray(root.images)) {
    throw new ProjectFormatError('images must be an array')
  }
  const images = root.images.map((entry, index) => {
    const label = `images[${index}]`
    if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
      throw new ProjectFormatError(`${label} must be an object`)
    }
    const item = entry as Record<string, unknown>
    if (typeof item.id !== 'string' || item.id.length === 0) {
      throw new ProjectFormatError(`${label}.id must be a non-empty string`)
    }
    if (typeof item.filePath !== 'string' || item.filePath.length === 0) {
      throw new ProjectFormatError(`${label}.filePath must be a non-empty string`)
    }
    return {
      id: item.id,
      filePath: item.filePath,
      widthPx: requirePositiveInt(item, 'widthPx', `${label}.widthPx`),
      heightPx: requirePositiveInt(item, 'heightPx', `${label}.heightPx`),
      x: requireFinite(item, 'x', `${label}.x`),
      y: requireFinite(item, 'y', `${label}.y`),
      rotation: requireFinite(item, 'rotation', `${label}.rotation`)
    }
  })
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    document: { widthPx, heightPx },
    images
  }
}
