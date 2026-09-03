import { describe, expect, it } from 'vitest'
import {
  AUTO_DIRECT_MAX_SCALE,
  DEFAULT_MAX_TARGET_PX,
  PlanInputError,
  buildStepChain,
  buildUpscalePlan,
  chainSummary,
  cumulativeSquareWeights,
  estimateMemoryMb,
  overallProgress,
  resolveStrategy
} from './plan'

const SRC = { width: 400, height: 300 }

describe('buildStepChain — §4.3 검증표', () => {
  it.each([
    { totalScale: 10, strategy: 'STEP_2X' as const, expected: [2, 2, 2.5] },
    { totalScale: 10, strategy: 'STEP_5X' as const, expected: [5, 2] },
    { totalScale: 8, strategy: 'STEP_2X' as const, expected: [2, 2, 2] },
    { totalScale: 5, strategy: 'STEP_2X' as const, expected: [2, 2.5] },
    { totalScale: 3, strategy: 'STEP_2X' as const, expected: [2, 1.5] },
    { totalScale: 26, strategy: 'STEP_5X' as const, expected: [5, 5.2] },
    { totalScale: 1.2, strategy: 'DIRECT' as const, expected: [1.2] },
    { totalScale: 0.5, strategy: 'STEP_2X' as const, expected: [0.5] }
  ])('S=$totalScale ${strategy} → $expected', ({ totalScale, strategy, expected }) => {
    expect(buildStepChain(totalScale, strategy)).toEqual(expected)
  })

  it('잔여 흡수 상한 — 흡수 결과가 K×1.25 초과면 흡수하지 않는다', () => {
    // S=3.2: [2, 1.6] — last 1.6 ≥ 1.5라 흡수 대상 아님
    expect(buildStepChain(3.2, 'STEP_2X')).toEqual([2, 1.6])
    // S=7.4 STEP_3X: r=7.4 → push3, r=2.4667 → push → [3, 2.47] — last ≥ 1.5
    expect(buildStepChain(7.4, 'STEP_3X')).toEqual([3, 2.47])
    // S=5.5 STEP_3X: r=5.5>3 → push3, r=1.8333 → [3, 1.83] — last ≥ 1.5, 흡수 없음
    expect(buildStepChain(5.5, 'STEP_3X')).toEqual([3, 1.83])
  })

  it('S가 정확히 K면 단일 스텝 체인', () => {
    expect(buildStepChain(2, 'STEP_2X')).toEqual([2])
    expect(buildStepChain(5, 'STEP_5X')).toEqual([5])
  })
})

describe('resolveStrategy — §4.4 AUTO 규칙', () => {
  it('S ≤ 1.5 → DIRECT', () => {
    expect(resolveStrategy(1.2, 'AUTO')).toBe('DIRECT')
    expect(resolveStrategy(AUTO_DIRECT_MAX_SCALE, 'AUTO')).toBe('DIRECT')
  })
  it('1.5 < S ≤ 12 → STEP_2X', () => {
    expect(resolveStrategy(2, 'AUTO')).toBe('STEP_2X')
    expect(resolveStrategy(12, 'AUTO')).toBe('STEP_2X')
  })
  it('S > 12 → STEP_2X (타일링 강제는 경고로 표현)', () => {
    expect(resolveStrategy(13, 'AUTO')).toBe('STEP_2X')
  })
  it('AUTO 외 전략은 그대로 통과', () => {
    expect(resolveStrategy(10, 'STEP_5X')).toBe('STEP_5X')
    expect(resolveStrategy(0.8, 'DIRECT')).toBe('DIRECT')
  })
})

describe('cm → px 변환 (§4.1)', () => {
  it('10cm @ 300DPI → 1181px', () => {
    const plan = buildUpscalePlan(
      { unit: 'cm', widthCm: 10, heightCm: 10, dpi: 300, strategy: 'AUTO', fitMode: 'KEEP_RATIO' },
      { width: 118, height: 118 }
    )
    expect(plan.target.width).toBe(1181)
    expect(plan.target.height).toBe(1181)
    expect(plan.totalScale).toBeCloseTo(10, 1)
    expect(plan.chain).toEqual([2, 2, 2.5])
  })

  it('px 단위는 타겟 px을 직접 사용한다', () => {
    const plan = buildUpscalePlan(
      {
        unit: 'px',
        widthPx: 800,
        heightPx: 600,
        dpi: 300,
        strategy: 'AUTO',
        fitMode: 'KEEP_RATIO'
      },
      SRC
    )
    expect(plan.target).toEqual({ width: 800, height: 600 })
  })

  it('배율 단위는 원본 px × 배율', () => {
    const plan = buildUpscalePlan(
      { unit: 'scale', scale: 2, dpi: 300, strategy: 'STEP_2X', fitMode: 'KEEP_RATIO' },
      SRC
    )
    expect(plan.target).toEqual({ width: 800, height: 600 })
  })

  it('cm 범위 초과(200cm) 시 PlanInputError', () => {
    expect(() =>
      buildUpscalePlan(
        {
          unit: 'cm',
          widthCm: 300,
          heightCm: 10,
          dpi: 300,
          strategy: 'AUTO',
          fitMode: 'KEEP_RATIO'
        },
        SRC
      )
    ).toThrow(PlanInputError)
  })
})

describe('진행률 픽셀 가중치 (§4.5)', () => {
  it('[2,2,2.5] 기여도 ≈ 3.3% / 13.3% / 83.3%', () => {
    const weights = cumulativeSquareWeights([2, 2, 2.5])
    expect(weights.reduce((s, w) => s + w, 0)).toBeCloseTo(1, 10)
    expect(weights[0]).toBeCloseTo(0.0333, 3)
    expect(weights[1]).toBeCloseTo(0.1333, 3)
    expect(weights[2]).toBeCloseTo(0.8333, 3)
  })

  it('진행률 단조 증가 · 종료 시 1.0 도달 (테스트 계획 §9)', () => {
    const weights = cumulativeSquareWeights([2, 2, 2.5])
    let prev = -1
    for (let step = 0; step < 3; step++) {
      for (const f of [0, 0.25, 0.5, 0.75, 1]) {
        const p = overallProgress(weights, step, f)
        expect(p).toBeGreaterThanOrEqual(prev)
        expect(p).toBeLessThanOrEqual(1)
        prev = p
      }
    }
    expect(overallProgress(weights, 2, 1)).toBeCloseTo(1, 10)
  })
})

describe('가드레일 (§6.1)', () => {
  it('목표 10000px → 클램프 + WARN_TARGET_CLAMPED (KEEP_RATIO는 비율 유지 축소)', () => {
    const plan = buildUpscalePlan(
      {
        unit: 'px',
        widthPx: 10000,
        heightPx: 5000,
        dpi: 300,
        strategy: 'AUTO',
        fitMode: 'KEEP_RATIO'
      },
      SRC
    )
    expect(Math.max(plan.target.width, plan.target.height)).toBeLessThanOrEqual(
      DEFAULT_MAX_TARGET_PX
    )
    expect(plan.warnings).toContain('WARN_TARGET_CLAMPED')
    // 원본 4:3 비율이 유지된다 — 클램프 캔버스(8000×4000) 안의 짧은 쪽 배율 5333×4000
    expect(plan.target).toEqual({ width: 5333, height: 4000 })
  })

  it('S=0.5 → WARN_DOWNSCALE · AI 생략', () => {
    const plan = buildUpscalePlan(
      { unit: 'scale', scale: 0.5, dpi: 300, strategy: 'AUTO', fitMode: 'KEEP_RATIO' },
      SRC
    )
    expect(plan.warnings).toContain('WARN_DOWNSCALE')
    expect(plan.aiUsed).toBe(false)
    expect(plan.chain).toEqual([0.5])
  })

  it('1 ≤ S < 1.5 + 단계 전략 → WARN_DIRECT_RECOMMENDED', () => {
    const plan = buildUpscalePlan(
      { unit: 'scale', scale: 1.2, dpi: 300, strategy: 'STEP_2X', fitMode: 'KEEP_RATIO' },
      SRC
    )
    expect(plan.warnings).toContain('WARN_DIRECT_RECOMMENDED')
    expect(plan.aiUsed).toBe(false)
  })

  it('DPI < 72 → WARN_LOW_DPI', () => {
    const plan = buildUpscalePlan(
      { unit: 'scale', scale: 2, dpi: 60, strategy: 'STEP_2X', fitMode: 'KEEP_RATIO' },
      SRC
    )
    expect(plan.warnings).toContain('WARN_LOW_DPI')
  })

  it('S > 12 → WARN_OVERSIZED_TILING', () => {
    const plan = buildUpscalePlan(
      { unit: 'scale', scale: 13, dpi: 300, strategy: 'AUTO', fitMode: 'KEEP_RATIO' },
      SRC
    )
    expect(plan.warnings).toContain('WARN_OVERSIZED_TILING')
  })
})

describe('FitMode (§4.2)', () => {
  const input = {
    unit: 'px' as const,
    widthPx: 800,
    heightPx: 800,
    dpi: 300,
    strategy: 'AUTO' as const
  }

  it('KEEP_RATIO — 목표를 원본 비율(4:3)로 재조정', () => {
    const plan = buildUpscalePlan({ ...input, fitMode: 'KEEP_RATIO' }, SRC)
    expect(plan.target).toEqual({ width: 800, height: 600 })
    expect(plan.srcCrop).toBeNull()
  })

  it('비율 불일치(배율 차 ~67%) → WARN_RATIO_MISMATCH', () => {
    const plan = buildUpscalePlan({ ...input, fitMode: 'KEEP_RATIO' }, SRC)
    expect(plan.warnings).toContain('WARN_RATIO_MISMATCH')
  })

  it('COVER — 원본을 목표 비율로 센터 크롭 후 균등 확대', () => {
    const plan = buildUpscalePlan({ ...input, fitMode: 'COVER' }, SRC)
    // 4:3 원본 → 1:1 타겟: 폭을 300×(800/800)=300px로 크롭, 좌우 여백 50px씩
    expect(plan.srcCrop).toEqual({ x: 50, y: 0, width: 300, height: 300 })
    expect(plan.target).toEqual({ width: 800, height: 800 })
    expect(plan.totalScale).toBeCloseTo(2.67, 2)
  })

  it('CONTAIN — 목표 캔버스 유지, 체인은 짧은 쪽 배율', () => {
    const plan = buildUpscalePlan({ ...input, fitMode: 'CONTAIN' }, SRC)
    expect(plan.target).toEqual({ width: 800, height: 800 })
    expect(plan.totalScale).toBe(2)
  })

  it('STRETCH — 목표 캔버스 그대로 (최종 단계에서 비균등)', () => {
    const plan = buildUpscalePlan({ ...input, fitMode: 'STRETCH' }, SRC)
    expect(plan.target).toEqual({ width: 800, height: 800 })
    expect(plan.totalScale).toBe(2)
  })
})

describe('메모리 추정 (§4.6)', () => {
  it('8000×600px → 약 46MB (RGBA×2.5 오버헤드)', () => {
    expect(estimateMemoryMb(8000, 600)).toBeCloseTo(45.8, 1)
  })
})

describe('chainSummary', () => {
  it('체인을 한국어 요약 문구로', () => {
    expect(chainSummary([2, 2, 2.5])).toBe('2배 → 2배 → 2.5배')
    expect(chainSummary([5, 2])).toBe('5배 → 2배')
    expect(chainSummary([0.5])).toBe('0.5배')
  })
})
