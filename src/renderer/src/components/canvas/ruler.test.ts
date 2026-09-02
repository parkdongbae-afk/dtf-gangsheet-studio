import { describe, expect, it } from 'vitest'
import { computeRulerTicks, pickRulerScale, rulerTickLabel } from './ruler'

describe('pickRulerScale', () => {
  it('100% 줌(약 137.8px/cm) → 라벨 0.5cm·보조 0.1cm', () => {
    const scale = pickRulerScale(137.8)
    expect(scale.labelStepCm).toBe(0.5)
    expect(scale.minorStepCm).toBeCloseTo(0.1)
  })

  it('축소(3px/cm) → 라벨 20cm·보조 4cm', () => {
    const scale = pickRulerScale(3)
    expect(scale.labelStepCm * 3).toBeGreaterThanOrEqual(48)
    expect(scale.labelStepCm).toBe(20)
    expect(scale.minorStepCm).toBe(4)
  })

  it('극단 축소(0.5px/cm) → 최대 후보 100cm로 클램프', () => {
    expect(pickRulerScale(0.5).labelStepCm).toBe(100)
  })

  it('확대(1,000px/cm) → 라벨 0.1cm·보조 0.02cm', () => {
    const scale = pickRulerScale(1000)
    expect(scale.labelStepCm).toBe(0.1)
    expect(scale.minorStepCm).toBeCloseTo(0.02)
  })

  it('보조 눈금은 항상 라벨의 1/5 — 라벨 간격 ≥48px > 8px×5 보장', () => {
    for (const pxPerCm of [0.5, 1, 3, 12, 40, 137.8, 500, 2000]) {
      const s = pickRulerScale(pxPerCm)
      expect(s.labelStepCm * pxPerCm).toBeGreaterThanOrEqual(48)
      expect(s.minorStepCm).toBeCloseTo(s.labelStepCm / 5)
    }
  })

  it('0 이하 입력 → 안전 클램프(NaN 없음)', () => {
    const scale = pickRulerScale(0)
    expect(scale.labelStepCm).toBeGreaterThan(0)
    expect(scale.minorStepCm).toBeGreaterThan(0)
  })
})

describe('computeRulerTicks', () => {
  it('범위 안 눈금만 생성 — 시작/끝 경계 포함', () => {
    const ticks = computeRulerTicks(0, 10, 137.8)
    expect(ticks.length).toBeGreaterThan(0)
    expect(ticks[0].cm).toBeGreaterThanOrEqual(0)
    expect(ticks[ticks.length - 1].cm).toBeLessThanOrEqual(10)
  })

  it('pos는 뷰포트 원점 기준 — cm 0이 pos 0, cm 5가 5×pxPerCm', () => {
    const pxPerCm = 137.8
    const ticks = computeRulerTicks(0, 10, pxPerCm)
    const zero = ticks.find((t) => t.cm === 0)
    const five = ticks.find((t) => t.cm === 5)
    expect(zero?.pos).toBeCloseTo(0)
    expect(five?.pos).toBeCloseTo(5 * pxPerCm)
  })

  it('음수(문서 왼쪽 바깥) 범위도 좌표 성립', () => {
    const ticks = computeRulerTicks(-5, 5, 50)
    const at0 = ticks.find((t) => t.cm === 0)
    expect(at0?.pos).toBeCloseTo(5 * 50)
  })

  it('라벨은 라벨 스텝 배수에만 — 137.8px/cm에서 0.5cm마다 라벨', () => {
    const ticks = computeRulerTicks(0, 10, 137.8)
    const labeled = ticks.filter((t) => t.labeled).map((t) => t.cm)
    expect(labeled).toEqual([
      0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 6.5, 7, 7.5, 8, 8.5, 9, 9.5, 10
    ])
  })

  it('빈 범위·비정상 입력 → 빈 배열', () => {
    expect(computeRulerTicks(10, 0, 100)).toEqual([])
    expect(computeRulerTicks(0, 10, 0)).toEqual([])
    expect(computeRulerTicks(Number.NaN, 10, 100)).toEqual([])
  })
})

describe('rulerTickLabel', () => {
  it('정수 cm는 정수 라벨', () => {
    expect(rulerTickLabel(5)).toBe('5')
  })

  it('소수 스텝 눈금은 소수 1자리', () => {
    expect(rulerTickLabel(0.5)).toBe('0.5')
    expect(rulerTickLabel(1.2)).toBe('1.2')
  })
})
