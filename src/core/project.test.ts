import { describe, expect, it } from 'vitest'
import {
  PROJECT_EXTENSION,
  PROJECT_FORMAT,
  PROJECT_VERSION,
  validateProjectData,
  ProjectFormatError,
  type ProjectData
} from './project'

const validProject = (): ProjectData => ({
  format: PROJECT_FORMAT,
  version: PROJECT_VERSION,
  document: { widthPx: 6890, heightPx: 13780 },
  images: [
    {
      id: 'a1',
      filePath: 'C:/imgs/red.png',
      widthPx: 600,
      heightPx: 400,
      x: 100.5,
      y: -20,
      rotation: 45
    }
  ]
})

describe('validateProjectData — 정상 스키마', () => {
  it('유효 프로젝트 통과 + 미지 필드 제거(정규화)', () => {
    const raw = { ...validProject(), unknownField: 'x' }
    const result = validateProjectData(raw)
    expect(result).toEqual(validProject())
    expect(Object.keys(result)).toEqual(['format', 'version', 'document', 'images'])
  })

  it('빈 이미지 목록 허용 (문서만 저장)', () => {
    const result = validateProjectData({ ...validProject(), images: [] })
    expect(result.images).toEqual([])
  })

  it('음수 좌표·회전·소수 x/y 허용 (캔버스 밖 배치 대비)', () => {
    expect(() => validateProjectData(validProject())).not.toThrow()
  })

  it('이미지 치수 소수 허용 — 리사이즈·비율 연산 결과(2026-09-03 접수: 1206.99…px 거부 결함)', () => {
    const raw = validProject()
    raw.images[0].heightPx = 1206.9961977186313
    raw.images[0].widthPx = 1809.5
    expect(() => validateProjectData(raw)).not.toThrow()
  })
})

describe('validateProjectData — 스키마 위반 거부', () => {
  it.each([
    ['루트가 객체 아님', 'not-object'],
    ['format 불일치', { ...validProject(), format: 'other-app' }],
    ['버전 불일치(향후 마이그레이션 지점)', { ...validProject(), version: 2 }],
    ['document 누락', { format: PROJECT_FORMAT, version: PROJECT_VERSION, images: [] }],
    ['images가 배열 아님', { ...validProject(), images: 'x' }]
  ])('%s → throw', (_name, raw) => {
    expect(() => validateProjectData(raw)).toThrow(ProjectFormatError)
  })

  it('문서 치수 — 양의 정수 아닌 값 거부', () => {
    for (const bad of [0, -1, 1.5, '6890', NaN, Infinity]) {
      const raw = { ...validProject(), document: { widthPx: bad, heightPx: 13780 } }
      expect(() => validateProjectData(raw), `widthPx=${String(bad)}`).toThrow(ProjectFormatError)
    }
  })

  it('문서 치수 — PSD 30,000px 한계 초과 거부', () => {
    const raw = { ...validProject(), document: { widthPx: 30_001, heightPx: 1000 } }
    expect(() => validateProjectData(raw)).toThrow(/PSD/)
  })

  it('이미지 항목 — id·filePath 빈 문자열 거부, 치수 양수 강제(0·음수 거부, 소수는 허용)', () => {
    const badId = validProject()
    badId.images[0].id = ''
    expect(() => validateProjectData(badId)).toThrow(/id/)

    const badPath = validProject()
    badPath.images[0].filePath = ''
    expect(() => validateProjectData(badPath)).toThrow(/filePath/)

    for (const bad of [0, -1, NaN, Infinity]) {
      const badDim = validProject()
      badDim.images[0].widthPx = bad
      expect(() => validateProjectData(badDim), `widthPx=${String(bad)}`).toThrow(/widthPx/)
    }
  })

  it('이미지 x/y/rotation — 유한수 강제 (NaN 거부)', () => {
    const raw = validProject()
    raw.images[0].rotation = NaN
    expect(() => validateProjectData(raw)).toThrow(/rotation/)
  })
})

describe('프로젝트 상수', () => {
  it('확장자 .dtf · 포맷·버전 식별자', () => {
    expect(PROJECT_EXTENSION).toBe('dtf')
    expect(PROJECT_FORMAT).toBe('dtf-gangsheet-project')
    expect(PROJECT_VERSION).toBe(1)
  })
})
