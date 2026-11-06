import { CardShell, CardTitle } from './parts'
import { easeOutExpo, outFade, prog, clamp01 } from '../core/clock'
import type { EffectDef } from '../core/types'

/** 左右對比條 */
function CompareBars({ t, enterAt, exitAt, params }: any) {
  const lv = clamp01(Number(params.leftValue ?? 50) / 100)
  const rv = clamp01(Number(params.rightValue ?? 80) / 100)
  const p = easeOutExpo(prog(t, enterAt + 200, 1000))
  const fade = outFade(t, exitAt)
  const rowA = clamp01(prog(t, enterAt + 60, 360)) * fade
  const rowB = clamp01(prog(t, enterAt + 220, 360)) * fade
  const Row = ({ label, val, color, alpha }: any) => (
    <div style={{ opacity: alpha }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 28, marginBottom: 8 }}>
        <span style={{ color: 'var(--c-text)' }}>{label}</span>
        <span className="fx-num" style={{ color: `var(--c-${color})` }}>{Math.round(val * p * 100)}%</span>
      </div>
      <div style={{ height: 14, borderRadius: 7, background: 'var(--c-line)', overflow: 'hidden' }}>
        <div style={{
          width: `${val * p * 100}%`, height: '100%', borderRadius: 7,
          background: `var(--c-${color})`,
          transition: 'none',
        }} />
      </div>
    </div>
  )
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <CardTitle text={params.title} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>
        <Row label={params.leftLabel} val={lv} color={params.leftColor} alpha={rowA} />
        <Row label={params.rightLabel} val={rv} color={params.rightColor} alpha={rowB} />
      </div>
      {params.footnote ? (
        <div style={{ marginTop: 24, fontSize: 22, color: 'var(--c-muted)', opacity: fade }}>{params.footnote}</div>
      ) : null}
    </CardShell>
  )
}

export const compareBars: EffectDef = {
  id: 'compare-bars',
  name: '左右對比條',
  category: '結構',
  desc: '兩條橫向進度條先後生長，直觀對比兩項數據',
  side: 'right',
  track: 'data',
  width: 680,
  params: [
    { key: 'title', label: '標題', type: 'text', default: '效率對比' },
    { key: 'leftLabel', label: '左項名稱', type: 'text', default: '傳統流程' },
    { key: 'leftValue', label: '左項數值', type: 'range', min: 0, max: 100, step: 1, default: 42 },
    { key: 'leftColor', label: '左項色', type: 'semantic', default: 'support' },
    { key: 'rightLabel', label: '右項名稱', type: 'text', default: '動效產線' },
    { key: 'rightValue', label: '右項數值', type: 'range', min: 0, max: 100, step: 1, default: 93 },
    { key: 'rightColor', label: '右項色', type: 'semantic', default: 'data' },
    { key: 'footnote', label: '腳註', type: 'text', default: '' },
  ],
  component: CompareBars,
}
