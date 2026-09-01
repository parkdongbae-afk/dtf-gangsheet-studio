import { describe, expect, it } from 'vitest'
import {
  calculateGridPositions,
  centeredTopLeft,
  commitTransform,
  duplicateOffset,
  fitToCanvas,
  normalizeRotation,
  screenToDoc,
  viewCenterDoc,
  type FitSource,
  type GridSource,
  type PlacedTransform,
  type ViewTransform
} from './placement'

const identity: ViewTransform = { scale: 1, x: 0, y: 0 }

describe('screenToDoc', () => {
  it('scale 1·원점 0에서는 항등', () => {
    expect(screenToDoc(identity, 100, 200)).toEqual({ x: 100, y: 200 })
  })

  it('팬 오프셋을 문서 좌표로 환산', () => {
    const view: ViewTransform = { scale: 1, x: -50, y: 120 }
    expect(screenToDoc(view, 0, 0)).toEqual({ x: 50, y: -120 })
  })

  it('줌 배율로 나눈다 — 포인터 고정 줌의 역변환', () => {
    const view: ViewTransform = { scale: 0.1, x: 220, y: 160 }
    // 화면 (220+689, 160+690) = 문서 (6890, 6900) @ 10%
    expect(screenToDoc(view, 220 + 689, 160 + 690)).toEqual({ x: 6890, y: 6900 })
  })
})

describe('viewCenterDoc', () => {
  it('뷰포트 중심의 문서 좌표', () => {
    const view: ViewTransform = { scale: 0.05, x: 10, y: 20 }
    const c = viewCenterDoc(view, 1000, 500)
    expect(c.x).toBeCloseTo((500 - 10) / 0.05)
    expect(c.y).toBeCloseTo((250 - 20) / 0.05)
  })
})

describe('centeredTopLeft', () => {
  it('이미지 중심이 기준점에 정렬', () => {
    expect(centeredTopLeft(200, 100, { x: 1000, y: 500 }, 0, 1)).toEqual({ x: 900, y: 450 })
  })

  it('캐스케이드 간격은 화면 px 기준 — 줌 인 시 문서 좌표 간격 축소', () => {
    const a = centeredTopLeft(10, 10, { x: 0, y: 0 }, 0, 0.1)
    const b = centeredTopLeft(10, 10, { x: 0, y: 0 }, 1, 0.1)
    expect(b.x - a.x).toBeCloseTo(240) // 24 화면px ÷ 0.1
    const p = centeredTopLeft(10, 10, { x: 0, y: 0 }, 0, 8)
    const q = centeredTopLeft(10, 10, { x: 0, y: 0 }, 1, 8)
    expect(q.x - p.x).toBeCloseTo(3) // 24 ÷ 8
  })
})

describe('normalizeRotation', () => {
  it('90° 단위 래핑 — 항상 (-180, 180]', () => {
    expect(normalizeRotation(0)).toBe(0)
    expect(normalizeRotation(90)).toBe(90)
    expect(normalizeRotation(180)).toBe(180)
    expect(normalizeRotation(270)).toBe(-90)
    expect(normalizeRotation(360)).toBe(0)
    expect(normalizeRotation(-90)).toBe(-90)
    expect(normalizeRotation(-180)).toBe(180)
    expect(normalizeRotation(-270)).toBe(90)
  })

  it('1° 단위·다중 회전 래핑', () => {
    expect(normalizeRotation(181)).toBe(-179)
    expect(normalizeRotation(-181)).toBe(179)
    expect(normalizeRotation(725)).toBe(5)
    expect(normalizeRotation(-725)).toBe(-5)
  })
})

describe('commitTransform', () => {
  it('임시 scale을 절대 px 치수로 확정 — 등비(keepRatio) 리사이즈', () => {
    expect(
      commitTransform({
        x: 100,
        y: 200,
        rotation: 0,
        width: 600,
        height: 400,
        scaleX: 1.5,
        scaleY: 1.5
      })
    ).toEqual({ x: 100, y: 200, widthPx: 900, heightPx: 600, rotation: 0 })
  })

  it('축 비대칭(자유 비율) 리사이즈 + 회전각 정규화 동시 처리', () => {
    expect(
      commitTransform({
        x: -10,
        y: 0,
        rotation: 275,
        width: 100,
        height: 50,
        scaleX: 0.5,
        scaleY: 2
      })
    ).toEqual({ x: -10, y: 0, widthPx: 50, heightPx: 100, rotation: -85 })
  })
})

describe('duplicateOffset', () => {
  it('화면 24px을 줌 배율로 보정 — 문서 px 오프셋', () => {
    expect(duplicateOffset(1)).toBe(24)
    expect(duplicateOffset(8)).toBe(3)
    expect(duplicateOffset(0.1)).toBeCloseTo(240)
  })
})

describe('calculateGridPositions', () => {
  const item: GridSource = { x: 100, y: 200, widthPx: 600, heightPx: 400 }

  it('1×1 — 원본 자리 단일 셀', () => {
    expect(calculateGridPositions(item, 1, 1, 0)).toEqual([{ row: 0, col: 0, x: 100, y: 200 }])
  })

  it('3×4 gap 0 — 스텝 = 치수, row-major 순서, (0,0) = 원본 위치', () => {
    const cells = calculateGridPositions(item, 3, 4, 0)
    expect(cells).toHaveLength(12)
    expect(cells[0]).toEqual({ row: 0, col: 0, x: 100, y: 200 })
    expect(cells[3]).toEqual({ row: 0, col: 3, x: 100 + 3 * 600, y: 200 })
    expect(cells[5]).toEqual({ row: 1, col: 1, x: 100 + 600, y: 200 + 400 })
    expect(cells[11]).toEqual({ row: 2, col: 3, x: 100 + 3 * 600, y: 200 + 2 * 400 })
  })

  it('gap > 0 — 스텝 = 치수 + gap', () => {
    const cells = calculateGridPositions(item, 2, 2, 138)
    expect(cells[1]).toEqual({ row: 0, col: 1, x: 100 + 600 + 138, y: 200 })
    expect(cells[2]).toEqual({ row: 1, col: 0, x: 100, y: 200 + 400 + 138 })
  })

  it('float 치수·gap 반올림 없이 그대로 — 반복 변환 오차 불누적', () => {
    const f: GridSource = { x: 0.5, y: -0.25, widthPx: 123.4, heightPx: 56.7 }
    const cells = calculateGridPositions(f, 2, 2, 8.9)
    expect(cells[3].row).toBe(1)
    expect(cells[3].col).toBe(1)
    expect(cells[3].x).toBeCloseTo(0.5 + 132.3, 10)
    expect(cells[3].y).toBeCloseTo(-0.25 + 65.6, 10)
    expect(cells[3].x).not.toBe(133) // 반올림 금지 확인
  })

  it('음수 좌표(캔버스 밖) 순수 연산', () => {
    const n: GridSource = { x: -1000, y: -2000, widthPx: 100, heightPx: 100 }
    expect(calculateGridPositions(n, 2, 2, 50)[3]).toEqual({ row: 1, col: 1, x: -850, y: -1850 })
  })
})

describe('fitToCanvas', () => {
  const DOC_W = 6890
  const DOC_H = 13780

  /** 커밋 결과의 회전 바운딩 박스(문서 좌표) — 코너 4개 매핑 (u,v)→(x+u·cosθ−v·sinθ, y+u·sinθ+v·cosθ) */
  const bboxOf = (
    t: PlacedTransform
  ): { left: number; right: number; top: number; bottom: number } => {
    const rad = (t.rotation * Math.PI) / 180
    const cos = Math.cos(rad)
    const sin = Math.sin(rad)
    const corners: Array<[number, number]> = [
      [0, 0],
      [t.widthPx, 0],
      [t.widthPx, t.heightPx],
      [0, t.heightPx]
    ]
    const pts = corners.map(([u, v]) => [t.x + u * cos - v * sin, t.y + u * sin + v * cos])
    const xs = pts.map((p) => p[0])
    const ys = pts.map((p) => p[1])
    return {
      left: Math.min(...xs),
      right: Math.max(...xs),
      top: Math.min(...ys),
      bottom: Math.max(...ys)
    }
  }

  it('축 정렬 cover — 세로축 정확히 채우고 폭은 잘림(중심 오버플로), y=0', () => {
    const src: FitSource = { x: 1234, y: -567, widthPx: 600, heightPx: 400, rotation: 0 }
    const t = fitToCanvas(src, DOC_W, DOC_H, 'cover')
    const k = Math.max(DOC_W / 600, DOC_H / 400) // 34.45 — 세로 한계
    expect(t.widthPx).toBeCloseTo(600 * k, 6)
    expect(t.heightPx).toBeCloseTo(13780, 6)
    expect(t.x).toBeCloseTo((DOC_W - 600 * k) / 2, 6)
    expect(t.y).toBeCloseTo(0, 6)
    expect(t.rotation).toBe(0)
    const b = bboxOf(t)
    expect(b.right - b.left).toBeGreaterThanOrEqual(DOC_W - 1e-6)
    expect(b.bottom - b.top).toBeGreaterThanOrEqual(DOC_H - 1e-6)
  })

  it('축 정렬 contain — 폭 정확히 맞추고 세로는 중앙 수납, x=0', () => {
    const src: FitSource = { x: -999, y: 99999, widthPx: 600, heightPx: 400, rotation: 0 }
    const t = fitToCanvas(src, DOC_W, DOC_H, 'contain')
    const k = Math.min(DOC_W / 600, DOC_H / 400) // 폭 한계
    expect(t.widthPx).toBeCloseTo(DOC_W, 6)
    expect(t.heightPx).toBeCloseTo(400 * k, 6)
    expect(t.x).toBeCloseTo(0, 6)
    expect(t.y).toBeCloseTo((DOC_H - 400 * k) / 2, 6)
    const b = bboxOf(t)
    expect(b.right - b.left).toBeLessThanOrEqual(DOC_W + 1e-6)
    expect(b.bottom - b.top).toBeLessThanOrEqual(DOC_H + 1e-6)
  })

  it('90° 회전 contain — 바운딩 박스 기준 스케일, 로컬 비율 유지, 문서 중심 정렬', () => {
    const src: FitSource = { x: 0, y: 0, widthPx: 400, heightPx: 300, rotation: 90 }
    const t = fitToCanvas(src, DOC_W, DOC_H, 'contain')
    const k = Math.min(DOC_W / 300, DOC_H / 400) // 회전 바운딩 박스 300×400에서 폭 한계
    expect(t.widthPx).toBeCloseTo(400 * k, 6)
    expect(t.heightPx).toBeCloseTo(400 * k * (300 / 400), 6) // 300k — 비율 유지
    // cos90≈0, sin90=1: x = cx + h'/2, y = cy − w'/2
    expect(t.x).toBeCloseTo(DOC_W / 2 + (300 * k) / 2, 6)
    expect(t.y).toBeCloseTo(DOC_H / 2 - (400 * k) / 2, 6)
    expect(t.rotation).toBe(90)
    const b = bboxOf(t)
    expect(b.right - b.left).toBeLessThanOrEqual(DOC_W + 1e-6)
    expect(b.bottom - b.top).toBeLessThanOrEqual(DOC_H + 1e-6)
    expect((b.left + b.right) / 2).toBeCloseTo(DOC_W / 2, 6)
    expect((b.top + b.bottom) / 2).toBeCloseTo(DOC_H / 2, 6)
  })

  it('90° 회전 cover — 문서 전체를 덮음(양방향), 중심 정렬', () => {
    const src: FitSource = { x: 0, y: 0, widthPx: 400, heightPx: 300, rotation: 90 }
    const t = fitToCanvas(src, DOC_W, DOC_H, 'cover')
    const k = Math.max(DOC_W / 300, DOC_H / 400)
    expect(t.widthPx).toBeCloseTo(400 * k, 6)
    expect(t.heightPx).toBeCloseTo(300 * k, 6)
    const b = bboxOf(t)
    expect(b.right - b.left).toBeGreaterThanOrEqual(DOC_W - 1e-6)
    expect(b.bottom - b.top).toBeGreaterThanOrEqual(DOC_H - 1e-6)
    expect((b.left + b.right) / 2).toBeCloseTo(DOC_W / 2, 6)
    expect((b.top + b.bottom) / 2).toBeCloseTo(DOC_H / 2, 6)
  })

  it('임의 각(30°·−45°·137.5°·180°) — 중심 정렬·비율 유지·모드 불변식', () => {
    for (const deg of [30, -45, 137.5, 180]) {
      const src: FitSource = { x: 500, y: 500, widthPx: 600, heightPx: 400, rotation: deg }
      for (const mode of ['cover', 'contain'] as const) {
        const t = fitToCanvas(src, DOC_W, DOC_H, mode)
        expect(t.rotation).toBe(deg)
        expect(t.widthPx / t.heightPx).toBeCloseTo(600 / 400, 9)
        const b = bboxOf(t)
        expect((b.left + b.right) / 2).toBeCloseTo(DOC_W / 2, 6)
        expect((b.top + b.bottom) / 2).toBeCloseTo(DOC_H / 2, 6)
        if (mode === 'cover') {
          expect(b.right - b.left).toBeGreaterThanOrEqual(DOC_W - 1e-6)
          expect(b.bottom - b.top).toBeGreaterThanOrEqual(DOC_H - 1e-6)
        } else {
          expect(b.right - b.left).toBeLessThanOrEqual(DOC_W + 1e-6)
          expect(b.bottom - b.top).toBeLessThanOrEqual(DOC_H + 1e-6)
        }
      }
    }
  })

  it('극단 비율 — 세로 100px 항목 contain 시 폭 한계 지배', () => {
    const src: FitSource = { x: 0, y: 0, widthPx: 10000, heightPx: 100, rotation: 0 }
    const t = fitToCanvas(src, DOC_W, DOC_H, 'contain')
    expect(t.widthPx).toBeCloseTo(DOC_W, 6)
    expect(t.heightPx).toBeCloseTo(100 * (DOC_W / 10000), 6)
    expect(t.y).toBeCloseTo((DOC_H - t.heightPx) / 2, 6)
  })

  it('원본 x/y는 결과에 무관 — 항상 문서 중심 재배치', () => {
    const a: FitSource = { x: 0, y: 0, widthPx: 600, heightPx: 400, rotation: 33 }
    const b: FitSource = { x: -98765, y: 4321, widthPx: 600, heightPx: 400, rotation: 33 }
    expect(fitToCanvas(a, DOC_W, DOC_H, 'cover')).toEqual(fitToCanvas(b, DOC_W, DOC_H, 'cover'))
    expect(fitToCanvas(a, DOC_W, DOC_H, 'contain')).toEqual(fitToCanvas(b, DOC_W, DOC_H, 'contain'))
  })
})
