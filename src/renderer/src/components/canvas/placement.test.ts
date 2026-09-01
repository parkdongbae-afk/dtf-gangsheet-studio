import { describe, expect, it } from 'vitest'
import {
  centeredTopLeft,
  commitTransform,
  normalizeRotation,
  screenToDoc,
  viewCenterDoc,
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
