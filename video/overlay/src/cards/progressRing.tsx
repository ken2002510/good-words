import { CardShell, CardTitle } from './parts'
import { easeOutExpo, countUp, outFade, prog, clamp01 } from '../core/clock'
import type { EffectDef } from '../core/types'

const R = 96
const CIRC = 2 * Math.PI * R

/** 環形進度 */
function ProgressRing({ t, enterAt, exitAt, params }: any) {
  const pct = clamp01(Number(params.percent ?? 76) / 100)
  const p = easeOutExpo(prog(t, enterAt + 150, Number(params.durMs ?? 1300)))
  const fade = outFade(t, exitAt)
  const shown = Math.round(pct * p * 100)
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <CardTitle text={params.title} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 30, opacity: fade }}>
        <svg width={R * 2 + 16} height={R * 2 + 16} viewBox={`0 0 ${R * 2 + 16} ${R * 2 + 16}`}>
          <circle cx={R + 8} cy={R + 8} r={R} fill="none" stroke="var(--c-line)" strokeWidth={13} />
          <circle
            cx={R + 8} cy={R + 8} r={R} fill="none"
            stroke={`var(--c-${params.color})`} strokeWidth={13} strokeLinecap="round"
            strokeDasharray={CIRC}
            strokeDashoffset={CIRC * (1 - pct * p)}
            transform={`rotate(-90 ${R + 8} ${R + 8})`}
          />
        </svg>
        <div>
          <div className="fx-num" style={{ fontSize: 58, fontWeight: 700, color: `var(--c-${params.color})` }}>
            {countUp(t, enterAt + 150, pct * 100, Number(params.durMs ?? 1300)).toFixed(0)}%
          </div>
          <div style={{ fontSize: 26, color: 'var(--c-muted)', marginTop: 6 }}>{params.label}</div>
          <div className="fx-num" style={{ fontSize: 20, color: 'var(--c-muted)', marginTop: 14, opacity: clamp01(prog(t, enterAt + 1200, 400)) }}>
            {shown}% · {params.sublabel}
          </div>
        </div>
      </div>
    </CardShell>
  )
}

export const progressRing: EffectDef = {
  id: 'progress-ring',
  name: '環形進度',
  category: '數據',
  desc: 'SVG 圓環描邊生長 + 中央百分比滾動',
  side: 'right',
  track: 'data',
  width: 520,
  params: [
    { key: 'title', label: '標題', type: 'text', default: '自動化覆蓋' },
    { key: 'percent', label: '百分比', type: 'range', min: 0, max: 100, step: 1, default: 76 },
    { key: 'durMs', label: '時長(ms)', type: 'range', min: 600, max: 2400, step: 50, default: 1300 },
    { key: 'label', label: '主說明', type: 'text', default: '全流程自動化' },
    { key: 'sublabel', label: '副說明', type: 'text', default: '無需手工對齊' },
    { key: 'color', label: '語意色', type: 'semantic', default: 'accent' },
  ],
  component: ProgressRing,
}
