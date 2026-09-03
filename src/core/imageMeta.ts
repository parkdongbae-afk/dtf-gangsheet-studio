/**
 * 이미지 물리 DPI 메타데이터 추출 (PNG pHYs / JPEG JFIF) — 순수 함수 (Vitest 선검증).
 *
 * 고DPI(예: 500dpi)로 저장된 원본을 350DPI 문서에 픽셀 그대로 배치하면 물리 크기가
 * 커지는 결함(5cm 원본이 7cm로)의 해결 근거. 메타데이터가 없으면 null —
 * 호출부는 기존 동작(픽셀 그대로)을 유지한다.
 */

/** PNG 시그니처 — 첫 8바이트가 일치해야 파싱을 시도한다 */
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPEG_SOI = [0xff, 0xd8] as const
/** pixels-per-meter → dots-per-inch 환산 (1 inch = 0.0254 m → dpi = ppm × 0.0254) */
const PPM_TO_DPI = 0.0254

const bytesEqual = (bytes: Uint8Array, offset: number, expected: readonly number[]): boolean =>
  expected.every((byte, i) => bytes[offset + i] === byte)

const readUint32Be = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 24) |
  (bytes[offset + 1]! << 16) |
  (bytes[offset + 2]! << 8) |
  bytes[offset + 3]!

const readUint16Be = (bytes: Uint8Array, offset: number): number =>
  (bytes[offset]! << 8) | bytes[offset + 1]!

const isValidDpi = (dpi: number): boolean => Number.isFinite(dpi) && dpi >= 1 && dpi <= 100_000

/** PNG pHYs 청크 파싱 — IHDR 직후 등장하는 경우가 많아 청크 순회로 탐색한다.
 *  unit=1(meter)일 때만 유효 — 0(비율 전용)은 물리 크기가 없어 null. */
function parsePngDpi(bytes: Uint8Array): number | null {
  let offset = 8 // 시그니처 이후 첫 청크
  while (offset + 12 <= bytes.length) {
    const length = readUint32Be(bytes, offset)
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!
    )
    const dataStart = offset + 8
    if (type === 'pHYs' && length >= 9) {
      const unit = bytes[dataStart + 8]
      if (unit !== 1) return null
      const xppm = readUint32Be(bytes, dataStart)
      if (xppm <= 0) return null
      const dpi = xppm * PPM_TO_DPI
      return isValidDpi(dpi) ? Math.round(dpi) : null
    }
    if (type === 'IDAT' || type === 'IEND') return null // 이미지 데이터 시작 전까지에만 존재
    offset = dataStart + length + 4 // 데이터 + CRC
  }
  return null
}

/** JPEG APP0(JFIF) 밀도 파싱 — units 1=dpi, 2=dcm(변환), 0=비율 전용(null) */
function parseJpegDpi(bytes: Uint8Array): number | null {
  if (bytes.length < 18) return null
  if (!bytesEqual(bytes, 2, [0xff, 0xe0])) return null // 첫 마커가 APP0여야 JFIF
  if (bytes[6] !== 0x4a || bytes[7] !== 0x46) return null // 'JF'
  const units = bytes[13]!
  const xDensity = readUint16Be(bytes, 14)
  if (xDensity <= 0) return null
  if (units === 1) {
    const dpi = xDensity
    return isValidDpi(dpi) ? dpi : null
  }
  if (units === 2) {
    const dpi = xDensity * 2.54 // dcm → dpi
    return isValidDpi(dpi) ? Math.round(dpi) : null
  }
  return null
}

/** 이미지 헤더 바이너리 → 물리 DPI (PNG/JPEG 외·메타데이터 없음 → null) */
export function extractImageDpi(bytes: Uint8Array): number | null {
  if (bytes.length >= 8 && bytesEqual(bytes, 0, PNG_SIGNATURE)) {
    return parsePngDpi(bytes)
  }
  if (bytes.length >= 2 && bytesEqual(bytes, 0, JPEG_SOI)) {
    return parseJpegDpi(bytes)
  }
  return null
}

/** 임포트 픽셀 치수를 물리 크기 보존 문서 px(350 DPI)로 환산.
 *  dpi가 없거나 무효(≤0)면 원본 픽셀을 그대로 돌려준다. */
export function physicalDocPixels(px: number, dpi: number | undefined): number {
  if (dpi === undefined || !(dpi > 0)) return px
  return (px / dpi) * 350
}
