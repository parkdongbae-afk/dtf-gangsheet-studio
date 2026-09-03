import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type Konva from 'konva'
import type { Box } from 'konva/lib/shapes/Transformer'
import { Image, Layer, Rect, Shape, Stage, Transformer } from 'react-konva'
import {
  Boxes,
  Expand,
  FileOutput,
  Grid2x2,
  Grid3x3,
  ImagePlus,
  LayoutGrid,
  Maximize,
  Redo2,
  Shrink,
  Undo2
} from 'lucide-react'
import { ExportDialog } from './ExportDialog'
import { GridDialog } from './GridDialog'
import { GridSettingsDialog } from './GridSettingsDialog'
import { NestingDialog } from './NestingDialog'
import { RulerOverlay } from './RulerOverlay'
import { BgSitesDialog } from '../BgSitesDialog'
import { packImages } from './autoNesting'
import { alignItems, marqueeSelection, type AlignOp } from './alignment'
import {
  DEFAULT_GRID_SETTINGS,
  gridDash,
  gridLinePositions,
  type GridSettings
} from './gridOverlay'
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
/** 마키 시작을 클릭으로 판정하는 화면 px 임계 — 미만 이동은 선택 해제로만 처리 */
const MARQUEE_CLICK_PX = 3

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
  /** 다중 선택 (.agent/tech.md §3) — 배열 순서 = 선택 순서, 씬 배열 순과 무관 */
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /** 드래그 영역 선택(마키) 진행 상태 — null이면 비활성. 좌표는 문서(절대 px) */
  const [marquee, setMarquee] = useState<{
    start: DocPoint
    current: DocPoint
    /** Ctrl 드래그 시작 시점의 기존 선택 — 마키 히트를 합산한다 */
    baseIds: string[]
    additive: boolean
  } | null>(null)
  const [gridOpen, setGridOpen] = useState(false)
  const [gridSettingsOpen, setGridSettingsOpen] = useState(false)
  const [bgSitesOpen, setBgSitesOpen] = useState(false)
  const [exportOpen, setExportOpen] = useState(false)
  const [nestingOpen, setNestingOpen] = useState(false)
  /** 그리드 표시 설정 — 보기 옵션이라 히스토리(undo) 대상 아님 */
  const [gridSettings, setGridSettings] = useState<GridSettings>(DEFAULT_GRID_SETTINGS)
  /** 문서 배경 체커보드 표시 — 흰색 배경 이미지의 경계 식별용 보기 옵션(표시 전용) */
  const [checkerBg, setCheckerBg] = useState(false)
  /** 휠 클릭(중앙 버튼) 드래그 팬 진행 중 — 커서 표시용 */
  const [panning, setPanning] = useState(false)
  /** 배경 제거 진행 중 — 사이드카 추론(첫 요청은 모델 다운로드 포함) 동안 버튼 잠금 */
  const [removeBusy, setRemoveBusy] = useState(false)

  /** 체커보드 패턴 타일(16px) — 흰색 배경 이미지의 경계 식별용 */
  const checkerPattern = useMemo(() => {
    const tile = document.createElement('canvas')
    tile.width = 16
    tile.height = 16
    const ctx = tile.getContext('2d')
    if (!ctx) return null
    ctx.fillStyle = '#ffffff'
    ctx.fillRect(0, 0, 16, 16)
    ctx.fillStyle = '#d4d4d8'
    ctx.fillRect(0, 0, 8, 8)
    ctx.fillRect(8, 8, 8, 8)
    return tile
  }, [])

  /**
   * 단일 선택 항목 — 정확히 1개 선택 시에만 존재(수치 편집·그리드 복제·화면 채우기 기준).
   * 다중 선택에서는 null — 편집은 정렬 패널로 대체된다.
   */
  const selectedItem =
    selectedIds.length === 1 ? (images.find((img) => img.id === selectedIds[0]) ?? null) : null

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
    setSelectedIds((sel) =>
      sel.length > 0 ? sel.filter((id) => prev.some((img) => img.id === id)) : sel
    )
  }, [past, images])

  /** 다시실행 — future 선두 스냅샷 재적용, 현재 상태는 past로 이동 (선택 가드는 undo와 동일) */
  const redo = useCallback((): void => {
    if (future.length === 0) return
    const next = future[0]
    setHistory((h) => ({
      past: [...h.past, images].slice(0, UNDO_LIMIT),
      future: h.future.slice(1)
    }))
    setImages(next)
    setSelectedIds((sel) =>
      sel.length > 0 ? sel.filter((id) => next.some((img) => img.id === id)) : sel
    )
  }, [future, images])

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
      if (
        gridOpen ||
        gridSettingsOpen ||
        bgSitesOpen ||
        exportOpen ||
        nestingOpen ||
        isEditableTarget(e.target)
      )
        return
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
  }, [gridOpen, gridSettingsOpen, bgSitesOpen, exportOpen, nestingOpen])

  /**
   * 씬 편집 단축키 (통합) — Ctrl+Z=실행취소, Ctrl+Shift+Z/Ctrl+Y=다시실행(선택 불필요),
   * Del/Backspace=삭제, R=90° 회전, Ctrl/Cmd+D=복제(화면 24px 오프셋 — 캐스케이드 규칙).
   * 대화상자 모달 중·텍스트 입력 포커스 중에는 전면 무시한다.
   */
  useEffect(() => {
    if (gridOpen || gridSettingsOpen || bgSitesOpen || exportOpen || nestingOpen) return
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
      if (selectedIds.length === 0) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault()
        commitImages((prev) => prev.filter((img) => !selectedIds.includes(img.id)))
        setSelectedIds([])
        return
      }
      if ((e.key === 'r' || e.key === 'R') && !e.repeat) {
        e.preventDefault()
        commitImages((prev) =>
          prev.map((img) =>
            selectedIds.includes(img.id)
              ? { ...img, rotation: normalizeRotation(img.rotation + 90) }
              : img
          )
        )
        return
      }
      if (mod && (e.key === 'd' || e.key === 'D')) {
        e.preventDefault() // 브라우저 기본 동작(북마크) 차단 — Electron에서도 명시 차단
        if (e.repeat) return
        const selected = images.filter((img) => selectedIds.includes(img.id))
        if (selected.length === 0) return
        const offset = duplicateOffset(view.scale)
        // 블록 복제 — 다중 선택 전체를 동일 오프셋으로 복사하고 사본들을 새로 선택한다
        const copies = selected.map((source) => ({
          ...source,
          id: crypto.randomUUID(),
          x: source.x + offset,
          y: source.y + offset
        }))
        commitImages((prev) => [...prev, ...copies])
        setSelectedIds(copies.map((copy) => copy.id))
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [
    selectedIds,
    images,
    view.scale,
    gridOpen,
    gridSettingsOpen,
    bgSitesOpen,
    exportOpen,
    nestingOpen,
    commitImages,
    undo,
    redo
  ])

  /**
   * 단일 공유 트랜스포머에 선택 노드들 바인딩 — 1개면 리사이즈·회전 핸들, 2개 이상이면
   * 합집합 보더만(resizeEnabled/rotateEnabled=false) 렌더한다. 다중 이동은 노드
   * 드래그 동기화(handleNodeDragMove)가 담당한다.
   */
  useEffect(() => {
    const transformer = transformerRef.current
    const stage = stageRef.current
    if (!transformer || !stage) return
    const nodes = selectedIds
      .map((id) => stage.findOne(`#${id}`))
      .filter((node): node is Konva.Node => node !== undefined)
    transformer.nodes(nodes)
    transformer.getLayer()?.batchDraw()
  }, [selectedIds, images])

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

  /** 팬 진행 중 뷰 동기화 — 자(ruler) 오버레이가 스테이지 드래그를 실시간 추적 */
  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>): void => {
    interactedRef.current = true
    setView((prev) => ({ ...prev, x: e.currentTarget.x(), y: e.currentTarget.y() }))
  }

  /** 팬 종료 — Konva 내장 드래그가 이동시킨 stage.position을 상태로 동기화 */
  const handleDragEnd = (e: Konva.KonvaEventObject<DragEvent>): void => {
    interactedRef.current = true
    setView((prev) => ({ ...prev, x: e.currentTarget.x(), y: e.currentTarget.y() }))
  }

  /** 휠 클릭 팬 진행 정보 — mousedown 시점 화면 좌표와 뷰 오프셋 스냅샷 */
  const wheelPanRef = useRef<{ sx: number; sy: number; vx: number; vy: number } | null>(null)

  /**
   * Stage mousedown — 휠 클릭(중앙 버튼)은 어디에서나 팬 시작(Chromium 오토스크롤
   * 차단), 좌클릭 빈 곳은 마키(드래그 영역 선택) 시작. Ctrl 없이 시작하면 즉시 전체
   * 선택 해제(TC-6), Ctrl 드래그는 기존 선택에 합산. Space 팬 모드 중에는
   * 내비게이션이 우선한다.
   */
  const handleStageMouseDown = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    if (e.evt.button === 1) {
      e.evt.preventDefault()
      const pointer = stageRef.current?.getPointerPosition()
      if (pointer) {
        wheelPanRef.current = { sx: pointer.x, sy: pointer.y, vx: view.x, vy: view.y }
        setPanning(true)
      }
      return
    }
    if (e.evt.button !== 0 || spaceDown) return
    const onEmpty = e.target === e.target.getStage() || e.target.name() === DOC_BACKGROUND
    if (!onEmpty) return
    const stage = stageRef.current
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    const additive = e.evt.ctrlKey || e.evt.metaKey
    const baseIds = additive ? selectedIds : []
    if (!additive) setSelectedIds([])
    const doc = screenToDoc(view, pointer.x, pointer.y)
    setMarquee({ start: doc, current: doc, baseIds, additive })
  }

  /** Stage mousemove — 휠 클릭 팬 우선 처리, 아니면 마키 진행(1px 교차 실시간 히트) */
  const handleStageMouseMove = (e: Konva.KonvaEventObject<MouseEvent>): void => {
    const pan = wheelPanRef.current
    const stage = e.target.getStage()
    const pointer = stage?.getPointerPosition()
    if (!pointer) return
    if (pan) {
      interactedRef.current = true
      setView((prev) => ({
        ...prev,
        x: pan.vx + (pointer.x - pan.sx),
        y: pan.vy + (pointer.y - pan.sy)
      }))
      return
    }
    if (!marquee) return
    const doc = screenToDoc(view, pointer.x, pointer.y)
    setMarquee((prev) => (prev ? { ...prev, current: doc } : prev))
    const hits = marqueeSelection(images, marquee.start, doc)
    setSelectedIds(marquee.additive ? Array.from(new Set([...marquee.baseIds, ...hits])) : hits)
  }

  /** 휠 클릭 팬 종료 — 릴리즈는 스테이지 밖에서도 놓치지 않도록 window에서 포착 */
  useEffect(() => {
    if (!panning) return
    const onMouseUp = (): void => {
      wheelPanRef.current = null
      setPanning(false)
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [panning])

  /**
   * 마키 종료 — 마우스 릴리즈는 스테이지 밖에서도 놓치지 않도록 window에서 포착.
   * 이동이 임계 미만이면 클릭으로 판정해 부가(Ctrl) 모드의 시작 시점 선택을 복원한다
   * (일반 모드는 mousedown에서 이미 해제 완료).
   */
  useEffect(() => {
    if (!marquee) return
    const onMouseUp = (): void => {
      const moved =
        Math.hypot(marquee.current.x - marquee.start.x, marquee.current.y - marquee.start.y) *
          view.scale >=
        MARQUEE_CLICK_PX
      if (!moved && marquee.additive) setSelectedIds(marquee.baseIds)
      setMarquee(null)
    }
    window.addEventListener('mouseup', onMouseUp)
    return () => window.removeEventListener('mouseup', onMouseUp)
  }, [marquee, view.scale])

  /**
   * 이미지 클릭 선택 (TECH §4.2) — Ctrl/Cmd=토글(기존 선택 유지·개별 해제 TC-2/3),
   * 일반 클릭=단일 선택. 다중 선택 구성원 재클릭은 선택을 유지한다(그룹 이동 대비).
   * Space 팬 모드 중에는 무시 (내비게이션 우선).
   */
  const handleSelect = useCallback(
    (id: string, additive: boolean): void => {
      if (spaceDown) return
      setSelectedIds((prev) => {
        if (additive) {
          return prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
        }
        return prev.includes(id) ? prev : [id]
      })
    },
    [spaceDown]
  )

  /** 그룹 드래그 기준 스냅샷 — 다중 선택 구성원 드래그 시작 시각의 절대 px 위치들 */
  const groupDragRef = useRef<Map<string, { x: number; y: number }> | null>(null)

  /** 노드 드래그 시작 — 다중 선택이면 그룹 이동 기준점 확보 */
  const handleNodeDragStart = useCallback(
    (id: string): void => {
      groupDragRef.current =
        selectedIds.length > 1 && selectedIds.includes(id)
          ? new Map(
              images
                .filter((img) => selectedIds.includes(img.id))
                .map((img) => [img.id, { x: img.x, y: img.y }])
            )
          : null
    },
    [selectedIds, images]
  )

  /** 노드 드래그 진행 — 움직인 노드의 델타를 다른 선택 노드에 즉시 반영(단일 커밋 대비) */
  const handleNodeDragMove = useCallback((id: string, node: Konva.Node): void => {
    const base = groupDragRef.current
    const start = base?.get(id)
    if (!base || !start) return
    const dx = node.x() - start.x
    const dy = node.y() - start.y
    for (const [otherId, pos] of base) {
      if (otherId === id) continue
      stageRef.current?.findOne(`#${otherId}`)?.position({ x: pos.x + dx, y: pos.y + dy })
    }
  }, [])

  /**
   * 노드 드래그 종료 — 그룹이면 전체 새 위치를 한 번에 히스토리 커밋(undo 1단계),
   * 단일이면 해당 항목만 커밋한다.
   */
  const handleNodeDragEnd = useCallback(
    (id: string, x: number, y: number): void => {
      const base = groupDragRef.current
      groupDragRef.current = null
      if (!base) {
        commitImages((prev) => prev.map((img) => (img.id === id ? { ...img, x, y } : img)))
        return
      }
      const start = base.get(id)
      if (!start) return
      const moves = new Map(base)
      const dx = x - start.x
      const dy = y - start.y
      for (const [otherId, pos] of base) {
        if (otherId !== id) moves.set(otherId, { x: pos.x + dx, y: pos.y + dy })
      }
      moves.set(id, { x, y })
      commitImages((prev) =>
        prev.map((img) => {
          const moved = moves.get(img.id)
          return moved ? { ...img, ...moved } : img
        })
      )
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

  /** 자동 배치 확정 (BATCH.md) — MaxRects 패킹 결과를 히스토리 커밋해 Ctrl+Z 복구 지원.
   *  미배치(캔버스 초과) 항목은 현재 위치를 그대로 둔다. */
  const handleNestingConfirm = useCallback(
    (gapCm: number, allowRotation: boolean): void => {
      const result = packImages(images, {
        canvasWidthPx: widthPx,
        canvasHeightPx: heightPx,
        gapCm,
        dpi: 350,
        allowRotation
      })
      setNestingOpen(false)
      if (result.packedItems.length === 0) return
      const placementById = new Map(result.packedItems.map((p) => [p.id, p]))
      commitImages((prev) =>
        prev.map((img) => {
          const p = placementById.get(img.id)
          return p ? { ...img, x: p.x, y: p.y, rotation: p.rotation } : img
        })
      )
    },
    [images, widthPx, heightPx, commitImages]
  )

  /** 속성 패널 — 선택 항목 수치 편집 커밋 (cm→px 변환은 패널 담당, 여기선 절대 px만) */
  const handleUpdateSelected = useCallback(
    (patch: Partial<PlacedImage>): void => {
      if (!selectedItem) return
      commitImages((prev) =>
        prev.map((img) => (img.id === selectedItem.id ? { ...img, ...patch } : img))
      )
    },
    [selectedItem, commitImages]
  )

  /** 속성 패널 90° 회전 버튼 — R 단축키와 동일 규칙 */
  const handleRotate90 = useCallback((): void => {
    if (!selectedItem) return
    commitImages((prev) =>
      prev.map((img) =>
        img.id === selectedItem.id
          ? { ...img, rotation: normalizeRotation(img.rotation + 90) }
          : img
      )
    )
  }, [selectedItem, commitImages])

  /** 속성 패널 레이어 순서 — 배열 순서 = z순서 (뒤 index가 화면 위).
   *  경계 no-op(이미 맨 앞/맨 뒤)는 커밋하지 않아 빈 undo 단계를 만들지 않는다. */
  const handleOrder = useCallback(
    (op: LayerOrderOp): void => {
      if (!selectedItem) return
      const next = reorderItem(images, selectedItem.id, op)
      if (next.every((img, i) => img === images[i])) return
      commitImages(() => next)
    },
    [images, selectedItem, commitImages]
  )

  /**
   * 다중 선택 정렬·균등 분배 (TECH §4.3) — 순수 함수 결과를 한 번의 히스토리 커밋으로
   * 적용해 undo 1단계를 보장한다. 조건 미달(정렬 2·분배 3 미만)은 no-op.
   */
  const handleAlign = useCallback(
    (op: AlignOp): void => {
      const moves = alignItems(
        images.filter((img) => selectedIds.includes(img.id)),
        op
      )
      if (!moves) return
      const movesById = new Map(moves.map((move) => [move.id, move]))
      commitImages((prev) =>
        prev.map((img) => {
          const move = movesById.get(img.id)
          return move ? { ...img, x: move.x, y: move.y } : img
        })
      )
    },
    [images, selectedIds, commitImages]
  )

  /**
   * 배경 제거(v2) — 선택 항목 전체(단일·다중)를 순차 처리해 RGBA PNG로 에셋 치환.
   * 시작 시점의 id·경로를 캡처해 처리 중 선택이 바뀌어도 올바른 항목을 갱신하고,
   * 성공분은 한 번의 히스토리 커밋으로 반영해 배치 전체가 undo 1단계로 되돌려진다.
   * 치환 정책상 내보내기 파이프라인은 무수정 재사용된다(알파→백색 잉크 마스크).
   */
  const handleRemoveBg = useCallback((): void => {
    const targets = images
      .filter((img) => selectedIds.includes(img.id))
      .map((img) => ({ id: img.id, filePath: img.filePath }))
    if (targets.length === 0 || removeBusy) return
    setRemoveBusy(true)
    void (async (): Promise<void> => {
      const done: Array<{ id: string; filePath: string; dataUrl: string }> = []
      const failures: string[] = []
      for (const target of targets) {
        try {
          const result = await window.api.removeBackground(target.filePath)
          done.push({ id: target.id, filePath: result.filePath, dataUrl: result.dataUrl })
        } catch (err) {
          failures.push(err instanceof Error ? err.message : String(err))
        }
      }
      if (done.length > 0) {
        const doneById = new Map(done.map((entry) => [entry.id, entry]))
        commitImages((prev) =>
          prev.map((img) => {
            const entry = doneById.get(img.id)
            return entry ? { ...img, filePath: entry.filePath, dataUrl: entry.dataUrl } : img
          })
        )
      }
      setRemoveBusy(false)
      if (failures.length > 0) {
        alert(`배경 제거 실패 ${failures.length}/${targets.length}건:\n${failures.join('\n')}`)
      }
    })()
  }, [images, selectedIds, removeBusy, commitImages])

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

  /**
   * E2E 자동검증 훅 (DTF_SMOKE_TEST 패턴 계승) — dtf:import-paths 커스텀 이벤트로
   * 파일 대화상자(자동화 불가) 없이 씬에 이미지를 주입한다. 렌더러 내부 경로라
   * 일반 사용 중에는 발생하지 않는다.
   */
  useEffect(() => {
    const onImportPaths = (e: Event): void => {
      const paths = (e as CustomEvent<string[]>).detail
      if (Array.isArray(paths) && paths.length > 0) {
        void importPaths(paths, viewCenterDoc(view, size.w, size.h))
      }
    }
    window.addEventListener('dtf:import-paths', onImportPaths)
    return () => window.removeEventListener('dtf:import-paths', onImportPaths)
  }, [importPaths, view, size])

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
  const selectedIndex =
    selectedIds.length === 1 ? images.findIndex((img) => img.id === selectedIds[0]) : -1
  const isSingleSelection = selectedIds.length === 1
  const selectionStrokeWidth = 2 / view.scale
  const gridV = useMemo(
    () => gridLinePositions(widthPx, gridSettings.intervalCm),
    [widthPx, gridSettings.intervalCm]
  )
  const gridH = useMemo(
    () => gridLinePositions(heightPx, gridSettings.intervalCm),
    [heightPx, gridSettings.intervalCm]
  )

  return (
    <div
      className="fixed inset-0 flex overflow-hidden bg-zinc-950"
      style={{ cursor: panning ? 'grabbing' : spaceDown ? 'grab' : 'default' }}
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
          onDragMove={handleDragMove}
          onDragEnd={handleDragEnd}
          onMouseDown={handleStageMouseDown}
          onMouseMove={handleStageMouseMove}
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
          {checkerBg && checkerPattern && (
            <Layer listening={false}>
              {/* 체커보드 배경 — 투명 영역 표시 관례. 표시 전용 보기 옵션이라 내보내기와
                  무관하며, 스테이지 배율 역보정으로 화면 기준 셀 크기를 일정하게 유지 */}
              <Shape
                sceneFunc={(ctx) => {
                  const pattern = ctx.createPattern(checkerPattern, 'repeat')
                  if (!pattern) return
                  ctx.save()
                  ctx.scale(1 / view.scale, 1 / view.scale)
                  ctx.fillStyle = pattern
                  ctx.fillRect(0, 0, widthPx * view.scale, heightPx * view.scale)
                  ctx.restore()
                }}
                perfectDrawEnabled={false}
              />
            </Layer>
          )}
          {gridSettings.visible && (
            <Layer listening={false}>
              {/* 격자 오버레이 — 단일 Shape에 전체 경로를 한 번에 그린다(노드 수 폭주 방지).
                  대시·스트로크는 1/scale 보정으로 줌과 무관한 화면 1px 두께 유지 */}
              <Shape
                sceneFunc={(ctx, shape) => {
                  ctx.beginPath()
                  for (const x of gridV) {
                    ctx.moveTo(x, 0)
                    ctx.lineTo(x, heightPx)
                  }
                  for (const y of gridH) {
                    ctx.moveTo(0, y)
                    ctx.lineTo(widthPx, y)
                  }
                  ctx.strokeShape(shape)
                }}
                stroke={gridSettings.color}
                strokeWidth={1 / view.scale}
                dash={gridDash(gridSettings.lineStyle, view.scale)}
                lineCap={gridSettings.lineStyle === 'dotted' ? 'round' : 'butt'}
                perfectDrawEnabled={false}
              />
            </Layer>
          )}
          <Layer>
            {images.map((placed) => (
              <SceneImage
                key={placed.id}
                placed={placed}
                draggable={!spaceDown}
                selected={selectedIds.includes(placed.id)}
                selectionStrokeWidth={selectionStrokeWidth}
                onSelect={handleSelect}
                onDragStart={handleNodeDragStart}
                onDragMove={handleNodeDragMove}
                onDragEnd={handleNodeDragEnd}
                onTransform={handleTransform}
              />
            ))}
            {/* 씬 전체 유일 트랜스포머 — 1개 선택: 모서리 4핸들(비율 유지 기본, Shift=자유
              비율) + 회전 앵커 · 2개 이상: 합집합 보더만(이동은 노드 드래그 동기화).
              트랜스포머는 절대(화면) 좌표계로 렌더 — 앵커·스트로크는 줌 배율과 무관하게 화면 px */}
            <Transformer
              ref={transformerRef}
              resizeEnabled={isSingleSelection}
              rotateEnabled={isSingleSelection}
              keepRatio
              shiftBehavior="inverted"
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              boundBoxFunc={boundMinSize}
              borderStroke={SELECTION_STROKE}
              borderStrokeWidth={2}
              anchorStroke={SELECTION_STROKE}
            />
          </Layer>
          {marquee && (
            <Layer listening={false}>
              {/* 마키 선택 박스 — 반투명 채움 + 대시 보더 (TECH §2.1 실시간 피드백) */}
              <Rect
                x={Math.min(marquee.start.x, marquee.current.x)}
                y={Math.min(marquee.start.y, marquee.current.y)}
                width={Math.abs(marquee.current.x - marquee.start.x)}
                height={Math.abs(marquee.current.y - marquee.start.y)}
                fill="rgba(99,102,241,0.08)"
                stroke={SELECTION_STROKE}
                strokeWidth={1 / view.scale}
                dash={[4 / view.scale, 4 / view.scale]}
                perfectDrawEnabled={false}
              />
            </Layer>
          )}
        </Stage>

        {/* 문서 바깥 자 — 상단(가로 cm)·좌측(세로 cm), 문서 범위 하이라이트 포함 */}
        <RulerOverlay
          view={view}
          viewportW={size.w}
          viewportH={size.h}
          docW={widthPx}
          docH={heightPx}
        />

        {/* 상태 오버레이: 문서 치수 · 현재 배율 · 툴바 — 상단 자(22px) 아래에 위치 */}
        <div className="absolute right-3 top-8 flex select-none items-center gap-2">
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
              title="이미지 복제"
            >
              <Grid3x3 size={14} strokeWidth={1.5} />
              이미지 복제
            </OverlayButton>
            <OverlayButton
              onClick={() => setGridSettingsOpen(true)}
              active={gridSettings.visible}
              title="그리드 표시 설정 (간격·색·선 스타일)"
            >
              <Grid2x2 size={14} strokeWidth={1.5} />
              그리드
            </OverlayButton>
            <OverlayButton
              onClick={() => setCheckerBg((v) => !v)}
              active={checkerBg}
              title="문서 배경 체커보드 토글 — 흰색 배경 이미지 경계 식별 (표시 전용)"
            >
              <LayoutGrid size={14} strokeWidth={1.5} />
              배경
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
            <OverlayButton
              onClick={() => setNestingOpen(true)}
              disabled={images.length === 0}
              title="자동 배치 (MaxRects 밀집 패킹)"
            >
              <Boxes size={14} strokeWidth={1.5} />
              자동 배치
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
            widthPx={widthPx}
            onConfirm={handleGridConfirm}
            onClose={() => setGridOpen(false)}
          />
        )}

        {gridSettingsOpen && (
          <GridSettingsDialog
            settings={gridSettings}
            onChange={setGridSettings}
            onClose={() => setGridSettingsOpen(false)}
          />
        )}

        {bgSitesOpen && <BgSitesDialog onClose={() => setBgSitesOpen(false)} />}

        {nestingOpen && images.length > 0 && (
          <NestingDialog
            items={images}
            widthPx={widthPx}
            heightPx={heightPx}
            onConfirm={handleNestingConfirm}
            onClose={() => setNestingOpen(false)}
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
          휠: 줌 · Space/휠 클릭 + 드래그: 팬 · 클릭: 선택 · 드래그: 이동 · 빈 곳 드래그: 영역 선택
          · Ctrl+클릭: 선택 추가/해제 · 핸들: 크기(Shift: 자유 비율)·회전 · Ctrl+D: 복제 · R: 90°
          회전 · Del: 삭제 · Ctrl+Z/Y: 실행취소·다시실행 · 이미지 드롭: 배치
        </div>
      </div>

      <PropertiesPanel
        item={selectedItem}
        itemCount={images.length}
        selectedIndex={selectedIndex >= 0 ? selectedIndex : null}
        multiSelectedCount={selectedIds.length}
        onAlign={handleAlign}
        onUpdate={handleUpdateSelected}
        onRotate90={handleRotate90}
        onOrder={handleOrder}
        onOpenGrid={() => setGridOpen(true)}
        onRemoveBg={handleRemoveBg}
        removeBusy={removeBusy}
        onOpenBgSites={() => setBgSitesOpen(true)}
      />
    </div>
  )
}

interface SceneImageProps {
  placed: PlacedImage
  /** Space 팬 모드 중 false — stage 드래그가 우선한다 */
  draggable: boolean
  /** 다중 선택 구성원 여부 — 선택 테두리(스트로크) 렌더 */
  selected: boolean
  /** 선택 스트로크 두께(절대 px) — 줌 배율 역보정값(화면 2px 고정)을 호출자가 계산해 전달 */
  selectionStrokeWidth: number
  onSelect: (id: string, additive: boolean) => void
  onDragStart: (id: string) => void
  onDragMove: (id: string, node: Konva.Node) => void
  onDragEnd: (id: string, x: number, y: number) => void
  onTransform: (id: string, reading: NodeTransformReading) => void
}

interface OverlayButtonProps {
  onClick: () => void
  disabled?: boolean
  title?: string
  primary?: boolean
  /** 활성 상태 강조 (토글성 버튼 — 그리드 표시 등) */
  active?: boolean
  children: React.ReactNode
}

/** 오버레이 버튼 — disabled 시 기존 관례(투명도 0.4·포인터 차단) 적용 */
function OverlayButton({
  onClick,
  disabled = false,
  title,
  primary = false,
  active = false,
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
          : active
            ? 'border border-indigo-500 bg-indigo-500/15 font-medium text-indigo-300 hover:bg-indigo-500/25'
            : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
      }`}
    >
      {children}
    </button>
  )
}

/** 씬 이미지 노드 — 원본 px 크기 그대로 렌더. mousedown으로 즉선택(Ctrl=토글) 후 드래그 이동 */
function SceneImage({
  placed,
  draggable,
  selected,
  selectionStrokeWidth,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
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
      stroke={selected ? SELECTION_STROKE : undefined}
      strokeWidth={selected ? selectionStrokeWidth : undefined}
      strokeHitEnabled={false}
      onMouseDown={(e) => onSelect(placed.id, e.evt.ctrlKey || e.evt.metaKey)}
      onDragStart={() => onDragStart(placed.id)}
      onDragMove={(e) => onDragMove(placed.id, e.currentTarget)}
      onDragEnd={(e) => onDragEnd(placed.id, e.currentTarget.x(), e.currentTarget.y())}
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
