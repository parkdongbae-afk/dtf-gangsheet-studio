import { cmToPx } from '../../../../core/math'

/** 그리드 선 스타일 — solid=실선, dashed=대시, dotted=점 */
export type GridLineStyle = 'solid' | 'dashed' | 'dotted'

/** 그리드 표시 설정 — 보기 옵션(씬 상태 아님, 히스토리 대상 아님) */
export interface GridSettings {
  visible: boolean
  intervalCm: number
  color: string
  lineStyle: GridLineStyle
}

export const GRID_INTERVAL_MIN_CM = 0.5
export const GRID_INTERVAL_MAX_CM = 50

export const GRID_COLOR_PRESETS = [
  '#71717a',
  '#e4e4e7',
  '#000000',
  '#6366f1',
  '#ef4444',
  '#22c55e',
  '#3b82f6',
  '#eab308'
] as const

export const GRID_LINE_STYLES: readonly GridLineStyle[] = ['solid', 'dashed', 'dotted']

export const GRID_STYLE_LABELS: Record<GridLineStyle, string> = {
  solid: '실선',
  dashed: '대시',
  dotted: '도트'
}

export const DEFAULT_GRID_SETTINGS: GridSettings = {
  visible: false,
  intervalCm: 5,
  color: '#71717a',
  lineStyle: 'solid'
}

export function clampGridIntervalCm(cm: number): number {
  if (!Number.isFinite(cm)) return DEFAULT_GRID_SETTINGS.intervalCm
  return Math.min(Math.max(cm, GRID_INTERVAL_MIN_CM), GRID_INTERVAL_MAX_CM)
}

/** 문서 내부 격자선 위치(문서 px) — 경계 0과 문서 끝은 문서 테두리와 겹쳐 제외 */
export function gridLinePositions(docPx: number, intervalCm: number): number[] {
  const stepPx = cmToPx(clampGridIntervalCm(intervalCm))
  const positions: number[] = []
  for (let i = 1; i * stepPx < docPx; i++) {
    positions.push(i * stepPx)
  }
  return positions
}

/**
 * 화면 px 대시 패턴을 문서 px로 환산 — 스테이지 스케일을 나눠 줌과 무관한
 * 일정한 화면 대시를 만든다. dotted는 round 라인캡과 함께 대시 길이=선 두께(화면 1px)
 * 로 점을 그린다 (0에 가까운 대시는 Chromium이 스킵해 렌더링되지 않음).
 */
export function gridDash(lineStyle: GridLineStyle, viewScale: number): number[] | undefined {
  const s = viewScale > 0 ? viewScale : 1
  if (lineStyle === 'dashed') return [6 / s, 4 / s]
  if (lineStyle === 'dotted') return [1 / s, 4 / s]
  return undefined
}
