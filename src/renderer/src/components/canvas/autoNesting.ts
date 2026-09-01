/**
 * 자동 배치 (Auto-Nesting / MaxRects Bin Packing) — .agent/BATCH.md 스펙 구현.
 * UI 라이브러리 의존 없는 순수 함수 (placement.ts와 동일 규칙, Vitest 선검증).
 *
 * - 알고리즘: MaxRects BAF(Best Area Fit) 1차 + BSF(Best Short Side Fit) 차선.
 * - 정렬: 면적 내림차순(동률 최장변) → id 오름차순 안정화 — 표준 휴리스틱.
 * - 간격: 이미지 둘레에 gap/2 패딩 → 패킹 박스 = 회전 후 치수 + gap.
 * - 회전: allowRotation 시 90° 회전이 더 유리하면 자동 회전. 임의 각도 항목은
 *   회전 바운딩 박스 기준으로 패킹하고 각도를 유지한다.
 * - 좌표 규약: Konva 원점 피벗 — 회전은 노드 원점(x,y) 기준이며 회전 후 중심은
 *   (x,y) + R·(w/2,h/2). getClientRect 실측으로 검증 (autoNesting.test.ts).
 */

import { cmToPx } from '../../../../core/math'
import { normalizeRotation } from './placement'

export interface NestingOptions {
  /** 캔버스 가로 폭 (px) */
  canvasWidthPx: number
  /** 캔버스 최대 허용 높이 (px) */
  canvasHeightPx: number
  /** 이미지 간격 (cm, 기본 2.0) */
  gapCm?: number
  /** DPI (기본 350) */
  dpi?: number
  /** 90° 회전 배치 허용 여부 (기본 false) */
  allowRotation?: boolean
}

export interface NestingInput {
  id: string
  /** 회전 전 치수 (px) — PlacedImage와 동일 규약 */
  widthPx: number
  heightPx: number
  /** 노드 회전각 (도) — PlacedImage와 동일 규약 */
  rotation: number
}

export interface NestedPlacement {
  id: string
  /** 노드 원점 x,y (Konva 원점 피벗 규약) */
  x: number
  y: number
  rotation: number
}

export interface NestingResult {
  /** 패킹 성공 항목 — 입력 순서를 유지해 반환 */
  packedItems: NestedPlacement[]
  /** 사용된 최종 수직 높이 (px) — 가장 아래 항목의 시각 하단 */
  usedHeightPx: number
  /** 공간 효율 (%) — 원본 픽셀 면적 합 ÷ (캔버스 폭 × 사용 높이) */
  efficiency: number
  /** 캔버스에 못 들어간 항목 id — 입력 순서 유지 */
  unpackedIds: string[]
}

/** 내부 free rectangle — x,y = 좌상단, w,h = 치수 */
interface FreeRect {
  x: number
  y: number
  w: number
  h: number
}

/** 회전 θ에서의 축정렬 박스 치수 (|cosθ|w+|sinθ|h × |sinθ|w+|cosθ|h) — fitToCanvas와 동일 수학 */
function axisBox(rotationDeg: number, w: number, h: number): { w: number; h: number } {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.abs(Math.cos(rad))
  const sin = Math.abs(Math.sin(rad))
  return { w: cos * w + sin * h, h: sin * w + cos * h }
}

/**
 * 회전 박스가 셀(칸)을 정확히 덮도록 하는 노드 원점 x,y.
 * Konva 원점 피벗 규약: 회전 후 중심 = (x,y) + R·(w/2,h/2) 를 셀 중심에 정렬한다.
 * θ=0이고 셀=치수이면 x=cellX, y=cellY 로 퇴화된다.
 */
function originToCoverCell(
  rotationDeg: number,
  w: number,
  h: number,
  cellX: number,
  cellY: number,
  cellW: number,
  cellH: number
): { x: number; y: number } {
  const rad = (rotationDeg * Math.PI) / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return {
    x: cellX + cellW / 2 - (cos * w - sin * h) / 2,
    y: cellY + cellH / 2 - (sin * w + cos * h) / 2
  }
}

/**
 * MaxRects 분할 — 배치 박스와 교차하는 모든 free rect를 최대 4개의 잔여
 * 최대 사각형으로 분할하고, 다른 사각형에 포함되는 것은 제거한다(prune).
 * 동일 사각형 중복 시 선두만 유지해 중복 노드 폭주를 막는다.
 */
function splitFreeRects(free: readonly FreeRect[], used: FreeRect): FreeRect[] {
  const next: FreeRect[] = []
  for (const f of free) {
    const intersects =
      used.x < f.x + f.w && used.x + used.w > f.x && used.y < f.y + f.h && used.y + used.h > f.y
    if (!intersects) {
      next.push(f)
      continue
    }
    if (used.x > f.x) next.push({ x: f.x, y: f.y, w: used.x - f.x, h: f.h })
    if (used.x + used.w < f.x + f.w) {
      next.push({ x: used.x + used.w, y: f.y, w: f.x + f.w - (used.x + used.w), h: f.h })
    }
    if (used.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: used.y - f.y })
    if (used.y + used.h < f.y + f.h) {
      next.push({ x: f.x, y: used.y + used.h, w: f.w, h: f.y + f.h - (used.y + used.h) })
    }
  }
  const alive = next.filter((r) => r.w > 0 && r.h > 0)
  return alive.filter(
    (r, i) =>
      !alive.some((o, j) => {
        if (j === i) return false
        const inside = r.x >= o.x && r.y >= o.y && r.x + r.w <= o.x + o.w && r.y + r.h <= o.y + o.h
        if (!inside) return false
        const identical = r.x === o.x && r.y === o.y && r.w === o.w && r.h === o.h
        return identical ? j < i : true
      })
  )
}

/** BAF 후보 — free rect 하나에 대한 최적 배치 스코어 */
interface BestFit {
  free: FreeRect
  rotation: number
  boxW: number
  boxH: number
  areaFit: number
  shortFit: number
}

/**
 * 자동 배치 패킹 (BATCH.md §2) — 상단부터 빈 공간에 밀집.
 * 결과 좌표는 절대 px이며 시각적 항목은 셀 안쪽으로 gap/2 여백을 가진다.
 */
export function packImages(items: readonly NestingInput[], options: NestingOptions): NestingResult {
  const { canvasWidthPx, canvasHeightPx, allowRotation = false } = options
  const gapPx = cmToPx(options.gapCm ?? 2, options.dpi ?? 350)
  const halfGap = gapPx / 2

  // 면적 → 최장변 내림차순, 동률은 id로 안정화 (결정론적 레이아웃)
  const sorted = [...items].sort((a, b) => {
    const areaDiff = b.widthPx * b.heightPx - a.widthPx * a.heightPx
    if (areaDiff !== 0) return areaDiff
    const sideDiff = Math.max(b.widthPx, b.heightPx) - Math.max(a.widthPx, a.heightPx)
    if (sideDiff !== 0) return sideDiff
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  })

  let free: FreeRect[] = [{ x: 0, y: 0, w: canvasWidthPx, h: canvasHeightPx }]
  const placed = new Map<string, NestedPlacement>()
  const unpacked: string[] = []
  let inkArea = 0
  let usedBottom = 0

  for (const item of sorted) {
    const rotation0 = normalizeRotation(item.rotation)
    const box0 = axisBox(rotation0, item.widthPx, item.heightPx)
    // 회전 후보 — 90° 회전 박스는 치수가 뒤바뀐다. 치수가 같으면(정사각 등) 후보 1개.
    const rotation1 = normalizeRotation(rotation0 + 90)
    const box1 = axisBox(rotation1, item.widthPx, item.heightPx)

    let best: BestFit | null = null
    for (const f of free) {
      const candidates: Array<{ rotation: number; w: number; h: number }> = [
        { rotation: rotation0, w: box0.w, h: box0.h }
      ]
      if (allowRotation && box1.w !== box0.w) {
        candidates.push({ rotation: rotation1, w: box1.w, h: box1.h })
      }
      for (const c of candidates) {
        const paddedW = c.w + gapPx
        const paddedH = c.h + gapPx
        if (paddedW > f.w || paddedH > f.h) continue
        const areaFit = f.w * f.h - paddedW * paddedH
        const shortFit = Math.min(f.w - paddedW, f.h - paddedH)
        if (
          best === null ||
          areaFit < best.areaFit ||
          (areaFit === best.areaFit && shortFit < best.shortFit)
        ) {
          best = { free: f, rotation: c.rotation, boxW: c.w, boxH: c.h, areaFit, shortFit }
        }
      }
    }

    if (best === null) {
      unpacked.push(item.id)
      continue
    }

    // 패딩 박스를 free rect 원점에 두고, 시각 셀은 안쪽 gap/2만큼 오프셋
    const cellX = best.free.x + halfGap
    const cellY = best.free.y + halfGap
    const origin = originToCoverCell(
      best.rotation,
      item.widthPx,
      item.heightPx,
      cellX,
      cellY,
      best.boxW,
      best.boxH
    )
    placed.set(item.id, { id: item.id, x: origin.x, y: origin.y, rotation: best.rotation })
    inkArea += item.widthPx * item.heightPx
    usedBottom = Math.max(usedBottom, cellY + best.boxH)

    free = splitFreeRects(free, {
      x: best.free.x,
      y: best.free.y,
      w: best.boxW + gapPx,
      h: best.boxH + gapPx
    })
  }

  // 반환은 입력 순서 유지 — 호출측 매핑·표시가 단순해진다
  const packedItems = items.flatMap((item) => {
    const p = placed.get(item.id)
    return p ? [p] : []
  })
  const unpackedSet = new Set(unpacked)
  const unpackedIds = items.flatMap((item) => (unpackedSet.has(item.id) ? [item.id] : []))
  const efficiency = usedBottom > 0 ? (inkArea / (canvasWidthPx * usedBottom)) * 100 : 0

  return { packedItems, usedHeightPx: usedBottom, efficiency, unpackedIds }
}
