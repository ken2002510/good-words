import type { FC, ReactNode } from 'react'
import { prog, clamp01, easeOutCubic, easeOutBack } from '../core/clock'

/** 卡片外殼：整體感來自容器。進出動畫一律由 t 驅動（鐵律 2） */
export const CardShell: FC<{
  t: number
  enterAt: number
  exitAt: number
  style?: React.CSSProperties
  children: ReactNode
}> = ({ t, enterAt, exitAt, style, children }) => {
  // v10：進場放慢（0.42/0.52s → 0.62/0.80s）。視覺審查反映「字卡過渡略顯生硬」，
  // 且使用者偏好「寧慢勿快」；淡出也從 260ms 放寬到 320ms。
  const a = clamp01(prog(t, enterAt, 620))
  const rise = (1 - easeOutCubic(prog(t, enterAt, 800))) * 22
  // 跳出（pop）：進場 800ms 內 scale 0.62→1 with overshoot（easeOutBack）
  const pop = easeOutBack(prog(t, enterAt, 800))
  const scale = 0.62 + 0.38 * pop
  const fade = 1 - clamp01((t - exitAt) / 320)
  const alpha = Math.min(a, fade)
  if (alpha <= 0.001) return null
  return (
    <div
      className="fx-card"
      style={{
        opacity: alpha,
        transform: `translateY(${rise}px) scale(${scale})`,
        ...style,
      }}
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
