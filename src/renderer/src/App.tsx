import { useState } from 'react'
import {
  CANVAS_WIDTH_PX,
  DTF_WIDTH_CM,
  HEIGHT_PRESETS_M,
  getCanvasHeightPx,
  type HeightPresetM
} from '../../core/math'
import { ProxyCanvas } from './components/canvas/ProxyCanvas'

function App(): React.JSX.Element {
  const [heightM, setHeightM] = useState<HeightPresetM>(1)
  const [created, setCreated] = useState(false)

  const heightPx = getCanvasHeightPx(heightM)

  if (created) {
    return <ProxyCanvas widthPx={CANVAS_WIDTH_PX} heightPx={heightPx} />
  }

  return (
    <main className="new-doc">
      <h1>새 문서</h1>
      <fieldset>
        <legend>용지 규격 (350 DPI)</legend>
        <div className="field">
          <span>가로 (DTF 롤 고정)</span>
          <strong>{DTF_WIDTH_CM} cm</strong>
        </div>
        <div className="field">
          <span>세로 길이</span>
          <div className="choices">
            {HEIGHT_PRESETS_M.map((meters) => (
              <label key={meters}>
                <input
                  type="radio"
                  name="height"
                  checked={heightM === meters}
                  onChange={() => setHeightM(meters)}
                />
                {meters} m
              </label>
            ))}
          </div>
        </div>
      </fieldset>
      <button onClick={() => setCreated(true)}>문서 만들기</button>
    </main>
  )
}

export default App
