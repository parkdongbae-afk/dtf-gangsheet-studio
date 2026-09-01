import { useEffect, useState } from 'react'
import { CANVAS_WIDTH_PX, cmToPx } from '../../../../core/math'
import type { GridSource } from './placement'

/** 행×열 상한 — 프록시 씬 노드 수 폭주 방지 (50×50 = 2,500개) */
const MAX_GRID = 50
const GAP_CM_MAX = 50

interface GridDialogProps {
  /** 복제 기준 항목 — 셀 (0,0)이 이 항목의 자리가 된다 */
  item: GridSource
  onConfirm: (rows: number, cols: number, gapPx: number) => void
  onClose: () => void
}

const parseIntFallback = (text: string, min: number, max: number, fallback: number): number => {
  const n = Number.parseInt(text, 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(Math.max(n, min), max)
}

const parseGapCm = (text: string): number => {
  const n = Number.parseFloat(text)
  if (Number.isNaN(n)) return 1
  return Math.min(Math.max(n, 0), GAP_CM_MAX)
}

/** 그리드 복제 대화상자 (S5 세션 2) — 행×열·간격(cm)을 받아 절대 px gap으로 확정 커밋 */
export function GridDialog({ item, onConfirm, onClose }: GridDialogProps): React.JSX.Element {
  const [rowsText, setRowsText] = useState('2')
  const [colsText, setColsText] = useState('2')
  const [gapText, setGapText] = useState('1')

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const rows = parseIntFallback(rowsText, 1, MAX_GRID, 2)
  const cols = parseIntFallback(colsText, 1, MAX_GRID, 2)
  const gapCm = parseGapCm(gapText)
  const gapPx = cmToPx(gapCm)
  const total = rows * cols
  // 결과 그리드 범위 (350 DPI px → cm) — 롤 폭 50cm 초과 시 경고
  const extentCm = {
    w: ((cols * item.widthPx + (cols - 1) * gapPx) / 350) * 2.54,
    h: ((rows * item.heightPx + (rows - 1) * gapPx) / 350) * 2.54
  }
  const overRoll = cols * item.widthPx + (cols - 1) * gapPx > CANVAS_WIDTH_PX

  return (
    <div className="grid-dialog-backdrop" onMouseDown={onClose}>
      <form
        className="grid-dialog"
        role="dialog"
        aria-label="그리드 복제"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          onConfirm(rows, cols, gapPx)
        }}
      >
        <h2>그리드 복제</h2>
        <div className="grid-dialog-fields">
          <label>
            행
            <input
              type="number"
              min={1}
              max={MAX_GRID}
              value={rowsText}
              autoFocus
              onChange={(e) => setRowsText(e.target.value)}
            />
          </label>
          <label>
            열
            <input
              type="number"
              min={1}
              max={MAX_GRID}
              value={colsText}
              onChange={(e) => setColsText(e.target.value)}
            />
          </label>
          <label>
            간격 (cm)
            <input
              type="number"
              min={0}
              max={GAP_CM_MAX}
              step={0.1}
              value={gapText}
              onChange={(e) => setGapText(e.target.value)}
            />
          </label>
        </div>
        <p className="grid-dialog-result">
          총 {total}개 (신규 {total - 1}개 복제) · 결과 {extentCm.w.toFixed(1)} ×{' '}
          {extentCm.h.toFixed(1)} cm
          {overRoll && <span className="grid-dialog-warn"> — 롤 폭 50cm 초과!</span>}
        </p>
        <div className="grid-dialog-actions">
          <button type="button" onClick={onClose}>
            취소
          </button>
          <button type="submit">적용</button>
        </div>
      </form>
    </div>
  )
}
