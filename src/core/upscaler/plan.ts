/**
 * 업스케일 Plan Builder — UPSCALER.MD v2.0 §4 (순수 함수, UI 비의존, Vitest 선검증).
 *
 * 책임: cm/px/배율 입력 → 타겟 px 산출 · 가드레일(최대 px 클램프) · FitMode별
 * 타겟 조정(KEEP_RATIO/COVER/CONTAIN/STRETCH) · 총 배율 → 스텝 체인 분할
 * (잔여 흡수 규칙 §4.3) · 진행률 픽셀 가중치(§4.5) · 메모리 추정(§4.6) · 경고 코드.
 *
 * 렌더러(실시간 예상 정보 패널)와 메인(Executor)이 같은 함수를 공유해
 * "표시된 예상 = 실행 계획"을 보장한다. 부작용·I/O 없음.
 */
import { cmToPx } from '../math'

/** 입력 단위 — cm(기본) / px / 배율 */
export type UpscaleUnit = 'cm' | 'px' | 'scale'

/** 스텝 전략 — AUTO는 총 배율에 따라 resolveStrategy가 구체 전략으로 해석한다 */
export type StepStrategy = 'AUTO' | 'STEP_2X' | 'STEP_3X' | 'STEP_5X' | 'DIRECT'

/** AUTO가 해석된 구체 전략 */
export type ResolvedStrategy = Exclude<StepStrategy, 'AUTO'>

/** 가로/세로 비율 불일치 처리 방식 (UPSCALER.MD §4.2) */
export type FitMode = 'KEEP_RATIO' | 'COVER' | 'CONTAIN' | 'STRETCH'

/** 출력 포맷 — DPI 메타데이터는 png/jpeg에만 기록된다(webp는 무시) */
export type UpscaleOutputFormat = 'png' | 'jpeg' | 'webp'

/** 계획 수립 단계 경고 코드 — 오류 아님(진행 가능), UI 안내용 */
export type WarningCode =
  | 'WARN_RATIO_MISMATCH' // 가로/세로 배율 차이 > 3% — FitMode 선택 필요
  | 'WARN_DOWNSCALE' // S < 1 — AI 생략, 고품질 리샘플로 처리
  | 'WARN_DIRECT_RECOMMENDED' // 1 ≤ S < 1.5 — 단번에(DIRECT) 처리 권장 안내
  | 'WARN_LOW_DPI' // DPI < 72 — 인쇄 시 흐릿할 수 있음
  | 'WARN_TARGET_CLAMPED' // 목표 px > maxTargetPx — 최대 크기로 자동 조정됨
  | 'WARN_MEMORY_TILING' // 추정 메모리 > 한도 — 타일링 강제
  | 'WARN_OVERSIZED_TILING' // S > 12 — 초대형 출력, 타일링 강제 + 메모리 경고

export interface ImageSize {
  width: number
  height: number
}

/** 픽셀 직사각형 — COVER 모드의 원본 센터 크롭 영역 */
export interface PixelRect {
  x: number
  y: number
  width: number
  height: number
}

/** 크기 입력 — unit에 따라 필요한 필드만 채운다 (나머지는 undefined) */
export interface UpscaleTargetInput {
  unit: UpscaleUnit
  /** unit='cm' — 0.5~200cm */
  widthCm?: number
  heightCm?: number
  /** unit='px' */
  widthPx?: number
  heightPx?: number
  /** unit='scale' — 원본 대비 배율 */
  scale?: number
}

export interface UpscalePlanInput extends UpscaleTargetInput {
  /** 출력 물리 해상도 — 72/150/300/커스텀(36~1200) */
  dpi: number
  strategy: StepStrategy
  fitMode: FitMode
  /** 가드레일 — 목표 최대 변 px (기본 8,000) */
  maxTargetPx?: number
  /** 가드레일 — 추정 메모리 한도 MB (기본 2,048) */
  maxMemoryMb?: number
}

/** 확정된 실행 계획 — Executor(sidecar 호출)와 예상 패널이 함께 소비한다 */
export interface UpscalePlan {
  src: ImageSize
  /** COVER 모드의 업스케일 전 센터 크롭 영역 — 없으면 null(전체 사용) */
  srcCrop: PixelRect | null
  target: ImageSize
  /** 균등 체인 배율(소수점 2자리) — STRETCH/CONTAIN의 최종 비균등 조정은 체인 밖에서 */
  totalScale: number
  chain: number[]
  strategy: ResolvedStrategy
  fitMode: FitMode
  /** 체인 단계별 정규화 기여도(0..1, 합=1) — §4.5 픽셀 가중치 */
  weights: number[]
  /** AI 엔진 사용 여부 — S ≤ 1.5면 고품질 리샘플만 사용 */
  aiUsed: boolean
  warnings: WarningCode[]
  /** 최종 출력 기준 메모리 추정 MB — target×RGBA×2.5 오버헤드 */
  estimatedMemoryMb: number
}

/** Plan Builder 입력 오류 — 대화상자 인라인 검증 메시지로 직접 노출 */
export class PlanInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PlanInputError'
  }
}

/** 전략별 스텝 단위 K (§4.3 규칙 1) */
export const STEP_SIZE: Readonly<Record<'STEP_2X' | 'STEP_3X' | 'STEP_5X', number>> = {
  STEP_2X: 2,
  STEP_3X: 3,
  STEP_5X: 5
}

/** 잔여 흡수 임계 — 마지막 스텝이 이 값 미만이면 이전 스텝에 흡수 (§4.3 규칙 4) */
export const ABSORB_THRESHOLD = 1.5
/** 흡수 허용 상한 — 흡수 후 스텝이 K × 1.25 초과면 흡수 취소 */
export const ABSORB_CAP_FACTOR = 1.25
/** 목표 최대 변 px 기본값 (§6.1 가드레일) */
export const DEFAULT_MAX_TARGET_PX = 8000
/** 메모리 한도 기본값 MB (§6.1) */
export const DEFAULT_MAX_MEMORY_MB = 2048
/** 픽셀당 바이트(RGBA) × 처리 오버헤드 계수 (§4.6) */
const BYTES_PER_PIXEL = 4
const MEMORY_OVERHEAD = 2.5
/** 비율 불일치 판정 — 배율 차이가 3% 초과면 WARN_RATIO_MISMATCH (§4.2) */
const RATIO_MISMATCH_TOLERANCE = 0.03
/** AUTO가 DIRECT를 선택하는 상한 배율 (§4.4) */
export const AUTO_DIRECT_MAX_SCALE = 1.5
/** AUTO가 타일링을 강제하는 하한 배율 (§4.4) */
export const AUTO_TILING_MIN_SCALE = 12

const round2 = (value: number): number => Math.round(value * 100) / 100

/** 입력 단위·값 → 클램프 전 타겟 px (§4.1) — cm 변환에는 input.dpi를 사용한다 */
function resolveRawInput(input: UpscalePlanInput, src: ImageSize): ImageSize {
  if (input.unit === 'cm') {
    if (
      input.widthCm === undefined ||
      input.heightCm === undefined ||
      !(input.widthCm > 0) ||
      !(input.heightCm > 0)
    ) {
      throw new PlanInputError('가로·세로 크기(cm)를 입력해 주세요 (0.5~200cm)')
    }
    if (
      input.widthCm > 200 ||
      input.heightCm > 200 ||
      input.widthCm < 0.5 ||
      input.heightCm < 0.5
    ) {
      throw new PlanInputError('크기는 0.5~200cm 사이로 입력해 주세요')
    }
    return { width: cmToPx(input.widthCm, input.dpi), height: cmToPx(input.heightCm, input.dpi) }
  }
  if (input.unit === 'scale') {
    if (input.scale === undefined || !(input.scale > 0)) {
      throw new PlanInputError('배율은 0보다 큰 값으로 입력해 주세요')
    }
    return {
      width: Math.round(src.width * input.scale),
      height: Math.round(src.height * input.scale)
    }
  }
  if (
    input.widthPx === undefined ||
    input.heightPx === undefined ||
    !(input.widthPx > 0) ||
    !(input.heightPx > 0)
  ) {
    throw new PlanInputError('가로·세로 크기(px)를 입력해 주세요')
  }
  return { width: Math.round(input.widthPx), height: Math.round(input.heightPx) }
}

/** AUTO 전략 해석 (§4.4) — S≤1.5 DIRECT · S≤12 STEP_2X · 초과 STEP_2X+타일링 */
export function resolveStrategy(totalScale: number, requested: StepStrategy): ResolvedStrategy {
  if (requested !== 'AUTO') return requested
  return totalScale <= AUTO_DIRECT_MAX_SCALE ? 'DIRECT' : 'STEP_2X'
}

/**
 * 스텝 체인 분할 — 캐노니컬 알고리즘 (§4.3).
 *
 * 규칙: K보다 큰 동안 K배 스텝 추가 → 마지막 잔여 추가 → 잔여 < 1.5면 이전
 * 스텝에 흡수(단, 흡수 결과가 K×1.25 초과면 취소). 검증표는 plan.test.ts.
 */
export function buildStepChain(totalScale: number, strategy: ResolvedStrategy): number[] {
  if (strategy === 'DIRECT' || totalScale <= 1) return [round2(totalScale)]

  const k = STEP_SIZE[strategy]
  const cap = k * ABSORB_CAP_FACTOR
  const steps: number[] = []
  let remaining = totalScale
  while (remaining > k) {
    steps.push(k)
    remaining /= k
  }
  steps.push(round2(remaining))

  const last = steps[steps.length - 1]!
  if (steps.length >= 2 && last < ABSORB_THRESHOLD) {
    const merged = round2(steps[steps.length - 2]! * last)
    // 부동소수점 오차 허용(×1.001) — 흡수 상한 이내면 두 스텝을 하나로
    if (merged <= cap * 1.001) steps.splice(-2, 2, merged)
  }
  return steps
}

/** 체인 단계별 누적 배율² 가중치 정규화 (§4.5) — 합=1, 진행률 가중용 */
export function cumulativeSquareWeights(chain: readonly number[]): number[] {
  if (chain.length === 0) return []
  let cumulative = 1
  const raw = chain.map((scale) => {
    cumulative *= scale
    return cumulative * cumulative
  })
  const total = raw.reduce((sum, w) => sum + w, 0)
  return raw.map((w) => w / total)
}

/** 전체 진행률(0..1) — 완료 스텝 가중합 + 현재 스텝 내부 진행률 반영 (§4.5) */
export function overallProgress(
  weights: readonly number[],
  stepIndex: number,
  stepFraction: number
): number {
  const total = weights.reduce((sum, w) => sum + w, 0)
  if (total <= 0) return 0
  let acc = 0
  for (let i = 0; i < stepIndex && i < weights.length; i++) acc += weights[i]!
  const current = weights[stepIndex] ?? 0
  return Math.min(1, Math.max(0, (acc + current * Math.min(1, Math.max(0, stepFraction))) / total))
}

/** 최종 출력 기준 메모리 추정 MB (§4.6) */
export function estimateMemoryMb(width: number, height: number): number {
  return (width * height * BYTES_PER_PIXEL * MEMORY_OVERHEAD) / (1024 * 1024)
}

/** FitMode 확정 — 클램프된 타겟에 대해 균등 배율·최종 타겟·(COVER)크롭 영역 산출 (§4.2) */
function resolveFit(
  src: ImageSize,
  target: ImageSize,
  fitMode: FitMode
): { scale: number; target: ImageSize; srcCrop: PixelRect | null } {
  const scaleX = target.width / src.width
  const scaleY = target.height / src.height
  if (fitMode === 'STRETCH' || fitMode === 'CONTAIN') {
    // 목표 캔버스 그대로 — 체인은 짧은 쪽 배율로 돌리고 최종 단계에서 비균등/여백 처리
    return { scale: Math.min(scaleX, scaleY), target, srcCrop: null }
  }
  if (fitMode === 'COVER') {
    // 원본을 목표 비율로 센터 크롭 후 균등 업스케일
    const targetAspect = target.width / target.height
    const srcAspect = src.width / src.height
    let crop: PixelRect
    if (srcAspect > targetAspect) {
      const cropWidth = Math.max(1, Math.round(src.height * targetAspect))
      crop = {
        x: Math.floor((src.width - cropWidth) / 2),
        y: 0,
        width: cropWidth,
        height: src.height
      }
    } else {
      const cropHeight = Math.max(1, Math.round(src.width / targetAspect))
      crop = {
        x: 0,
        y: Math.floor((src.height - cropHeight) / 2),
        width: src.width,
        height: cropHeight
      }
    }
    return { scale: target.width / crop.width, target, srcCrop: crop }
  }
  // KEEP_RATIO(기본·권장) — 목표를 원본 비율에 맞게 재조정(min 배율)
  const scale = Math.min(scaleX, scaleY)
  return {
    scale,
    target: {
      width: Math.max(1, Math.round(src.width * scale)),
      height: Math.max(1, Math.round(src.height * scale))
    },
    srcCrop: null
  }
}

/**
 * 전체 계획 수립 (§4 총괄) — 입력 검증 → 타겟 산출 → 가드레일 클램프 →
 * FitMode 확정 → 체인 생성 → 경고 수집. 순수 함수.
 */
export function buildUpscalePlan(input: UpscalePlanInput, src: ImageSize): UpscalePlan {
  if (!(src.width > 0) || !(src.height > 0)) {
    throw new PlanInputError('원본 이미지 크기를 읽을 수 없어요')
  }
  if (!(input.dpi > 0)) throw new PlanInputError('DPI를 입력해 주세요')

  const maxTargetPx = input.maxTargetPx ?? DEFAULT_MAX_TARGET_PX
  const maxMemoryMb = input.maxMemoryMb ?? DEFAULT_MAX_MEMORY_MB
  const warnings: WarningCode[] = []

  // cm 단위 변환에 DPI 주입 — resolveRawInput에 dpi가 포함된 입력 전체를 전달
  const raw = resolveRawInput(input, src)

  // 가드레일: 목표 변 > maxTargetPx면 비율 유지 축소(§6.1 — 자동 조정, UI에서 안내)
  let clamped = raw
  const maxDim = Math.max(raw.width, raw.height)
  if (maxDim > maxTargetPx) {
    const shrink = maxTargetPx / maxDim
    clamped = {
      width: Math.max(1, Math.round(raw.width * shrink)),
      height: Math.max(1, Math.round(raw.height * shrink))
    }
    warnings.push('WARN_TARGET_CLAMPED')
  }

  // 비율 불일치 경고 — FitMode와 무관하게 안내(§4.2), 사용자가 모드로 대응한다
  const rawScaleX = clamped.width / src.width
  const rawScaleY = clamped.height / src.height
  const ratioDiff = Math.abs(rawScaleX - rawScaleY) / Math.min(rawScaleX, rawScaleY)
  if (ratioDiff > RATIO_MISMATCH_TOLERANCE) warnings.push('WARN_RATIO_MISMATCH')

  const fit = resolveFit(src, clamped, input.fitMode)
  const totalScale = round2(fit.scale)

  if (totalScale < 1) warnings.push('WARN_DOWNSCALE')
  if (totalScale >= 1 && totalScale <= AUTO_DIRECT_MAX_SCALE && input.strategy !== 'DIRECT') {
    warnings.push('WARN_DIRECT_RECOMMENDED')
  }
  if (input.dpi < 72) warnings.push('WARN_LOW_DPI')

  const strategy = resolveStrategy(totalScale, input.strategy)
  const chain = buildStepChain(totalScale, strategy)
  const weights = cumulativeSquareWeights(chain)
  const estimatedMemoryMb = estimateMemoryMb(fit.target.width, fit.target.height)
  if (estimatedMemoryMb > maxMemoryMb) warnings.push('WARN_MEMORY_TILING')
  if (totalScale > AUTO_TILING_MIN_SCALE) warnings.push('WARN_OVERSIZED_TILING')

  return {
    src,
    srcCrop: fit.srcCrop,
    target: fit.target,
    totalScale,
    chain,
    strategy,
    fitMode: input.fitMode,
    weights,
    aiUsed: totalScale > AUTO_DIRECT_MAX_SCALE,
    warnings,
    estimatedMemoryMb
  }
}

/** 체인 요약 문구 — "2배 → 2배 → 2.5배" (부록 B 진행 메시지용) */
export function chainSummary(chain: readonly number[]): string {
  return chain
    .map((scale) =>
      Number.isInteger(scale) ? `${scale}배` : `${scale.toFixed(1).replace(/\.0$/, '')}배`
    )
    .join(' → ')
}
