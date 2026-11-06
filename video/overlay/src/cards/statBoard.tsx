import { CardShell, CardTitle } from './parts'
import { countUp, outFade, clamp01, prog } from '../core/clock'
import type { EffectDef } from '../core/types'

/** 數據面板：最多四格「標籤:數值」 */
function StatBoard({ t, enterAt, exitAt, params }: any) {
  const rows = String(params.stats ?? '').split('\n').map((r) => r.split(':')).filter((p) => p.length >= 2)
  const fade = outFade(t, exitAt)
  return (
    <CardShell t={t} enterAt={enterAt} exitAt={exitAt}>
      <CardTitle text={params.title} />
      <div style={{
        display: 'grid',
        gridTemplateColumns: rows.length > 2 ? '1fr 1fr' : '1fr',
        gap: 18,
      }}>
        {rows.slice(0, 4).map(([label, val], i) => {
          const numStr = (val ?? '').trim()
          const m = numStr.match(/^([^\d]*)([\d.]+)(.*)$/)
          const pre = m ? m[1] : ''
          const num = m ? parseFloat(m[2]) : 0
          const suf = m ? m[3] : numStr
          const dec = m && m[2].includes('.') ? m[2].split('.')[1].length : 0
          const a = clamp01(prog(t, enterAt + i * 160, 420)) * fade
          return (
            <div key={i} style={{
              opacity: a,
              transform: `translateY(${(1 - a / Math.max(fade, 0.0001)) * 14}px)`,
              border: '1px solid var(--card-line)',
              borderRadius: 16,
              padding: '16px 20px',
            }}>
              <div style={{ fontSize: 22, color: 'var(--c-muted)', marginBottom: 6 }}>{label}</div>
              <div className="fx-num" style={{ fontSize: 60, fontWeight: 700, color: `var(--c-${params.color})` }}>
                {pre}{m ? countUp(t, enterAt + i * 160, num, 1100).toFixed(dec) : ''}{suf}
              </div>
            </div>
          )
        })}
      </div>
    </CardShell>
  )
}

export const statBoard: EffectDef = {
  id: 'stat-board',
  name: '四格數據板',
  category: '數據',
  desc: '最多四個「標籤:數值」格子，數字依次滾動點亮',
  side: 'right',
  track: 'data',
  width: 700,
  params: [
    { key: 'title', label: '標題', type: 'text', default: '生產線成績' },
    { key: 'stats', label: '數據（每行 標籤:數值）', type: 'textarea', default: '出片耗時:3小時\n返工率:9%\n卡片復用:87%\ntoken成本:¥0.4' },
    { key: 'color', label: '語意色', type: 'semantic', default: 'data' },
  ],
  component: StatBoard,
}
