import { describe, expect, it } from 'vitest'
import { cmToPx } from '../../../../core/math'
import {
  DEFAULT_GRID_SETTINGS,
  GRID_COLOR_PRESETS,
  GRID_INTERVAL_MAX_CM,
  GRID_INTERVAL_MIN_CM,
  GRID_LINE_STYLES,
  clampGridIntervalCm,
  gridDash,
  gridLinePositions
} from './gridOverlay'

describe('clampGridIntervalCm', () => {
  it('범위 내 값은 그대로', () => {
    expect(clampGridIntervalCm(5)).toBe(5)
    expect(clampGridIntervalCm(0.5)).toBe(0.5)
  })

  it('최소 0.5cm·최대 50cm 클램프', () => {
    expect(clampGridIntervalCm(0.1)).toBe(GRID_INTERVAL_MIN_CM)
    expect(clampGridIntervalCm(100)).toBe(GRID_INTERVAL_MAX_CM)
  })

  it('NaN·±Infinity → 기본값 (유효하지 않은 입력 전부)', () => {
    expect(clampGridIntervalCm(Number.NaN)).toBe(DEFAULT_GRID_SETTINGS.intervalCm)
    expect(clampGridIntervalCm(Number.POSITIVE_INFINITY)).toBe(DEFAULT_GRID_SETTINGS.intervalCm)
    expect(clampGridIntervalCm(Number.NEGATIVE_INFINITY)).toBe(DEFAULT_GRID_SETTINGS.intervalCm)
  })
})

describe('gridLinePositions', () => {
  it('50cm 문서에 5cm 간격 → 내부 9개 (경계 제외)', () => {
    const docPx = cmToPx(50)
    const positions = gridLinePositions(docPx, 5)
    expect(positions).toHaveLength(9)
    expect(positions[0]).toBe(cmToPx(5))
    expect(positions[8]).toBe(cmToPx(45))
  })

  it('경계값(0, 문서 끝)은 포함하지 않음 — 문서 테두리와 겹침 방지', () => {
    const docPx = cmToPx(50)
    const positions = gridLinePositions(docPx, 5)
    expect(positions.every((p) => p > 0 && p < docPx)).toBe(true)
  })

  it('간격이 문서보다 크거나 같으면 빈 배열', () => {
    expect(gridLinePositions(cmToPx(10), 50)).toEqual([])
    expect(gridLinePositions(cmToPx(10), 10)).toEqual([])
  })

  it('2m 문서 0.5cm 간격 → 399개 (성능 상한 확인용)', () => {
    expect(gridLinePositions(cmToPx(200), 0.5)).toHaveLength(399)
  })
})

describe('gridDash', () => {
  it('solid → undefined (대시 없음)', () => {
    expect(gridDash('solid', 1)).toBeUndefined()
  })

  it('dashed → 화면 [6,4]를 스케일로 나눈 문서 px', () => {
    expect(gridDash('dashed', 1)).toEqual([6, 4])
    expect(gridDash('dashed', 0.5)).toEqual([12, 8])
  })

  it('dotted → 대시 길이=선 두께(화면 1px 점) + 화면 4px 간격', () => {
    expect(gridDash('dotted', 1)).toEqual([1, 4])
    expect(gridDash('dotted', 2)).toEqual([0.5, 2])
  })

  it('0 이하 스케일 → 안전 클램프(1로 나눔)', () => {
    expect(gridDash('dashed', 0)).toEqual([6, 4])
  })
})

describe('상수 무결성', () => {
  it('기본 설정 — 숨김·5cm·프리셋 첫 색·실선', () => {
    expect(DEFAULT_GRID_SETTINGS).toEqual({
      visible: false,
      intervalCm: 5,
      color: GRID_COLOR_PRESETS[0],
      lineStyle: 'solid'
    })
  })

  it('선 스타일 목록 = solid·dashed·dotted', () => {
    expect(GRID_LINE_STYLES).toEqual(['solid', 'dashed', 'dotted'])
  })
})
