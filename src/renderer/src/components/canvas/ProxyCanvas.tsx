import { useCallback, useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import { Layer, Rect, Stage } from 'react-konva'

/**
 * 프록시 캔버스 뷰포트 (S3).
 *
 * - Stage 크기 = 브라우저 창(뷰포트) 고정 — 실제 6,890×N px 메모리의 Stage를 만들지 않는다.
 * - 문서는 가상 좌표계(350 DPI 절대 px)의 흰색 Rect 하나로 표현 (CLAUDE.md §1:
 *   내부 데이터는 항상 절대 픽셀, 스케일은 뷰 변환에서만 처리).
 * - 줌/팬은 stage.scale()/stage.position() 내장 속성만 조작 (객체 좌표 직접 연산 금지).
 */

/** 뷰 변환 상태 — stage.scale()/position() 에 대응하는 값만 다룬다 */
interface ViewTransform {
  scale: number
  x: number
  y: number
}

/** 줌 클램프 (화면 배율 기준) */
const MIN_SCALE = 0.02
const MAX_SCALE = 8
/** 휠 delta → 줌 비율 (exp 곱산: 휠·트랙패드 공통 부드러움) */
const ZOOM_SENSITIVITY = 0.0015
/** fit-to-screen 시 화면 가장자리 여백 (px) */
const FIT_PADDING = 24

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/** 문서 전체가 화면에 들어오는 뷰 변환(fit-to-screen) 계산 */
function fitView(docW: number, docH: number, viewW: number, viewH: number): ViewTransform {
  const scale = Math.min((viewW - FIT_PADDING * 2) / docW, (viewH - FIT_PADDING * 2) / docH)
  return { scale, x: (viewW - docW * scale) / 2, y: (viewH - docH * scale) / 2 }
}

export interface ProxyCanvasProps {
  /** 문서 가로 (350 DPI px) — 6,890 */
  widthPx: number
  /** 문서 세로 (350 DPI px) — 13,780 / 27,559 */
  heightPx: number
}

export function ProxyCanvas({ widthPx, heightPx }: ProxyCanvasProps): React.JSX.Element {
  const stageRef = useRef<Konva.Stage>(null)
  /** 사용자가 줌/팬을 한 번이라도 조작했는가 — 조작 전엔 리사이즈 시 자동 refit */
  const interactedRef = useRef(false)

  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [spaceDown, setSpaceDown] = useState(false)
  const [view, setView] = useState<ViewTransform>(() =>
    fitView(widthPx, heightPx, window.innerWidth, window.innerHeight)
  )

  /** 뷰포트(창) 리사이즈 추적 — 조작 이력 없으면 문서를 다시 맞춤 */
  useEffect(() => {
    const onResize = (): void => {
      const w = window.innerWidth
      const h = window.innerHeight
      setSize({ w, h })
      if (!interactedRef.current) setView(fitView(widthPx, heightPx, w, h))
    }
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [widthPx, heightPx])

  /** 스페이스 홀드 = 팬 모드 (커서 grab + Stage 드래그 활성) */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault()
        setSpaceDown(true)
      }
    }
    const onKeyUp = (e: KeyboardEvent): void => {
      if (e.code === 'Space') setSpaceDown(false)
    }
    const onBlur = (): void => setSpaceDown(false)
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('blur', onBlur)
    }
  }, [])

  /** 휠 줌 — 포인터 아래 문서 좌표를 고정한 채 stage.scale/position만 갱신 */
  const handleWheel = (e: Konva.KonvaEventObject<WheelEvent>): void => {
    e.evt.preventDefault()
    const pointer = stageRef.current?.getPointerPosition()
    if (!pointer) return
    interactedRef.current = true
    const factor = Math.exp(-e.evt.deltaY * ZOOM_SENSITIVITY)
    setView((prev) => {
      const scale = clamp(prev.scale * factor, MIN_SCALE, MAX_SCALE)
      const ratio = scale / prev.scale
      if (ratio === 1) return prev
      return {
        scale,
        x: pointer.x - (pointer.x - prev.x) * ratio,
        y: pointer.y - (pointer.y - prev.y) * ratio
      }
    })
  }

  /** 팬 종료 — Konva 내장 드래그가 이동시킨 stage.position을 상태로 동기화 */
  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>): void => {
    interactedRef.current = true
    setView((prev) => ({ ...prev, x: e.currentTarget.x(), y: e.currentTarget.y() }))
  }

  /** "맞춤" 버튼 — 문서 전체가 화면에 들어오도록 초기화 */
  const handleFit = useCallback((): void => {
    interactedRef.current = false
    setView(fitView(widthPx, heightPx, window.innerWidth, window.innerHeight))
  }, [widthPx, heightPx])

  const zoomPercent = Math.round(view.scale * 100)

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#1e293b',
        overflow: 'hidden',
        cursor: spaceDown ? 'grab' : 'default'
      }}
    >
      <Stage
        ref={stageRef}
        width={size.w}
        height={size.h}
        scaleX={view.scale}
        scaleY={view.scale}
        x={view.x}
        y={view.y}
        draggable={spaceDown}
        onWheel={handleWheel}
        onDragEnd={handleDragEnd}
      >
        <Layer>
          {/* 가상 문서 — 실규격 350 DPI 좌표계의 흰색 Rect (테두리는 화면 2px 유지) */}
          <Rect
            x={0}
            y={0}
            width={widthPx}
            height={heightPx}
            fill="#ffffff"
            stroke="#64748b"
            strokeWidth={2 / view.scale}
            perfectDrawEnabled={false}
          />
        </Layer>
      </Stage>

      {/* 상태 오버레이: 문서 치수 · 현재 배율 · 맞춤 버튼 */}
      <div
        style={{
          position: 'absolute',
          top: 12,
          right: 12,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '6px 12px',
          borderRadius: 6,
          background: '#0f172a',
          color: '#e2e8f0',
          fontSize: 13,
          fontVariantNumeric: 'tabular-nums',
          userSelect: 'none'
        }}
      >
        <span>
          {widthPx.toLocaleString()} × {heightPx.toLocaleString()} px
        </span>
        <span style={{ fontWeight: 700 }}>{zoomPercent}%</span>
        <button
          onClick={handleFit}
          style={{
            padding: '2px 10px',
            fontSize: 12,
            cursor: 'pointer',
            border: '1px solid #475569',
            borderRadius: 4,
            background: '#1e293b',
            color: 'inherit'
          }}
        >
          맞춤
        </button>
      </div>

      {/* 조작 힌트 */}
      <div
        style={{
          position: 'absolute',
          bottom: 12,
          left: 12,
          padding: '4px 10px',
          borderRadius: 6,
          background: '#0f172a',
          color: '#94a3b8',
          fontSize: 12,
          userSelect: 'none'
        }}
      >
        휠: 줌 · Space + 드래그: 팬
      </div>
    </div>
  )
}
