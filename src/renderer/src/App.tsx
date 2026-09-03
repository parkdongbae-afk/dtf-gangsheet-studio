import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, FilePlus2, FolderOpen } from 'lucide-react'
import {
  DTF_WIDTH_CM,
  HEIGHT_PRESETS_M,
  WIDTH_PRESETS_CM,
  getCanvasHeightPx,
  getCanvasWidthPx,
  type HeightPresetM
} from '../../core/math'
import { ProxyCanvas, type PlacedImage } from './components/canvas/ProxyCanvas'
import { hydrateProjectImages } from './projectIO'

/** 작업 세션 — 문서 규격 + 씬 이미지. nonce 증가 = 프로젝트 불러오기로 전체 교체 */
interface DocumentSession {
  widthPx: number
  heightPx: number
  images: PlacedImage[]
  nonce: number
}

function App(): React.JSX.Element {
  const [widthCm, setWidthCm] = useState<number>(DTF_WIDTH_CM)
  const [heightM, setHeightM] = useState<HeightPresetM>(1)
  const [doc, setDoc] = useState<DocumentSession | null>(null)

  const widthPx = getCanvasWidthPx(widthCm)
  const heightPx = getCanvasHeightPx(heightM)

  /** .dtf 프로젝트 열기 — 프리뷰 재생성(hydrate) 후 세션 교체 (새 문서 만들기와 동일 경로) */
  const openProjectFromDisk = useCallback(async (pathOverride?: string): Promise<void> => {
    try {
      const project = await window.api.openProject(pathOverride)
      if (!project) return
      const images = await hydrateProjectImages(project.images)
      setDoc((prev) => ({
        widthPx: project.document.widthPx,
        heightPx: project.document.heightPx,
        images,
        nonce: (prev?.nonce ?? 0) + 1
      }))
    } catch (err) {
      alert(`프로젝트 열기 실패: ${err instanceof Error ? err.message : String(err)}`)
    }
  }, [])

  /** 툴바 "새 파일" — 진행 중 세션 폐기 후 새 문서 설정 화면으로 돌아간다 (미저장 경고) */
  const handleNewProject = useCallback((): void => {
    if (
      !window.confirm(
        '현재 작업 내용을 버리고 새 문서를 만들까요?\n저장하지 않은 변경 사항은 사라집니다.'
      )
    )
      return
    setDoc(null)
  }, [])

  /** E2E 자동검증 훅 (dtf:import-paths 패턴 계승) — 파일 다이얼로그 없이 경로로 프로젝트를 연다 */
  useEffect(() => {
    const onOpenProject = (e: Event): void => {
      const path = (e as CustomEvent<string>).detail
      if (typeof path === 'string' && path.length > 0) void openProjectFromDisk(path)
    }
    window.addEventListener('dtf:open-project', onOpenProject)
    return () => window.removeEventListener('dtf:open-project', onOpenProject)
  }, [openProjectFromDisk])

  if (doc) {
    return (
      <ProxyCanvas
        widthPx={doc.widthPx}
        heightPx={doc.heightPx}
        initialImages={doc.images}
        loadNonce={doc.nonce}
        onOpenProject={() => void openProjectFromDisk()}
        onNewProject={handleNewProject}
      />
    )
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-zinc-950 p-8">
      <div className="w-[420px] rounded-lg border border-zinc-800 bg-zinc-900 p-5 shadow-2xl">
        <div className="flex items-center gap-2.5">
          <FilePlus2 size={18} strokeWidth={1.5} className="text-zinc-400" />
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold text-zinc-100">새 문서</h1>
            <span className="text-[10px] text-zinc-500">350 DPI · DTF 갱시트 규격</span>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-zinc-400">가로 폭 (1cm 단위 · 최대 1m)</span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] tabular-nums text-zinc-500">
              {widthPx.toLocaleString()} px
            </span>
            <div className="flex items-center rounded-md border border-zinc-800 bg-zinc-950 transition-all focus-within:ring-1 focus-within:ring-indigo-500">
              <select
                value={widthCm}
                onChange={(e) => setWidthCm(Number(e.target.value))}
                className="cursor-pointer appearance-none bg-transparent px-2 py-1 pr-6 text-sm tabular-nums text-zinc-200 outline-none"
                aria-label="문서 가로 폭 (cm)"
              >
                {WIDTH_PRESETS_CM.map((cm) => (
                  <option key={cm} value={cm} className="bg-zinc-900">
                    {cm} cm
                  </option>
                ))}
              </select>
              <ChevronDown
                size={12}
                strokeWidth={1.5}
                className="pointer-events-none -ml-5 text-zinc-500"
              />
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-col gap-1.5">
          <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
            세로 길이
          </span>
          <div className="grid grid-cols-2 gap-2">
            {HEIGHT_PRESETS_M.map((meters) => (
              <label key={meters} className="cursor-pointer">
                <input
                  type="radio"
                  name="height"
                  checked={heightM === meters}
                  onChange={() => setHeightM(meters)}
                  className="sr-only"
                />
                <div
                  className={`flex flex-col gap-0.5 rounded-md border p-2.5 transition-colors ${
                    heightM === meters
                      ? 'border-indigo-500 bg-indigo-500/15'
                      : 'border-zinc-800 bg-zinc-950 hover:bg-zinc-800'
                  }`}
                >
                  <span
                    className={`text-sm font-semibold tabular-nums ${
                      heightM === meters ? 'text-indigo-300' : 'text-zinc-200'
                    }`}
                  >
                    {meters} m
                  </span>
                  <span className="text-[10px] tabular-nums text-zinc-500">
                    {getCanvasHeightPx(meters).toLocaleString()} px
                  </span>
                </div>
              </label>
            ))}
          </div>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={() => void openProjectFromDisk()}
            className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-800 bg-zinc-900 px-3 py-2 text-sm text-zinc-200 transition-colors hover:bg-zinc-800 active:scale-[0.98]"
          >
            <FolderOpen size={15} strokeWidth={1.5} />
            열기
          </button>
          <button
            onClick={() => setDoc({ widthPx, heightPx, images: [], nonce: 1 })}
            className="flex-1 rounded-md bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 active:scale-[0.98]"
          >
            문서 만들기
          </button>
        </div>
      </div>
    </main>
  )
}

export default App
