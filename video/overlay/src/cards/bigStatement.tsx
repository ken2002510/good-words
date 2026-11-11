import { CardShell } from './parts'
import { prog, outFade, clamp01, easeOutCubic } from '../core/clock'
import type { EffectDef } from '../core/types'

/** 大字觀點：整塊浮現 + 底部細線展開 */
function BigStatement({ t, enterAt, exitAt, params }: any) {
  const fade = outFade(t, exitAt)
  const a = clamp01(prog(t, enterAt + 80, 520)) * fade
  const rise = (1 - easeOutCubic(prog(t, enterAt, 560))) * 30
  const lineP = easeOutCubic(prog(t, enterAt + 260, 700))
  return (
    // 不覆寫 padding：原本 style padding '10px 6px' 讓文字離左框只剩 8–9px（§26 退回等級）
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <div style={{
        fontSize: Number(params.fontSize ?? 78), fontWeight: 650,
        lineHeight: 1.35, letterSpacing: '1px',
        color: `var(--c-${params.color})`,
        opacity: a,
        transform: `translateY(${rise * 0.3}px)`,
      }}>
        {params.text}
      </div>
      <div style={{
        height: 3, borderRadius: 2, marginTop: 18,
        width: `${lineP * 84}%`,   // 底線不要頂到卡片左右邊界
        background: `color-mix(in srgb, var(--c-${params.color}) 65%, transparent)`,
      }} />
    </CardShell>
  )
}

export const bigStatement: EffectDef = {
  id: 'big-statement',
  name: '大字觀點',
  category: '文本',
  desc: '無框大字 + 細線展開，壓得住場的觀點句',
  side: 'right',
  track: 'main',
  width: 820,
  params: [
    { key: 'text', label: '文字', type: 'textarea', default: '動效不是加法\n是減法' },
    { key: 'fontSize', label: '字號', type: 'range', min: 44, max: 104, step: 2, default: 68 },
    { key: 'color', label: '語意色', type: 'semantic', default: 'accent' },
  ],
  component: BigStatement,
}
