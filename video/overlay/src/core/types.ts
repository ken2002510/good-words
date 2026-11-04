/* ============ 核心型別定義 ============ */

/** 語意色 —— 卡片只能引用這四種，禁止自由色值（鐵律 3） */
export type SemanticColor = 'accent' | 'data' | 'support' | 'special'

export type ThemeName = 'dark' | 'light'
export type StyleName = 'glass' | 'flat'
export type SideName = 'left' | 'right'
export type TrackName = 'main' | 'data' | 'support'

/** 參數欄位定義（右欄面板依此自動生成） */
export interface ParamDef {
  key: string
  label: string
  type: 'text' | 'textarea' | 'number' | 'range' | 'boolean' | 'semantic'
  default?: any
  min?: number
  max?: number
  step?: number
}

/** 動效卡定義：組件 + 參數 Schema + 預設位置 */
export interface EffectDef {
  id: string
  name: string
  category: string
  desc: string
  side: SideName
  width?: number
  track?: TrackName
  params: ParamDef[]
  component: React.FC<any>
}

/** 時間軸上的一張卡實例 */
export interface CardInstance {
  id: string
  effect: string
  start: number // ms
  end: number   // ms
  side: SideName
  offsetY?: number
  width?: number
  track?: TrackName
  seg?: string
  params: Record<string, any>
}

/** 段落場景：段頭板 + 可選整段暗化 */
export interface Segment {
  id: string
  title: string
  tag?: string
  color: SemanticColor
  start: number
  end: number
  dimAt?: number
}

/** 編排 JSON 根物件（L2 大腦的輸出格式） */
export interface OverlayJSON {
  version: number
  theme: ThemeName
  style?: StyleName
  font?: string
  skin?: string
  segs?: Segment[]
  cards: CardInstance[]
}

/** lint 診斷結果 */
export interface LintIssue {
  level: 'error' | 'warn'
  msg: string
  cardId?: string
}
