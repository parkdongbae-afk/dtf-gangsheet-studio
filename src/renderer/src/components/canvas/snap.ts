/**
 * 드래그 스냅 (델타 기능) — UI 라이브러리 의존 없는 순수 함수 (Vitest 선검증).
 * 이동 중 항목들의 union bbox 좌/중심/우·상/중심/하 에지를 인접 항목·문서 가장자리의
 * 대응 에지에 임계값 이내로 붙인다 (Figma 관례). 좌표는 전부 문서(350 DPI 절대 px).
 */

import { rotatedBBox, type AlignableItem, type BBox } from './alignment'

/** 스냅 대상 박스 — kind는 라벨·가이드 표기에만 쓰인다 (판정은 박스 수학만) */
export interface SnapTarget {
  box: BBox
  kind: 'item' | 'doc'
}

/** 정렬 가이드 라인 — axis 'x'는 세로 라인(수평 위치 스냅), 'y'는 가로 라인 */
export interface SnapGuide {
  axis: 'x' | 'y'
  /** 라인의 문서 좌표 (축 상 위치) */
  position: number
  /** 라인이 놓이는 수직/수평 범위 (두 박스의 합집합 모서리) */
  from: number
  to: number
}

/** 간격 라벨 — 이동군과 스냅 대상 사이의 순수 분리 거리(px)와 표기 위치 */
export interface SnapGapLabel {
  x: number
  y: number
  gapPx: number
}

export interface SnapResult {
  dx: number
  dy: number
  guides: SnapGuide[]
  labels: SnapGapLabel[]
}

/** 박스들의 합집합 — 다중 드래그 시 이동군 전체를 하나의 스냅 단위로 취급 */
export function unionBox(boxes: readonly BBox[]): BBox {
  if (boxes.length === 0) return { left: 0, top: 0, right: 0, bottom: 0 }
  return {
    left: Math.min(...boxes.map((b) => b.left)),
    top: Math.min(...boxes.map((b) => b.top)),
    right: Math.max(...boxes.map((b) => b.right)),
    bottom: Math.max(...boxes.map((b) => b.bottom))
  }
}

/** union 계산 편의 — 회전 바운딩 박스들의 합집합 */
export function unionOfItems(items: readonly AlignableItem[]): BBox {
  return unionBox(items.map((item) => rotatedBBox(item)))
}

const center = (start: number, end: number): number => (start + end) / 2

/** 축별 세 기준선(시작/중심/끝) 위치 */
const axisLines = (box: BBox, axis: 'x' | 'y'): number[] =>
  axis === 'x'
    ? [box.left, center(box.left, box.right), box.right]
    : [box.top, center(box.top, box.bottom), box.bottom]

/** 두 박스의 축 방향 분리 거리 — 양수=떨어짐, ≤0=겹침(접촉 0) */
const separation = (a: BBox, b: BBox, axis: 'x' | 'y'): number =>
  axis === 'x'
    ? Math.max(b.left - a.right, a.left - b.right)
    : Math.max(b.top - a.bottom, a.top - b.bottom)

/** 간격 라벨 생성 — 스냅 축과 수직 축 분리 거리 중 양수인 것만, 접점 중앙에 배치 */
function gapLabels(moving: BBox, target: BBox): SnapGapLabel[] {
  const labels: SnapGapLabel[] = []
  const gapX = separation(moving, target, 'x')
  if (gapX > 0) {
    const left = Math.max(moving.left, target.left)
    const right = Math.min(moving.right, target.right)
    labels.push({
      x: center(left, right),
      y: center(Math.max(moving.top, target.top), Math.min(moving.bottom, target.bottom)),
      gapPx: gapX
    })
  }
  const gapY = separation(moving, target, 'y')
  if (gapY > 0) {
    const top = Math.max(moving.top, target.top)
    const bottom = Math.min(moving.bottom, target.bottom)
    labels.push({
      x: center(Math.max(moving.left, target.left), Math.min(moving.right, target.right)),
      y: center(top, bottom),
      gapPx: gapY
    })
  }
  return labels
}

interface BestPair {
  dist: number
  /** 스냅이 성립한 대상 기준선 위치 — 가이드 라인 위치로 그대로 사용 */
  guidePos: number
  target: SnapTarget
}

/**
 * 스냅 판정 — moving의 세 기준선(축별)을 각 대상의 세 기준선과 대응시켜 임계값 이내의
 * 최근접 쌍을 축마다 하나씩 선택한다. 반환 dx/dy는 원 위치에 더하면 스냅이 성립하는
 * 보정량. 임계값 초과 축은 보정 0·가이드 없음. 문서 가장자리·중앙선은 호출자가
 * doc 박스 대상으로 전달한다.
 */
export function computeSnap(
  moving: BBox,
  targets: readonly SnapTarget[],
  thresholdPx: number
): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, guides: [], labels: [] }
  if (thresholdPx <= 0) return result

  const snappedTargets: SnapTarget[] = []
  for (const axis of ['x', 'y'] as const) {
    const movingLines = axisLines(moving, axis)
    let best: BestPair | null = null
    for (const target of targets) {
      const targetLines = axisLines(target.box, axis)
      for (const m of movingLines) {
        for (const t of targetLines) {
          const dist = t - m
          if (Math.abs(dist) > thresholdPx) continue
          if (best === null || Math.abs(dist) < Math.abs(best.dist)) {
            best = { dist, guidePos: t, target }
          }
        }
      }
    }
    if (best === null) continue

    if (axis === 'x') result.dx = best.dist
    else result.dy = best.dist
    snappedTargets.push(best.target)

    result.guides.push({
      axis,
      position: best.guidePos,
      from:
        axis === 'x'
          ? Math.min(moving.top, best.target.box.top)
          : Math.min(moving.left, best.target.box.left),
      to:
        axis === 'x'
          ? Math.max(moving.bottom, best.target.box.bottom)
          : Math.max(moving.right, best.target.box.right)
    })
  }

  // 간격 라벨은 양축 보정이 모두 반영된 최종 위치 기준 — 축별 중간 상태가 아니라
  // 사용자에게 보이는 확정 배치의 실제 간격을 표기해야 한다.
  if (snappedTargets.length > 0) {
    const finalBox: BBox = {
      left: moving.left + result.dx,
      top: moving.top + result.dy,
      right: moving.right + result.dx,
      bottom: moving.bottom + result.dy
    }
    for (const target of new Set(snappedTargets)) {
      result.labels.push(...gapLabels(finalBox, target.box))
    }
  }
  return result
}
