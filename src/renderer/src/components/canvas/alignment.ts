/**
 * 다중 선택 수학 (.agent/tech.md TECH-2026-0903) — UI 라이브러리 의존 없는 순수 함수 (Vitest 선검증).
 * 좌표는 전부 문서(350 DPI 절대 px) 기준. 회전 바운딩 박스는 Konva 원점 피벗 규약
 * (placement.ts fitToCanvas·autoNesting.ts originToCoverCell·renderer.py와 동일 수학)이라
 * 화면 표시·내보내기 결과와 일치한다.
 */

import type { DocPoint } from './placement'

/** 축정렬 사각형 — left/top/right/bottom (절대 px) */
export interface BBox {
  left: number
  top: number
  right: number
  bottom: number
}

/** PlacedImage를 구조적으로 만족하는 최소 입력 — groupId를 공유하는 항목은 정렬·분배에서
 *  하나의 원자 유닛으로 취급된다 (Figma 관례: 그룹 내부 상대 위치 불변). */
export interface AlignableItem {
  id: string
  x: number
  y: number
  widthPx: number
  heightPx: number
  rotation: number
  /** 선택적 그룹 식별자 — 같은 groupId를 공유하는 항목이 하나의 유닛 */
  groupId?: string
}

/**
 * 항목 1개의 회전된 바운딩 박스 — 피벗(x,y)에 로컬 4모서리 (0,0)(w,0)(0,h)(w,h)의
 * 회전 오프셋 최솟값·최댓값을 더한다 (θ=0이면 x,y,x+w,y+h로 퇴화).
 */
export function rotatedBBox(item: AlignableItem): BBox {
  const rad = (item.rotation * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  const w = item.widthPx
  const h = item.heightPx
  const xs = [0, w * cos, -h * sin, w * cos - h * sin]
  const ys = [0, w * sin, h * cos, w * sin + h * cos]
  return {
    left: item.x + Math.min(...xs),
    top: item.y + Math.min(...ys),
    right: item.x + Math.max(...xs),
    bottom: item.y + Math.max(...ys)
  }
}

/** AABB 교차 판정 — 부분 교차만으로 true (완전 분리 시에만 false) */
export function rectsIntersect(a: BBox, b: BBox): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom)
}

/** 드래그 두 점 → 정규화 사각형 (드래그 방향 무관) */
export function marqueeRect(start: DocPoint, current: DocPoint): BBox {
  return {
    left: Math.min(start.x, current.x),
    top: Math.min(start.y, current.y),
    right: Math.max(start.x, current.x),
    bottom: Math.max(start.y, current.y)
  }
}

/** 마키(드래그 영역)와 1px이라도 교차하는 항목 id 목록 — 순서는 씬 배열 순 유지 */
export function marqueeSelection(
  items: readonly AlignableItem[],
  start: DocPoint,
  current: DocPoint
): string[] {
  const rect = marqueeRect(start, current)
  return items.filter((item) => rectsIntersect(rect, rotatedBBox(item))).map((item) => item.id)
}

export type AlignOp =
  'left' | 'centerH' | 'right' | 'top' | 'centerV' | 'bottom' | 'distH' | 'distV'

/** 문서 기준 정렬 연산 — 선택 1개만으로도 문서 가장자리·중앙축에 정렬 (델타 기능) */
export type DocAlignOp =
  'docLeft' | 'docCenterH' | 'docRight' | 'docTop' | 'docCenterV' | 'docBottom'

/**
 * 문서 기준 정렬 — 선택 전체 union bbox의 모서리·중심축을 문서(0..docW, 0..docH)의
 * 모서리·중앙에 맞춘다. union 전체에 동일 평행이동을 적용하므로 항목 간 상대 위치가
 * 불변이다. 개수 제한 없음(1개 허용), 빈 선택은 null. 회전 바운딩 박스 기준 —
 * 화면 표시 경계와 일치 (alignItems와 동일 규약).
 */
export function alignToDocument(
  items: readonly AlignableItem[],
  op: DocAlignOp,
  docW: number,
  docH: number
): ItemMove[] | null {
  if (items.length === 0) return null

  const boxes = items.map((item) => rotatedBBox(item))
  const xMin = Math.min(...boxes.map((b) => b.left))
  const xMax = Math.max(...boxes.map((b) => b.right))
  const yMin = Math.min(...boxes.map((b) => b.top))
  const yMax = Math.max(...boxes.map((b) => b.bottom))
  const width = xMax - xMin
  const height = yMax - yMin

  let shiftX = 0
  let shiftY = 0
  switch (op) {
    case 'docLeft':
      shiftX = -xMin
      break
    case 'docCenterH':
      shiftX = docW / 2 - width / 2 - xMin
      break
    case 'docRight':
      shiftX = docW - width - xMin
      break
    case 'docTop':
      shiftY = -yMin
      break
    case 'docCenterV':
      shiftY = docH / 2 - height / 2 - yMin
      break
    case 'docBottom':
      shiftY = docH - height - yMin
      break
  }
  return items.map((item) => ({ id: item.id, x: item.x + shiftX, y: item.y + shiftY }))
}

/** 정렬 결과 — 순수 평행이동(회전·치수 불변), 씬 배열 순과 동일한 id 순서 */
export interface ItemMove {
  id: string
  x: number
  y: number
}

const MIN_ALIGN_ITEMS = 2
const MIN_DISTRIBUTE_ITEMS = 3

/** 정렬·분배의 원자 유닛 — 그룹 멤버는 union bbox로 병합, 단일 항목은 그 자체가 유닛 */
interface AlignUnit {
  items: Array<{ item: AlignableItem; box: BBox }>
  box: BBox
}

/** 같은 groupId를 공유하는 항목들을 union bbox 유닛으로 묶는다 (그룹 없음 = 개별 유닛) */
function buildAlignUnits(items: readonly AlignableItem[]): AlignUnit[] {
  const units: AlignUnit[] = []
  const groupUnitIndex = new Map<string, number>()
  for (const item of items) {
    const box = rotatedBBox(item)
    const groupId = item.groupId
    if (groupId === undefined) {
      units.push({ items: [{ item, box }], box })
      continue
    }
    const idx = groupUnitIndex.get(groupId)
    if (idx === undefined) {
      groupUnitIndex.set(groupId, units.length)
      units.push({ items: [{ item, box }], box })
      continue
    }
    const unit = units[idx]!
    unit.items.push({ item, box })
    unit.box = {
      left: Math.min(unit.box.left, box.left),
      top: Math.min(unit.box.top, box.top),
      right: Math.max(unit.box.right, box.right),
      bottom: Math.max(unit.box.bottom, box.bottom)
    }
  }
  return units
}

const unionBox = (units: readonly AlignUnit[]): BBox => ({
  left: Math.min(...units.map((u) => u.box.left)),
  top: Math.min(...units.map((u) => u.box.top)),
  right: Math.max(...units.map((u) => u.box.right)),
  bottom: Math.max(...units.map((u) => u.box.bottom))
})

/** 유닛별 수평(수직) 델타를 멤버 전체에 적용 — 결과는 입력 항목 순서를 유지한다 */
const applyUnitShift = (
  units: readonly AlignUnit[],
  deltas: ReadonlyMap<AlignUnit, number>,
  axis: 'x' | 'y'
): ItemMove[] =>
  units.flatMap((unit) =>
    unit.items.map(({ item }) => {
      const delta = deltas.get(unit) ?? 0
      return axis === 'x'
        ? { id: item.id, x: item.x + delta, y: item.y }
        : { id: item.id, x: item.x, y: item.y + delta }
    })
  )

/**
 * 선택 항목 정렬·균등 분배 (TECH §4.3) — 기준은 회전 바운딩 박스(화면 표시 경계).
 * 같은 그룹(groupId)의 항목들은 하나의 원자 유닛으로 병합되어 내부 상대 위치가 불변이다
 * (Figma 관례 — 그룹이 정렬·분배로 찢어지지 않는다). 정렬은 유닛 전체 bbox의 모서리/
 * 중심축, 분배는 양 끝 유닛 고정 + 유닛 간 간격 균등화. 최소 유닛 수(정렬 2·분배 3)
 * 미달 시 null.
 */
export function alignItems(items: readonly AlignableItem[], op: AlignOp): ItemMove[] | null {
  if (items.length === 0) return null
  const units = buildAlignUnits(items)
  const need = op === 'distH' || op === 'distV' ? MIN_DISTRIBUTE_ITEMS : MIN_ALIGN_ITEMS
  if (units.length < need) return null

  const union = unionBox(units)

  const shiftTo = (targets: ReadonlyMap<AlignUnit, number>, axis: 'x' | 'y'): ItemMove[] =>
    applyUnitShift(units, targets, axis)

  const xMin = union.left
  const xMax = union.right
  const yMin = union.top
  const yMax = union.bottom

  switch (op) {
    case 'left':
      return shiftTo(new Map(units.map((u) => [u, xMin - u.box.left])), 'x')
    case 'right':
      return shiftTo(new Map(units.map((u) => [u, xMax - u.box.right])), 'x')
    case 'centerH':
      return shiftTo(
        new Map(units.map((u) => [u, (xMin + xMax) / 2 - (u.box.left + u.box.right) / 2])),
        'x'
      )
    case 'top':
      return shiftTo(new Map(units.map((u) => [u, yMin - u.box.top])), 'y')
    case 'bottom':
      return shiftTo(new Map(units.map((u) => [u, yMax - u.box.bottom])), 'y')
    case 'centerV':
      return shiftTo(
        new Map(units.map((u) => [u, (yMin + yMax) / 2 - (u.box.top + u.box.bottom) / 2])),
        'y'
      )
    case 'distH':
    case 'distV': {
      const horizontal = op === 'distH'
      const sorted = [...units].sort((a, b) => {
        const aStart = horizontal ? a.box.left : a.box.top
        const bStart = horizontal ? b.box.left : b.box.top
        const aEnd = horizontal ? a.box.right : a.box.bottom
        const bEnd = horizontal ? b.box.right : b.box.bottom
        return aStart - bStart || aEnd - bEnd
      })
      const spanStart = horizontal ? xMin : yMin
      const spanEnd = horizontal ? xMax : yMax
      const sizes = sorted.map((unit) =>
        horizontal ? unit.box.right - unit.box.left : unit.box.bottom - unit.box.top
      )
      const gap =
        (spanEnd - spanStart - sizes.reduce((sum, size) => sum + size, 0)) / (sorted.length - 1)
      let cursor = spanStart
      const deltas = new Map<AlignUnit, number>()
      for (const [index, unit] of sorted.entries()) {
        const delta = cursor - (horizontal ? unit.box.left : unit.box.top)
        deltas.set(unit, delta)
        cursor += sizes[index]! + gap
      }
      return applyUnitShift(units, deltas, horizontal ? 'x' : 'y')
    }
  }
}
