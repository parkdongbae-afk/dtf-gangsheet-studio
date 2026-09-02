import { useEffect, useRef } from 'react'
import type { ViewTransform } from './placement'
import { computeRulerTicks, rulerTickLabel } from './ruler'

/** 350 DPI 문서 좌표계의 1cm 문서 px — 350 / 2.54 */
const DOC_PX_PER_CM = 350 / 2.54

/** 자 스트립 두께 (화면 px) */
export const RULER_SIZE = 22

const BG = '#18181b'
const DOC_EXTENT_BG = '#27272a'
const BORDER = '#3f3f46'
const TICK_MINOR = '#52525b'
const TICK_LABEL = '#71717a'
const TEXT = '#a1a1aa'
const FONT = '9px ui-monospace, Consolas, monospace'

const TICK_LABELED_LEN = 12
const TICK_MINOR_LEN = 5

interface RulerOverlayProps {
  view: ViewTransform
  viewportW: number
  viewportH: number
  docW: number
  docH: number
}

/** 문서 px 길이 → 화면 px 시작/끝 (뷰 변환 적용) */
const docExtentScreen = (
  docPx: number,
  view: ViewTransform,
  axisOffset: number
): [number, number] => [axisOffset, axisOffset + docPx * view.scale]

/** 화면 좌표 축의 보이는 cm 범위 — 문서 원점(0cm) 기준, 문서 바깥은 음수/초과값 */
function visibleCmRange(
  axisScreenPx: number,
  view: ViewTransform,
  originScreen: number
): [number, number] {
  const startDocPx = (0 - originScreen) / view.scale
  const endDocPx = (axisScreenPx - originScreen) / view.scale
  return [startDocPx / DOC_PX_PER_CM, endDocPx / DOC_PX_PER_CM]
}

/**
 * 뷰포트 상단·좌측 자(ruler) 오버레이 — 문서 좌표계 0cm를 문서 좌상단에 둔 채
 * 줌/팬을 따라간다. HTML canvas 2D로 그리며 포인터 이벤트는 통과시킨다.
 */
export function RulerOverlay({
  view,
  viewportW,
  viewportH,
  docW,
  docH
}: RulerOverlayProps): React.JSX.Element {
  const topRef = useRef<HTMLCanvasElement>(null)
  const leftRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const pxPerCm = DOC_PX_PER_CM * view.scale
    const dpr = window.devicePixelRatio || 1

    const top = topRef.current
    if (top) {
      prepareCanvas(top, viewportW, RULER_SIZE, dpr)
      const ctx = top.getContext('2d')
      if (ctx) {
        const [startCm, endCm] = visibleCmRange(viewportW, view, view.x)
        const [docX0, docX1] = docExtentScreen(docW, view, view.x)
        drawHorizontalRuler(ctx, viewportW, pxPerCm, startCm, endCm, docX0, docX1)
      }
    }

    const left = leftRef.current
    if (left) {
      prepareCanvas(left, RULER_SIZE, viewportH, dpr)
      const ctx = left.getContext('2d')
      if (ctx) {
        const [startCm, endCm] = visibleCmRange(viewportH, view, view.y)
        const [docY0, docY1] = docExtentScreen(docH, view, view.y)
        drawVerticalRuler(ctx, viewportH, pxPerCm, startCm, endCm, docY0, docY1)
      }
    }
  }, [view, viewportW, viewportH, docW, docH])

  return (
    <div className="pointer-events-none absolute inset-0 select-none">
      <canvas ref={topRef} className="absolute left-0 top-0" />
      <canvas ref={leftRef} className="absolute left-0 top-0" />
      <div
        className="absolute left-0 top-0 flex items-center justify-center border-b border-r text-[9px] font-medium text-zinc-500"
        style={{
          width: RULER_SIZE,
          height: RULER_SIZE,
          backgroundColor: BG,
          borderColor: BORDER
        }}
      >
        cm
      </div>
    </div>
  )
}

function prepareCanvas(canvas: HTMLCanvasElement, cssW: number, cssH: number, dpr: number): void {
  canvas.width = Math.max(1, Math.round(cssW * dpr))
  canvas.height = Math.max(1, Math.round(cssH * dpr))
  canvas.style.width = `${cssW}px`
  canvas.style.height = `${cssH}px`
  const ctx = canvas.getContext('2d')
  ctx?.setTransform(dpr, 0, 0, dpr, 0, 0)
}

function drawHorizontalRuler(
  ctx: CanvasRenderingContext2D,
  widthPx: number,
  pxPerCm: number,
  startCm: number,
  endCm: number,
  docX0: number,
  docX1: number
): void {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, widthPx, RULER_SIZE)
  ctx.fillStyle = DOC_EXTENT_BG
  ctx.fillRect(docX0, 0, docX1 - docX0, RULER_SIZE)

  ctx.strokeStyle = TICK_MINOR
  ctx.lineWidth = 1
  ctx.font = FONT
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'

  for (const tick of computeRulerTicks(startCm, endCm, pxPerCm)) {
    const x = Math.round(tick.pos) + 0.5
    ctx.beginPath()
    if (tick.labeled) {
      ctx.strokeStyle = TICK_LABEL
      ctx.moveTo(x, RULER_SIZE - TICK_LABELED_LEN)
      ctx.lineTo(x, RULER_SIZE)
      ctx.stroke()
      ctx.fillStyle = TEXT
      ctx.fillText(rulerTickLabel(tick.cm), tick.pos, 5.5)
    } else {
      ctx.strokeStyle = TICK_MINOR
      ctx.moveTo(x, RULER_SIZE - TICK_MINOR_LEN)
      ctx.lineTo(x, RULER_SIZE)
      ctx.stroke()
    }
  }

  ctx.strokeStyle = BORDER
  ctx.beginPath()
  ctx.moveTo(0, RULER_SIZE - 0.5)
  ctx.lineTo(widthPx, RULER_SIZE - 0.5)
  ctx.stroke()
}

function drawVerticalRuler(
  ctx: CanvasRenderingContext2D,
  heightPx: number,
  pxPerCm: number,
  startCm: number,
  endCm: number,
  docY0: number,
  docY1: number
): void {
  ctx.fillStyle = BG
  ctx.fillRect(0, 0, RULER_SIZE, heightPx)
  ctx.fillStyle = DOC_EXTENT_BG
  ctx.fillRect(0, docY0, RULER_SIZE, docY1 - docY0)

  ctx.lineWidth = 1
  ctx.font = FONT
  ctx.textBaseline = 'middle'

  for (const tick of computeRulerTicks(startCm, endCm, pxPerCm)) {
    const y = Math.round(tick.pos) + 0.5
    ctx.beginPath()
    if (tick.labeled) {
      ctx.strokeStyle = TICK_LABEL
      ctx.moveTo(RULER_SIZE - TICK_LABELED_LEN, y)
      ctx.lineTo(RULER_SIZE, y)
      ctx.stroke()
      ctx.save()
      ctx.fillStyle = TEXT
      ctx.translate(5.5, tick.pos)
      ctx.rotate(-Math.PI / 2)
      ctx.textAlign = 'center'
      ctx.fillText(rulerTickLabel(tick.cm), 0, 0)
      ctx.restore()
    } else {
      ctx.strokeStyle = TICK_MINOR
      ctx.moveTo(RULER_SIZE - TICK_MINOR_LEN, y)
      ctx.lineTo(RULER_SIZE, y)
      ctx.stroke()
    }
  }

  ctx.strokeStyle = BORDER
  ctx.beginPath()
  ctx.moveTo(RULER_SIZE - 0.5, 0)
  ctx.lineTo(RULER_SIZE - 0.5, heightPx)
  ctx.stroke()
}
