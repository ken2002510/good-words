/* ============ 全域虛擬時鐘 ============
 * 所有動畫一律是 f(t)：預覽用 rAF 推進 t；導出用 seek(t) 逐幀定格。
 * 禁 setInterval（鐵律 2）。同一份編排在預覽與導出中逐幀一致。
 */

type Listener = () => void

class VirtualClock {
  private _t = 0
  private _playing = false
  private _lastReal = 0
  private _raf = 0
  private listeners = new Set<Listener>()
  /** 時間軸總長（ms），由 App 依內容計算 */
  duration = 30000
  /** 導出模式：rAF 不推進，一切由 seek() 驅動 */
  exportMode = false

  get t(): number {
    return this._t
  }

  get playing(): boolean {
    return this._playing
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn)
    if (!this.exportMode) this._ensureRaf()
    return () => this.listeners.delete(fn)
  }

  play(): void {
    if (this.exportMode || this._playing) return
    this._playing = true
    this._lastReal = performance.now()
    this._ensureRaf()
  }

  pause(): void {
    this._playing = false
  }

  toggle(): void {
    if (this._playing) this.pause()
    else this.play()
  }

  seek(ms: number): void {
    this._t = Math.max(0, Math.min(this.duration, ms))
    this._emit()
  }

  /** 導出腳本逐幀呼叫：強制定格並通知渲染 */
  seekExport(ms: number): void {
    this._t = ms
    this._emit()
  }

  private _emit(): void {
    for (const fn of this.listeners) fn()
  }

  private _ensureRaf(): void {
    if (this._raf || this.exportMode) return
    const loop = (now: number) => {
      const dt = now - this._lastReal
      this._lastReal = now
      if (this._playing) {
        this._t += dt
        if (this._t >= this.duration) {
          this._t = this.duration
          this._playing = false
        }
        this._emit()
      }
      this._raf = requestAnimationFrame(loop)
    }
    this._raf = requestAnimationFrame(loop)
  }
}

export const clock = new VirtualClock()

/* ---- f(t) 工具函式（卡片只准用這些驅動動畫） ---- */

export const clamp01 = (x: number): number => Math.max(0, Math.min(1, x))

/** 區間進度：t 從 at 開始、dur 內由 0→1 */
export const prog = (t: number, at: number, dur: number): number =>
  clamp01((t - at) / Math.max(1, dur))

export const easeOutCubic = (p: number): number => 1 - Math.pow(1 - clamp01(p), 3)

export const easeOutExpo = (p: number): number =>
  p >= 1 ? 1 : 1 - Math.pow(2, -10 * clamp01(p))

/** 數字滾動：at 起 dur 內從 0 滾到 target */
export const countUp = (t: number, at: number, target: number, dur = 1200): number =>
  target * easeOutExpo(prog(t, at, dur))

/** 出場淡出：exitAt 前為 1，之後 260ms 內降到 0 */
export const outFade = (t: number, exitAt: number): number =>
  1 - clamp01((t - exitAt) / 260)
