import { describe, expect, it } from 'vitest'
import {
  CANVAS_WIDTH_PX,
  CanvasSizeLimitError,
  DTF_WIDTH_CM,
  HEIGHT_PRESETS_M,
  MAX_WIDTH_CM,
  MIN_WIDTH_CM,
  PSD_MAX_PX,
  WIDTH_PRESETS_CM,
  WIDTH_STEP_CM,
  cmToPx,
  getCanvasHeightPx,
  getCanvasWidthPx,
  pxToCm
} from './index'

describe('cmToPx', () => {
  it('2.54cm @ 350dpi → 350px (단위 환산 항등)', () => {
    expect(cmToPx(2.54, 350)).toBe(350)
  })

  it('1cm @ 350dpi → 138px (반올림: 137.795…)', () => {
    expect(cmToPx(1, 350)).toBe(138)
  })

  it('0cm → 0px', () => {
    expect(cmToPx(0, 350)).toBe(0)
  })

  it('dpi 생략 시 기본 350 적용', () => {
    expect(cmToPx(2.54)).toBe(350)
  })
})

describe('pxToCm', () => {
  it('350px @ 350dpi → 2.54cm (cmToPx 역변환)', () => {
    expect(pxToCm(350, 350)).toBeCloseTo(2.54)
  })

  it('13,780px @ 350dpi → 100cm (1m 문서 높이)', () => {
    expect(pxToCm(13780)).toBeCloseTo(100)
  })

  it('0px → 0cm', () => {
    expect(pxToCm(0)).toBe(0)
  })
})

describe('getCanvasHeightPx — PSD 치수 가드', () => {
  it('1m → 13,780px', () => {
    expect(getCanvasHeightPx(1)).toBe(13780)
  })

  it('2m → 27,559px (허용 프리셋 최대치)', () => {
    expect(getCanvasHeightPx(2)).toBe(27559)
  })

  it('3m → PSD 한계 초과로 throw (3m 옵션 금지 규칙)', () => {
    expect(() => getCanvasHeightPx(3)).toThrowError(/30,000px|PSD 최대/)
  })
})

describe('문서 규격 상수', () => {
  it('CANVAS_WIDTH_PX = 6,890 (가로 50cm @ 350dpi)', () => {
    expect(DTF_WIDTH_CM).toBe(50)
    expect(CANVAS_WIDTH_PX).toBe(6890)
  })

  it('PSD_MAX_PX = 30,000 (변당 최대 — 300,000 아님)', () => {
    expect(PSD_MAX_PX).toBe(30000)
  })

  it('세로 프리셋은 1m·2m만 존재', () => {
    expect([...HEIGHT_PRESETS_M]).toEqual([1, 2])
  })
})

describe('getCanvasWidthPx — 가로 폭 선택', () => {
  it('50cm → 6,890px (기본 DTF 롤 폭)', () => {
    expect(getCanvasWidthPx(50)).toBe(CANVAS_WIDTH_PX)
  })

  it('100cm(1m) → 13,780px — 최대 허용', () => {
    expect(getCanvasWidthPx(100)).toBe(13780)
  })

  it('5cm → 6,890px 미만 (689px)', () => {
    expect(getCanvasWidthPx(5)).toBe(cmToPx(5))
  })

  it('250cm → PSD 한계 초과로 throw', () => {
    expect(() => getCanvasWidthPx(250)).toThrowError(CanvasSizeLimitError)
  })
})

describe('WIDTH_PRESETS_CM — 1cm 단위 프리셋', () => {
  it('5~100cm까지 1cm 스텝 96개', () => {
    expect(WIDTH_PRESETS_CM).toHaveLength(96)
    expect(WIDTH_PRESETS_CM[0]).toBe(MIN_WIDTH_CM)
    expect(WIDTH_PRESETS_CM[WIDTH_PRESETS_CM.length - 1]).toBe(MAX_WIDTH_CM)
  })

  it('모든 프리셋이 정수 cm이고 PSD 한계 내', () => {
    for (const cm of WIDTH_PRESETS_CM) {
      expect(cm % WIDTH_STEP_CM).toBe(0)
      expect(Number.isInteger(cm)).toBe(true)
      expect(cmToPx(cm)).toBeLessThanOrEqual(PSD_MAX_PX)
    }
  })
})
