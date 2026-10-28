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

# ---- 節奏參數（秒）。可用環境變數覆寫，方便調整到剛好 3 分鐘 ----
SPEED = float(os.environ.get("DEMO_SPEED", "1.0"))


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


def scroll_to(page, selector: str, block: str = "center", extra_pause: float = 0.8) -> None:
    try:
        page.eval_on_selector(
            selector,
            """(el, block) => {
                const r = el.getBoundingClientRect();
                const y = window.scrollY + r.top - (block === 'center'
                    ? (window.innerHeight - r.height) / 2 : 40);
                window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
            }""",
            block,
        )
        pause(page, extra_pause)
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
        seg3 = [t for t in tl if t["seg"] == 3]
        seg4 = [t for t in tl if t["seg"] == 4]
        return {
            "demo_total": (seg4[-1]["end"] if seg4 else 139.5)
                          - (seg3[0]["start"] if seg3 else 42.6) + 2.0,
            "seg3": [round(t["dur"], 2) for t in seg3],
            "seg4": [round(t["dur"], 2) for t in seg4],
        }
    except Exception:
        return {"demo_total": 101.0, "seg3": [7.0] * 9, "seg4": [10.5] * 3}


BEATS = load_beats()

# 起始網址（由 record_demo.py 設定；不能依賴 page.url，新分頁是 about:blank）
ENTRY_URL = {"url": "http://127.0.0.1:3210/"}
# 錄影期間累積的「已停留秒數」，用來把節奏撐到 demo_total
_STATE = {"elapsed": 0.0, "marks": {}}


def hold(page, sec: float) -> None:
    """明確標記的停留（會累計，供最後補足缺口）。"""
    _STATE["elapsed"] += sec * SPEED
    page.wait_for_timeout(int(sec * 1000 * SPEED))


def mark(name: str) -> None:
    _STATE["marks"][name] = round(_STATE["elapsed"], 2)


def pad_to_total(page, log) -> None:
    """保險機制：若真實互動的節奏仍短於旁白視窗，補足差額。

    設計原則：**寧可讓每一步多做一點真實停留，也不要靠假捲動灌時間**。
    這裡只當最後保險，正常情況下缺口應該接近 0（每一步已按旁白長度配速）。
    補足時用慢速捲動來回，畫面持續有位移，不會定格。
    """
    need = BEATS["demo_total"] - _STATE["elapsed"]
    if need <= 2.0:
        log(f"   節奏足夠（{_STATE['elapsed']:.1f}s / 目標 {BEATS['demo_total']:.1f}s）")
        return
    log(f"   !! 仍缺 {need:.1f}s，以慢速捲動補足（畫面持續變化，非定格）")
    steps = max(2, int(round(need / 5.0)))
    per = need / steps
    for i in range(steps):
        y = 0 if i % 2 else 1100
        slow_scroll(page, y, steps=14, step_pause=per / 14.0)
        _STATE["elapsed"] += per


def run(page, ui, log) -> None:
    """整段 Demo 流程 —— 對應影片結構的 00:50–02:00。"""
    _STATE["elapsed"] = 0.0
    _STATE["marks"] = {}
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

    scroll_to(page, "#result", block="start", extra_pause=1.2)

    # 情緒標籤
    hold(page, 4.5); scroll_to(page, "#emotion-tag", extra_pause=0.1)

    # 三段：承接 / 好話 / 小步
    for sel, wait in (("#seg-accept", 5.0), ("#seg-good", 6.0), ("#seg-step", 5.0)):
        try:
            page.locator(sel).wait_for(state="visible", timeout=8000)
            hold(page, wait); scroll_to(page, sel, extra_pause=0.1)
        except Exception as exc:  # noqa: BLE001
            log(f"   !! {sel} 未出現：{exc}")

    # ==================================================================
    # D. 複製 -------------------------------------------------------------
    # ==================================================================
    log("D. 複製這句")
    try:
        scroll_to(page, "button[data-act='copy']", extra_pause=0.8)
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
        scroll_to(page, "#share-panel", extra_pause=0.2); hold(page, 6.0)      # 給朋友
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
        hold(page, 4.5); scroll_to(page, "#fav-panel", extra_pause=0.1)
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
        hold(page, 6.5); scroll_to(page, "#crisis", block="start", extra_pause=0.1)   # 讓 1925/1995/1980 清楚入鏡
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
    log(f"   實際節奏 {_STATE['elapsed']:.1f}s / 目標 {BEATS['demo_total']:.1f}s")
