import type { FC, ReactNode } from 'react'
import { prog, clamp01, easeOutCubic } from '../core/clock'

/** 卡片外殼：整體感來自容器。進出動畫一律由 t 驅動（鐵律 2） */
export const CardShell: FC<{
  t: number
  enterAt: number
  exitAt: number
  style?: React.CSSProperties
  children: ReactNode
}> = ({ t, enterAt, exitAt, style, children }) => {
  const a = clamp01(prog(t, enterAt, 420))
  const rise = (1 - easeOutCubic(prog(t, enterAt, 520))) * 22
  const fade = 1 - clamp01((t - exitAt) / 260)
  const alpha = Math.min(a, fade)
  if (alpha <= 0.001) return null
  return (
    <div
      className="fx-card"
      style={{ opacity: alpha, transform: `translateY(${rise}px)`, ...style }}
    >
      {children}
    </div>
  )
}

/** 卡片標題：細線 + 小字 */
export const CardTitle: FC<{ text?: string }> = ({ text }) => {
  if (!text) return null
  return <div className="fx-title">{text}</div>
}
