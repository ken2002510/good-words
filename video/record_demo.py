#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
record_demo.py — 用 Playwright 的**原生錄影**錄製《好好說話》的真實操作畫面。

## 為什麼改成 Playwright 原生錄影（重要教訓）

第一版用 `ffmpeg -f gdigrab -offset_x/-offset_y -i desktop` 擷取桌面區域。
**結果錄到的是整個桌面**：DeepSeek HARNESS 視窗、Windows 工作列、
瀏覽器分頁標題「2026 三好AI創新應用競賽」、其他專案名稱全部入鏡
→ 違反 BRIEF §8（不得出現單位/可辨識資訊），等於直接失格。

根因：gdigrab 的 offset/尺寸沒有如預期套用，且**我只驗證了檔案大小，
沒有驗證畫面內容**，所以錯誤一路流到成片。

## 現在的保證

Playwright 的原生錄影（`record_video_dir`）錄的是**頁面自己的渲染表面**，
不是螢幕截圖。它在**物理上不可能**錄到：
  - 桌面、桌布、其他應用程式視窗
  - Windows 工作列
  - 瀏覽器網址列、分頁列、書籤列
  - 任何通知

這是比「裁切桌面」可靠得多的保證：不是「避開」，而是「根本不存在」。

用法：
    uv run --offline --with playwright --with pillow python record_demo.py [--port 3210]
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
PAGES = RAW / "pages"
for d in (RAW, PAGES):
    d.mkdir(parents=True, exist_ok=True)

# ---- 尺寸 ----
# 輸出：直式 1080x1920。
REC_W, REC_H = 1080, 1920

# ★ viewport：寬度必須等於輸出寬度（否則 Playwright 會把畫面放在左側並補灰邊），
#   但高度必須**小於**頁面高度，否則 maxScroll=0、所有捲動都是 no-op。
#
# 實測（送出心事後的結果頁）：
#   viewport 1080x1920 → scrollHeight=1920  innerH=1920  maxScroll=  0  ← 捲不動
#   viewport  540x960  → scrollHeight=1447  innerH= 960  maxScroll=487  ← 可捲，但
#                        Playwright 只把 540px 寬的內容放在左邊，右側補灰邊
#                        （錄出來的 1080x1920 有一半是灰的）
#   走過四次冤枉路（全部實測）：
#     viewport 1080x1920 → maxScroll=  0  ← 捲不動，畫面整段凍結（auditor 抓到）
#     viewport  540x960  → maxScroll=487  ← 能捲，但錄出來右半是灰邊
#     viewport 1080x1100 → maxScroll=191  ← 被 maxScroll 門檻擋下，且下方灰邊
#     viewport 1080x1024 → maxScroll=267  ← 滿版但 crop 後左右文字被裁掉
#
#   ★ 正解：viewport 用 **9:16** 且高度小於頁高。
#     viewport 608x1080 → scrollHeight=1419  maxScroll=339
#     608x1080 與 1080x1920 同為 9:16 → 放大 1.777 倍即填滿，
#     **零補邊、零裁切、零變形**，且仍有 339px 可捲動空間。
VIEW_W, VIEW_H = 608, 1080

# 捲動空間的最低要求：低於這個值就代表 viewport 設太大，直接中止
MIN_MAX_SCROLL = 200


def log(msg: str) -> None:
    print(f"[record] {msg}", flush=True)


def wait_port(port: int, timeout: float = 40.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/", timeout=1.5):
                return True
        except urllib.error.HTTPError:
            return True
        except Exception:
            time.sleep(0.4)
    return False


# 前端選擇器（實際選擇器以 index.html 為準，已核對）
DEFAULT_UI = {
    "input": ["#input", "textarea"],
    "submit": ["#btn-submit", "button[type=submit]"],
    "result": ["#result"],
    "emotion": ["#emotion-tag"],
    "copy": ["button[data-act='copy']"],
    "favorite": ["button[data-act='fav']"],
    "share": ["button[data-act='share']"],
    "favlist": ["#fav-panel"],
    "crisis": ["#crisis"],
    "reset": ["#reset"],
}


def load_ui() -> dict:
    f = HERE / "ui_map.json"
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            merged = dict(DEFAULT_UI)
            merged.update({k: v for k, v in data.items() if v})
            return merged
        except Exception as exc:  # noqa: BLE001
            log(f"ui_map.json 解析失敗，改用預設：{exc}")
    return DEFAULT_UI


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3210)
    ap.add_argument("--url", default=None)
    ap.add_argument("--no-record", action="store_true", help="不錄影，只驗證流程")
    ap.add_argument("--headed", action="store_true")
    args = ap.parse_args()

    url = args.url or f"http://127.0.0.1:{args.port}/"
    if not wait_port(args.port):
        log(f"!! 127.0.0.1:{args.port} 沒有回應 —— 網站尚未可跑")
        return 2

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    ui = load_ui()
    sys.path.insert(0, str(HERE))
    import demo_steps  # noqa: PLC0415

    demo_steps.ENTRY_URL["url"] = url

    if PAGES.exists():
        for f in PAGES.glob("*.webm"):
            f.unlink()
    PAGES.mkdir(parents=True, exist_ok=True)

    run_error = None

    with sync_playwright() as pw:
        # headless 也能原生錄影，且沒有真實視窗 ＝ 絕不可能有其他畫面干擾
        launch_kwargs = dict(
            headless=not args.headed,
            args=["--no-first-run", "--no-default-browser-check",
                  "--disable-features=Translate,MediaRouter",
                  "--disable-notifications", "--hide-scrollbars"],
        )
        ctx_kwargs = dict(
            # viewport = 擷取尺寸，且必須等於 record_video_size
            viewport={"width": VIEW_W, "height": VIEW_H},
            device_scale_factor=1,
            locale="zh-TW", timezone_id="Asia/Taipei", color_scheme="light",
            # ★ 授予剪貼簿權限：headless Chromium 預設拒絕 navigator.clipboard，
            #   導致 Demo 按「複製這句」時跳出「複製失敗，請長按選取文字」的錯誤
            #   toast —— 錄進影片會讓評審以為功能壞掉（實際上是錄影環境限制）。
            permissions=["clipboard-read", "clipboard-write"],
        )
        if not args.no_record:
            # ★ 關鍵：record_video_* 只錄頁面渲染表面，不錄螢幕
            ctx_kwargs["record_video_dir"] = str(PAGES)
            # ★ record_video_size 必須等於 viewport，否則 Playwright 會把畫面
            #   放在左上角並在右側／下方補灰邊（已實測踩過兩次）：
            #     viewport 540x960  + record 1080x1920 → 右半灰
            #     viewport 1080x1100 + record 1080x1920 → 下方灰
            #   錄成 viewport 尺寸後，再由轉檔步驟等比縮放並用網站底色補滿到
            #   REC_W x REC_H（見下方 ffmpeg 的 scale+pad）。
            ctx_kwargs["record_video_size"] = {"width": VIEW_W, "height": VIEW_H}

        browser = pw.chromium.launch(**launch_kwargs)
        ctx = browser.new_context(**ctx_kwargs)
        ctx.set_default_timeout(20000)
        page = ctx.new_page()
        page.set_viewport_size({"width": VIEW_W, "height": VIEW_H})

        # ---- 錄影前的畫面防呆 ----
        # 上次的教訓：頁面沒渲染好就開錄 → 錄到空白，事後才發現。
        # 這裡在開錄前先確認「頁面真的畫出網站內容」，否則直接中止。
        try:
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_selector("#input", state="visible", timeout=20000)
            page.wait_for_timeout(800)
            shot = page.screenshot()
            (RAW / "preflight.png").write_bytes(shot)
            from PIL import Image, ImageStat  # noqa: PLC0415
            import io  # noqa: PLC0415

            g = Image.open(io.BytesIO(shot)).convert("L")
            std = ImageStat.Stat(g).stddev[0]
            mean = ImageStat.Stat(g).mean[0]
            log(f"開錄前畫面檢查：亮度標準差 {std:.1f}，平均 {mean:.1f} → raw/preflight.png")
            if std < 3.0:
                log("!! 開錄前畫面近乎全白/全空 —— 中止，不浪費一次錄影")
                ctx.close(); browser.close()
                return 7

            # ---- ★ 可捲動性硬斷言 ----
            # 教訓：viewport 設成 1080x1920 時，結果頁 scrollHeight==innerHeight，
            # maxScroll=0 → 所有 window.scrollTo() 都是 no-op → 畫面整段凍結。
            # 這裡**先送出一次心事、等結果出來**再量，因為結果頁比首頁長。
            page.fill("#input", "今天開會我講錯話，覺得自己很沒用。")
            page.click("#btn-submit")
            page.wait_for_selector("#result-body", state="visible", timeout=90000)
            page.wait_for_timeout(1200)
            sc = page.evaluate("""() => ({
                sh: document.documentElement.scrollHeight,
                ih: window.innerHeight,
            })""")
            max_scroll = sc["sh"] - sc["ih"]
            log(f"可捲動性檢查：scrollHeight={sc['sh']} innerHeight={sc['ih']} "
                f"maxScroll={max_scroll}")
            if max_scroll < MIN_MAX_SCROLL:
                log(f"!! viewport 太大（{VIEW_W}x{VIEW_H}）：maxScroll={max_scroll} "
                    f"< {MIN_MAX_SCROLL}，捲動會失效 → 中止錄影")
                ctx.close(); browser.close()
                return 8
            log(f"   ✓ maxScroll={max_scroll} ≥ {MIN_MAX_SCROLL}，捲動有效")

            # 量完之後清掉狀態，讓正式錄影從乾淨的首頁開始
            page.evaluate("() => { try { localStorage.clear(); } catch(e){} }")
            page.goto(url, wait_until="networkidle", timeout=30000)
            page.wait_for_selector("#input", state="visible", timeout=20000)
            page.wait_for_timeout(600)
        except Exception as exc:  # noqa: BLE001
            log(f"!! 開錄前檢查失敗：{exc}")
            try:
                ctx.close(); browser.close()
            except Exception:  # noqa: BLE001
                pass
            return 7

        try:
            log("執行 demo 步驟…")
            t0 = time.time()
            demo_steps.run(page, ui, log)
            took = time.time() - t0
            log(f"demo 步驟實測 {took:.1f}s")
            (RAW / "demo_timing.json").write_text(
                json.dumps({"seconds": round(took, 2)}, ensure_ascii=False),
                encoding="utf-8")
        except Exception as exc:  # noqa: BLE001
            run_error = exc
            log(f"!! demo 步驟發生例外：{exc}")
        finally:
            # ★ Playwright 在 context 關閉時才 finalize 影片檔
            try:
                ctx.close()
            except Exception as exc:  # noqa: BLE001
                log(f"   （關閉 context 非致命錯誤：{type(exc).__name__}）")
            try:
                browser.close()
            except Exception:  # noqa: BLE001
                pass

    # ---- 找出錄好的 webm 並轉成 mp4 ----
    if not args.no_record:
        webms = sorted(PAGES.glob("*.webm"), key=lambda p: p.stat().st_mtime)
        if not webms:
            log("!! 找不到 Playwright 錄影檔")
            return 4
        src = webms[-1]
        raw = RAW / "demo_raw.mp4"
        if raw.exists():
            raw.unlink()
        log(f"Playwright 錄影：{src.name}（{src.stat().st_size/1024/1024:.1f} MB）→ 轉 mp4")
        # ★ 轉檔：viewport 已選成與輸出**完全相同長寬比（9:16）**，
        #   所以這裡只要單純等比例放大即可 —— 不需 pad、不需 crop、不會變形。
        #
        #   （先前三種寫法都失敗，記錄在此避免後人重蹈：
        #      pad  → 留大片單色邊，像破版
        #      crop → 左右文字被裁掉（「好好說話」變「說話」），內容不完整
        #      兩者都是因為 viewport 長寬比 ≠ 輸出長寬比而被迫取捨。）
        vf = f"scale={REC_W}:{REC_H}:flags=lanczos,setsar=1"
        r = subprocess.run([
            "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
            "-i", str(src),
            "-vf", vf,
            "-r", "30", "-pix_fmt", "yuv420p",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
            "-an", str(raw),
        ], capture_output=True, text=True)
        if r.returncode != 0 or not raw.exists():
            log("!! 轉檔失敗：" + (r.stderr or "")[-800:])
            return 5
        log(f"demo_raw.mp4 = {raw.stat().st_size/1024/1024:.1f} MB")

    if run_error is not None:
        log(f"!! demo 步驟未完整跑完：{run_error}")
        return 6
    log("完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
