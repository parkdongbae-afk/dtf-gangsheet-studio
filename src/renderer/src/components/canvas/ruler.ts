/**
 * 뷰포트 자(ruler) 눈금 계산 — UI 라이브러리 없는 순수 함수 (Vitest 선검증).
 * 좌표 단위는 전부 cm(문서 좌표계)와 화면 px만 다룬다.
 */

/** 자 한 축의 눈금 — pos는 뷰포트 좌상단 기준 화면 px */
export interface RulerTick {
  pos: number
  cm: number
  labeled: boolean
}

/** 눈금 밀도 — 숫자 라벨 간격과 보조 눈금 간격 (cm) */
export interface RulerScale {
  labelStepCm: number
  minorStepCm: number
}

/** 라벨 후보 간격 (cm) — 1:0.1 ~ 100:1m */
const LABEL_STEP_CANDIDATES = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100] as const

/** 라벨 최소 화면 간격 (px) — 이보다 촘촘하면 다음 후보로 */
const LABEL_MIN_SPACING_PX = 48

/** 화면 1cm당 px에서 눈금 밀도 선택 — 라벨이 48px 이상 떨어지는 가장 촘촘한 단계.
 *  라벨 최소 간격(48px)의 1/5(9.6px)도 충분히 읽힌다 — 보조 눈금은 항상 라벨의 /5. */
export function pickRulerScale(pxPerCm: number): RulerScale {
  const safe = pxPerCm > 0 ? pxPerCm : 1
  let labelStepCm = LABEL_STEP_CANDIDATES[LABEL_STEP_CANDIDATES.length - 1]
  for (const step of LABEL_STEP_CANDIDATES) {
    if (step * safe >= LABEL_MIN_SPACING_PX) {
      labelStepCm = step
      break
    }
  }
  return { labelStepCm, minorStepCm: labelStepCm / 5 }
}

/** 눈금 float 허용 오차 — 라벨(=라벨 스텝 배수) 판정용 */
const MULTIPLE_EPS = 1e-6

const isMultipleOf = (value: number, step: number): boolean =>
  Math.abs(value / step - Math.round(value / step)) < MULTIPLE_EPS

/**
 * 보이는 cm 범위의 자 눈금 목록 — pos = (cm - visibleStartCm) * pxPerCm.
 * 보조 눈금도 포함하며, 라벨 스텝 배수만 labeled=true.
 */
export function computeRulerTicks(
  visibleStartCm: number,
  visibleEndCm: number,
  pxPerCm: number
): RulerTick[] {
  if (!Number.isFinite(visibleStartCm) || !Number.isFinite(visibleEndCm)) return []
  if (visibleEndCm <= visibleStartCm || pxPerCm <= 0) return []
  const { labelStepCm, minorStepCm } = pickRulerScale(pxPerCm)
  const first = Math.ceil(visibleStartCm / minorStepCm - MULTIPLE_EPS)
  const last = Math.floor(visibleEndCm / minorStepCm + MULTIPLE_EPS)
  const ticks: RulerTick[] = []
  for (let i = first; i <= last; i++) {
    const cm = Number((i * minorStepCm).toFixed(4))
    ticks.push({
      pos: (cm - visibleStartCm) * pxPerCm,
      cm,
      labeled: isMultipleOf(cm, labelStepCm)
    })
  }
  return ticks
}

/** 라벨 텍스트 — 정수 스텝은 정수로, 소수 스텝(0.1/0.2/0.5)은 소수 1자리 */
export function rulerTickLabel(cm: number): string {
  return Number.isInteger(cm) ? String(cm) : cm.toFixed(1)
}
