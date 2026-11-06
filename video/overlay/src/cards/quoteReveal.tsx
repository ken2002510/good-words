import { CardShell } from './parts'
import { easeOutCubic, prog, outFade, clamp01 } from '../core/clock'
import type { EffectDef } from '../core/types'

/** 金句逐行揭示 */
function QuoteReveal({ t, enterAt, exitAt, params }: any) {
  const lines: string[] = String(params.lines ?? '').split('\n').filter((s) => s.trim())
  const hi = String(params.highlight ?? '')
  const fade = outFade(t, exitAt)
  const ruleP = easeOutCubic(prog(t, enterAt + 120, 900))
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <div style={{
        width: `${ruleP * 64}px`, height: 3, borderRadius: 2,
        background: `var(--c-${params.color})`, marginBottom: 22,
      }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {lines.map((ln, i) => {
          const a = clamp01(prog(t, enterAt + 200 + i * Number(params.lineGap ?? 260), 480)) * fade
          const rise = (1 - easeOutCubic(prog(t, enterAt + 200 + i * Number(params.lineGap ?? 260), 480))) * 18
          const isHi = hi && ln.includes(hi)
          const parts = isHi
            ? ln.split(hi).flatMap((s, j) => (j === 0 ? [s] : [hi, s])).filter(Boolean)
            : [ln]
          return (
            <div key={i} style={{
              opacity: a, transform: `translateY(${rise}px)`,
              fontSize: Number(params.fontSize ?? 62),
              fontWeight: 650, lineHeight: 1.42,
              letterSpacing: '0.5px',
              color: 'var(--c-text)',
            }}>
              {parts.map((seg, j) =>
                isHi && seg === hi ? (
                  <span key={j} style={{ color: `var(--c-${params.color})` }}>{seg}</span>
                ) : (
                  <span key={j}>{seg}</span>
                ),
              )}
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

export const quoteReveal: EffectDef = {
  id: 'quote-reveal',
  name: '金句逐行揭示',
  category: '文本',
  desc: '金句按行交錯浮現，關鍵詞著色，配短標尺線',
  side: 'left',
  track: 'main',
  width: 740,
  params: [
    { key: 'lines', label: '金句（每行一句）', type: 'textarea', default: '好的工具不該被看見\n它只是讓想法\n更快落到螢幕上' },
    { key: 'highlight', label: '高亮詞', type: 'text', default: '想法' },
    { key: 'lineGap', label: '行間隔(ms)', type: 'range', min: 120, max: 500, step: 10, default: 260 },
    { key: 'fontSize', label: '字號', type: 'range', min: 36, max: 72, step: 1, default: 52 },
    { key: 'color', label: '語意色', type: 'semantic', default: 'special' },
  ],
  component: QuoteReveal,
}
