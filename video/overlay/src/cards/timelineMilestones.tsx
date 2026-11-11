import { CardShell } from './parts'
import { easeOutExpo, prog, outFade, clamp01 } from '../core/clock'
import type { EffectDef } from '../core/types'

/** 時間軸里程碑：橫向節點逐個點亮 */
function TimelineMilestones({ t, enterAt, exitAt, params }: any) {
  const nodes = String(params.items ?? '').split('\n').filter((s) => s.trim()).slice(0, 6)
  const fade = outFade(t, exitAt)
  const n = nodes.length
  const dotR = 9
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      {/* §26：高度不可寫死。原 height:150 在標籤折行時會讓文字溢出卡片框（實測超出 7px） */}
      <div style={{ position: 'relative', minHeight: 150, paddingTop: 30, paddingBottom: 14 }}>
        {/* 主軸線從左向右生長 */}
        <div style={{
          position: 'absolute', top: 39 + dotR - 1, left: 0,
          height: 2, background: 'var(--c-line)',
          width: `${clamp01(prog(t, enterAt + 100, 900)) * fade * 100}%`,
        }} />
        <div style={{ display: 'flex', justifyContent: 'space-between', position: 'relative' }}>
          {nodes.map((label, i) => {
            const at = enterAt + 200 + (i / Math.max(n - 1, 1)) * Number(params.spreadMs ?? 1200)
            const a = clamp01(prog(t, at, 360)) * fade
            const p = clamp01(prog(t, at, 500))
            return (
              <div key={i} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
                width: `${100 / n}%`,
                opacity: a,
                transform: `translateY(${(1 - easeOutExpo(p)) * 10}px)`,
              }}>
                <div style={{
                  width: dotR * 2, height: dotR * 2, borderRadius: '50%',
                  border: `2px solid var(--c-${params.color})`,
                  background: `color-mix(in srgb, var(--c-${params.color}) ${Math.round(p * 85)}%, transparent)`,
                }} />
                <div style={{
                  fontSize: 28, color: 'var(--c-text)', textAlign: 'center',
                  lineHeight: 1.35, padding: '0 8px', overflowWrap: 'anywhere',
                }}>{label}</div>
              </div>
            )
          })}
        </div>
      </div>
    </CardShell>
  )
}

export const timelineMilestones: EffectDef = {
  id: 'timeline-milestones',
  name: '時間軸里程碑',
  category: '結構',
  desc: '橫向軸線生長，節點與標籤依次點亮',
  side: 'left',
  track: 'support',
  width: 780,
  params: [
    { key: 'items', label: '節點（每行一個）', type: 'textarea', default: '定風格\n量產卡\n接編排\n透明導出\n一鍵出片' },
    { key: 'spreadMs', label: '展開時長(ms)', type: 'range', min: 400, max: 2400, step: 50, default: 1200 },
    { key: 'color', label: '語意色', type: 'semantic', default: 'accent' },
  ],
  component: TimelineMilestones,
}
