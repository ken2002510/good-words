import { memo } from 'react'
import { registry, getEffect, TRACK_COLORS, trackOf } from '../registry'

interface Props {
  cards: { id: string; start: number; effect: string; track?: string }[]
  selId: string | null
  onAdd: (effectId: string) => void
  onSelect: (id: string) => void
  onSeekPulse: (ms: number) => void
  onDel: (id: string) => void
}

/** 左欄：卡片庫 + 時間軸實例。與 t 無關 → 用 memo 隔離重繪（播放 tick 時跳過） */
export const CardLibrary = memo(function CardLibrary({ cards, selId, onAdd, onSelect, onSeekPulse, onDel }: Props) {
  return (
    <div className="left">
      <h3>卡片庫（點擊新增）</h3>
      {registry.map((e) => (
        <div key={e.id} className="lib-item" onClick={() => onAdd(e.id)}>
          <div className="nm">{e.name}</div>
          <div className="ds">{e.desc}</div>
        </div>
      ))}
      <h3>時間軸實例</h3>
      {[...cards].sort((a, b) => a.start - b.start).map((c) => (
        <div key={c.id} className={`inst-row ${selId === c.id ? 'sel' : ''}`} onClick={() => { onSelect(c.id); onSeekPulse(c.start + 600) }}>
          <span className="dot" style={{ background: TRACK_COLORS[trackOf(c)] }} />
          <span>{getEffect(c.effect)?.name ?? c.effect}</span>
          <span className="del" onClick={(e) => { e.stopPropagation(); onDel(c.id) }}>✕</span>
        </div>
      ))}
    </div>
  )
})