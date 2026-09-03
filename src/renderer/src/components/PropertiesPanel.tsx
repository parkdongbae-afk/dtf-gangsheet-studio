import { useState } from 'react'
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalJustifyCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalJustifyCenter,
  ArrowDownToLine,
  ArrowUpToLine,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Copy,
  Eraser,
  ExternalLink,
  Globe,
  Grid3x3,
  Layers,
  Link2,
  Link2Off,
  Loader2,
  MousePointerClick,
  Move,
  RotateCw
} from 'lucide-react'
import { cmToPx, pxToCm } from '../../../core/math'
import { normalizeRotation, type LayerOrderOp } from './canvas/placement'
import type { AlignOp } from './canvas/alignment'
import type { PlacedImage } from './canvas/ProxyCanvas'

const ICON = { size: 15, strokeWidth: 1.5 } as const

export interface PropertiesPanelProps {
  item: PlacedImage | null
  itemCount: number
  selectedIndex: number | null
  /** 다중 선택 개수 — 2 이상이면 정렬 패널이 편집 패널을 대체한다 */
  multiSelectedCount: number
  onAlign: (op: AlignOp) => void
  onUpdate: (patch: Partial<PlacedImage>) => void
  onRotate90: () => void
  onOrder: (op: LayerOrderOp) => void
  onOpenGrid: () => void
  onRemoveBg: () => void
  removeBusy: boolean
  /** 배경 제거 사이트 다이얼로그 열기 */
  onOpenBgSites: () => void
}

function Section({
  title,
  icon,
  children,
  defaultOpen = true
}: {
  title: string
  icon: React.ReactNode
  children: React.ReactNode
  defaultOpen?: boolean
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="border-b border-zinc-800">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-3 py-2.5 text-zinc-200 transition-colors hover:bg-zinc-800"
      >
        <span className="flex items-center gap-2">
          <span className="text-zinc-400">{icon}</span>
          <span className="text-xs font-medium uppercase tracking-wide">{title}</span>
        </span>
        <ChevronDown
          size={14}
          strokeWidth={1.5}
          className={`text-zinc-500 transition-transform duration-150 ${open ? 'rotate-180' : ''}`}
        />
      </button>
      {open && <div className="px-3 pb-4 pt-1">{children}</div>}
    </div>
  )
}

/**
 * 수치 입력 필드 — 포커스 중 로컬 드래프트 편집, blur/Enter 시에만 커밋.
 * display는 확정 상태에서의 표시 문자열(포맷팅은 호출자 담당).
 */
function NumField({
  label,
  unit,
  display,
  onCommit
}: {
  label: string
  unit: string
  display: string
  onCommit: (valueCm: number) => void
}): React.JSX.Element {
  const [draft, setDraft] = useState<string | null>(null)
  const editing = draft !== null

  const commit = (): void => {
    if (draft === null) return
    const parsed = Number.parseFloat(draft)
    setDraft(null)
    if (Number.isFinite(parsed)) onCommit(parsed)
  }

  return (
    <div className="flex flex-col gap-1">
      <label className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </label>
      <div
        className={`flex items-center rounded-md border bg-zinc-950 transition-all focus-within:ring-1 focus-within:ring-indigo-500 ${
          editing ? 'border-indigo-500' : 'border-zinc-800'
        }`}
      >
        <input
          type="text"
          inputMode="decimal"
          value={editing ? draft : display}
          onChange={(e) => setDraft(e.target.value)}
          onFocus={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') {
              setDraft(null)
              e.currentTarget.blur()
            }
          }}
          className="w-full bg-transparent px-2 py-1.5 text-sm tabular-nums text-zinc-200 outline-none"
        />
        <span className="px-2 text-[10px] font-medium text-zinc-500">{unit}</span>
      </div>
    </div>
  )
}

function IconBtn({
  label,
  onClick,
  disabled = false,
  children
}: {
  label: string
  onClick?: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="flex h-8 flex-1 items-center justify-center rounded-md border border-zinc-800 bg-zinc-900 text-zinc-300 transition-colors hover:bg-zinc-800 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
    >
      {children}
    </button>
  )
}

const fileBaseName = (filePath: string): string => filePath.split(/[\\/]/).pop() ?? filePath

const formatCm = (px: number): string => pxToCm(px).toFixed(1)

export function PropertiesPanel({
  item,
  itemCount,
  selectedIndex,
  multiSelectedCount,
  onAlign,
  onUpdate,
  onRotate90,
  onOrder,
  onOpenGrid,
  onRemoveBg,
  removeBusy,
  onOpenBgSites
}: PropertiesPanelProps): React.JSX.Element {
  const [linked, setLinked] = useState(true)
  const multi = !item && multiSelectedCount >= 2
  const canDistribute = multiSelectedCount >= 3

  const commitWidth = (valueCm: number): void => {
    if (!item || valueCm <= 0) return
    const widthPx = cmToPx(valueCm)
    onUpdate(linked ? { widthPx, heightPx: (item.heightPx * widthPx) / item.widthPx } : { widthPx })
  }

  const commitHeight = (valueCm: number): void => {
    if (!item || valueCm <= 0) return
    const heightPx = cmToPx(valueCm)
    onUpdate(
      linked ? { heightPx, widthPx: (item.widthPx * heightPx) / item.heightPx } : { heightPx }
    )
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-l border-zinc-800 bg-zinc-950">
      <div className="flex items-center justify-between border-b border-zinc-800 px-3 py-3">
        <div className="flex flex-col">
          <span className="text-sm font-semibold text-zinc-100">속성</span>
          <span className="max-w-[180px] truncate text-[10px] text-zinc-500">
            {multi
              ? `${multiSelectedCount}개 다중 선택`
              : item
                ? fileBaseName(item.filePath)
                : '선택 없음'}
          </span>
        </div>
        <span className="rounded border border-zinc-800 bg-zinc-900 px-1.5 py-0.5 text-[10px] tabular-nums text-zinc-500">
          {itemCount}개
        </span>
      </div>

      {multi ? (
        <div className="flex-1 overflow-y-auto">
          <Section
            title="정렬"
            icon={<AlignCenterVertical size={ICON.size} strokeWidth={ICON.strokeWidth} />}
          >
            <div className="grid grid-cols-3 gap-1.5">
              <IconBtn label="좌측 정렬" onClick={() => onAlign('left')}>
                <AlignStartVertical size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn label="가로 중앙 정렬" onClick={() => onAlign('centerH')}>
                <AlignCenterVertical size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn label="우측 정렬" onClick={() => onAlign('right')}>
                <AlignEndVertical size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn label="상단 정렬" onClick={() => onAlign('top')}>
                <AlignStartHorizontal size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn label="세로 중앙 정렬" onClick={() => onAlign('centerV')}>
                <AlignCenterHorizontal size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn label="하단 정렬" onClick={() => onAlign('bottom')}>
                <AlignEndHorizontal size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
            </div>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5">
              <IconBtn
                label="수평 간격 균등 분배 (3개 이상)"
                onClick={() => onAlign('distH')}
                disabled={!canDistribute}
              >
                <AlignHorizontalJustifyCenter size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn
                label="수직 간격 균등 분배 (3개 이상)"
                onClick={() => onAlign('distV')}
                disabled={!canDistribute}
              >
                <AlignVerticalJustifyCenter size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
            </div>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              {multiSelectedCount}개 항목을 회전된 표시 영역 기준으로 정렬합니다. 모든 정렬은
              Ctrl+Z로 되돌릴 수 있습니다.
            </p>
          </Section>
          <Section
            title="배경 제거"
            icon={<Eraser size={ICON.size} strokeWidth={ICON.strokeWidth} />}
          >
            <button
              type="button"
              onClick={onRemoveBg}
              disabled={removeBusy}
              title={`배경 제거 (${multiSelectedCount}개)`}
              aria-label={`배경 제거 (${multiSelectedCount}개)`}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-indigo-500 bg-indigo-500/15 py-2 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {removeBusy ? (
                <Loader2 size={ICON.size} strokeWidth={ICON.strokeWidth} className="animate-spin" />
              ) : (
                <Eraser size={ICON.size} strokeWidth={ICON.strokeWidth} />
              )}
              {removeBusy ? '처리 중…' : `배경 제거 (${multiSelectedCount}개)`}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              선택 {multiSelectedCount}개를 한 번에 순차 처리해 배경을 투명하게 만듭니다. 전체가 한
              단계로 Ctrl+Z 복구되며, 처리된 항목도 내보내기는 기존과 동일하게 동작합니다.
            </p>
            <button
              type="button"
              onClick={onOpenBgSites}
              title="고해상도 다운로드가 가능한 무료 AI 누끼 서비스 모음 열기"
              className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 active:scale-[0.98]"
            >
              <Globe size={13} strokeWidth={1.5} className="text-zinc-400" />
              배경 제거 사이트…
            </button>
          </Section>
          <div className="flex flex-col items-center gap-2 px-6 py-8 text-center">
            <MousePointerClick size={20} strokeWidth={1.5} className="text-zinc-600" />
            <span className="text-xs text-zinc-500">
              {multiSelectedCount}개 항목이 선택되었습니다
            </span>
            <span className="text-[10px] text-zinc-600">
              드래그하면 함께 이동하고 · Ctrl+클릭으로 개별 해제 · 1개만 남기면 수치 편집이
              가능합니다
            </span>
          </div>
        </div>
      ) : !item ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
          <MousePointerClick size={20} strokeWidth={1.5} className="text-zinc-600" />
          <span className="text-xs text-zinc-500">선택된 항목 없음</span>
          <span className="text-[10px] text-zinc-600">
            캔버스에서 이미지를 클릭하면 위치·크기·레이어를 편집할 수 있습니다
          </span>
          <button
            type="button"
            onClick={onOpenBgSites}
            title="고해상도 다운로드가 가능한 무료 AI 누끼 서비스 모음 열기"
            className="mt-3 flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 active:scale-[0.98]"
          >
            <Globe size={13} strokeWidth={1.5} className="text-zinc-400" />
            배경 제거 사이트…
          </button>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto" key={item.id}>
          <Section
            title="위치 / 크기"
            icon={<Move size={ICON.size} strokeWidth={ICON.strokeWidth} />}
          >
            <div className="grid grid-cols-2 gap-2">
              <NumField
                label="X"
                unit="cm"
                display={formatCm(item.x)}
                onCommit={(v) => onUpdate({ x: cmToPx(v) })}
              />
              <NumField
                label="Y"
                unit="cm"
                display={formatCm(item.y)}
                onCommit={(v) => onUpdate({ y: cmToPx(v) })}
              />
            </div>

            <div className="mt-2 flex items-end gap-1.5">
              <div className="flex-1">
                <NumField
                  label="가로"
                  unit="cm"
                  display={formatCm(item.widthPx)}
                  onCommit={commitWidth}
                />
              </div>
              <button
                type="button"
                onClick={() => setLinked((v) => !v)}
                title={linked ? '비율 고정 해제' : '비율 고정'}
                aria-label={linked ? '비율 고정 해제' : '비율 고정'}
                className={`mb-1 flex h-8 w-7 items-center justify-center rounded-md border transition-colors active:scale-95 ${
                  linked
                    ? 'border-indigo-500 bg-indigo-500/15 text-indigo-300'
                    : 'border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800'
                }`}
              >
                {linked ? (
                  <Link2 size={14} strokeWidth={1.5} />
                ) : (
                  <Link2Off size={14} strokeWidth={1.5} />
                )}
              </button>
              <div className="flex-1">
                <NumField
                  label="세로"
                  unit="cm"
                  display={formatCm(item.heightPx)}
                  onCommit={commitHeight}
                />
              </div>
            </div>

            <div className="mt-2 grid grid-cols-2 gap-2">
              <NumField
                label="회전"
                unit="deg"
                display={String(Math.round(item.rotation))}
                onCommit={(v) => onUpdate({ rotation: normalizeRotation(v) })}
              />
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
                  변형
                </span>
                <IconBtn label="90도 회전" onClick={onRotate90}>
                  <RotateCw size={ICON.size} strokeWidth={ICON.strokeWidth} />
                </IconBtn>
              </div>
            </div>
          </Section>

          <Section
            title="레이어 순서"
            icon={<Layers size={ICON.size} strokeWidth={ICON.strokeWidth} />}
          >
            <div className="grid grid-cols-4 gap-1.5">
              <IconBtn label="맨 앞으로" onClick={() => onOrder('front')}>
                <ArrowUpToLine size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn label="앞으로" onClick={() => onOrder('forward')}>
                <ChevronUp size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn label="뒤로" onClick={() => onOrder('backward')}>
                <ChevronDown size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
              <IconBtn label="맨 뒤로" onClick={() => onOrder('back')}>
                <ArrowDownToLine size={ICON.size} strokeWidth={ICON.strokeWidth} />
              </IconBtn>
            </div>
            {selectedIndex !== null && (
              <p className="mt-2 text-[10px] tabular-nums text-zinc-500">
                현재 레이어 <span className="text-zinc-300">{selectedIndex + 1}</span> / {itemCount}
              </p>
            )}
          </Section>

          <Section
            title="배경 제거"
            icon={<Eraser size={ICON.size} strokeWidth={ICON.strokeWidth} />}
          >
            <button
              type="button"
              onClick={onRemoveBg}
              disabled={removeBusy}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-indigo-500 bg-indigo-500/15 py-2 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25 active:scale-95 disabled:pointer-events-none disabled:opacity-40"
            >
              {removeBusy ? (
                <Loader2 size={ICON.size} strokeWidth={ICON.strokeWidth} className="animate-spin" />
              ) : (
                <Eraser size={ICON.size} strokeWidth={ICON.strokeWidth} />
              )}
              {removeBusy ? '처리 중…' : '배경 제거'}
            </button>
            <p className="mt-2 text-[10px] leading-relaxed text-zinc-500">
              AI 누끼로 배경을 투명하게 제거합니다. 첫 사용 시 모델 다운로드(약 1GB) 후 오프라인
              동작하며, 처리 중 잠시 멈출 수 있습니다. Ctrl+Z로 되돌릴 수 있습니다.
            </p>
            <button
              type="button"
              onClick={onOpenBgSites}
              title="고해상도 다운로드가 가능한 무료 AI 누끼 서비스 모음 열기"
              className="mt-1.5 flex w-full items-center justify-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 active:scale-[0.98]"
            >
              <Globe size={13} strokeWidth={1.5} className="text-zinc-400" />
              배경 제거 사이트…
            </button>
          </Section>

          <Section
            title="이미지 복제"
            icon={<Grid3x3 size={ICON.size} strokeWidth={ICON.strokeWidth} />}
          >
            <button
              type="button"
              onClick={onOpenGrid}
              className="flex w-full items-center justify-center gap-2 rounded-md border border-indigo-500 bg-indigo-500/15 py-2 text-xs font-medium text-indigo-300 transition-colors hover:bg-indigo-500/25 active:scale-95"
            >
              <Copy size={ICON.size} strokeWidth={ICON.strokeWidth} />
              이미지 복제…
            </button>
          </Section>
        </div>
      )}

      <div className="flex flex-col gap-1.5 border-t border-zinc-800 px-3 py-2.5">
        <div className="flex items-center justify-between text-[10px] tabular-nums text-zinc-500">
          <span>{item ? '선택 영역' : multi ? '다중 선택' : '문서'}</span>
          <span className="text-zinc-300">
            {item
              ? `${formatCm(item.widthPx)} × ${formatCm(item.heightPx)} cm`
              : multi
                ? `${multiSelectedCount}개 선택`
                : `배치 ${itemCount}개`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void window.api?.openManualPdf()}
          title="번들된 사용자 메뉴얼 PDF를 기본 뷰어로 엽니다"
          className="flex items-center gap-2 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-1.5 text-xs text-zinc-300 transition-colors hover:bg-zinc-800 active:scale-[0.98]"
        >
          <BookOpen size={13} strokeWidth={1.5} className="shrink-0 text-zinc-400" />
          <span className="flex-1 text-left">사용자 메뉴얼 (PDF)</span>
          <ExternalLink size={11} strokeWidth={1.5} className="shrink-0 text-zinc-600" />
        </button>
      </div>
    </aside>
  )
}
