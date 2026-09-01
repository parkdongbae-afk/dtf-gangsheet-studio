/**
 * 배치 수학 (S4) — UI 라이브러리 의존 없는 순수 함수 (Vitest 선검증).
 * 모든 좌표는 문서(350 DPI 절대 px) 기준. 줌/스케일은 뷰 변환에서만 사용된다.
 */

/** 뷰 변환 상태 — stage.scale()/position() 에 대응하는 값만 다룬다 */
export interface ViewTransform {
  scale: number
  x: number
  y: number
}

export interface DocPoint {
  x: number
  y: number
}

/** 화면(viewport) 좌표 → 문서 좌표 */
export function screenToDoc(view: ViewTransform, screenX: number, screenY: number): DocPoint {
  return {
    x: (screenX - view.x) / view.scale,
    y: (screenY - view.y) / view.scale
  }
}

/** 현재 뷰의 중심을 문서 좌표로 — 대화상자 임포트 배치 기준점 */
export function viewCenterDoc(view: ViewTransform, viewportW: number, viewportH: number): DocPoint {
  return screenToDoc(view, viewportW / 2, viewportH / 2)
}

/** 다중 임포트 캐스케이드 간격 — 화면 기준 24px (줌 배율 보정) */
const CASCADE_SCREEN_PX = 24

/** 이미지 중심을 기준점에 두는 좌상단 좌표 — 캐스케이드 인덱스만큼 대각 이동 */
export function centeredTopLeft(
  imgWidthPx: number,
  imgHeightPx: number,
  center: DocPoint,
  cascadeIndex: number,
  viewScale: number
): DocPoint {
  const offset = cascadeIndex * duplicateOffset(viewScale)
  return {
    x: center.x - imgWidthPx / 2 + offset,
    y: center.y - imgHeightPx / 2 + offset
  }
}

/** Ctrl+D 복제 오프셋 (문서 px) — 화면 24px 규칙을 줌 배율로 보정 (S4 캐스케이드 재사용) */
export function duplicateOffset(viewScale: number): number {
  return CASCADE_SCREEN_PX / viewScale
}

/** 회전각 정규화 — 항상 (-180, 180] 범위 (270° → -90°, -180° → 180°) */
export function normalizeRotation(deg: number): number {
  const wrapped = ((((deg + 180) % 360) + 360) % 360) - 180
  return wrapped === -180 ? 180 : wrapped
}

/** Konva 노드 onTransformEnd 판독값 — scale은 트랜스포머가 붙인 임시값 */
export interface NodeTransformReading {
  x: number
  y: number
  rotation: number
  width: number
  height: number
  scaleX: number
  scaleY: number
}

/** 트랜스폼 확정 커밋 — 임시 scale을 절대 px 치수로 환산한 순수 JSON 상태 조각 */
export interface PlacedTransform {
  x: number
  y: number
  widthPx: number
  heightPx: number
  rotation: number
}

/** 판독값 → 커밋: width×scaleX 확정 패턴 + 회전각 정규화 (S5 세션 1) */
export function commitTransform(t: NodeTransformReading): PlacedTransform {
  return {
    x: t.x,
    y: t.y,
    widthPx: t.width * t.scaleX,
    heightPx: t.height * t.scaleY,
    rotation: normalizeRotation(t.rotation)
  }
}

/** 그리드 복제 계산에 필요한 원본 배치 정보 */
export interface GridSource {
  x: number
  y: number
  widthPx: number
  heightPx: number
}

/** 그리드 셀 하나 — row-major. (0,0) 셀 = 원본 현재 자리 */
export interface GridCell {
  row: number
  col: number
  x: number
  y: number
}

/**
 * 그리드 복제 셀 좌표 (S5 세션 2) — 셀 (0,0)이 원본 위치, 스텝 = 치수 + gap (절대 px).
 * 좌표는 float 그대로 (keepRatio 커밋 방식과 일치, 반올림 없음). 회전은 좌표계와 무관하게
 * 사본이 원본 각을 물려받아 그리드 전체가 원본 로컬 축을 따라 회전한다.
 */
export function calculateGridPositions(
  item: GridSource,
  rows: number,
  cols: number,
  gap: number
): GridCell[] {
  const cells: GridCell[] = []
  const stepX = item.widthPx + gap
  const stepY = item.heightPx + gap
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      cells.push({ row, col, x: item.x + col * stepX, y: item.y + row * stepY })
    }
  }
  return cells
}
