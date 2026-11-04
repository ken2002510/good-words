import { CardShell, CardTitle } from './parts'
import { easeOutCubic, prog, outFade, clamp01 } from '../core/clock'
import type { EffectDef } from '../core/types'

/** 段落分段板：章節列表依序點亮，帶 TAG 徽章與完成指示點 */
function SegmentBoard({ t, enterAt, exitAt, params }: any) {
  const items = String(params.items ?? '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((line) => {
      const [tag, ...rest] = line.split('|')
      return { tag: (tag ?? '').trim(), title: rest.join('|').trim() }
    })
  const fade = outFade(t, exitAt)
  const gap = Number(params.stepGap ?? 240)
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <CardTitle text={params.title} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
        {items.map((it, i) => {
          const p = clamp01(prog(t, enterAt + 180 + i * gap, 420))
          const eased = easeOutCubic(p)
          const lit = t >= enterAt + 180 + i * gap
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 14,
              opacity: p * fade,
              transform: `translateX(${(1 - eased) * -16}px)`,
            }}>
              <span style={{
                fontSize: 11, fontWeight: 700, letterSpacing: 1.5,
                padding: '3px 8px', borderRadius: 6,
                border: `1px solid var(--c-${params.color})`,
                color: `var(--c-${params.color})`,
                opacity: lit ? 1 : 0.35,
              }}>{it.tag || '·'}</span>
              <span style={{ fontSize: 17, fontWeight: 600, color: 'var(--c-text)' }}>{it.title}</span>
              <span style={{
                marginLeft: 'auto', width: 7, height: 7, borderRadius: '50%',
                background: `var(--c-${params.color})`, opacity: lit ? 0.95 : 0,
              }} />
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

export const segmentBoard: EffectDef = {
  id: 'segment-board',
  name: '段落分段板',
  category: '文本',
  desc: '章節列表依序點亮，帶 TAG 徽章與完成點',
  side: 'left',
  track: 'support',
  width: 520,
  params: [
    { key: 'title', label: '標題', type: 'text', default: '本次改裝清單' },
    { key: 'items', label: '項目（每行 TAG|標題）', type: 'textarea', default: 'WHY|為什麼重做一條生產線\nOLD|舊流程的三個痛點\nNEW|新流程長什麼樣' },
    { key: 'stepGap', label: '間隔(ms)', type: 'range', min: 120, max: 600, step: 20, default: 240 },
    { key: 'color', label: '語意色', type: 'semantic', default: 'data' },
  ],
  component: SegmentBoard,
}
