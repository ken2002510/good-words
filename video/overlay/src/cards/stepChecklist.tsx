import { CardShell } from './parts'
import { prog, outFade, clamp01, easeOutCubic } from '../core/clock'
import type { EffectDef } from '../core/types'

/** 步驟清單：編號行逐條勾選 */
function StepChecklist({ t, enterAt, exitAt, params }: any) {
  const items = String(params.items ?? '').split('\n').filter((s) => s.trim()).slice(0, 6)
  const fade = outFade(t, exitAt)
  const checkEvery = Number(params.checkEveryMs ?? 420)
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {items.map((txt, i) => {
          const rowA = clamp01(prog(t, enterAt + i * Number(params.rowGapMs ?? 180), 380)) * fade
          const doneP = easeOutCubic(clamp01(prog(t, enterAt + 350 + i * checkEvery, 340)))
          return (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 16,
              opacity: rowA,
              transform: `translateX(${(1 - rowA / Math.max(fade, 0.0001)) * 18}px)`,
            }}>
              <div style={{
                width: 34, height: 34, borderRadius: 10, flex: 'none',
                border: `1.5px solid ${doneP > 0.5 ? `var(--c-${params.doneColor})` : 'var(--card-line)'}`,
                background: doneP > 0.5 ? `color-mix(in srgb, var(--c-${params.doneColor}) 16%, transparent)` : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 19, fontWeight: 650,
                color: doneP > 0.5 ? `var(--c-${params.doneColor})` : 'var(--c-muted)',
              }}>
                {doneP > 0.5 ? '✓' : String(i + 1)}
              </div>
              <div style={{ fontSize: 24, color: 'var(--c-text)' }}>{txt}</div>
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

export const stepChecklist: EffectDef = {
  id: 'step-checklist',
  name: '步驟清單',
  category: '結構',
  desc: '編號行逐條入場並依次打勾，適合流程說明',
  side: 'right',
  track: 'support',
  width: 600,
  params: [
    { key: 'items', label: '步驟（每行一個）', type: 'textarea', default: '錄口播\n導出字幕 SRT\nAI 編排卡片\n預覽微調\n一鍵渲染成片' },
    { key: 'rowGapMs', label: '行間隔(ms)', type: 'range', min: 80, max: 400, step: 10, default: 180 },
    { key: 'checkEveryMs', label: '打勾間隔(ms)', type: 'range', min: 120, max: 800, step: 20, default: 420 },
    { key: 'doneColor', label: '完成色', type: 'semantic', default: 'special' },
  ],
  component: StepChecklist,
}
