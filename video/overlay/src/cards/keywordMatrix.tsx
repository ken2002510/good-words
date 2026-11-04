import { CardShell } from './parts'
import { outFade, prog, clamp01 } from '../core/clock'
import { strSeed, hash01 } from '../core/random'
import type { EffectDef } from '../core/types'

/** 關鍵字矩陣：詞塊確定性錯落浮入（隨機感 → 種子雜湊，鐵律 2） */
function KeywordMatrix({ t, enterAt, exitAt, params }: any) {
  const words = String(params.words ?? '').split('\n').filter((s) => s.trim()).slice(0, 8)
  const fade = outFade(t, exitAt)
  const seed = strSeed(params.words ?? 'kw')
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <div style={{
        display: 'flex', flexWrap: 'wrap', gap: 14,
      }}>
        {words.map((w, i) => {
          const d = hash01(seed + i * 97) // 確定性延遲抖動
          const at = enterAt + 180 + i * Number(params.stepMs ?? 130) + d * 90
          const a = clamp01(prog(t, at, 380)) * fade
          const rise = (1 - clamp01(prog(t, at, 380))) * 12
          const hot = i % 3 === Number(params.hotIndex ?? 1) % 3
          return (
            <div key={i} style={{
              opacity: a,
              transform: `translateY(${rise}px)`,
              padding: '10px 22px',
              borderRadius: 999,
              border: `1px solid ${hot ? `var(--c-${params.color})` : 'var(--card-line)'}`,
              background: hot ? `color-mix(in srgb, var(--c-${params.color}) 14%, transparent)` : 'transparent',
              fontSize: 24,
              fontWeight: hot ? 650 : 450,
              color: hot ? `var(--c-${params.color})` : 'var(--c-muted)',
            }}>
              {w}
            </div>
          )
        })}
      </div>
      <div style={{ marginTop: 20, fontSize: 15, letterSpacing: 3, color: 'var(--c-muted)', opacity: fade * clamp01(prog(t, enterAt + 500, 500)) }}>
        {params.tagline ?? ''}
      </div>
    </CardShell>
  )
}

export const keywordMatrix: EffectDef = {
  id: 'keyword-matrix',
  name: '關鍵字矩陣',
  category: '文本',
  desc: '詞塊按確定性節奏錯落浮現，重點詞著色',
  side: 'right',
  track: 'support',
  width: 620,
  params: [
    { key: 'words', label: '關鍵字（每行一個）', type: 'textarea', default: '虛擬時間\n逐幀渲染\n透明通道\n零返工\n確定性隨機\n時鐘校正' },
    { key: 'stepMs', label: '節奏(ms)', type: 'range', min: 60, max: 300, step: 10, default: 130 },
    { key: 'hotIndex', label: '熱詞序號', type: 'range', min: 0, max: 7, step: 1, default: 1 },
    { key: 'tagline', label: '底部小字', type: 'text', default: '' },
    { key: 'color', label: '語意色', type: 'semantic', default: 'support' },
  ],
  component: KeywordMatrix,
}
