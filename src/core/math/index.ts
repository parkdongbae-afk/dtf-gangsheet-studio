/**
 * 수학 유틸 (cm↔px 변환, PSD 치수 가드) — CLAUDE.md §2.2 표준식.
 * UI 라이브러리 의존 없는 순수 함수만 둔다 (S2 선검증, Vitest).
 */

/** PSD 표준 최대 치수 — 변당 30,000px (3m=41,339px 금지의 근거) */
export const PSD_MAX_PX = 30_000

/** DTF 롤 기본 가로 폭 (cm) — 가로폭 선택 기본값 */
export const DTF_WIDTH_CM = 50

/** 문서 캔버스 가로 (px) — 50cm @ 350dpi = 6,890 */
export const CANVAS_WIDTH_PX = cmToPx(DTF_WIDTH_CM, 350)

/** 가로 폭 선택 단위 (cm) — 1cm 스텝 */
export const WIDTH_STEP_CM = 1

/** 가로 폭 최소 (cm) */
export const MIN_WIDTH_CM = 5

/** 가로 폭 최대 (cm) — 1m */
export const MAX_WIDTH_CM = 100

/** 가로 폭 프리셋 — 1cm 단위 5~100cm */
export const WIDTH_PRESETS_CM: readonly number[] = Array.from(
  { length: (MAX_WIDTH_CM - MIN_WIDTH_CM) / WIDTH_STEP_CM + 1 },
  (_, i) => MIN_WIDTH_CM + i * WIDTH_STEP_CM
)

/** 세로 길이 프리셋 — 1m·2m만 허용 (3m+는 PSD 한계 초과) */
export const HEIGHT_PRESETS_M = [1, 2] as const

export type HeightPresetM = (typeof HEIGHT_PRESETS_M)[number]

/** cm → px 환산 (반올림). 모든 내부 수치는 350 DPI 절대 픽셀 기준. */
export function cmToPx(cm: number, dpi: number = 350): number {
  return Math.round((cm / 2.54) * dpi)
}

/** px → cm 환산 (표시 전용 — 내부 데이터는 항상 px). */
export function pxToCm(px: number, dpi: number = 350): number {
  return (px / dpi) * 2.54
}

/** mm → px 환산 (반올림 없음 — 키보드 누적 이동의 드리프트 방지). 방향키 이동 거리용. */
export function mmToPx(mm: number, dpi: number = 350): number {
  return (mm / 25.4) * dpi
}

/** px → mm 환산 (표시 전용). */
export function pxToMm(px: number, dpi: number = 350): number {
  return (px / dpi) * 25.4
}

/** PSD 치수 한계 초과 오류 — 2m 단위 분할 안내 (CLAUDE.md §1-3) */
export class CanvasSizeLimitError extends Error {
  readonly requestedPx: number

  constructor(requestedPx: number) {
    super(`PSD 최대 치수(30,000px) 초과 — 2m 단위로 분할할 것 (요청: ${requestedPx}px)`)
    this.name = 'CanvasSizeLimitError'
    this.requestedPx = requestedPx
  }
}

/** 세로 길이(m) → 캔버스 높이(px). 1m=13,780 / 2m=27,559. */
export function getCanvasHeightPx(heightInMeters: number): number {
  const px = cmToPx(heightInMeters * 100, 350)
  if (px > PSD_MAX_PX) {
    throw new CanvasSizeLimitError(px)
  }
  return px
}

/** 가로 폭(cm) → 캔버스 폭(px). 50cm=6,890 / 100cm=13,780 (PSD 한계 내). */
export function getCanvasWidthPx(widthCm: number): number {
  const px = cmToPx(widthCm, 350)
  if (px > PSD_MAX_PX) {
    throw new CanvasSizeLimitError(px)
  }
  return px
}
