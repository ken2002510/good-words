import { CardShell, CardTitle } from './parts'
import { easeOutExpo, countUp, outFade, prog } from '../core/clock'
import type { EffectDef } from '../core/types'

/** 數字滾動卡 */
function NumberRoll({ t, enterAt, exitAt, params }: any) {
  const p = easeOutExpo(prog(t, enterAt + 150, Number(params.durMs ?? 1200)))
  const fade = outFade(t, exitAt)
  const dec = Math.max(0, Math.min(3, Number(params.decimals ?? 0)))
  const val = Number(params.value ?? 0)
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <CardTitle text={params.title} />
      <div style={{ opacity: fade }}>
        <div className="fx-num" style={{
          fontSize: 92, fontWeight: 750, lineHeight: 1.1,
          color: `var(--c-${params.color})`, letterSpacing: '1px',
        }}>
          {params.prefix}
          {countUp(t, enterAt + 150, val, Number(params.durMs ?? 1200)).toFixed(dec)}
          {params.suffix}
        </div>
        {params.caption ? (
          <div style={{ fontSize: 19, color: 'var(--c-muted)', marginTop: 10 }}>{params.caption}</div>
        ) : null}
      </div>
    </CardShell>
  )
}

export const numberRoll: EffectDef = {
  id: 'number-roll',
  name: '數字滾動',
  category: '數據',
  desc: '大號數字從零滾動到目標值，配標題與備註',
  side: 'left',
  track: 'data',
  width: 560,
  params: [
    { key: 'title', label: '標題', type: 'text', default: '出片耗時' },
    { key: 'value', label: '目標數值', type: 'number', default: 3 },
    { key: 'decimals', label: '小數位', type: 'range', min: 0, max: 2, step: 1, default: 0 },
    { key: 'prefix', label: '前綴', type: 'text', default: '' },
    { key: 'suffix', label: '後綴', type: 'text', default: ' 小時' },
    { key: 'durMs', label: '滾動時長(ms)', type: 'range', min: 600, max: 2400, step: 50, default: 1200 },
    { key: 'caption', label: '備註', type: 'text', default: '過去要整整一週' },
    { key: 'color', label: '語意色', type: 'semantic', default: 'accent' },
  ],
  component: NumberRoll,
}
