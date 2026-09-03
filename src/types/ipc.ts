/** 공유 IPC 계약 (CLAUDE.md §2.1 src/types) — 메인·프리로드·렌더러가 함께 참조.
 *
 * 원칙: 렌더러→메인 사이드카에 바이너리(ArrayBuffer)를 전송하지 않고
 * 파일 절대 경로를 주고받는다. 프리뷰는 메인 프로세스에서 ≤2,048px로
 * 리사이즈한 PNG dataURL로 전달한다 (S4 설계 패턴 #1·#2).
 */
import type { ProjectData } from '../core/project'

/** 이미지 임포트 결과 — 원본 크기는 350 DPI 절대 px 기준 */
export interface ImportedImage {
  /** ≤2,048px PNG 프리뷰 (알파 보존) — 캔버스 표시 전용 */
  dataUrl: string
  /** 원본 가로 (350 DPI 절대 px) — 씬 배치 크기로 사용 */
  widthPx: number
  /** 원본 세로 (350 DPI 절대 px) */
  heightPx: number
  previewWidthPx: number
  previewHeightPx: number
}

/** 배경 제거 결과 — 처리된 32-bit RGBA PNG가 새 원본이 된다 (치수는 입력과 동일) */
export interface RemoveBgImage extends ImportedImage {
  /** 배경 제거된 RGBA PNG 절대 경로 — 이후 내보내기·재편집의 원본 */
  filePath: string
}

/** 사이드카 remove_bg 결과 — 경로·메타데이터만 (바이너리 반환 금지) */
export interface RemoveBgSidecarResult {
  output_path: string
  width_px: number
  height_px: number
}

import type { ExportFormat, ExportManifest } from '../workers/exportManifest'

/** 사이드카 render 진행 알림 — stage "items"=항목 렌더, "write"=파일 저장 */
export interface ExportProgress {
  stage: 'items' | 'write'
  current: number
  total: number
}

/** 사이드카 render 결과 — 경로·메타데이터만 (바이너리 반환 금지) */
export interface ExportResult {
  output_path: string
  width_px: number
  height_px: number
  layer_count: number
  duration_ms: number
}

export type { ExportFormat, ExportManifest }

/** 프리로드가 렌더러에 노출하는 에디터 API */
export interface DtfApi {
  /** 파일 대화상자(다중 선택) — 취소 시 null */
  openImages(): Promise<string[] | null>
  /** 원본 경로만 전달해 임포트 — 프리뷰 dataURL + 원본 px 반환 */
  importImage(filePath: string): Promise<ImportedImage>
  /** 배경 제거(rembg 사이드카) — 처리된 RGBA PNG 경로 + 프리뷰 반환 (v2) */
  removeBackground(filePath: string): Promise<RemoveBgImage>
  /** 드래그앤드롭 File → 절대 경로 — Electron 32+ 에서 File.path 제거의 공식 대체 */
  getPathForFile(file: File): string
  /** 내보내기 저장 대화상자 — 포맷별 확장자 필터, 취소 시 null */
  exportSaveDialog(format: ExportFormat): Promise<string | null>
  /** 매니페스트를 사이드카로 렌더 — 진행률은 onExportProgress로 수신 */
  exportDocument(manifest: ExportManifest): Promise<ExportResult>
  /** 진행 중 내보내기 취소 — 다음 내보내기부터 사이드카 자동 재시작 */
  cancelExport(): Promise<void>
  /** 내보내기 진행 알림 구독 — 반환 함수 호출로 구독 해제 */
  onExportProgress(listener: (progress: ExportProgress) => void): () => void
  /** 번들된 가이드 PDF를 시스템 기본 뷰어로 열기 */
  openGuidePdf(): Promise<void>
  /** 번들된 사용자 메뉴얼 PDF를 시스템 기본 뷰어로 열기 */
  openManualPdf(): Promise<void>
  /** 현재 작업을 .dtf 프로젝트로 저장 — 저장 경로 반환, 취소 시 null */
  saveProject(data: ProjectData, path?: string): Promise<string | null>
  /** .dtf 프로젝트 열기 — 프로젝트 데이터 반환, 취소 시 null */
  openProject(path?: string): Promise<ProjectData | null>
}
