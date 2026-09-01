/**
 * 공유 IPC 계약 (CLAUDE.md §2.1 src/types) — 메인·프리로드·렌더러가 함께 참조.
 *
 * 원칙: 렌더러 ↔ 메인 사이에 이미지 바이너리(ArrayBuffer)를 전송하지 않고
 * 파일 절대 경로만 주고받는다. 프리뷰는 메인 프로세스에서 ≤2,048px로
 * 리사이즈한 PNG dataURL로 전달한다 (S4 절약 패턴 #1·#2).
 */

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

/** 프리로드가 렌더러에 노출하는 에디터 API */
export interface DtfApi {
  /** 파일 대화상자(다중 선택) — 취소 시 null */
  openImages(): Promise<string[] | null>
  /** 원본 경로만 전달해 임포트 — 프리뷰 dataURL + 원본 px 반환 */
  importImage(filePath: string): Promise<ImportedImage>
  /** 드래그앤드롭 File → 절대 경로 — Electron 32+ 에서 File.path 제거의 공식 대체 */
  getPathForFile(file: File): string
}
