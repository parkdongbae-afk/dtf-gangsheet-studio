import { useState } from 'react'
import { ChevronDown, FilePlus2 } from 'lucide-react'
import {
  DTF_WIDTH_CM,
  HEIGHT_PRESETS_M,
  WIDTH_PRESETS_CM,
  getCanvasHeightPx,
  getCanvasWidthPx,
  type HeightPresetM
} from '../../core/math'
import { ProxyCanvas } from './components/canvas/ProxyCanvas'

function App(): React.JSX.Element {
  const [widthCm, setWidthCm] = useState<number>(DTF_WIDTH_CM)
  const [heightM, setHeightM] = useState<HeightPresetM>(1)
  const [created, setCreated] = useState(false)

  const widthPx = getCanvasWidthPx(widthCm)
  const heightPx = getCanvasHeightPx(heightM)

  if (created) {
    return <ProxyCanvas widthPx={widthPx} heightPx={heightPx} />
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

        <button
          onClick={() => setCreated(true)}
          className="mt-5 w-full rounded-md bg-indigo-600 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500 active:scale-[0.98]"
        >
          문서 만들기
        </button>
      </div>
    </main>
  )
}

export default App
