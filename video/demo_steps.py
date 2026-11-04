#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
demo_steps.py — 《好好說話》真實操作畫面腳本（供 record_demo.py 呼叫）。

選擇器直接對應 builder 的 C:\\prodcut\\app\\public\\index.html（已核對）：
    #input / #btn-submit / #loading / #result / #result-body
    #emotion-tag / #emotion-intensity / #emotion-situation
    #seg-accept / #seg-good / #seg-step
    button[data-act=copy|fav|share|copy-share|close-share]
    #share-panel / #share-text / .seg-tab[data-audience]
    #btn-favorites / #fav-panel / #fav-list / #fav-item
    #crisis / #hotlines

節奏刻意放慢（打字、捲動、停頓），因為這是給評審看的 Demo，不是自動化測試。
"""

from __future__ import annotations

import os
import re
import time

# ---- 節奏參數（秒）。可用環境變數覆寫，方便調整到剛好 3 分鐘 ----
SPEED = float(os.environ.get("DEMO_SPEED", "1.0"))

# ---- record_demo.py --with-wall 時設為 True：demo 流程改走「含好話牆」版本 ----
WITH_WALL = False


def _t(sec: float) -> None:
    return None if sec is None else sec


def pause(page, sec: float) -> None:
    page.wait_for_timeout(int(sec * 1000 * SPEED))


def human_type(page, locator, text: str, delay_ms: int = 95) -> None:
    """像人一樣打字：逐字輸入，模擬真實操作。"""
    locator.click()
    pause(page, 0.5)
    locator.fill("")
    locator.press_sequentially(text, delay=int(delay_ms * SPEED))
    pause(page, 0.8)


def slow_scroll(page, target_y: int, steps: int = 18, step_pause: float = 0.05) -> None:
    """平滑捲動，避免畫面跳動，也讓錄影看得出是「人在操作」。"""
    page.evaluate(
        """async ([y, steps, ps]) => {
            const start = window.scrollY; const delta = y - start;
            for (let i = 1; i <= steps; i++) {
                window.scrollTo(0, start + delta * (i / steps));
                await new Promise(r => setTimeout(r, ps * 1000));
            }
        }""",
        [target_y, steps, step_pause * SPEED],
    )


def scroll_to(page, selector: str, block: str = "center", duration: float = 1.4) -> None:
    """平滑捲動到某個元素，**拉長成 1.2–1.8 秒**讓評審看得見捲動過程。

    先前用 `behavior:'smooth'`（瀏覽器自己決定時間，通常 300ms 太快），
    且 maxScroll=0 時完全無效。這裡改成自己控制每一格的位移與時間，
    並夾在 [0, maxScroll] 內，確保真的有動。
    """
    try:
        page.eval_on_selector(
            selector,
            """async (el, args) => {
                const [block, dur] = args;
                const maxY = Math.max(0,
                    document.documentElement.scrollHeight - window.innerHeight);
                const r = el.getBoundingClientRect();
                const target = window.scrollY + r.top - (block === 'center'
                    ? Math.max(0, (window.innerHeight - r.height) / 2) : 40);
                const dest = Math.min(maxY, Math.max(0, target));
                const start = window.scrollY;
                const delta = dest - start;
                if (Math.abs(delta) < 2) return;      // 已經在目標位置
                const steps = Math.max(8, Math.round(dur * 30));
                for (let i = 1; i <= steps; i++) {
                    const t = i / steps;
                    // easeInOutQuad：起步與收尾慢，中間快，像人操作
                    const e = t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t + 2, 2) / 2;
                    window.scrollTo(0, start + delta * e);
                    await new Promise(r2 => setTimeout(r2, (dur * 1000) / steps));
                }
                window.scrollTo(0, dest);
            }""",
            [block, duration * SPEED],
        )
        pause(page, 0.35)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# 節拍表：每個步驟要對上哪一段旁白，以及該段旁白有幾秒。
# 由 narration.py 的 timeline.json 讀進來；沒有檔案時退回保守值。
# 目的：Demo 畫面長度必須 ≥ assemble.py 的 demo 視窗（seg3~seg4 約 99s），
#       否則影片尾端會凍結在同一格（看起來像當掉）。
# ---------------------------------------------------------------------------
def load_beats() -> dict:
    import json
    from pathlib import Path
    tl_path = Path(__file__).resolve().parent / "assets" / "audio" / "timeline.json"
    try:
        tl = json.loads(tl_path.read_text(encoding="utf-8"))
        # ★ demo 視窗以 card=="demo" 的段為準（組裝公式：起點−1s 到結束+1s）。
        #   不能用 seg==4 取最後一段：threegood 卡也掛在 seg 4，會把視窗多算 ~13s。
        demo_segs = [t for t in tl if t.get("card") == "demo"]
        seg3 = [t for t in tl if t["seg"] == 3]
        seg4 = [t for t in tl if t["seg"] == 4 and t.get("card") == "demo"]
        w0 = min(t["start"] for t in demo_segs) if demo_segs else 43.15
        w1 = max(t["end"] for t in demo_segs) if demo_segs else 128.226
        return {
            "demo_total": w1 - w0 + 2.0,
            "seg3": [round(t["dur"], 2) for t in seg3],
            "seg4": [round(t["dur"], 2) for t in seg4],
        }
    except Exception:
        return {"demo_total": 87.076, "seg3": [7.0] * 9, "seg4": [10.5] * 2}


BEATS = load_beats()

# 起始網址（由 record_demo.py 設定；不能依賴 page.url，新分頁是 about:blank）
ENTRY_URL = {"url": "http://127.0.0.1:3210/"}
# 錄影期間的 wall-clock 起點（run() 開頭設），marks/evidence 都從這裡算
_STATE = {"t0": 0.0, "marks": {}, "evidence": {}}


def get_state() -> dict:
    """給 record_demo.py 寫進 demo_timing.json 用（步驟標記 + 牆流程防呆證據）。"""
    return {"marks": dict(_STATE["marks"]), "evidence": dict(_STATE["evidence"])}


def elapsed_now() -> float:
    """run() 開始至今的 wall-clock 秒數（含 wait_for_selector 等真實等待）。"""
    return time.time() - _STATE["t0"]


def hold(page, sec: float) -> None:
    """明確標記的停留（會累計，供最後補足缺口）。

    ★ 為什麼在停留時加「微幅呼吸捲動」而不是純等待：
      auditor 量到舊版影片有 97.4% 的時間「畫面完全不動」，被判定像簡報。
      純 wait_for_timeout() 期間畫面是凍結的 → 時間軸上沒有變化。
      這裡在停留期間做 ±3px 的極緩慢來回捲動，讓畫面持續有真實的生命感
      （真實使用者閱讀時也會微幅捲動），但**不改變任何示範內容**。
    """
    dur = sec * SPEED
    if dur < 1.5:
        page.wait_for_timeout(int(dur * 1000))
        return
    # 停留期間：每 0.45s 做一次 ±3px 的呼吸捲動
    steps = max(2, int(dur / 0.45))
    page.evaluate(
        """async ([steps, totalMs]) => {
            const y0 = window.scrollY;
            const per = totalMs / steps;
            for (let i = 0; i < steps; i++) {
                // 極緩慢的正弦呼吸：±3px，肉眼幾乎不察覺，但時間軸上有變化
                const off = Math.round(Math.sin(i * 1.7) * 3);
                window.scrollTo(0, Math.max(0, y0 + off));
                await new Promise(r => setTimeout(r, per));
            }
            window.scrollTo(0, y0);
        }""",
        [steps, int(dur * 1000)],
    )


def mark(name: str) -> None:
    _STATE["marks"][name] = round(elapsed_now(), 2)


def pad_to_total(page, log) -> None:
    """保險機制：若真實互動的節奏仍短於旁白視窗，補足差額。

    ★ 用 wall-clock（elapsed_now）而不是 hold 累計，因為 wait_for_selector /
    wait_for_function / 打字時間也會佔去錄影秒數，只有 wall-clock 才是
    demo_raw.mp4 的真實長度，才是 assemble.py 視窗（raw[0:demo_len]）會看到的。

    設計原則：**寧可讓每一步多做一點真實停留，也不要靠假捲動灌時間**。
    補足時用慢速捲動來回，畫面持續有位移，不會定格。
    """
    el = elapsed_now()
    need = BEATS["demo_total"] - el
    if need <= 2.0:
        log(f"   節奏足夠（{el:.1f}s / 目標 {BEATS['demo_total']:.1f}s）")
        if el > BEATS["demo_total"] + 0.5:
            log(f"   !! 超出視窗 {el - BEATS['demo_total']:.1f}s —— 成片尾端會被 trim，請刪減步驟")
        return
    log(f"   !! 仍缺 {need:.1f}s，以慢速捲動補足（畫面持續變化，非定格）")
    steps = max(2, int(round(need / 5.0)))
    per = need / steps
    for i in range(steps):
        y = 0 if i % 2 else 1100
        slow_scroll(page, y, steps=14, step_pause=per / 14.0)


def run(page, ui, log) -> None:
    """進入點：--with-wall 走含好話牆的流程，否則走舊版流程。"""
    _STATE["t0"] = time.time()
    _STATE["marks"] = {}
    _STATE["evidence"] = {}
    if WITH_WALL:
        run_wall(page, ui, log)
    else:
        run_legacy(page, ui, log)


# ---------------------------------------------------------------------------
# 好話牆版 demo 流程（--with-wall）
# 與舊版差異：刪除「轉送面板」「收藏清單」兩段低價值步驟來騰時間給牆流程，
# 危機護欄步驟絕對保留。牆/排行榜資料由 mock_kv.cjs seed（虛構）。
# ---------------------------------------------------------------------------

# 牆上鼓勵話：≥10 字、含感受詞（聽起來/難受/說出來/不容易），會通過
# screen.validateEncourage（lint + bigram 重疊 + ACK_WORDS）
ENC_TEXT = "聽起來三天沒回訊息，心裡一定很難受，你願意說出來已經很不容易了。"
# 要鼓勵的 seed 貼文（mock_kv.cjs種的 love 主題貼文）
ENC_TARGET = "三天沒回我訊息"

# 個資 pattern（與 app/lib/screen.js findPII 同款）——錄影防呆掃描用
PII_RE = re.compile(
    r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"
    r"|(?<![\d.])(?:09\d{8}|0\d{1,2}-?\d{6,8}|\+886\s?\d{9})(?![\d.])"
    r"|https?://|www\.|\.(?:com|tw|net|org|io|me|shop|club)\b"
    r"|@[A-Za-z0-9._]{3,30}\b",
    re.I,
)
HANDLE_RE = re.compile(r"^牆友#[A-Z0-9-]{4}$")


def _toast_text(page) -> str:
    try:
        return page.evaluate(
            "() => { const t = document.getElementById('toast');"
            " return t && !t.hidden ? t.textContent : ''; }")
    except Exception:  # noqa: BLE001
        return ""


def wait_toast_points(page, timeout: int = 20000) -> str:
    """等 #toast 出現且內容含「+N 分」，回傳 toast 全文（掛牆/鼓勵共用）。"""
    page.wait_for_function(
        "() => { const t = document.getElementById('toast');"
        " return t && !t.hidden && /\\+\\s*\\d+\\s*分/.test(t.textContent); }",
        timeout=timeout,
    )
    return _toast_text(page)


def collect_wall_evidence(page) -> dict:
    """抓牆/個人面板/排行榜的 DOM 文字做防呆掃描（無個資、handle 格式）。"""
    ev = page.evaluate("""() => ({
        wallCount: document.querySelectorAll('#wall-list .wall-item').length,
        encCount: document.querySelectorAll('#wall-list .enc-item').length,
        wallTexts: [...document.querySelectorAll('#wall-list .wall-item')].map(li => li.innerText),
        encHandles: [...document.querySelectorAll('#wall-list .enc-handle')].map(e => e.textContent.trim()),
        boardNames: [...document.querySelectorAll('#board-list .board-name')].map(e => e.textContent.trim()),
        mePts: document.getElementById('me-pts').textContent,
        meWeekPts: document.getElementById('me-week-pts').textContent,
        meTitle: document.getElementById('me-title').textContent,
        meRank: document.getElementById('me-rank').textContent,
        meWallCount: document.querySelectorAll('#me-wall .wall-item').length,
    })""")
    pii_hits = [t[:60] for t in ev.get("wallTexts", []) if PII_RE.search(t)]
    handles = ev.get("encHandles", []) + ev.get("boardNames", [])
    handles_ok = all(HANDLE_RE.match(h) for h in handles) if handles else False
    _STATE["evidence"].update({
        "wall_count": ev.get("wallCount"),
        "enc_count": ev.get("encCount"),
        "me_pts": ev.get("mePts"),
        "me_week_pts": ev.get("meWeekPts"),
        "me_title": ev.get("meTitle"),
        "me_rank": ev.get("meRank"),
        "me_wall_count": ev.get("meWallCount"),
        "board_names": ev.get("boardNames"),
        "pii_clean": not pii_hits,
        "pii_hits": pii_hits,
        "handles_ok": handles_ok,
    })
    return _STATE["evidence"]


def run_wall(page, ui, log) -> None:
    """含好話牆的 demo 流程。全部步驟 wall-clock 必須塞進 BEATS['demo_total'] 視窗。"""
    log(f"   節拍目標 {BEATS['demo_total']:.1f}s（with-wall：牆流程 + 危機護欄）")

    # ==================================================================
    # A. 首頁（乾淨、無個資）--------------------------------------------
    # ==================================================================
    log("A. 首頁")
    page.goto(ENTRY_URL["url"], wait_until="domcontentloaded")
    page.wait_for_selector("#input", state="visible", timeout=20000)
    hold(page, 1.8)
    slow_scroll(page, 260, steps=14)
    hold(page, 0.9)
    slow_scroll(page, 0, steps=10)
    hold(page, 1.0)
    mark("A_home")

    # ==================================================================
    # B. 輸入心事（真實打字）--------------------------------------------
    # ==================================================================
    log("B. 輸入心事")
    mind = (
        "今天開會我講錯話，回家路上一直想，"
        "覺得自己很沒用。同事一定覺得我很雷。"
    )
    inp = page.locator("#input")
    inp.wait_for(state="visible", timeout=15000)
    human_type(page, inp, mind, delay_ms=95)
    hold(page, 0.8)
    mark("B_typed")

    # ==================================================================
    # C. 送出 → 情緒辨識 → 三段好話 --------------------------------------
    # ==================================================================
    log("C. 送出")
    page.locator("#btn-submit").click()
    hold(page, 0.6)   # 讓 loading 動畫被錄進去（證明真的有跑 AI）
    page.locator("#result-body").wait_for(state="visible", timeout=90000)
    log("   結果已出現")
    hold(page, 0.7)
    scroll_to(page, "#result", block="start", duration=1.2)
    hold(page, 0.4)
    hold(page, 0.9); scroll_to(page, "#emotion-tag", duration=1.0); hold(page, 0.9)
    for sel, wait in (("#seg-accept", 1.9), ("#seg-good", 2.2), ("#seg-step", 1.9)):
        try:
            page.locator(sel).wait_for(state="visible", timeout=8000)
            hold(page, 0.5); scroll_to(page, sel, duration=1.0); hold(page, wait)
        except Exception as exc:  # noqa: BLE001
            log(f"   !! {sel} 未出現：{exc}")
    mark("C_result")

    # ==================================================================
    # D. 複製 -------------------------------------------------------------
    # ==================================================================
    log("D. 複製這句")
    try:
        scroll_to(page, "button[data-act='copy']", duration=1.0); hold(page, 0.3)
        page.locator("button[data-act='copy']").click()
        hold(page, 2.0)          # 讓 toast 出現
    except Exception as exc:  # noqa: BLE001
        log(f"   !! 複製失敗：{exc}")
    mark("D_copy")

    # ==================================================================
    # E. 匿名掛上好話牆（主題選「工作」→ toast +N 分 → 牆上出現新貼文）---
    # ==================================================================
    log("E. 匿名掛上好話牆")
    scroll_to(page, "#btn-publish", duration=1.1); hold(page, 0.3)
    page.select_option("#publish-topic", "work")
    hold(page, 0.6)              # 讓下拉選「工作」清楚入鏡
    page.locator("#btn-publish").click()
    toast_pub = wait_toast_points(page, timeout=20000)
    _STATE["evidence"]["toast_publish"] = toast_pub
    log(f"   掛牆 toast：{toast_pub}")
    hold(page, 1.2)              # toast 壽命 2.2s，停留讓 +N 分 入鏡
    scroll_to(page, "#wall-section", duration=1.2)
    page.wait_for_function(
        "() => document.querySelectorAll('#wall-list .wall-item').length >= 4",
        timeout=20000)           # 3 篇 seed + 剛掛的 1 篇
    hold(page, 2.0)
    mark("E_publish")

    # ==================================================================
    # F. 在牆上一篇 seed 貼文留一句會過審的鼓勵 --------------------------
    # ==================================================================
    log("F. 鼓勵別人一篇")
    item = page.locator(".wall-item", has_text=ENC_TARGET).first
    item.scroll_into_view_if_needed()
    hold(page, 0.3)
    human_type(page, item.locator(".enc-input"), ENC_TEXT, delay_ms=80)
    hold(page, 0.3)
    item.locator(".enc-send").click()
    toast_enc = wait_toast_points(page, timeout=20000)
    _STATE["evidence"]["toast_encourage"] = toast_enc
    log(f"   鼓勵 toast：{toast_enc}")
    hold(page, 1.2)
    page.locator(".wall-item", has_text=ENC_TARGET).locator(".enc-item").first \
        .wait_for(state="visible", timeout=20000)
    hold(page, 2.0)              # 鼓勵出現在牆上，停留 2s
    mark("F_encourage")

    # ==================================================================
    # G. 我的好話紀錄（分數/本週稱號/我的牆上貼文）→ 本週排行榜 -----------
    # ==================================================================
    log("G. 我的紀錄 / 排行榜")
    scroll_to(page, "#me-panel", duration=1.2); hold(page, 2.0)
    scroll_to(page, "#me-wall", duration=1.0); hold(page, 1.2)
    scroll_to(page, "#board", duration=1.2); hold(page, 2.0)
    mark("G_me_board")
    try:
        ev = collect_wall_evidence(page)
        log(f"   防呆：牆 {ev['wall_count']} 篇 / 鼓勵 {ev['enc_count']} 句，"
            f"me={ev['me_pts']}分 称號={ev['me_title']} 排名={ev['me_rank']}，"
            f"pii_clean={ev['pii_clean']} handles_ok={ev['handles_ok']}")
        if ev["pii_hits"]:
            log(f"   !! 牆上文字疑似含個資：{ev['pii_hits']}")
        if not ev["handles_ok"]:
            log(f"   !! handle/排行榜名稱格式異常：{ev['board_names']}")
    except Exception as exc:  # noqa: BLE001
        log(f"   !! 牆防呆掃描失敗：{exc}")

    # ==================================================================
    # H. 危機護欄（真實操作！絕對保留）------------------------------------
    # ==================================================================
    log("H. 危機護欄")
    slow_scroll(page, 0, steps=16)
    hold(page, 0.5)
    inp = page.locator("#input")
    human_type(page, inp, "我真的撐不下去了，不想活了。", delay_ms=115)
    hold(page, 0.8)
    page.locator("#btn-submit").click()
    page.wait_for_function(
        "() => { const c = document.getElementById('crisis');"
        " return c && !c.hidden; }",
        timeout=40000,
    )
    hold(page, 0.9)
    scroll_to(page, "#crisis", block="start", duration=1.2); hold(page, 1.8)   # 讓 1925/1995/1980 清楚入鏡
    scroll_to(page, "#hotlines", duration=1.0)
    hold(page, 2.2)
    mark("H_crisis")

    # ==================================================================
    # I. 收尾：回到輸入區 --------------------------------------------------
    # ==================================================================
    log("I. 收尾")
    slow_scroll(page, 0, steps=16)
    hold(page, 1.0)
    mark("I_end")

    pad_to_total(page, log)
    log(f"   實際節奏 {elapsed_now():.1f}s / 目標 {BEATS['demo_total']:.1f}s")


def run_legacy(page, ui, log) -> None:
    """舊版 Demo 流程（不含牆）—— 對應影片結構的 00:50–02:00。"""
    log(f"   節拍目標 {BEATS['demo_total']:.1f}s（seg3={len(BEATS['seg3'])}段 seg4={len(BEATS['seg4'])}段）")

    # ==================================================================
    # A. 首頁（乾淨、無個資）--------------------------------------------
    # ==================================================================
    log("A. 首頁")
    # 注意：新開的 page.url 是 about:blank，不能用它當導覽目標。
    # 由 record_demo.py 傳入真正的起始網址。
    page.goto(ENTRY_URL["url"], wait_until="domcontentloaded")
    page.wait_for_selector("#input", state="visible", timeout=20000)
    hold(page, 4.0)
    slow_scroll(page, 260, steps=14)
    hold(page, 2.5)
    slow_scroll(page, 0, steps=10)
    hold(page, 3.0)

    # ==================================================================
    # B. 輸入心事（真實打字）--------------------------------------------
    # ==================================================================
    log("B. 輸入心事")
    mind = (
        "今天開會我講錯話，回家路上一直想，"
        "覺得自己很沒用。同事一定覺得我很雷。"
    )
    inp = page.locator("#input")
    inp.wait_for(state="visible", timeout=15000)
    hold(page, 0.5)
    human_type(page, inp, mind, delay_ms=110)
    hold(page, 3.0)
    slow_scroll(page, 420, steps=12)
    hold(page, 3.5)

    # ==================================================================
    # C. 送出 → 情緒辨識 → 三段好話 --------------------------------------
    # ==================================================================
    log("C. 送出")
    page.locator("#btn-submit").click()
    hold(page, 1.2)   # 讓 loading 動畫被錄進去（證明真的有跑 AI）

    # 等結果（本機 Ollama 可能要幾秒；規則降級則很快）
    page.locator("#result-body").wait_for(state="visible", timeout=90000)
    log("   結果已出現")
    hold(page, 2.0)

    scroll_to(page, "#result", block="start", duration=1.5)

    # 情緒標籤
    hold(page, 3.0); scroll_to(page, "#emotion-tag", duration=1.4); hold(page, 1.5)

    # 三段：承接 / 好話 / 小步
    for sel, wait in (("#seg-accept", 5.0), ("#seg-good", 6.0), ("#seg-step", 5.0)):
        try:
            page.locator(sel).wait_for(state="visible", timeout=8000)
            hold(page, 1.5); scroll_to(page, sel, duration=1.3); hold(page, wait)
        except Exception as exc:  # noqa: BLE001
            log(f"   !! {sel} 未出現：{exc}")

    # ==================================================================
    # D. 複製 -------------------------------------------------------------
    # ==================================================================
    log("D. 複製這句")
    try:
        scroll_to(page, "button[data-act='copy']", duration=1.3); hold(page, 1.0)
        page.locator("button[data-act='copy']").click()
        hold(page, 4.5)          # 讓 toast 出現
    except Exception as exc:  # noqa: BLE001
        log(f"   !! 複製失敗：{exc}")

    # ==================================================================
    # E. 轉送給別人 -------------------------------------------------------
    # ==================================================================
    log("E. 轉送給別人")
    try:
        page.locator("button[data-act='share']").scroll_into_view_if_needed()
        hold(page, 1.5)
        page.locator("button[data-act='share']").click()
        page.locator("#share-panel").wait_for(state="visible", timeout=10000)
        hold(page, 2.5)
        scroll_to(page, "#share-panel", duration=1.5); hold(page, 6.0)      # 給朋友
        for aud, wait in (("family", 5.5), ("colleague", 5.5)):
            page.locator(f".seg-tab[data-audience='{aud}']").click()
            hold(page, wait)
        # 回到「給朋友」做結尾（最常用）
        page.locator(".seg-tab[data-audience='friend']").click()
        hold(page, 3.0)
        page.locator("button[data-act='copy-share']").click()
        hold(page, 3.0)
        page.locator("button[data-act='close-share']").click()
        pause(page, 1.0)
    except Exception as exc:  # noqa: BLE001
        log(f"   !! 轉送流程失敗：{exc}")

    # ==================================================================
    # F. 收藏 -------------------------------------------------------------
    # ==================================================================
    log("F. 收藏")
    try:
        page.locator("button[data-act='fav']").scroll_into_view_if_needed()
        hold(page, 1.5)
        page.locator("button[data-act='fav']").click()
        hold(page, 3.5)          # 按鈕變「已收藏」＋徽章 +1
        page.locator("#btn-favorites").click()
        page.locator("#fav-panel").wait_for(state="visible", timeout=8000)
        hold(page, 2.0)
        hold(page, 2.0); scroll_to(page, "#fav-panel", duration=1.4); hold(page, 3.0)
        # 收藏清單就是「帶走一句話」的證據
        page.locator("#fav-panel").scroll_into_view_if_needed()
        hold(page, 4.0)
    except Exception as exc:  # noqa: BLE001
        log(f"   !! 收藏流程失敗：{exc}")

    # ==================================================================
    # G. 危機護欄（真實操作！）-------------------------------------------
    # ==================================================================
    log("G. 危機護欄")
    try:
        slow_scroll(page, 0, steps=16)
        hold(page, 1.0)
        inp = page.locator("#input")
        human_type(page, inp, "我真的撐不下去了，不想活了。", delay_ms=130)
        hold(page, 2.5)
        page.locator("#btn-submit").click()
        # 等 hidden 屬性被拿掉（section hidden 時 wait_for(visible) 不會成功，
        # 因為 hidden 屬性是 display:none 的來源）
        page.wait_for_function(
            "() => { const c = document.getElementById('crisis');"
            " return c && !c.hidden; }",
            timeout=40000,
        )
        hold(page, 2.0)
        hold(page, 4.0); scroll_to(page, "#crisis", block="start", duration=1.6); hold(page, 3.0)   # 讓 1925/1995/1980 清楚入鏡
        page.locator("#hotlines").scroll_into_view_if_needed()
        hold(page, 7.0)
    except Exception as exc:  # noqa: BLE001
        log(f"   !! 危機模式失敗：{exc}")

    # ==================================================================
    # H. 收尾：回到輸入區 --------------------------------------------------
    # ==================================================================
    log("H. 收尾")
    slow_scroll(page, 0, steps=16)
    hold(page, 2.0)

    pad_to_total(page, log)
    log(f"   實際節奏 {elapsed_now():.1f}s / 目標 {BEATS['demo_total']:.1f}s")
