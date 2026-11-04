import { useEffect, useMemo, useState, useRef, useCallback } from 'react'
import { clock } from './core/clock'
import type { OverlayJSON, CardInstance, SemanticColor } from './core/types'
import { registry, getEffect, TRACKS, TRACK_COLORS, trackOf } from './registry'
import { Stage } from './stage/Stage'
import { lintOverlay } from '../scripts/overlay-lint.mjs'
import embeddedDoc from './overlay.json'

/* ==================== 內建範例編排 ==================== */
const DEFAULT_DOC: OverlayJSON = {
  version: 1,
  theme: 'dark',
  style: 'glass',
  segs: [
    { id: 'seg-1', title: '為什麼重做一條生產線', tag: 'WHY REBUILD', color: 'accent', start: 400, end: 4300, dimAt: 0.45 },
    { id: 'seg-2', title: '新流程長什麼樣', tag: 'NEW PIPELINE', color: 'data', start: 27400, end: 31200 },
  ],
  cards: [
    { id: 'c1', effect: 'number-roll', start: 5100, end: 10600, side: 'left', track: 'data', params: {} },
    { id: 'c2', effect: 'compare-bars', start: 11400, end: 16600, side: 'right', track: 'data', params: {} },
    { id: 'c3', effect: 'quote-reveal', start: 27800, end: 31100, side: 'left', track: 'main', offsetY: -40, params: {} },
    { id: 'c4', effect: 'progress-ring', start: 17400, end: 22600, side: 'right', track: 'data', params: {} },
    { id: 'c5', effect: 'keyword-matrix', start: 18000, end: 23200, side: 'left', track: 'support', params: {} },
  ],
}

const fmtTC = (ms: number) => {
  const m = Math.floor(ms / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  const cs = Math.floor((ms % 1000) / 10)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

const IS_EXPORT = typeof location !== 'undefined' && new URLSearchParams(location.search).has('export')

/* 導出模式：rAF 不自動推進，一切由 seekExport(t) 逐幀驅動 */
if (IS_EXPORT) clock.exportMode = true

/** 每次時鐘跳動重繪 */
function useClockTick(): number {
  const [, force] = useState(0)
  useEffect(() => clock.subscribe(() => force((x) => x + 1)), [])
  return clock.t
}

export default function App() {
  const [doc, setDoc] = useState<OverlayJSON>(() => {
    if (IS_EXPORT) return embeddedDoc as OverlayJSON
    try {
      const raw = localStorage.getItem('overlay-doc')
      if (raw) return JSON.parse(raw)
    } catch { }
    return DEFAULT_DOC
  })
  const [selId, setSelId] = useState<string | null>(null)
  const [playing, setPlaying] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [videoSrc, setVideoSrc] = useState<string | null>(null)
  const [jsonOpen, setJsonOpen] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [jsonMsg, setJsonMsg] = useState('')
  /** SRT 底層區塊 [{start,end,text}]，由導入字幕填充（持久化，重開仍在） */
  const [srtBlocks, setSrtBlocks] = useState<{ start: number; end: number; text: string }[]>(() => {
    try {
      const raw = localStorage.getItem('overlay-srt')
      if (raw) return JSON.parse(raw)
    } catch { }
    return []
  })
  /** 磁吸輔助線位置（ms），拖拽中顯示 */
  const [snapGuide, setSnapGuide] = useState<number | null>(null)
  const t = useClockTick()

  /* ---------- 時鐘總長隨內容更新 ---------- */
  useEffect(() => {
    clock.duration = Math.max(30000, ...doc.cards.map((c) => c.end), ...(doc.segs ?? []).map((s) => s.end ?? 0))
  }, [doc])

  useEffect(() => {
    if (IS_EXPORT) return
    localStorage.setItem('overlay-doc', JSON.stringify(doc))
  }, [doc])

  useEffect(() => {
    if (IS_EXPORT) return
    // 空層不覆寫：避免掛載競態清掉外部種入的字幕（evaluateOnNewDocument 場景）
    if (srtBlocks.length > 0) localStorage.setItem('overlay-srt', JSON.stringify(srtBlocks))
  }, [srtBlocks])

  /* ---------- 導出 API 掛點 ---------- */
  useEffect(() => {
    ;(window as any).__overlayAPI = { clock, getDoc: () => doc, ready: true }
    if (IS_EXPORT) {
      document.title = 'OVERLAY_EXPORT_READY'
      document.body.style.background = 'transparent'
      document.documentElement.style.background = 'transparent'
    }
  }, [doc])

  /* ---------- 快捷鍵：空白鍵 播放/暫停 ---------- */
  useEffect(() => {
    if (IS_EXPORT) return
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.code === 'Space') {
        e.preventDefault()
        clock.toggle()
        setPlaying(clock.playing)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const sel = doc.cards.find((c) => c.id === selId)
  const selDef = sel ? getEffect(sel.effect) : undefined

  const issues = useMemo(() => {
    const catalog = registry.map((e) => ({ id: e.id, name: e.name, params: e.params.map((p) => p.key) }))
    return lintOverlay(doc as any, catalog)
  }, [doc])

  /* ---------- 檔案導入 ---------- */
  const pickVideo = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = 'video/*'
    inp.onchange = () => { const f = inp.files?.[0]; if (f) setVideoSrc(URL.createObjectURL(f)) }
    inp.click()
  }
  const importJson = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = '.json,application/json'
    inp.onchange = () => {
      const f = inp.files?.[0]; if (!f) return
      f.text().then((txt) => {
        try {
          const d = JSON.parse(txt)
          setDoc(d); setSelId(null); setJsonMsg(`已導入 ${f.name}`)
        } catch (e: any) { setJsonMsg('JSON 解析失敗：' + e.message) }
      })
    }
    inp.click()
  }
  const importSrt = () => {
    const inp = document.createElement('input')
    inp.type = 'file'; inp.accept = '.srt'
    inp.onchange = () => {
      const f = inp.files?.[0]; if (!f) return
      f.text().then((txt) => {
        const blocks: { start: number; end: number; text: string }[] = []
        const re = /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})([\s\S]*?)(?=\n\n|\n\d+\n|$)/g
        let m: RegExpExecArray | null
        while ((m = re.exec(txt))) {
          const start = +m[1] * 3600000 + +m[2] * 60000 + +m[3] * 1000 + +m[4]
          const end = +m[5] * 3600000 + +m[6] * 60000 + +m[7] * 1000 + +m[8]
          const text = m[9].trim().replace(/\n/g, ' ')
          if (text) blocks.push({ start, end, text })
        }
        setSrtBlocks(blocks)
        setJsonMsg(`已載入 ${blocks.length} 條字幕`)
      })
    }
    inp.click()
  }

  /* ---------- 文檔操作 ---------- */
  const setParam = (key: string, v: any) => {
    if (!sel) return
    setDoc((d) => ({ ...d, cards: d.cards.map((c) => (c.id === sel.id ? { ...c, params: { ...c.params, [key]: v } } : c)) }))
  }
  const patchSel = (patch: Partial<CardInstance>) => {
    if (!sel) return
    setDoc((d) => ({ ...d, cards: d.cards.map((c) => (c.id === sel.id ? { ...c, ...patch } : c)) }))
  }
  const addCard = (effectId: string) => {
    const def = getEffect(effectId)!
    const nc: CardInstance = {
      id: 'c' + Date.now().toString(36),
      effect: effectId,
      start: Math.round(t),
      end: Math.round(Math.min(clock.duration, t + 5000)),
      side: def.side,
      track: def.track,
      params: {},
    }
    setDoc((d) => ({ ...d, cards: [...d.cards, nc] }))
    setSelId(nc.id)
  }
  const delCard = (id: string) => {
    setDoc((d) => ({ ...d, cards: d.cards.filter((c) => c.id !== id) }))
    if (selId === id) setSelId(null)
  }

  const exportJSONModal = () => { setJsonText(JSON.stringify(doc, null, 2)); setJsonOpen(true); setJsonMsg('') }
  const applyJSON = () => {
    try { setDoc(JSON.parse(jsonText)); setJsonOpen(false) }
    catch (e: any) { setJsonMsg('解析失敗：' + e.message) }
  }

  /* ============================================================
     NLE 時間軸：px ↔ ms 映射 · 拖拽狀態機 · 磁吸
     ============================================================ */
  const PX_PER_SEC = 60 // 水平比例：每秒 60px，可加縮放
  const msToPx = useCallback((ms: number) => (ms / 1000) * PX_PER_SEC, [])
  const pxToMs = useCallback((px: number) => Math.round((px / PX_PER_SEC) * 1000), [])

  /** 磁吸候選點：SRT 邊界 → 其他卡邊界 → 整秒刻度 */
  const snapPoints = useMemo(() => {
    const pts: number[] = []
    for (const b of srtBlocks) { pts.push(b.start, b.end) }
    for (const c of doc.cards) {
      if (c.id === selId) continue
      pts.push(c.start, c.end)
    }
    for (let s = 0; s <= clock.duration; s += 1000) pts.push(s)
    return pts
  }, [srtBlocks, doc.cards, selId])

  const SNAP_MS = 80
  const applySnap = useCallback((ms: number): number => {
    let best = ms, bestD = SNAP_MS + 1
    for (const p of snapPoints) {
      const d = Math.abs(p - ms)
      if (d < bestD) { bestD = d; best = p }
    }
    return bestD <= SNAP_MS ? best : ms
  }, [snapPoints])

  /** 拖拽狀態機 ref（避免每次 render 重綁事件） */
  const dragRef = useRef<{
    mode: 'move' | 'l' | 'r'
    cardId: string
    startX: number
    origStart: number
    origEnd: number
  } | null>(null)

  const onBlockMouseDown = (e: React.MouseEvent, mode: 'move' | 'l' | 'r', card: CardInstance) => {
    e.stopPropagation()
    e.preventDefault()
    setSelId(card.id)
    dragRef.current = { mode, cardId: card.id, startX: e.clientX, origStart: card.start, origEnd: card.end }
    const onMove = (ev: MouseEvent) => {
      const dg = dragRef.current
      if (!dg) return
      const dt = pxToMs(ev.clientX - dg.startX)
      // 純函式先算好新位置與輔助線，再寫回 state（避免閉包讀到舊狀態）
      let guide: number | null = null
      let patch: Partial<CardInstance> | null = null
      if (dg.mode === 'move') {
        const rawS = dg.origStart + dt
        const ns = applySnap(rawS)
        if (ns !== rawS && ns % 1000 !== 0) guide = ns
        const shift = ns - dg.origStart
        patch = { start: ns, end: Math.max(ns + 300, dg.origEnd + shift) }
      } else if (dg.mode === 'l') {
        const rawS = dg.origStart + dt
        const ns = Math.max(0, Math.min(applySnap(rawS), dg.origEnd - 300))
        if (ns !== rawS && ns % 1000 !== 0) guide = ns
        patch = { start: ns }
      } else {
        const rawE = dg.origEnd + dt
        const ne = Math.max(applySnap(rawE), dg.origStart + 300)
        if (ne !== rawE && ne % 1000 !== 0) guide = ne
        patch = { end: ne }
      }
      setSnapGuide(guide)
      setDoc((d) => ({
        ...d,
        cards: d.cards.map((c) => (c.id === dg.cardId ? { ...c, ...patch! } : c)),
      }))
    }
    const onUp = () => {
      dragRef.current = null
      setSnapGuide(null)
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const tlScrollRef = useRef<HTMLDivElement>(null)
  /** 點標尺/空白處 seek；點卡片塊由 block 自己 stopPropagation */
  const tlSeek = (e: React.MouseEvent) => {
    const el = tlScrollRef.current!
    const rect = el.getBoundingClientRect()
    const x = e.clientX - rect.left + el.scrollLeft
    clock.seek(pxToMs(x))
  }

  /* ---------- 導出模式：只渲染舞台 ---------- */
  if (IS_EXPORT) {
    return (
      <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'transparent', overflow: 'hidden' }}>
        <Stage doc={doc} videoSrc={null} />
      </div>
    )
  }

  const tlWidth = msToPx(clock.duration)

  return (
    <div className="app" data-theme="dark">
      {/* ===== 頂欄 ===== */}
      <div className="topbar">
        <div className="logo">OVERLAY STUDIO</div>
        <button className="btn small" onClick={() => setDoc({ ...doc, theme: doc.theme === 'dark' ? 'light' : 'dark' })}>
          {doc.theme === 'dark' ? '🌙 暗底' : '☀️ 亮底'}
        </button>
        <select className="btn small" value={doc.style ?? 'glass'} onChange={(e) => setDoc({ ...doc, style: e.target.value as any })}>
          <option value="glass">骨架 · 毛玻璃</option>
          <option value="flat">骨架 · 素面板</option>
        </select>
        <button className="btn small" onClick={pickVideo}>導入影片底片</button>
        <button className="btn small" onClick={importSrt}>載入 SRT 字幕</button>
        <label className="btn small" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          縮放 {zoom.toFixed(2)}
          <input type="range" min={1} max={2} step={0.05} value={zoom} style={{ width: 90 }} onChange={(e) => setZoom(Number(e.target.value))} />
        </label>
        <div className="spacer" />
        <input className="scrub" type="range" min={0} max={clock.duration} step={10}
          value={Math.min(t, clock.duration)} onChange={(e) => clock.seek(Number(e.target.value))} />
        <div className="timecode">{fmtTC(t)} / {fmtTC(clock.duration)}</div>
        <button className="btn primary" onClick={() => { clock.toggle(); setPlaying(clock.playing) }}>
          {playing ? '⏸ 暫停' : '▶ 播放'}
        </button>
        <button className="btn" onClick={exportJSONModal}>編排 JSON</button>
        <button className="btn" onClick={importJson}>導入 JSON</button>
        <button className="btn" title="npm run export" onClick={() => alert('導出請用終端機：\nnpm run export -- --json overlay.json --out renders/')}>導出 MOV</button>
      </div>

      {/* ===== 左欄 ===== */}
      <div className="left">
        <h3>卡片庫（點擊新增）</h3>
        {registry.map((e) => (
          <div key={e.id} className="lib-item" onClick={() => addCard(e.id)}>
            <div className="nm">{e.name}</div>
            <div className="ds">{e.desc}</div>
          </div>
        ))}
        <h3>時間軸實例</h3>
        {[...doc.cards].sort((a, b) => a.start - b.start).map((c) => (
          <div key={c.id} className={`inst-row ${selId === c.id ? 'sel' : ''}`} onClick={() => { setSelId(c.id); clock.seek(c.start + 600) }}>
            <span className="dot" style={{ background: TRACK_COLORS[trackOf(c)] }} />
            <span>{getEffect(c.effect)?.name ?? c.effect}</span>
            <span className="del" onClick={(e) => { e.stopPropagation(); delCard(c.id) }}>✕</span>
          </div>
        ))}
      </div>

      {/* ===== 中央舞台 ===== */}
      <div className="stage-wrap">
        <div className="stage-scaler" style={{ transform: `scale(${Math.min(1, zoom * ((window.innerHeight - 330) / 1080))})` }}>
          <Stage doc={doc} videoSrc={videoSrc} />
        </div>
      </div>

      {/* ===== 右欄參數面板 ===== */}
      <div className="right">
        <h3>參數 {sel ? `· ${getEffect(sel.effect)?.name}` : '（先選中一張卡）'}</h3>
        {sel && selDef && (
          <>
            {selDef.params.map((f) => {
              const val = sel.params[f.key] ?? f.default
              if (f.type === 'text') return (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input type="text" value={String(val)} onChange={(e) => setParam(f.key, e.target.value)} />
                </div>
              )
              if (f.type === 'textarea') return (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <textarea value={String(val)} onChange={(e) => setParam(f.key, e.target.value)} />
                </div>
              )
              if (f.type === 'number') return (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input type="number" value={Number(val)} onChange={(e) => setParam(f.key, Number(e.target.value))} />
                </div>
              )
              if (f.type === 'range') return (
                <div className="field" key={f.key}>
                  <label>{f.label} <span className="val">{val}</span></label>
                  <input type="range" min={f.min} max={f.max} step={f.step} value={Number(val)} onChange={(e) => setParam(f.key, Number(e.target.value))} />
                </div>
              )
              if (f.type === 'boolean') return (
                <div className="field" key={f.key}>
                  <label>{f.label}</label>
                  <input type="checkbox" checked={Boolean(val)} onChange={(e) => setParam(f.key, e.target.checked)} />
                </div>
              )
              if (f.type === 'semantic') {
                const colors: SemanticColor[] = ['accent', 'data', 'support', 'special']
                return (
                  <div className="field" key={f.key}>
                    <label>{f.label}</label>
                    <div className="swatches">
                      {colors.map((cc) => (
                        <div key={cc} className={`swatch ${val === cc ? 'on' : ''}`} onClick={() => setParam(f.key, cc)}>
                          <span className="c" style={{ background: `var(--c-${cc})` }} />{cc}
                        </div>
                      ))}
                    </div>
                  </div>
                )
              }
              return null
            })}
            <hr style={{ borderColor: 'var(--ui-border)', margin: '14px 0' }} />
            <div className="field"><label>側邊</label>
              <select value={sel.side} onChange={(e) => patchSel({ side: e.target.value as any })}>
                <option value="left">左側</option>
                <option value="right">右側</option>
              </select>
            </div>
            <div className="field"><label>軌道</label>
              <select value={trackOf(sel)} onChange={(e) => patchSel({ track: e.target.value as any })}>
                {TRACKS.map((tr) => <option key={tr.id} value={tr.id}>{tr.label}</option>)}
              </select>
            </div>
            <div className="field"><label>開始 (ms)</label>
              <input type="number" value={sel.start} onChange={(e) => patchSel({ start: Number(e.target.value) })} />
            </div>
            <div className="field"><label>結束 (ms)</label>
              <input type="number" value={sel.end} onChange={(e) => patchSel({ end: Number(e.target.value) })} />
            </div>
            <div className="field"><label>垂直偏移 (px)</label>
              <input type="range" min={-320} max={320} value={sel.offsetY ?? 0} onChange={(e) => patchSel({ offsetY: Number(e.target.value) })} />
            </div>
            <div className="field"><label>寬度</label>
              <input type="range" min={360} max={900} value={sel.width ?? selDef.width ?? 560} onChange={(e) => patchSel({ width: Number(e.target.value) })} />
            </div>
            <div className="field"><label>段落分組</label>
              <select value={sel.seg ?? ''} onChange={(e) => patchSel({ seg: e.target.value || undefined })}>
                <option value="">無</option>
                {(doc.segs ?? []).map((s) => <option key={s.id} value={s.id}>{s.title}</option>)}
              </select>
            </div>
          </>
        )}
        {!sel && (
          <div style={{ fontSize: 12, color: 'var(--ui-muted)', lineHeight: 1.8 }}>
            從左欄新增卡片；在時間軸上直接拖拽塊體與邊緣即可改時間。<br />
            鐵律：動畫只用 CSS transition + rAF，禁 setInterval / 真隨機。
          </div>
        )}
        {issues.length > 0 && (
          <div style={{ marginTop: 16 }}>
            <h3>Lint 體檢（{issues.length}）</h3>
            {issues.slice(0, 8).map((is: any, i: number) => (
              <div key={i} style={{ fontSize: 11, color: is.level === 'error' ? '#ff8f8f' : '#e6b45c', marginBottom: 4 }}>
                [{is.level}] {is.msg}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== NLE 時間軸 ===== */}
      <div className="timeline">
        <div className="tl-head">
          <b>時間軸</b>
          <span>拖塊移動 · 拖邊緣伸縮 · 靠近字幕/其他卡自動磁吸</span>
          <span style={{ marginLeft: 'auto' }}>主視覺 / 數據 / 輔助 三軌道</span>
        </div>
        <div className="tl-scroll" ref={tlScrollRef}>
          <div className="tl-canvas" style={{ width: Math.max(tlWidth, window.innerWidth) }} onMouseDown={tlSeek}>
            {/* 標尺 */}
            <div className="tl-ruler">
              {Array.from({ length: Math.floor(clock.duration / 1000) + 1 }).map((_, i) => (
                <div key={i} style={{
                  position: 'absolute', left: msToPx(i * 1000), top: 0,
                  fontSize: 9, color: 'var(--ui-muted)', paddingLeft: 4,
                  borderLeft: '1px solid var(--ui-border)', height: '100%',
                }}>{i}s</div>
              ))}
            </div>

            {/* SRT 字幕底層 */}
            {srtBlocks.length > 0 && (
              <div className="tl-srtrow">
                {srtBlocks.map((b, i) => (
                  <div key={i} className="tl-srt"
                    style={{ left: msToPx(b.start), width: Math.max(msToPx(b.end - b.start), 14) }}
                    title={`${fmtTC(b.start)} ${b.text}`}>
                    <span>{b.text}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 三軌道 */}
            {TRACKS.map((tr) => (
              <div key={tr.id} className="tl-track" style={{ height: 44 }}>
                <span className="tl-track-label">{tr.label}</span>
                {doc.cards.filter((c) => trackOf(c) === tr.id).map((c) => {
                  const isSel = selId === c.id
                  return (
                    <div key={c.id}
                      className={`tl-block ${isSel ? 'sel' : ''}`}
                      style={{
                        left: msToPx(c.start),
                        width: Math.max(msToPx(c.end - c.start), 30),
                        borderLeft: `3px solid ${TRACK_COLORS[trackOf(c)]}`,
                      }}
                      onMouseDown={(e) => onBlockMouseDown(e, 'move', c)}
                      title={`${getEffect(c.effect)?.name} ${fmtTC(c.start)}→${fmtTC(c.end)}`}>
                      <div className="lbl">{getEffect(c.effect)?.name}</div>
                      <div className="tl-handle l" onMouseDown={(e) => onBlockMouseDown(e, 'l', c)} />
                      <div className="tl-handle r" onMouseDown={(e) => onBlockMouseDown(e, 'r', c)} />
                    </div>
                  )
                })}
              </div>
            ))}

            {/* 磁吸輔助線 */}
            {snapGuide != null && (
              <div className="tl-guide" style={{ left: msToPx(snapGuide) }} />
            )}

            {/* 播放頭 */}
            <div className="tl-playhead" style={{ left: msToPx(t) }} />
          </div>
        </div>
      </div>

      {/* ===== JSON 模態框 ===== */}
      {jsonOpen && (
        <div className="modal-mask" onClick={() => setJsonOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div style={{ fontWeight: 650 }}>編排 JSON {jsonMsg && <span style={{ color: 'var(--ui-muted)', fontWeight: 400 }}>· {jsonMsg}</span>}</div>
            <textarea value={jsonText} onChange={(e) => setJsonText(e.target.value)} />
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn" onClick={() => navigator.clipboard.writeText(jsonText)}>複製</button>
              <button className="btn primary" onClick={applyJSON}>套用修改</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
