import { useEffect, useRef, useState } from 'react'
import type { ExportProgress, ExportResult } from '../../../../types/ipc'
import {
  buildExportManifest,
  type ExportableItem,
  type ExportFormat
} from '../../../../workers/exportManifest'

/** 내보내기 다이얼로그 단계 — 설정 → 렌더(진행률) → 완료/오류 */
type ExportPhase = 'setup' | 'rendering' | 'done' | 'error'

interface ExportDialogProps {
  /** 씬 항목 — PlacedImage를 구조적으로 만족(순수 데이터만) */
  items: readonly ExportableItem[]
  widthPx: number
  heightPx: number
  onClose: () => void
}

/**
 * 내보내기 다이얼로그 (S6 세션 2) — 포맷(PSD/PNG)·병합 옵션(F8) 선택 후
 * 사이드카 렌더를 진행률과 함께 보여준다. 진행률은 export:progress 이벤트
 * (메인 → 렌더러 push)로 수신한다. 렌더 중에는 실수로 닫히지 않게
 * Esc·백드롭 닫기를 비활성화하고 취소 버튼만 제공한다.
 */
export function ExportDialog({
  items,
  widthPx,
  heightPx,
  onClose
}: ExportDialogProps): React.JSX.Element {
  const [phase, setPhase] = useState<ExportPhase>('setup')
  const [format, setFormat] = useState<ExportFormat>('psd')
  const [flatten, setFlatten] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  /** 취소로 발생한 거부는 오류 안내 없이 설정 단계로 돌린다 */
  const cancelRequestedRef = useRef(false)

  useEffect(() => {
    return window.api.onExportProgress((p) => setProgress(p))
  }, [])

  useEffect(() => {
    if (phase !== 'rendering') return
    const onKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') e.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [phase])

  const handleExport = async (): Promise<void> => {
    const outputPath = await window.api.exportSaveDialog(format)
    if (!outputPath) return
    cancelRequestedRef.current = false
    setProgress(null)
    setError(null)
    setPhase('rendering')
    try {
      const manifest = buildExportManifest({
        outputPath,
        widthPx,
        heightPx,
        items,
        format,
        flatten: format === 'psd' && flatten
      })
      setResult(await window.api.exportDocument(manifest))
      setPhase('done')
    } catch (err) {
      if (cancelRequestedRef.current) {
        setPhase('setup')
        return
      }
      setError(err instanceof Error ? err.message : String(err))
      setPhase('error')
    }
  }

  const handleCancel = async (): Promise<void> => {
    cancelRequestedRef.current = true
    await window.api.cancelExport()
  }

  const rendering = phase === 'rendering'
  const progressPercent =
    progress && progress.total > 0 ? Math.round((progress.current / progress.total) * 100) : 0

  return (
    <div
      className="grid-dialog-backdrop"
      onMouseDown={rendering ? undefined : onClose}
      role="dialog"
      aria-label="내보내기"
    >
      <form
        className="grid-dialog export-dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          if (phase === 'setup' && items.length > 0) void handleExport()
        }}
      >
        <h2>내보내기</h2>

        {phase === 'setup' && (
          <>
            <div className="export-dialog-fields">
              <label>
                <input
                  type="radio"
                  name="export-format"
                  checked={format === 'psd'}
                  onChange={() => setFormat('psd')}
                />{' '}
                PSD (CMYK·350DPI)
              </label>
              <label>
                <input
                  type="radio"
                  name="export-format"
                  checked={format === 'png'}
                  onChange={() => setFormat('png')}
                />{' '}
                PNG (알파 검수용)
              </label>
            </div>
            {format === 'psd' && (
              <label className="export-dialog-flatten">
                <input
                  type="checkbox"
                  checked={flatten}
                  onChange={(e) => setFlatten(e.target.checked)}
                />{' '}
                단일 인쇄 레이어로 병합
              </label>
            )}
            <p className="grid-dialog-result">
              배치 항목 {items.length}개 · 캔버스 {widthPx.toLocaleString()} ×{' '}
              {heightPx.toLocaleString()} px
              {items.length === 0 && (
                <span className="grid-dialog-warn"> — 배치된 이미지가 없습니다</span>
              )}
            </p>
          </>
        )}

        {rendering && (
          <div className="export-dialog-progress">
            <div className="export-dialog-progress-bar">
              <div
                className="export-dialog-progress-fill"
                style={{ width: `${progress?.stage === 'write' ? 100 : progressPercent}%` }}
              />
            </div>
            <p className="grid-dialog-result">
              {progress?.stage === 'write'
                ? '파일 저장 중…'
                : `항목 렌더 ${progress?.current ?? 0} / ${progress?.total ?? items.length}`}
            </p>
          </div>
        )}

        {phase === 'done' && result && (
          <p className="export-dialog-result">
            완료 — {result.width_px.toLocaleString()} × {result.height_px.toLocaleString()} px ·
            레이어 {result.layer_count} · {(result.duration_ms / 1000).toFixed(1)}초
            <br />
            <span className="export-dialog-path">{result.output_path}</span>
          </p>
        )}

        {phase === 'error' && error && (
          <p className="grid-dialog-warn export-dialog-error">{error}</p>
        )}

        <div className="grid-dialog-actions">
          {rendering ? (
            <button type="button" onClick={() => void handleCancel()}>
              취소
            </button>
          ) : (
            <>
              <button type="button" onClick={onClose}>
                닫기
              </button>
              <button type="submit" disabled={items.length === 0}>
                {phase === 'error' ? '다시 시도' : '내보내기'}
              </button>
            </>
          )}
        </div>
      </form>
    </div>
  )
}
