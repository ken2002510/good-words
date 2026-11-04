// overlay-lint.mjs — 硬規則體檢（App 編輯器與 build/lint 共用）
// 硬規則：
//  1. effect 必須在目錄裡；params 的 key 必須在該卡 schema 內
//  2. 每卡 >= 2500ms
//  3. 同側相鄰卡間隙 >= 300ms；同一時刻同側最多 1 張
//  4. 顏色只用語意色（accent/data/support/special），params 禁十六進制字面值
//  5. params 禁用 speed/scale 保留字
//  6. 圖形類卡（number-roll/compare-bars/stat-board/progress-ring/timeline-milestones）占比 >= 50%

export const SEMANTIC_COLORS = ['accent', 'data', 'support', 'special']
export const GRAPHICAL = new Set([
  'number-roll', 'compare-bars', 'stat-board', 'progress-ring', 'timeline-milestones',
])
const RESERVED_PARAM_KEYS = new Set(['speed', 'scale'])
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/

export function lintOverlay(doc, catalog) {
  const issues = []
  const err = (msg, cardId) => issues.push({ level: 'error', msg, cardId })
  const warn = (msg, cardId) => issues.push({ level: 'warn', msg, cardId })

  if (!doc || typeof doc !== 'object') {
    err('doc 不是物件')
    return issues
  }
  if (doc.version !== 1) warn(`version=${doc.version}（預期 1）`)
  const catById = new Map((catalog ?? []).map((c) => [c.id, c]))

  const cards = Array.isArray(doc.cards) ? doc.cards : []
  if (cards.length === 0) err('cards 為空')

  // 逐卡檢查
  const seenIds = new Set()
  for (const c of cards) {
    if (seenIds.has(c.id)) err(`重複 id ${c.id}`, c.id)
    seenIds.add(c.id)
    const def = catById.get(c.effect)
    if (!def) { err(`effect 不在目錄: ${c.effect}`, c.id); continue }
    const dur = (c.end ?? 0) - (c.start ?? 0)
    if (dur < 2500) err(`每卡需 >=2500ms，此卡 ${dur}ms`, c.id)
    if (!(c.start >= 0)) err('start < 0', c.id)
    if (!['left', 'right'].includes(c.side)) err(`side 非法: ${c.side}`, c.id)
    const schemaKeys = new Set(def.params.map((p) => p.key))
    for (const [k, v] of Object.entries(c.params ?? {})) {
      if (!schemaKeys.has(k)) err(`參數 ${k} 不在 ${c.effect} 的 schema`, c.id)
      if (RESERVED_PARAM_KEYS.has(k)) err(`參數禁用保留字: ${k}`, c.id)
      if (typeof v === 'string' && HEX_RE.test(v)) err(`params 含十六進制色值: ${v}`, c.id)
      if (/color$/i.test(k) && !SEMANTIC_COLORS.includes(v)) {
        err(`語意色非法: ${k}=${v}（只准 accent/data/support/special）`, c.id)
      }
    }
  }

  // 同側規則
  for (const side of ['left', 'right']) {
    const same = cards
      .filter((c) => c.side === side)
      .sort((a, b) => a.start - b.start)
    for (let i = 0; i < same.length; i++) {
      for (let j = i + 1; j < same.length; j++) {
        const a = same[i], b = same[j]
        if (b.start >= a.end) break // b 在 a 之後不重疊
        err(`同側同時超過 1 張: ${a.id} 與 ${b.id} 重疊`, b.id)
      }
      if (i + 1 < same.length) {
        const gap = same[i + 1].start - same[i].end
        if (gap < 300) err(`同側相鄰間隙 ${gap}ms < 300ms: ${same[i].id} -> ${same[i + 1].id}`, same[i + 1].id)
      }
    }
  }

  // 圖形卡占比
  if (cards.length > 0) {
    const g = cards.filter((c) => GRAPHICAL.has(c.effect)).length
    const ratio = g / cards.length
    if (ratio < 0.5) err(`圖形類卡占比 ${(ratio * 100).toFixed(1)}% < 50%（${g}/${cards.length}）`)
  }

  // segs 檢查
  for (const s of doc.segs ?? []) {
    if (s.color && !SEMANTIC_COLORS.includes(s.color)) err(`seg ${s.id} 色非法: ${s.color}`, s.id)
    if (s.dimAt != null && (s.dimAt < 0 || s.dimAt > 1)) err(`seg ${s.id} dimAt 越界: ${s.dimAt}`, s.id)
  }

  return issues
}
