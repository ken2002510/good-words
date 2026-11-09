import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { OverlayJSON, CardInstance } from '../core/types'
import { clock } from '../core/clock'
import { registry, getEffect } from '../registry'

const IS_EXPORT =
  typeof location !== 'undefined' &&
  new URLSearchParams(location.search).has('export')

/* ==================== 1080x1920 直式舞台常數 ==================== */
export const STAGE_W = 1080
export const STAGE_H = 1920
const SIDE_MARGIN = 44          // 側邊距 90 -> 44px
const CARD_W_SCALE = 0.92       // 卡寬 x0.92（zoom 縮放，字級跟著縮；太小會被說「窗格太小」）
const CARD_SCALE_MIN = 0.5      // 高度塞不下時的下限（demo 段卡片才可能吃到）
// v12 版面重排：把畫面切成三段，互不侵犯
//   頂部 0..250    ：段頭板（tag＋標題）專用，卡片一律不得進入
//   內容 250..1370 ：卡片活動區（中心 810）
//   字幕 1370..1920：字幕＋收尾網址卡
const TOP_LIMIT = 250
const CENTER_Y = 810
const SUBTITLE_TOP = 1370
const SEG_LEFT = 48             // 段頭板移到左上
const SEG_TOP = 110

/** 影片底片層：cover 滿版 + 緩慢推鏡（Ken Burns），f(t) 驅動 */
function VideoLayer({ src }: { src: string | null }) {
  const ref = useRef<HTMLVideoElement>(null)
  useEffect(() => {
    const v = ref.current
    if (!v || !src) return
    v.play().catch(() => {})
    const unsub = clock.subscribe(() => {
      v.currentTime = Math.min(v.duration || 0, clock.t / 1000)
      if (clock.playing) v.pause()
    })
    return unsub
  }, [src])
  if (!src) {
    if (IS_EXPORT) return null
    return (
      <div style={{
        position: 'absolute', inset: 0, display: 'flex',
        alignItems: 'flex-end', justifyContent: 'center',
        background: 'linear-gradient(180deg, #171a21 0%, #101216 100%)',
      }}>
        <div style={{
          width: 420, height: 640, marginBottom: -80,
          borderRadius: '50% 50% 0 0',
          background: 'rgba(255,255,255,0.05)',
          border: '1px solid rgba(255,255,255,0.08)',
          borderBottom: 'none',
        }} />
      </div>
    )
  }
  return (
    <video
      ref={ref}
      src={src}
      muted
      playsInline
      style={{
        position: 'absolute', inset: 0, width: '100%', height: '100%',
        objectFit: 'cover',
        transform: `scale(${1.04 + 0.04 * Math.sin((clock.t / 1000) * 0.25)})`,
      }}
    />
  )
}

/** 段頭板：段落開場的標籤 + 標題（直式移到左上 left=48 top=110） */
function SegmentBoard({ seg, t }: { seg: any; t: number }) {
  const a = clamp01_(progP(t, seg.start, 500))
  const out = 1 - clamp01_((t - (seg.start + 2600)) / 400)
  const alpha = Math.min(a, out)
  if (alpha <= 0.001) return null
  return (
    <div style={{
      position: 'absolute', left: SEG_LEFT, top: SEG_TOP,
      opacity: alpha,
      transform: `translateY(${(1 - a) * 16}px)`,
      zIndex: 12,
    }}>
      <div style={{
        fontSize: 20, letterSpacing: 4, fontWeight: 600,
        color: `var(--c-${seg.color})`, marginBottom: 10,
      }}>
        {seg.tag ?? ''}
      </div>
      <div style={{
        fontSize: 52, fontWeight: 700, color: 'var(--c-text)',
        textShadow: '0 2px 18px rgba(0,0,0,0.45)',
      }}>
        {seg.title}
      </div>
      <div style={{
        marginTop: 12, width: 64, height: 3, borderRadius: 2,
        background: `var(--c-${seg.color})`,
      }} />
    </div>
  )
}

const clamp01_ = (x: number) => Math.max(0, Math.min(1, x))
const progP = (t: number, at: number, dur: number) => clamp01_((t - at) / Math.max(1, dur))

/**
 * 卡片插槽：直式定位。
 * - 水平：side 側邊距 44px，卡寬 = def.width，外層 zoom 0.56 → 實際卡寬 x0.56
 * - 垂直：置中 y=960 + offsetY，量到卡高後自動上移，避開底部字幕帶（bottom <= 1730）
 */
function CardSlot({ c, t }: { c: CardInstance; t: number }) {
  const def = getEffect(c.effect)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [avoid, setAvoid] = useState(0)
  const [scale, setScale] = useState(CARD_W_SCALE)
  if (!def) return null
  const Comp = def.component
  const width = c.width ?? def.width ?? 560
  const fullParams: Record<string, any> = {}
  for (const p of def.params) fullParams[p.key] = c.params?.[p.key] ?? p.default

  const visible = t >= c.start - 1 && t <= c.end + 300
  const measKey = `${c.effect}|${width}|${JSON.stringify(c.params)}|${visible ? 1 : 0}|${scale.toFixed(2)}`
  useLayoutEffect(() => {
    if (!visible) return
    const inner = wrapRef.current
    if (!inner) return
    const rect = inner.getBoundingClientRect()
    if (rect.height <= 0) return
    const innerH = rect.height / scale          // 未縮放高度
    const centerYraw = CENTER_Y + (c.offsetY ?? 0)
    // 高度自適應：卡片必須塞得進「上緣留白」與「字幕帶上方」之間。
    // demo 段卡片中心在 y=400（上方），這條限制會自動縮小過高的卡，不會切頂。
    const capH = Math.min(
      (SUBTITLE_TOP - TOP_LIMIT) / innerH,
      (2 * (centerYraw - TOP_LIMIT)) / innerH,
      (2 * (SUBTITLE_TOP - centerYraw)) / innerH,
    )
    const want = Math.max(CARD_SCALE_MIN, Math.min(CARD_W_SCALE, capH))
    if (Math.abs(want - scale) > 0.01) {
      setScale(want)
      return
    }
    // 位置微調（保險）：底部仍在字幕帶之上
    const bottom = centerYraw - avoid + (innerH * scale) / 2
    const over = bottom - SUBTITLE_TOP
    if (over > 0) setAvoid((a) => a + over)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [measKey])

  const centerY = CENTER_Y + (c.offsetY ?? 0) - avoid
  return (
    // 外層：定位用，不縮放（側邊距 44px、垂直置中 y=960 都是真實 px）
    <div
      style={{
        position: 'absolute',
        top: centerY,
        transform: 'translateY(-50%)',
        [c.side === 'left' ? 'left' : 'right']: SIDE_MARGIN,
        width: width * scale,
        zIndex: 10,
      }}
    >
      {/* 內層：zoom scale（預設 0.92）→ 卡寬 = def.width x scale，字級跟著縮。
          --card-origin 讓卡片縮放原點貼齊靠邊那一側（overshoot 不會外擴出安全區）。 */}
      <div
        ref={wrapRef}
        style={{
          width,
          zoom: scale,
          ['--card-origin' as any]: c.side === 'left' ? '0% 60%' : '100% 60%',
        }}
      >
        <Comp t={t} enterAt={c.start} exitAt={c.end} params={fullParams} />
      </div>
    </div>
  )
}

/**
 * 舞台：底片 → 卡片 → dim 遮罩 → 段頭板。
 * 1080x1920 直式固定座標系；導出時外殼透明。
 */
export function Stage({ doc, videoSrc }: { doc: OverlayJSON; videoSrc: string | null }) {
  const t = clock.t
  const theme = doc.theme === 'light' ? 'light' : 'dark'
  const styleName = doc.style ?? 'glass'

  const activeSegs = (doc.segs ?? []).filter(
    (s) => s.start != null && t >= (s.start ?? 0) && t <= (s.end ?? 0),
  )
  const dimSeg = activeSegs.find((s) => typeof s.dimAt === 'number')

  return (
    <div
      data-theme={theme}
      data-style={styleName}
      style={{
        width: STAGE_W, height: STAGE_H,
        position: 'relative', overflow: 'hidden',
        background: 'transparent',
        fontFamily: 'var(--font-display)',
      }}
    >
      {/* L0 底片 */}
      <VideoLayer src={videoSrc} />

      {/* L1 卡片層 */}
      {doc.cards.map((c: CardInstance) => (
        <CardSlot key={c.id} c={c} t={t} />
      ))}

      {/* L2 整段暗化遮罩（dimAt: demo 段 0.12，其餘 0.40） */}
      {dimSeg && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 8,
          background: '#000',
          opacity: clamp01_(progP(t, dimSeg.start ?? 0, 500)) *
            (dimSeg.dimAt ?? 0.4),
          pointerEvents: 'none',
        }} />
      )}

      {/* L3 段頭板 */}
      {activeSegs.map((s) => (
        <SegmentBoard key={s.id} seg={s} t={t} />
      ))}

      {void registry}
    </div>
  )
}
