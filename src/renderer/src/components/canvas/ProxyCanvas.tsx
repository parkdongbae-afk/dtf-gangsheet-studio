import { useCallback, useEffect, useRef, useState } from 'react'
import type Konva from 'konva'
import type { Box } from 'konva/lib/shapes/Transformer'
import { Image, Layer, Rect, Stage, Transformer } from 'react-konva'
import {
  Expand,
  FileOutput,
  Grid3x3,
  ImagePlus,
  Maximize,
  Redo2,
  Shrink,
  Undo2
} from 'lucide-react'
import { ExportDialog } from './ExportDialog'
import { GridDialog } from './GridDialog'
import {
  calculateGridPositions,
  centeredTopLeft,
  commitTransform,
  duplicateOffset,
  fitToCanvas,
  normalizeRotation,
  reorderItem,
  screenToDoc,
  viewCenterDoc,
  type DocPoint,
  type FitMode,
  type LayerOrderOp,
  type NodeTransformReading,
  type ViewTransform
} from './placement'
import { useHtmlImage } from './useHtmlImage'
import { PropertiesPanel } from '../PropertiesPanel'

/**
 * 프록시 캔버스 뷰포트 (S3) + 씬 이미지 배치·선택·이동·삭제 (S4)·리사이즈/회전/복제/그리드 (S5).
 *
 * - Stage 크기 = 브라우저 창(뷰포트) 고정 — 실제 6,890×N px 메모리의 Stage를 만들지 않는다.
 * - 문서는 가상 좌표계(350 DPI 절대 px)의 흰색 Rect + 이미지 노드로 표현 (CLAUDE.md §1:
 *   내부 데이터는 항상 절대 픽셀, 스케일은 뷰 변환에서만 처리).
 * - 줌/팬은 stage.scale()/stage.position() 내장 속성만 조작 (객체 좌표 직접 연산 금지).
 * - 이미지 노드는 원본 px 크기 그대로 렌더 — ≤2,048px 프리뷰 dataURL은 화면 표시 소스일 뿐.
 */

/** 씬에 배치된 이미지 — 좌표·크기는 전부 350 DPI 절대 px (음수 = 캔버스 밖 허용) */
export interface PlacedImage {
  id: string
  /** 원본 파일 절대 경로 — S6 내보내기(풀해상도 렌더)에서 사용 */
  filePath: string
  /** ≤2,048px PNG 프리뷰 dataURL — 표시 전용 */
  dataUrl: string
  widthPx: number
  heightPx: number
  x: number
  y: number
  /** 노드 중심 회전각 (도, -180 < r ≤ 180) — Konva rotation과 동일 단위 */
  rotation: number
}

/** 줌 클램프 (화면 배율 기준) */
const MIN_SCALE = 0.02
const MAX_SCALE = 8
/** 휠 delta → 줌 비율 (exp 곱산: 휠·트랙패드 공통 부드러움) */
const ZOOM_SENSITIVITY = 0.0015
/** fit-to-screen 시 화면 가장자리 여백 (px) */
const FIT_PADDING = 24
/** 문서 배경 Rect 식별명 — 빈 곳 클릭(선택 해제) 판정에 사용 */
const DOC_BACKGROUND = 'doc-background'
const SELECTION_STROKE = '#6366f1'
/** 리사이즈 최소 치수 (절대 px) — 반전·음수 치수 방지 (표준 Konva 레시피) */
const MIN_TRANSFORM_PX = 5
/** undo 히스토리 상한 (단계) — 초과분은 가장 오래된 스냅샷부터 폐기 */
const UNDO_LIMIT = 100

const boundMinSize = (oldBox: Box, newBox: Box): Box =>
  newBox.width < MIN_TRANSFORM_PX || newBox.height < MIN_TRANSFORM_PX ? oldBox : newBox

const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max)

/** 캔버스 전역 키보드 단축키를 텍스트 입력(그리드 대화상자 등)에서는 무시 */
const isEditableTarget = (target: EventTarget | null): boolean =>
  target instanceof HTMLInputElement ||
  target instanceof HTMLTextAreaElement ||
  (target instanceof HTMLElement && target.isContentEditable)

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
  /** 씬 전체에서 유일한 트랜스포머 — 선택 테두리 렌더 (이미지별 트랜스포머 금지) */
  const transformerRef = useRef<Konva.Transformer>(null)
  /** 속성 패널을 제외한 캔버스 뷰포트 영역 — Stage 크기·드롭 좌표의 기준 */
  const viewportRef = useRef<HTMLDivElement>(null)
  /** 사용자가 줌/팬을 한 번이라도 조작했는가 — 조작 전엔 리사이즈 시 자동 refit */
  const interactedRef = useRef(false)

  const [size, setSize] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const [spaceDown, setSpaceDown] = useState(false)
  const [view, setView] = useState<ViewTransform>(() =>
    fitView(widthPx, heightPx, window.innerWidth, window.innerHeight)
  )
  const [images, setImages] = useState<PlacedImage[]>([])
  /**
   * 실행취소 히스토리 — PlacedImage[] JSON 스냅샷만 저장 (Konva 객체 저장 금지 철칙).
   * 스냅샷은 배열 참조를 그대로 두는데, 씬 갱신은 항상 spread/map으로 새 배열을 만들므로
   * 참조가 불변이라는 규칙이 성립한다 (dataUrl 문자열 중복 복사 방지).
   */
  const [history, setHistory] = useState<{ past: PlacedImage[][]; future: PlacedImage[][] }>({
    past: [],
    future: []
  })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [gridOpen, setGridOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)

  /** 현재 선택 항목 — 그리드 복제·화면 채우기 기준 (렌더 스코프에서 해석: 순수 updater 유지) */
  const selectedItem = selectedId ? (images.find((img) => img.id === selectedId) ?? null) : null

  const { past, future } = history

  /**
   * 히스토리 기록 씬 변경 커밋 — 모든 이미지 변경 경로의 단일 관문. 변경 전 스냅샷을
   * past에 push(상한 100)하고 future를 폐기해 새 변경 이후의 redo를 무효화한다.
   * 업데이터는 순수 함수만 받는다(StrictMode 이중 호출 안전 — randomUUID는 밖에서).
   */
  const commitImages = useCallback(
    (updater: (prev: PlacedImage[]) => PlacedImage[]): void => {
      setHistory((h) => ({ past: [...h.past, images].slice(-UNDO_LIMIT), future: [] }))
      setImages(updater)
    },
    [images]
  )

  /** 실행취소 — past 마지막 스냅샷으로 복원, 현재 상태는 future로 이동.
   *  복원 씬에 선택 항목이 없으면 선택 해제(트랜스포머 유령 방지) — id를 제거하는 경로는
   *  삭제(명시적 해제)·undo/redo뿐이므로 여기서 가드하면 충분하다. */
  const undo = useCallback((): void => {
    if (past.length === 0) return
    const prev = past[past.length - 1]
    setHistory((h) => ({
      past: h.past.slice(0, -1),
      future: [images, ...h.future].slice(0, UNDO_LIMIT)
    }))
    setImages(prev)
    if (selectedId && !prev.some((img) => img.id === selectedId)) setSelectedId(null)
  }, [past, images, selectedId])

  /** 다시실행 — future 선두 스냅샷 재적용, 현재 상태는 past로 이동 (선택 가드는 undo와 동일) */
  const redo = useCallback((): void => {
    if (future.length === 0) return
    const next = future[0]
    setHistory((h) => ({
      past: [...h.past, images].slice(-UNDO_LIMIT),
      future: h.future.slice(1)
    }))
    setImages(next)
    if (selectedId && !next.some((img) => img.id === selectedId)) setSelectedId(null)
  }, [future, images, selectedId])

  const canUndo = past.length > 0
  const canRedo = future.length > 0

  /** 뷰포트(패널 제외 캔버스 영역) 크기 추적 — 조작 이력 없으면 문서를 다시 맞춤 */
  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const measure = (): void => {
      const w = el.clientWidth
      const h = el.clientHeight
      setSize({ w, h })
      if (!interactedRef.current) setView(fitView(widthPx, heightPx, w, h))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [widthPx, heightPx])

  /** 스페이스 홀드 = 팬 모드 (커서 grab + Stage 드래그 활성) — 텍스트 입력·모달 중 무시 */
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (gridOpen || exportOpen || isEditableTarget(e.target)) return
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
  }, [gridOpen, exportOpen])

  /**
   * 씬 편집 단축키 (통합) — Ctrl+Z=실행취소, Ctrl+Shift+Z/Ctrl+Y=다시실행(선택 불필요),
   * Del/Backspace=삭제, R=90° 회전, Ctrl/Cmd+D=복제(화면 24px 오프셋 — 캐스케이드 규칙).
   * 대화상자 모달 중·텍스트 입력 포커스 중에는 전면 무시한다.
   */
  useEffect(() => {
    if (gridOpen || exportOpen) return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (isEditableTarget(e.target)) return
      const mod = e.ctrlKey || e.metaKey
      if (mod && 'zyZY'.includes(e.key)) {
        e.preventDefault() // 브라우저/Electron 기본 undo·redo 차단
        if (e.repeat) return // 키 홀드 폭주 방지 — 단위 스텝만
        const isRedo = e.key === 'y' || e.key === 'Y' || e.shiftKey
        if (isRedo) redo()
        else undo()
        return
      }
      if (!selectedId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        commitImages((prev) => prev.filter((img) => img.id !== selectedId))
        setSelectedId(null)
        return
      }
      if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
        e.preventDefault()
        commitImages((prev) =>
          prev.map((img) =>
            img.id === selectedId ? { ...img, rotation: normalizeRotation(img.rotation + 90) } : img
          )
        )
        return
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault() // 브라우저 기본 동작(북마크) 차단 — Electron에서도 명시 차단
        if (e.repeat) return
        const item = images.find((img) => img.id === selectedId)
        if (!item) return
        const offset = duplicateOffset(view.scale)
        const copy: PlacedImage = {
          ...item,
          id: crypto.randomUUID(),
          x: item.x + offset,
          y: item.y + offset
        }
        commitImages((prev) => [...prev, copy])
        setSelectedId(copy.id)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [selectedId, images, view.scale, gridOpen, exportOpen, commitImages, undo, redo])

  /** 단일 공유 트랜스포머에 선택 노드만 바인딩 — 노드 드래그는 트랜스포머가 자동 추적 */
  useEffect(() => {
    const transformer = transformerRef.current
    const stage = stageRef.current
    if (!transformer || !stage) return
    const node = selectedId ? stage.findOne(`#${selectedId}`) : null
    transformer.nodes(node ? [node] : [])
    transformer.getLayer()?.batchDraw()
  }, [selectedId, images])

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

  /** Stage 빈 곳(스테이지 자신·문서 배경) 클릭 = 선택 해제 */
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    if (e.target === e.target.getStage() || e.target.name() === DOC_BACKGROUND) {
      setSelectedId(null)
    }
  }

  /** 이미지 클릭 선택 — Space 팬 모드 중에는 무시 (내비게이션 우선) */
  const handleSelect = useCallback(
    (id: string): void => {
      if (!spaceDown) setSelectedId(id)
    },
    [spaceDown]
  )

  /** 이미지 드래그 이동 확정 — 문서 좌표(절대 px)를 히스토리 커밋 */
  const handleMove = useCallback(
    (id: string, x: number, y: number): void => {
      commitImages((prev) => prev.map((img) => (img.id === id ? { ...img, x, y } : img)))
    },
    [commitImages]
  )

  /** 이미지 트랜스폼 확정 — 임시 scale이 확정된 절대 px 치수를 히스토리 커밋 (Konva는 뷰일 뿐) */
  const handleTransform = useCallback(
    (id: string, reading: NodeTransformReading): void => {
      const commit = commitTransform(reading)
      commitImages((prev) => prev.map((img) => (img.id === id ? { ...img, ...commit } : img)))
    },
    [commitImages]
  )

  /** "맞춤" 버튼 — 문서 전체가 화면에 들어오도록 초기화 */
  const handleFit = useCallback((): void => {
    interactedRef.current = false
    setView(fitView(widthPx, heightPx, window.innerWidth, window.innerHeight))
  }, [widthPx, heightPx])

  /** 그리드 복제 확정 — 셀 (0,0)=원본 자리를 제외한 순수 JSON 사본 추가 (신규 id만 새로) */
  const handleGridConfirm = useCallback(
    (rows: number, cols: number, gapPx: number): void => {
      if (!selectedItem) return
      const copies = calculateGridPositions(selectedItem, rows, cols, gapPx)
        .filter((cell) => cell.row > 0 || cell.col > 0)
        .map((cell) => ({
          ...selectedItem,
          id: crypto.randomUUID(),
          x: cell.x,
          y: cell.y
        }))
      commitImages((prev) => [...prev, ...copies])
      setGridOpen(false)
    },
    [selectedItem, commitImages]
  )

  /** 화면 채우기(cover/contain) — fitToCanvas 순수 함수 결과를 히스토리 커밋 (undo 가능) */
  const handleFitMode = useCallback(
    (mode: FitMode): void => {
      if (!selectedItem) return
      const commit = fitToCanvas(selectedItem, widthPx, heightPx, mode)
      commitImages((prev) =>
        prev.map((img) => (img.id === selectedItem.id ? { ...img, ...commit } : img))
      )
    },
    [selectedItem, widthPx, heightPx, commitImages]
  )

  /** 속성 패널 — 선택 항목 수치 편집 커밋 (cm→px 변환은 패널 담당, 여기선 절대 px만) */
  const handleUpdateSelected = useCallback(
    (patch: Partial<PlacedImage>): void => {
      if (!selectedId) return
      commitImages((prev) =>
        prev.map((img) => (img.id === selectedId ? { ...img, ...patch } : img))
      )
    },
    [selectedId, commitImages]
  )

  /** 속성 패널 90° 회전 버튼 — R 단축키와 동일 규칙 */
  const handleRotate90 = useCallback((): void => {
    if (!selectedId) return
    commitImages((prev) =>
      prev.map((img) =>
        img.id === selectedId ? { ...img, rotation: normalizeRotation(img.rotation + 90) } : img
      )
    )
  }, [selectedId, commitImages])

  /** 속성 패널 레이어 순서 — 배열 순서 = z순서 (뒤 index가 화면 위).
   *  경계 no-op(이미 맨 앞/맨 뒤)는 커밋하지 않아 빈 undo 단계를 만들지 않는다. */
  const handleOrder = useCallback(
    (op: LayerOrderOp): void => {
      if (!selectedId) return
      const next = reorderItem(images, selectedId, op)
      if (next.every((img, i) => img === images[i])) return
      commitImages(() => next)
    },
    [images, selectedId, commitImages]
  )

  /** 경로들을 기준점 중심에 캐스케이드 배치해 씬에 추가 */
  const importPaths = useCallback(
    async (paths: string[], center: DocPoint): Promise<void> => {
      try {
        const placed: PlacedImage[] = []
        for (let i = 0; i < paths.length; i++) {
          const imported = await window.api.importImage(paths[i])
          const topLeft = centeredTopLeft(
            imported.widthPx,
            imported.heightPx,
            center,
            i,
            view.scale
          )
          placed.push({
            id: crypto.randomUUID(),
            filePath: paths[i],
            dataUrl: imported.dataUrl,
            widthPx: imported.widthPx,
            heightPx: imported.heightPx,
            x: topLeft.x,
            y: topLeft.y,
            rotation: 0
          })
        }
        commitImages((prev) => [...prev, ...placed])
      } catch (err) {
        alert(`이미지 가져오기 실패: ${err instanceof Error ? err.message : String(err)}`)
      }
    },
    [view.scale, commitImages]
  )

  /** 파일 대화상자 임포트 — 현재 뷰 중심에 배치 */
  const handleImport = useCallback((): void => {
    void window.api.openImages().then((paths) => {
      if (!paths || paths.length === 0) return
      void importPaths(paths, viewCenterDoc(view, size.w, size.h))
    })
  }, [importPaths, view, size])

  /** 드래그앤드롭 — 드롭 지점(뷰포트 기준 → 문서 좌표)을 기준점으로 배치 */
  const handleDrop = useCallback(
    (e: React.DragEvent): void => {
      e.preventDefault()
      const rect = e.currentTarget.getBoundingClientRect()
      const paths = Array.from(e.dataTransfer.files).flatMap((file) => {
        try {
          const p = window.api.getPathForFile(file)
          return p.length > 0 ? [p] : []
        } catch {
          return []
        }
      })
      if (paths.length === 0) return
      void importPaths(paths, screenToDoc(view, e.clientX - rect.left, e.clientY - rect.top))
    },
    [importPaths, view]
  )

  const zoomPercent = Math.round(view.scale * 100)
  const selectedIndex = selectedId ? images.findIndex((img) => img.id === selectedId) : -1

  return (
    <div
      className="fixed inset-0 flex overflow-hidden bg-zinc-950"
      style={{ cursor: spaceDown ? 'grab' : 'default' }}
    >
      <div
        ref={viewportRef}
        className="relative min-w-0 flex-1"
        onDragOver={(e) => e.preventDefault()}
        onDrop={handleDrop}
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
          onMouseDown={handleStageMouseDown}
        >
          <Layer>
            {/* 가상 문서 — 실규격 350 DPI 좌표계의 흰색 Rect (테두리는 화면 2px 유지) */}
            <Rect
              name={DOC_BACKGROUND}
              x={0}
              y={0}
              width={widthPx}
              height={heightPx}
              fill="#ffffff"
              stroke="#52525b"
              strokeWidth={2 / view.scale}
              perfectDrawEnabled={false}
            />
          </Layer>
          <Layer>
            {images.map((placed) => (
              <SceneImage
                key={placed.id}
                placed={placed}
                draggable={!spaceDown}
                onSelect={handleSelect}
                onMove={handleMove}
                onTransform={handleTransform}
              />
            ))}
            {/* 씬 전체 유일 트랜스포머 — 모서리 4핸들(비율 유지 기본, Shift=자유 비율) + 회전 앵커.
              트랜스포머는 절대(화면) 좌표계로 렌더 — 앵커·스트로크는 줌 배율과 무관하게 화면 px */}
            <Transformer
              ref={transformerRef}
              resizeEnabled
              rotateEnabled
              keepRatio
              shiftBehavior="inverted"
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              boundBoxFunc={boundMinSize}
              borderStroke={SELECTION_STROKE}
              borderStrokeWidth={2}
              anchorStroke={SELECTION_STROKE}
            />
          </Layer>
        </Stage>

        {/* 상태 오버레이: 문서 치수 · 현재 배율 · 툴바 */}
        <div className="absolute right-3 top-3 flex select-none items-center gap-2">
          <div className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[11px] tabular-nums text-zinc-400">
            <span>
              {widthPx.toLocaleString()} × {heightPx.toLocaleString()} px
            </span>
            <span className="font-semibold text-zinc-200">{zoomPercent}%</span>
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900/95 p-1 shadow-2xl backdrop-blur">
            <OverlayButton onClick={handleImport} title="이미지 가져오기">
              <ImagePlus size={14} strokeWidth={1.5} />
              가져오기
            </OverlayButton>
            <div className="mx-0.5 h-5 w-px bg-zinc-800" />
            <OverlayButton
              onClick={() => setGridOpen(true)}
              disabled={!selectedItem}
              title="그리드 복제"
            >
              <Grid3x3 size={14} strokeWidth={1.5} />
              그리드 복제
            </OverlayButton>
            <OverlayButton
              onClick={() => handleFitMode('cover')}
              disabled={!selectedItem}
              title="화면 채우기 (cover)"
            >
              <Expand size={14} strokeWidth={1.5} />
              채우기
            </OverlayButton>
            <OverlayButton
              onClick={() => handleFitMode('contain')}
              disabled={!selectedItem}
              title="안에 맞춤 (contain)"
            >
              <Shrink size={14} strokeWidth={1.5} />
              안에 맞춤
            </OverlayButton>
            <div className="mx-0.5 h-5 w-px bg-zinc-800" />
            <OverlayButton onClick={undo} disabled={!canUndo} title="실행취소 (Ctrl+Z)">
              <Undo2 size={14} strokeWidth={1.5} />
              실행취소
            </OverlayButton>
            <OverlayButton onClick={redo} disabled={!canRedo} title="다시실행 (Ctrl+Shift+Z)">
              <Redo2 size={14} strokeWidth={1.5} />
              다시실행
            </OverlayButton>
            <div className="mx-0.5 h-5 w-px bg-zinc-800" />
            <OverlayButton onClick={handleFit} title="문서 전체 화면 맞춤">
              <Maximize size={14} strokeWidth={1.5} />
              맞춤
            </OverlayButton>
            <div className="mx-0.5 h-5 w-px bg-zinc-800" />
            <OverlayButton
              onClick={() => setExportOpen(true)}
              disabled={images.length === 0}
              title="내보내기 (PSD·PNG)"
              primary
            >
              <FileOutput size={14} strokeWidth={1.5} />
              내보내기
            </OverlayButton>
          </div>
        </div>

        {gridOpen && selectedItem && (
          <GridDialog
            item={selectedItem}
            onConfirm={handleGridConfirm}
            onClose={() => setGridOpen(false)}
          />
        )}

        {exportOpen && (
          <ExportDialog
            items={images}
            widthPx={widthPx}
            heightPx={heightPx}
            onClose={() => setExportOpen(false)}
          />
        )}

        {/* 조작 힌트 */}
        <div className="absolute bottom-3 left-3 select-none rounded-md border border-zinc-800 bg-zinc-900/95 px-3 py-1.5 text-[11px] text-zinc-500 backdrop-blur">
          휠: 줌 · Space + 드래그: 팬 · 클릭: 선택 · 드래그: 이동 · 핸들: 크기(Shift: 자유
          비율)·회전 · Ctrl+D: 복제 · R: 90° 회전 · Del: 삭제 · Ctrl+Z/Y: 실행취소·다시실행 · 이미지
          드롭: 배치
        </div>
      </div>

      <PropertiesPanel
        item={selectedItem}
        itemCount={images.length}
        selectedIndex={selectedIndex >= 0 ? selectedIndex : null}
        onUpdate={handleUpdateSelected}
        onRotate90={handleRotate90}
        onOrder={handleOrder}
        onOpenGrid={() => setGridOpen(true)}
      />
    </div>
  )
}

interface SceneImageProps {
  placed: PlacedImage
  /** Space 팬 모드 중 false — stage 드래그가 우선한다 */
  draggable: boolean
  onSelect: (id: string) => void
  onMove: (id: string, x: number, y: number) => void
  onTransform: (id: string, reading: NodeTransformReading) => void
}

interface OverlayButtonProps {
  onClick: () => void
  disabled?: boolean
  title?: string
  primary?: boolean
  children: React.ReactNode
}

/** 오버레이 버튼 — disabled 시 기존 관례(투명도 0.4·포인터 차단) 적용 */
function OverlayButton({
  onClick,
  disabled = false,
  title,
  primary = false,
  children
}: OverlayButtonProps): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={title}
      className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs transition-colors active:scale-95 disabled:pointer-events-none disabled:opacity-40 ${
        primary
          ? 'border border-indigo-500 bg-indigo-600 font-medium text-white hover:bg-indigo-500'
          : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}

/** 씬 이미지 노드 — 원본 px 크기 그대로 렌더. mousedown으로 즉선택 후 드래그 이동 */
function SceneImage({
  placed,
  draggable,
  onSelect,
  onMove,
  onTransform
}: SceneImageProps): React.JSX.Element | null {
  const el = useHtmlImage(placed.dataUrl)
  if (!el) return null
  return (
    <Image
      id={placed.id}
      x={placed.x}
      y={placed.y}
      rotation={placed.rotation}
      width={placed.widthPx}
      height={placed.heightPx}
      image={el}
      draggable={draggable}
      onMouseDown={() => onSelect(placed.id)}
      onDragEnd={(e) => onMove(placed.id, e.currentTarget.x(), e.currentTarget.y())}
      onTransformEnd={(e) => {
        // 트랜스포머는 리사이즈를 임시 scaleX/scaleY로 적용한다. 판독 직후 노드에 1로 리셋 —
        // react-konva는 prop으로 전달하지 않은 scale을 다음 렌더에서 되돌리지 않는다 (Konva 공식 패턴)
        const node = e.currentTarget
        const scaleX = node.scaleX()
        const scaleY = node.scaleY()
        node.scaleX(1)
        node.scaleY(1)
        onTransform(placed.id, {
          x: node.x(),
          y: node.y(),
          rotation: node.rotation(),
          width: node.width(),
          height: node.height(),
          scaleX,
          scaleY
        })
      }}
      perfectDrawEnabled={false}
    />
  )
}
