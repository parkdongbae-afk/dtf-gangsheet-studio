import { describe, expect, it } from 'vitest'
import {
  alignItems,
  marqueeRect,
  marqueeSelection,
  rectsIntersect,
  rotatedBBox,
  type AlignableItem,
  type ItemMove
} from './alignment'

const item = (
  id: string,
  x: number,
  y: number,
  widthPx: number,
  heightPx: number,
  rotation = 0
): AlignableItem => ({ id, x, y, widthPx, heightPx, rotation })

// --- 회전 바운딩 박스 (Konva 원점 피벗 규약) ---

describe('rotatedBBox — Konva 원점 피벗 회전 박스', () => {
  it('θ=0 — (x, y, x+w, y+h)로 퇴화', () => {
    expect(rotatedBBox(item('a', 100, 200, 300, 100))).toEqual({
      left: 100,
      top: 200,
      right: 400,
      bottom: 300
    })
  })

  it('θ=90 — w×h가 90° 회전해 h×w가 되고 박스는 피벗 왼쪽으로 h만큼 확장', () => {
    // 피벗 (100,200), w=300 h=100 → 회전 후 박스 (100-100, 200, 100, 200+300) — 부동소수점 ε 허용
    const box = rotatedBBox(item('a', 100, 200, 300, 100, 90))
    expect(box.left).toBeCloseTo(0, 10)
    expect(box.top).toBeCloseTo(200, 10)
    expect(box.right).toBeCloseTo(100, 10)
    expect(box.bottom).toBeCloseTo(500, 10)
  })

  it('θ=-90 — 반시계 사분면: 박스는 피벗 오른쪽·위쪽으로 확장', () => {
    const box = rotatedBBox(item('a', 100, 200, 300, 100, -90))
    expect(box.left).toBeCloseTo(100, 10)
    expect(box.top).toBeCloseTo(-100, 10)
    expect(box.right).toBeCloseTo(200, 10)
    expect(box.bottom).toBeCloseTo(200, 10)
  })

  it('θ=45 — 부동소수점 코너 수학 (±0.001 허용)', () => {
    const box = rotatedBBox(item('a', 0, 0, 100, 50, 45))
    expect(box.left).toBeCloseTo(-50 / Math.sqrt(2), 3)
    expect(box.top).toBeCloseTo(0, 3)
    expect(box.right).toBeCloseTo(100 / Math.sqrt(2), 3)
    expect(box.bottom).toBeCloseTo(150 / Math.sqrt(2), 3)
  })
})

// --- AABB 부분 교차 (TECH §4.1) ---

describe('rectsIntersect / marqueeSelection — 부분 교차 즉시 선택', () => {
  it('1px만 겹쳐도 교차 (TC-1)', () => {
    expect(
      rectsIntersect(
        { left: -10, top: -10, right: 1, bottom: 60 },
        { left: 0, top: 0, right: 100, bottom: 50 }
      )
    ).toBe(true)
  })

  it('완전 분리(우측/하단)는 미교차', () => {
    const img = { left: 0, top: 0, right: 100, bottom: 50 }
    expect(rectsIntersect({ left: 101, top: 0, right: 200, bottom: 100 }, img)).toBe(false)
    expect(rectsIntersect({ left: 0, top: 51, right: 100, bottom: 100 }, img)).toBe(false)
  })

  it('드래그 방향 무관 정규화 — 우하→좌상 드래그도 동일 사각형', () => {
    expect(marqueeRect({ x: 500, y: 500 }, { x: 100, y: 100 })).toEqual(
      marqueeRect({ x: 100, y: 100 }, { x: 500, y: 500 })
    )
  })

  it('마키가 회전 항목의 노출 영역(회전 bbox)과 교차하면 선택', () => {
    // 회전 90° 항목의 bbox는 (0,200)-(100,500) — 원본 좌표 (100,200)과 다른 영역
    const items = [item('rot', 100, 200, 300, 100, 90), item('flat', 5000, 5000, 100, 100)]
    const hits = marqueeSelection(items, { x: 50, y: 300 }, { x: 80, y: 400 })
    expect(hits).toEqual(['rot'])
  })
})

// --- 정렬 (TECH §4.3 — 회전 bbox 일반화) ---

describe('alignItems — 6종 정렬', () => {
  // bbox: a(0..100, 0..100) b(50..250, 80..130) c(200..300, 10..110) — xMin 0·xMax 300·yMin 0·yMax 130
  const a = item('a', 0, 0, 100, 100)
  const b = item('b', 50, 80, 200, 50)
  const c = item('c', 200, 10, 100, 100)
  const byId = (moves: NonNullable<ReturnType<typeof alignItems>>, id: string): ItemMove =>
    moves.find((m) => m.id === id)!

  it('좌측 정렬 — 모든 bbox.left = 0, y 불변', () => {
    const moves = alignItems([a, b, c], 'left')!
    expect(moves.map((m) => m.x)).toEqual([0, 0, 0])
    expect(byId(moves, 'b').y).toBe(80)
  })

  it('우측 정렬 — 모든 bbox.right = 300 (폭 차이만큼 x 상이)', () => {
    const moves = alignItems([a, b, c], 'right')!
    expect(moves.map((m) => m.x)).toEqual([200, 100, 200])
  })

  it('가로 중앙 정렬 — bbox 수평 중심 = 선택 전체 중심(150)', () => {
    const moves = alignItems([a, b, c], 'centerH')!
    expect(moves.map((m) => m.x)).toEqual([100, 50, 100])
  })

  it('상단·하단·세로 중앙 정렬 — y축 동일 수학', () => {
    expect(alignItems([a, b, c], 'top')!.map((m) => m.y)).toEqual([0, 0, 0])
    expect(alignItems([a, b, c], 'bottom')!.map((m) => m.y)).toEqual([30, 80, 30])
    expect(alignItems([a, b, c], 'centerV')!.map((m) => m.y)).toEqual([15, 40, 15])
  })

  it('회전 항목은 노출 bbox 기준으로 평행이동 — 회전값·다른 축 불변', () => {
    const rot = item('rot', 1000, 1000, 100, 50, 90) // bbox (950,1000)-(1000,1100)
    const moves = alignItems([rot, a], 'left')! // xMin = 0
    const m = byId(moves, 'rot')
    expect(m.x).toBe(1000 - 950)
    expect(m.y).toBe(1000)
  })
})

// --- 균등 분배 ---

describe('alignItems — 균등 분배 (distH·distV)', () => {
  const a = item('a', 0, 0, 100, 100)
  const b = item('b', 1000, 0, 100, 100)
  const c = item('c', 3000, 0, 100, 100)

  it('수평 분배 — 양 끝 고정, 내부 간격 (3100-300)/2 = 1400 균등', () => {
    const moves = alignItems([a, b, c], 'distH')!
    const byId = (id: string): ItemMove => moves.find((m) => m.id === id)!
    expect(byId('a').x).toBe(0)
    expect(byId('b').x).toBe(1500)
    expect(byId('c').x).toBe(3000)
    expect(moves.every((m) => m.y === 0)).toBe(true)
  })

  it('수직 분배 — 세로 축 동일 수학', () => {
    const v = [
      item('a', 0, 0, 100, 100),
      item('b', 0, 1000, 100, 100),
      item('c', 0, 3000, 100, 100)
    ]
    const moves = alignItems(v, 'distV')!
    expect(moves.map((m) => m.y)).toEqual([0, 1500, 3000])
  })

  it('2개는 분배 불가 → null (정렬은 가능)', () => {
    expect(alignItems([a, b], 'distH')).toBeNull()
    expect(alignItems([a, b], 'left')).not.toBeNull()
  })

  it('정렬 최소 1개·분배 최소 2개 → null', () => {
    expect(alignItems([a], 'left')).toBeNull()
    expect(alignItems([a, b], 'distV')).toBeNull()
  })
})
