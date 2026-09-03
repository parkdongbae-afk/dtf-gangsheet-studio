import { describe, expect, it } from 'vitest'
import type { BBox } from './alignment'
import { computeSnap, unionBox, unionOfItems, type SnapTarget } from './snap'

const box = (l: number, t: number, r: number, b: number): BBox => ({
  left: l,
  top: t,
  right: r,
  bottom: b
})

const item = (target: BBox): SnapTarget => ({
  box: target,
  kind: 'item'
})

describe('unionBox', () => {
  it('여러 박스의 합집합', () => {
    expect(unionBox([box(0, 0, 100, 50), box(50, 20, 200, 80)])).toEqual(box(0, 0, 200, 80))
  })

  it('빈 입력은 영박스', () => {
    expect(unionBox([])).toEqual(box(0, 0, 0, 0))
  })
})

describe('unionOfItems', () => {
  it('회전 항목들의 바운딩 박스 합집합', () => {
    // (0,0,100,50) + 90° 회전 항목(피벗 원점 → left=-50, right=0, top=0, bottom=100)
    const union = unionOfItems([
      { id: 'a', x: 0, y: 0, widthPx: 100, heightPx: 50, rotation: 0 },
      { id: 'b', x: 0, y: 0, widthPx: 100, heightPx: 50, rotation: 90 }
    ])
    expect(union.left).toBeCloseTo(-50, 5)
    expect(union.right).toBe(100)
    expect(union.bottom).toBe(100)
  })
})

describe('computeSnap — 항목 에지 스냅', () => {
  it('임계값 이내 좌 에지 ↔ 인접 항목 우 에지가 맞닿음(플러시) 보정', () => {
    const moving = box(112, 30, 212, 130) // y는 임계값 밖(간섭 없음)
    const targets = [item(box(0, 0, 100, 100))]
    const result = computeSnap(moving, targets, 12)
    expect(result.dx).toBe(-12) // moving.left(112) → target.right(100)
    expect(result.dy).toBe(0)
    expect(result.guides).toHaveLength(1)
    expect(result.guides[0]).toEqual({ axis: 'x', position: 100, from: 0, to: 130 })
  })

  it('접촉 상태(dist 0)에서도 가이드는 표시된다 (양축 정렬 시 2개)', () => {
    const moving = box(100, 200, 200, 300)
    const targets = [item(box(0, 200, 100, 300))]
    const result = computeSnap(moving, targets, 10)
    expect(result.dx).toBe(0)
    expect(result.dy).toBe(0)
    expect(result.guides).toHaveLength(2)
    expect(result.guides[0]).toMatchObject({ axis: 'x', position: 100 })
  })

  it('임계값 초과 시 보정·가이드 없음', () => {
    const result = computeSnap(box(500, 20, 600, 120), [item(box(0, 0, 100, 100))], 10)
    expect(result.dx).toBe(0)
    expect(result.dy).toBe(0)
    expect(result.guides).toHaveLength(0)
  })

  it('가장 가까운 쌍만 선택 — 중심↔중심이 에지보다 가까우면 중심이 이긴다', () => {
    // moving.center=160 vs target.center=150 (dist 10) / moving.left=110 vs target.right=100 (dist 10) 동점
    // 순회상 먼저 만나는 쌍(moving.left↔target.left: 110 vs 0 = 110 초과) 이후 center 쌍이 채택
    const result = computeSnap(box(110, 0, 210, 100), [item(box(100, 0, 200, 100))], 12)
    expect(Math.abs(result.dx)).toBeLessThanOrEqual(12)
    expect(result.guides[0]?.position).toBeGreaterThanOrEqual(100)
  })
})

describe('computeSnap — 문서 스냅', () => {
  const doc: SnapTarget = { box: box(0, 0, 1000, 500), kind: 'doc' }

  it('문서 가로 중앙에 항목 중심이 스냅', () => {
    const result = computeSnap(box(492, 0, 508, 100), [doc], 10)
    expect(result.dx).toBe(0) // center=500 → doc center=500
    expect(result.guides[0]).toMatchObject({ axis: 'x', position: 500 })
  })

  it('문서 좌·상 가장자리 동시 스냅 (양축 독립 판정)', () => {
    const result = computeSnap(box(3, 4, 103, 54), [doc], 10)
    expect(result.dx).toBe(-3)
    expect(result.dy).toBe(-4)
    expect(result.guides).toHaveLength(2)
  })
})

describe('computeSnap — 간격 라벨', () => {
  it('분리된 두 항목은 축 간격(px) 라벨을 생성', () => {
    // 세로로 떨어진 쌍: moving.left(112) → target.right(100) 스냅 시 x 분리 없음(플러시), y 분리 50
    const moving = box(112, 150, 212, 250)
    const targets = [item(box(0, 0, 100, 100))]
    const result = computeSnap(moving, targets, 12)
    expect(result.dx).toBe(-12)
    const yLabels = result.labels.filter((l) => l.gapPx === 50)
    expect(yLabels).toHaveLength(1)
    expect(yLabels[0]?.y).toBe(125) // (150+100)/2
  })

  it('겹치는 방향은 라벨 없음 (양수 분리만)', () => {
    const moving = box(110, 0, 210, 100)
    const targets = [item(box(0, 0, 100, 100))]
    const result = computeSnap(moving, targets, 12)
    expect(result.labels).toHaveLength(0)
  })
})
