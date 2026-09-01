import { describe, expect, it } from 'vitest'
import { buildExportManifest, cmToPx, pxToCm, type ExportableItem } from './exportManifest'

const item = (overrides: Partial<ExportableItem> = {}): ExportableItem => ({
  filePath: 'C:/images/a.png',
  x: 1234,
  y: 567,
  widthPx: 2066,
  heightPx: 2066,
  rotation: 37.5,
  ...overrides
})

describe('px ↔ cm 환산', () => {
  it.each([
    [6890], // 롤 폭 50cm
    [13780], // 1m
    [27559], // 2m
    [2066], // 15cm
    [1234] // 임의 좌표
  ])('%ipx ↔ cm 왕복이 무손실이다', (px) => {
    expect(cmToPx(pxToCm(px))).toBe(px)
  })
})

describe('buildExportManifest', () => {
  it('씬 상태(px)를 cm 매니페스트로 변환한다', () => {
    const manifest = buildExportManifest({
      outputPath: 'C:/out/test.psd',
      widthPx: 6890,
      heightPx: 13780,
      items: [item()]
    })

    expect(manifest.output_path).toBe('C:/out/test.psd')
    expect(manifest.canvas).toEqual({
      width_cm: pxToCm(6890),
      height_m: pxToCm(13780) / 100,
      dpi: 350
    })
    // 1m 캔버스의 height_m은 정확히 1이 아니라(13780px = 100.0036cm) float 그대로 —
    // Python이 cm→px 재변환 시 13780으로 무손실 복원한다
    expect(cmToPx(manifest.canvas.height_m * 100)).toBe(13780)
    expect(cmToPx(manifest.canvas.width_cm)).toBe(6890)

    const [entry] = manifest.items
    expect(entry.src).toBe('C:/images/a.png')
    expect(entry.rotation).toBe(37.5)
    expect(cmToPx(entry.x_cm)).toBe(1234)
    expect(cmToPx(entry.y_cm)).toBe(567)
    expect(cmToPx(entry.width_cm)).toBe(2066)
    expect(cmToPx(entry.height_cm)).toBe(2066)
  })

  it('항목 필드는 경로·좌표만 담는다 — dataUrl 등 바이너리 유출 금지 (STDIO_GUIDE)', () => {
    const manifest = buildExportManifest({
      outputPath: 'C:/out.psd',
      widthPx: 6890,
      heightPx: 13780,
      items: [item({ filePath: 'C:/img/루고.png' })]
    })
    expect(Object.keys(manifest.items[0]).sort()).toEqual([
      'height_cm',
      'rotation',
      'src',
      'width_cm',
      'x_cm',
      'y_cm'
    ])
    // 직렬화 크기 상한 — 이미지 데이터가 실수로 섞이면 즉시 파열
    expect(JSON.stringify(manifest).length).toBeLessThan(2000)
  })

  it('빈 씬도 매니페스트로 만들 수 있다(레이어 0 PSD)', () => {
    const manifest = buildExportManifest({
      outputPath: 'C:/out.psd',
      widthPx: 6890,
      heightPx: 27559,
      items: []
    })
    expect(manifest.items).toEqual([])
    expect(cmToPx(manifest.canvas.height_m * 100)).toBe(27559) // 2m
  })

  it('음수 좌표(캔버스 밖 항목)도 그대로 전달된다', () => {
    const manifest = buildExportManifest({
      outputPath: 'C:/out.psd',
      widthPx: 6890,
      heightPx: 13780,
      items: [item({ x: -300, y: -450 })]
    })
    expect(manifest.items[0].x_cm).toBeLessThan(0)
    expect(manifest.items[0].y_cm).toBeLessThan(0)
    expect(cmToPx(manifest.items[0].x_cm)).toBe(-300)
  })

  it('dpi 기본값은 350이다', () => {
    const manifest = buildExportManifest({
      outputPath: 'C:/out.psd',
      widthPx: 6890,
      heightPx: 13780,
      items: []
    })
    expect(manifest.canvas.dpi).toBe(350)
  })

  it('format·flatten은 기본값(psd·false)일 때 생략된다', () => {
    const manifest = buildExportManifest({
      outputPath: 'C:/out.psd',
      widthPx: 6890,
      heightPx: 13780,
      items: [item()]
    })
    expect(manifest.format).toBeUndefined()
    expect(manifest.flatten).toBeUndefined()
  })

  it('PNG 포맷·병합 옵션을 지정하면 매니페스트에 반영된다 (F8·F9)', () => {
    const manifest = buildExportManifest({
      outputPath: 'C:/out.png',
      widthPx: 6890,
      heightPx: 13780,
      items: [item()],
      format: 'png',
      flatten: true
    })
    expect(manifest.format).toBe('png')
    expect(manifest.flatten).toBe(true)
  })
})
