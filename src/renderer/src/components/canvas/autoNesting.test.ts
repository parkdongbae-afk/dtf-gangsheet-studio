import { describe, expect, it } from 'vitest'
import Konva from 'konva'
import { cmToPx } from '../../../../core/math'
import { packImages, type NestedPlacement, type NestingInput } from './autoNesting'

const GAP2 = cmToPx(2) // 276px @ 350dpi
const HALF2 = GAP2 / 2

const item = (id: string, w: number, h: number, rotation = 0): NestingInput => ({
  id,
  widthPx: w,
  heightPx: h,
  rotation
})

describe('packImages — 기본 배치', () => {
  it('단일 이미지는 상단 좌측 (gap/2, gap/2)에 밀집', () => {
    const r = packImages([item('a', 500, 300)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 2000,
      gapCm: 2
    })
    expect(r.packedItems).toHaveLength(1)
    expect(r.packedItems[0]).toMatchObject({ id: 'a', x: HALF2, y: HALF2, rotation: 0 })
    expect(r.usedHeightPx).toBe(HALF2 + 300)
    expect(r.efficiency).toBeCloseTo((150000 / (1000 * (HALF2 + 300))) * 100, 3)
    expect(r.unpackedIds).toEqual([])
  })

  it('같은 폭 두 이미지는 수직 스택 — 시각 간격 = gap', () => {
    const r = packImages([item('small', 500, 300), item('big', 500, 400)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 4000,
      gapCm: 2
    })
    expect(r.unpackedIds).toEqual([])
    // 면적 큰 big 먼저 → (138,138), small은 바로 아래
    const big = r.packedItems.find((p) => p.id === 'big')
    const small = r.packedItems.find((p) => p.id === 'small')
    expect(big).toMatchObject({ x: HALF2, y: HALF2 })
    expect(small).toBeDefined()
    expect(small!.x).toBe(HALF2)
    expect(small!.y - (HALF2 + 400)).toBe(GAP2)
    expect(r.usedHeightPx).toBe(small!.y + 300)
  })

  it('gap 0 — 상단 좌측에 딱 붙어 배치', () => {
    const r = packImages([item('a', 500, 300), item('b', 500, 300)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 2000,
      gapCm: 0
    })
    const b = r.packedItems.find((p) => p.id === 'b')
    expect(r.packedItems.find((p) => p.id === 'a')).toMatchObject({ x: 0, y: 0 })
    // BAF은 잔여 면적 최소 선택 — 폭 여유 0인 우측 열에 나란히 (높이 300 유지)
    expect(b).toMatchObject({ x: 500, y: 0 })
    expect(r.usedHeightPx).toBe(300)
  })

  it('빈 입력 — 무연산', () => {
    const r = packImages([], { canvasWidthPx: 1000, canvasHeightPx: 2000 })
    expect(r.packedItems).toEqual([])
    expect(r.usedHeightPx).toBe(0)
    expect(r.efficiency).toBe(0)
    expect(r.unpackedIds).toEqual([])
  })

  it('기본 옵션 — gapCm 생략 시 2.0cm와 동일', () => {
    const explicit = packImages([item('a', 500, 300)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 2000,
      gapCm: 2
    })
    const omitted = packImages([item('a', 500, 300)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 2000
    })
    expect(omitted).toEqual(explicit)
  })
})

describe('packImages — 회전 옵션', () => {
  it('회전으로만 들어가는 이미지 — allowRotation=false 미배치', () => {
    const r = packImages([item('wide', 1500, 400)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 3000,
      gapCm: 2,
      allowRotation: false
    })
    expect(r.packedItems).toEqual([])
    expect(r.unpackedIds).toEqual(['wide'])
  })

  it('회전으로만 들어가는 이미지 — allowRotation=true 90° 자동 회전', () => {
    const r = packImages([item('wide', 1500, 400)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 3000,
      gapCm: 2,
      allowRotation: true
    })
    expect(r.unpackedIds).toEqual([])
    const p = r.packedItems[0]
    expect(p.rotation).toBe(90)
    // 셀 (138,138,400,1500) — 원점 피벗 수학: x = 138 + 400/2 + 400/2, y = 138
    expect(p.x).toBe(HALF2 + 400)
    expect(p.y).toBe(HALF2)
    expect(r.usedHeightPx).toBe(HALF2 + 1500)
  })

  it('이미 90° 회전된 항목 — 치수 스왑 인식, 각도 유지', () => {
    const r = packImages([item('rot', 1500, 400, 90)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 3000,
      gapCm: 2,
      allowRotation: false
    })
    expect(r.unpackedIds).toEqual([])
    expect(r.packedItems[0]).toMatchObject({ rotation: 90, x: HALF2 + 400, y: HALF2 })
  })

  it('임의 각도(45°) 항목 — 바운딩 박스 패킹, 각도 유지', () => {
    const r = packImages([item('diag', 400, 200, 45)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 3000,
      gapCm: 2,
      allowRotation: false
    })
    expect(r.unpackedIds).toEqual([])
    const p = r.packedItems[0]
    expect(p.rotation).toBe(45)
    // 셀 = (138,138, 707.107, 707.107) — Konva getClientRect로 셀 커버 검증은 하단 참조
    expect(r.usedHeightPx).toBeCloseTo(HALF2 + Math.SQRT2 * 300, 3)
  })
})

describe('packImages — 오버플로·결정성', () => {
  it('어느 방위로도 못 들어가면 미배치 보고', () => {
    const r = packImages([item('huge', 900, 2600), item('ok', 400, 400)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 2000,
      gapCm: 2,
      allowRotation: true
    })
    expect(r.unpackedIds).toEqual(['huge'])
    expect(r.packedItems.map((p) => p.id)).toEqual(['ok'])
  })

  it('입력 순서와 무관하게 동일 레이아웃 — packedItems는 입력 순서 유지', () => {
    const opts = {
      canvasWidthPx: 1000,
      canvasHeightPx: 4000,
      gapCm: 2,
      allowRotation: true
    }
    const abc = [item('a', 500, 300), item('b', 400, 400), item('c', 300, 500)]
    const shuffled = [item('c', 300, 500), item('a', 500, 300), item('b', 400, 400)]
    const r1 = packImages(abc, opts)
    const r2 = packImages(shuffled, opts)
    const byId = (r: typeof r1, id: string): NestedPlacement | undefined =>
      r.packedItems.find((p) => p.id === id)
    for (const id of ['a', 'b', 'c']) {
      expect(byId(r2, id)).toEqual(byId(r1, id))
    }
    expect(r2.packedItems.map((p) => p.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('packImages — Konva 원점 피벗 실측 검증', () => {
  /** 패킹 결과대로 Konva Rect를 만들었을 때 렌더링되는 getClientRect */
  const clientRectOf = (
    p: { x: number; y: number; rotation: number },
    w: number,
    h: number
  ): { x: number; y: number; width: number; height: number } =>
    new Konva.Rect({ x: p.x, y: p.y, width: w, height: h, rotation: p.rotation }).getClientRect()

  it.each([0, 30, 45, 90, -90, 135])('회전 %i° — 렌더 박스가 셀을 정확히 덮음', (deg) => {
    const r = packImages([item('t', 500, 300, deg)], {
      canvasWidthPx: 1000,
      canvasHeightPx: 3000,
      gapCm: 2
    })
    const rad = (deg * Math.PI) / 180
    const cellW = Math.abs(Math.cos(rad)) * 500 + Math.abs(Math.sin(rad)) * 300
    const cellH = Math.abs(Math.sin(rad)) * 500 + Math.abs(Math.cos(rad)) * 300
    const rect = clientRectOf(r.packedItems[0], 500, 300)
    expect(rect.x).toBeCloseTo(HALF2, 3)
    expect(rect.y).toBeCloseTo(HALF2, 3)
    expect(rect.width).toBeCloseTo(cellW, 3)
    expect(rect.height).toBeCloseTo(cellH, 3)
  })

  it('혼합 6개 항목 — 캔버스 내부·쌍비교썹 없음 (getClientRect 심판)', () => {
    const mixed: NestingInput[] = [
      item('a', 400, 300),
      item('b', 600, 200),
      item('c', 250, 250),
      item('d', 300, 700, 90),
      item('e', 500, 500, 45),
      item('f', 200, 180)
    ]
    const r = packImages(mixed, {
      canvasWidthPx: 1000,
      canvasHeightPx: 4000,
      gapCm: 1,
      allowRotation: true
    })
    expect(r.unpackedIds).toEqual([])
    expect(r.packedItems.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])

    const srcById = new Map(mixed.map((i) => [i.id, i]))
    const rects = r.packedItems.map((p) => {
      const src = srcById.get(p.id)!
      return clientRectOf(p, src.widthPx, src.heightPx)
    })
    // 전항목 캔버스 내부
    for (const rc of rects) {
      expect(rc.x).toBeGreaterThanOrEqual(0)
      expect(rc.y).toBeGreaterThanOrEqual(0)
      expect(rc.x + rc.width).toBeLessThanOrEqual(1000)
      expect(rc.y + rc.height).toBeLessThanOrEqual(4000)
    }
    // 쌍비교썹 없음 — gap(138px) 이상 확보되므로 1px 관대 허용
    for (let i = 0; i < rects.length; i++) {
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i]
        const b = rects[j]
        const overlapW = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)
        const overlapH = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y)
        expect(overlapW < 1 || overlapH < 1).toBe(true)
      }
    }
  })
})
