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
  const offset = (cascadeIndex * CASCADE_SCREEN_PX) / viewScale
  return {
    x: center.x - imgWidthPx / 2 + offset,
    y: center.y - imgHeightPx / 2 + offset
  }
}
