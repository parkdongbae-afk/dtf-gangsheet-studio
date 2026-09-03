import { describe, expect, it } from 'vitest'
import { extractImageDpi, extractImageSize, physicalDocPixels } from './imageMeta'

/** PNG 헤더 조립 — 시그니처 + IHDR + (선택) pHYs. CRC는 파서가 안 읽으므로 0 채움 */
function buildPng(chunk: 'pHYs' | 'none', xppm?: number, unit?: number): Uint8Array {
  const header = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]
  const ihdr = [
    0,
    0,
    0,
    13, // length
    0x49,
    0x48,
    0x44,
    0x52, // 'IHDR'
    0,
    0,
    0,
    10,
    0,
    0,
    0,
    10, // 10×10
    8,
    6,
    0,
    0,
    0, // bit depth, color type, ...
    0,
    0,
    0,
    0 // CRC (미검증)
  ]
  const bytes = [...header, ...ihdr]
  if (chunk === 'pHYs') {
    const ppm = xppm ?? 5906 // ≈150dpi
    bytes.push(
      0,
      0,
      0,
      9, // length
      0x70,
      0x48,
      0x59,
      0x73, // 'pHYs'
      (ppm >>> 24) & 0xff,
      (ppm >>> 16) & 0xff,
      (ppm >>> 8) & 0xff,
      ppm & 0xff,
      (ppm >>> 24) & 0xff,
      (ppm >>> 16) & 0xff,
      (ppm >>> 8) & 0xff,
      ppm & 0xff,
      unit ?? 1,
      0,
      0,
      0,
      0 // CRC
    )
  }
  bytes.push(0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82) // IEND
  return new Uint8Array(bytes)
}

/** JPEG 헤더 조립 — SOI + APP0(JFIF) 밀도 */
function buildJpeg(units: number, xdensity: number): Uint8Array {
  const d = xdensity
  return new Uint8Array([
    0xff,
    0xd8, // SOI
    0xff,
    0xe0, // APP0
    0,
    16, // length
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00, // 'JFIF\0'
    1,
    2, // version
    units,
    (d >> 8) & 0xff,
    d & 0xff, // X density
    (d >> 8) & 0xff,
    d & 0xff, // Y density
    0,
    0, // thumbnail
    0xff,
    0xd9 // EOI
  ])
}

describe('extractImageDpi — PNG pHYs', () => {
  it('unit=1(meter) — 5906ppm ≈ 150dpi', () => {
    expect(extractImageDpi(buildPng('pHYs', 5906, 1))).toBe(150)
  })

  it('350dpi 문서 밀도 — 13780ppm = 350dpi', () => {
    expect(extractImageDpi(buildPng('pHYs', 13780, 1))).toBe(350)
  })

  it('unit=0(비율 전용) — 물리 크기 없음 → null', () => {
    expect(extractImageDpi(buildPng('pHYs', 5906, 0))).toBeNull()
  })

  it('pHYs 청크 없음 → null', () => {
    expect(extractImageDpi(buildPng('none'))).toBeNull()
  })
})

describe('extractImageDpi — JPEG JFIF', () => {
  it('units=1(dpi) — 밀도값 그대로', () => {
    expect(extractImageDpi(buildJpeg(1, 300))).toBe(300)
  })

  it('units=2(dcm) — 2.54배 환산', () => {
    expect(extractImageDpi(buildJpeg(2, 118))).toBe(300) // 118 dcm ≈ 299.7 → 300
  })

  it('units=0(비율 전용) → null', () => {
    expect(extractImageDpi(buildJpeg(0, 96))).toBeNull()
  })
})

describe('extractImageDpi — 미지원 형식', () => {
  it('PNG/JPEG 시그니처 외 → null', () => {
    expect(extractImageDpi(new Uint8Array([0x42, 0x4d, 0, 0]))).toBeNull() // BMP
    expect(extractImageDpi(new Uint8Array(4))).toBeNull()
  })
})

describe('physicalDocPixels — 물리 크기 보존 환산', () => {
  it('500dpi 원본 967px → 350dpi 문서 689px ≈ 5cm (5cm@500dpi 보존)', () => {
    expect(physicalDocPixels(967, 500)).toBeCloseTo(676.9, 1) // 967×350/500
  })

  it('dpi 350이면 픽셀 불변', () => {
    expect(physicalDocPixels(1000, 350)).toBe(1000)
  })

  it('dpi 없음·무효 → 원본 픽셀 그대로 (기존 동작 하위 호환)', () => {
    expect(physicalDocPixels(1000, undefined)).toBe(1000)
    expect(physicalDocPixels(1000, 0)).toBe(1000)
  })
})

/** JPEG SOF0 세그먼트 조립 — 치수 파싱 검증용 (픽셀 데이터 없음) */
function buildJpegWithSof(width: number, height: number): Uint8Array {
  const sof = [
    0xff,
    0xc0,
    0,
    17,
    8,
    (height >> 8) & 0xff,
    height & 0xff,
    (width >> 8) & 0xff,
    width & 0xff
  ]
  const app0 = buildJpeg(1, 300)
  return new Uint8Array([...app0.slice(0, -2), ...sof, 0xff, 0xd9])
}

/** WebP 헤더 조립 — chunk 종류별 치수 레이아웃 검증용 */
function buildWebP(chunk: 'VP8X' | 'VP8 ' | 'VP8L', width: number, height: number): Uint8Array {
  const head = [0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]
  const tag = chunk.split('').map((c) => c.charCodeAt(0))
  const body: number[] = []
  if (chunk === 'VP8X') {
    body.push(
      0,
      0,
      0,
      0, // chunk size(자리만)
      0,
      0,
      0,
      0, // flags/reserved
      (width - 1) & 0xff,
      ((width - 1) >> 8) & 0xff,
      ((width - 1) >> 16) & 0xff,
      (height - 1) & 0xff,
      ((height - 1) >> 8) & 0xff,
      ((height - 1) >> 16) & 0xff
    )
  } else if (chunk === 'VP8 ') {
    body.push(
      0,
      0,
      0,
      0, // chunk size
      0x30,
      0x01,
      0x00, // frame tag
      0x9d,
      0x01,
      0x2a, // start code
      width & 0xff,
      (width >> 8) & 0x3f,
      height & 0xff,
      (height >> 8) & 0x3f
    )
  } else {
    const w1 = width - 1
    const h1 = height - 1
    body.push(
      0,
      0,
      0,
      0, // chunk size
      0x2f, // VP8L signature
      w1 & 0xff,
      ((w1 >> 8) & 0x3f) | ((h1 & 0x3) << 6),
      (h1 >> 2) & 0xff,
      (h1 >> 10) & 0x03
    )
  }
  return new Uint8Array([...head, ...tag, ...body])
}

describe('extractImageSize — 업스케일 예상 패널용 치수 파싱', () => {
  it('PNG IHDR → 치수', () => {
    expect(extractImageSize(buildPng('none'))).toEqual({ width: 10, height: 10 })
    expect(extractImageSize(buildPng('pHYs', 5906, 1))).toEqual({ width: 10, height: 10 })
  })

  it('JPEG SOF0 → 치수', () => {
    expect(extractImageSize(buildJpegWithSof(4000, 3000))).toEqual({ width: 4000, height: 3000 })
  })

  it('JPEG SOF 없음(헤더만) → null', () => {
    expect(extractImageSize(buildJpeg(1, 300))).toBeNull()
  })

  it('WebP VP8X(확장) → 치수', () => {
    expect(extractImageSize(buildWebP('VP8X', 641, 481))).toEqual({ width: 641, height: 481 })
  })

  it('WebP VP8(손실) → 치수', () => {
    expect(extractImageSize(buildWebP('VP8 ', 640, 480))).toEqual({ width: 640, height: 480 })
  })

  it('WebP VP8L(무손실) → 치수', () => {
    expect(extractImageSize(buildWebP('VP8L', 641, 481))).toEqual({ width: 641, height: 481 })
  })

  it('미지원 형식·빈 입력 → null', () => {
    expect(extractImageSize(new Uint8Array([0x42, 0x4d, 0, 0]))).toBeNull() // BMP
    expect(extractImageSize(new Uint8Array(4))).toBeNull()
  })
})
