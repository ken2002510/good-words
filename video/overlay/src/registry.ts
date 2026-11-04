import type { EffectDef, TrackName } from './core/types'
import { numberRoll } from './cards/numberRoll'
import { compareBars } from './cards/compareBars'
import { quoteReveal } from './cards/quoteReveal'
import { statBoard } from './cards/statBoard'
import { progressRing } from './cards/progressRing'
import { keywordMatrix } from './cards/keywordMatrix'
import { timelineMilestones } from './cards/timelineMilestones'
import { stepChecklist } from './cards/stepChecklist'
import { bigStatement } from './cards/bigStatement'
import { segmentBoard } from './cards/segmentBoard'

/** 卡片註冊表 —— 唯一清單，目錄與 lint 都從這裡自動生成 */
export const registry: EffectDef[] = [
  numberRoll,
  compareBars,
  quoteReveal,
  statBoard,
  progressRing,
  keywordMatrix,
  timelineMilestones,
  stepChecklist,
  bigStatement,
  segmentBoard,
]

export const getEffect = (id: string): EffectDef | undefined =>
  registry.find((e) => e.id === id)

/** NLE 時間軸的三條軌道（由上到下） */
export const TRACKS: { id: TrackName; label: string }[] = [
  { id: 'main', label: '主視覺' },
  { id: 'data', label: '數據' },
  { id: 'support', label: '輔助' },
]

/** 軌道配色（時間軸塊的邊框/文字用） */
export const TRACK_COLORS: Record<TrackName, string> = {
  main: '#e88ab8',
  data: '#5ec9a0',
  support: '#7aa7e8',
}

/** 卡實例歸屬軌道：優先用實例上的 track，否則用卡定義預設 */
export const trackOf = (c: any): TrackName => {
  if (c.track && TRACKS.some((t) => t.id === c.track)) return c.track
  return getEffect(c.effect)?.track ?? 'support'
}
