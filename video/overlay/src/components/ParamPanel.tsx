import { memo } from 'react'
import { getEffect, TRACKS, trackOf } from '../registry'
import type { SemanticColor } from '../core/types'

interface Props {
  card: any // CardInstance + params
  issues: { level: 'error' | 'warn'; msg: string }[]
  onParam: (key: string, v: any) => void
  onPatch: (patch: any) => void
}

/** 右欄：參數面板。與 t 無關 → memo 隔離（播放 tick 跳過重繪） */
export const ParamPanel = memo(function ParamPanel({ card, issues, onParam, onPatch }: Props) {
  const def = getEffect(card.effect)
  if (!card || !def) return (
    <div className="right">
      <h3>參數（先選中一張卡）</h3>
      <div style={{ fontSize: 12, color: 'var(--ui-muted)', lineHeight: 1.8 }}>
        從左欄新增卡片；在時間軸上直接拖拽塊體與邊緣即可改時間。<br />
        鐵律：動畫只用 CSS transition + rAF，禁 setInterval / 真隨機。
      </div>
    </div>
  )

  return (
    <div className="right">
      <h3>參數 · {def.name}</h3>
      <div className="fields">
        {def.params.map((f) => {
          const val = card.params[f.key] ?? f.default
          if (f.type === 'text') return (
            <div className="field" key={f.key}><label>{f.label}</label>
              <input type="text" value={String(val)} onChange={(e) => onParam(f.key, e.target.value)} />
            </div>
          )
          if (f.type === 'textarea') return (
            <div className="field" key={f.key}><label>{f.label}</label>
              <textarea value={String(val)} onChange={(e) => onParam(f.key, e.target.value)} />
            </div>
          )
          if (f.type === 'number') return (
            <div className="field" key={f.key}><label>{f.label}</label>
              <input type="number" value={Number(val)} onChange={(e) => onParam(f.key, Number(e.target.value))} />
            </div>
          )
          if (f.type === 'range') return (
            <div className="field" key={f.key}>
              <label>{f.label} <span className="val">{val}</span></label>
              <input type="range" min={f.min} max={f.max} step={f.step} value={Number(val)} onChange={(e) => onParam(f.key, Number(e.target.value))} />
            </div>
          )
          if (f.type === 'boolean') return (
            <div className="field" key={f.key}><label>{f.label}</label>
              <input type="checkbox" checked={Boolean(val)} onChange={(e) => onParam(f.key, e.target.checked)} />
            </div>
          )
          if (f.type === 'semantic') {
            const colors: SemanticColor[] = ['accent', 'data', 'support', 'special']
            return (
              <div className="field" key={f.key}>
                <label>{f.label}</label>
                <div className="swatches">
                  {colors.map((cc) => (
                    <div key={cc} className={`swatch ${val === cc ? 'on' : ''}`} onClick={() => onParam(f.key, cc)}>
                      <span className="c" style={{ background: `var(--c-${cc})` }} />{cc}
                    </div>
                  ))}
                </div>
              </div>
            )
          }
          return null
        })}
        <hr style={{ borderColor: 'var(--ui-border)', margin: '14px 0' }} />
        <div className="field"><label>側邊</label>
          <select value={card.side} onChange={(e) => onPatch({ side: e.target.value })}>
            <option value="left">左側</option><option value="right">右側</option>
          </select>
        </div>
        <div className="field"><label>軌道</label>
          <select value={trackOf(card)} onChange={(e) => onPatch({ track: e.target.value })}>
            {TRACKS.map((tr) => <option key={tr.id} value={tr.id}>{tr.label}</option>)}
          </select>
        </div>
        <div className="field"><label>開始 (ms)</label>
          <input type="number" value={card.start} onChange={(e) => onPatch({ start: Number(e.target.value) })} />
        </div>
        <div className="field"><label>結束 (ms)</label>
          <input type="number" value={card.end} onChange={(e) => onPatch({ end: Number(e.target.value) })} />
        </div>
        <div className="field"><label>垂直偏移 (px)</label>
          <input type="range" min={-320} max={320} value={card.offsetY ?? 0} onChange={(e) => onPatch({ offsetY: Number(e.target.value) })} />
        </div>
        <div className="field"><label>寬度</label>
          <input type="range" min={360} max={900} value={card.width ?? def.width ?? 560} onChange={(e) => onPatch({ width: Number(e.target.value) })} />
        </div>
      </div>
      {issues.length > 0 && (
        <div style={{ marginTop: 16 }}>
          <h3>Lint 體檢（{issues.length}）</h3>
          {issues.slice(0, 8).map((is, i) => (
            <div key={i} style={{ fontSize: 11, color: is.level === 'error' ? '#ff8f8f' : '#e6b45c', marginBottom: 4 }}>
              [{is.level}] {is.msg}
            </div>
          ))}
        </div>
      )}
    </div>
  )
})