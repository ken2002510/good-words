#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
record_demo.py — 用 Playwright 錄製《好好說話》的**真實操作畫面**。

鐵則（BRIEF §7 §8）：
  * 必須是真實操作畫面，不是靜態截圖輪播。
  * 零個資：乾淨 profile、無書籤列、無通知、全螢幕、**不顯示網址列**。

隱私做法（關鍵）：
  Chromium launch 參數 --app=URL 會開一個「無網址列、無分頁、無書籤列」的視窗，
  再把該視窗放到畫面左上角並用 ffmpeg gdigrab 只抓那個區域，
  因此錄到的畫面**物理上不可能包含**瀏覽器 UI、桌面、工作列、通知。
  Playwright 自己的 video 錄製在本機 Chromium 上常常拿到 0 byte，
  所以這裡改用 gdigrab 外部擷取，並在結束後驗證檔案大小。

用法：
    uv run --offline --with playwright --with pillow python record_demo.py [--port 3210]
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
ASSETS = HERE / "assets"
OUT = HERE / "out"
for d in (RAW, ASSETS, OUT):
    d.mkdir(parents=True, exist_ok=True)

# 錄影區域（直式 1080x1920 的來源；實際輸出由 assemble.py 縮放）
#
# 螢幕只有 1920x1080，硬要抓 640x1138 會超出畫面 → gdigrab 直接失敗。
# 因此實際尺寸在 main() 用實測螢幕高度決定，這裡只是預設值。
WIN_X, WIN_Y = 0, 0
REC_W, REC_H = 640, 1024          # 影片錄製框（ffmpeg 要求偶數）
BROWSER_EXTRA_H = 0               # --app 模式無網址列

VIEW_W, VIEW_H = REC_W, REC_H     # CSS viewport 大小


def detect_capture_size(margin: int = 8) -> tuple[int, int, int, int]:
    """依實際螢幕決定可用的擷取區域。

    回傳 (x, y, w, h)。寬高都取偶數（libx264 要求）。
    手機優先網站是直式的，所以**盡量取高**；螢幕不夠高時就把視窗高度
    縮到螢幕上限，再由 assemble.py 放大填滿 1080x1920。
    """
    try:
        import ctypes  # noqa: PLC0415

        user32 = ctypes.windll.user32
        user32.SetProcessDPIAware()
        sw = user32.GetSystemMetrics(0)
        sh = user32.GetSystemMetrics(1)
    except Exception:
        sw, sh = 1920, 1080

    # 視窗略小於螢幕，避免被裁到邊
    w = min(760, sw - margin)
    h = min(1160, sh - margin)
    w -= w % 2
    h -= h % 2
    return 0, 0, w, h


# --------------------------------------------------------------------------
# 小工具
# --------------------------------------------------------------------------
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


def find_chrome() -> str | None:
    """找一個 Chrome / Edge 執行檔（--app 模式需要真的瀏覽器）。"""
    candidates = []
    for env in ("PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"):
        base = os.environ.get(env)
        if not base:
            continue
        candidates += [
            Path(base) / "Google/Chrome/Application/chrome.exe",
            Path(base) / "Microsoft/Edge/Application/msedge.exe",
        ]
    for c in candidates:
        if c.exists():
            return str(c)
    for exe in ("chrome", "msedge", "chromium", "chromium-browser"):
        p = shutil.which(exe)
        if p:
            return p
    return None


# --------------------------------------------------------------------------
# 前端選擇器：等 builder 交件後用 --dump-ui 產生 ui_map.json
# --------------------------------------------------------------------------
DEFAULT_UI = {
    "input": ["#mind", "#thought", "textarea[name=text]", "#input-text", "main textarea", "textarea"],
    "submit": ["#send", "#submit", "button[type=submit]", "#btn-send", "button:has-text('送出')",
               "button:has-text('說給它聽')", "button:has-text('開始')", "main button"],
    "result": ["#result", "#response", ".goodword-card", "[data-role=result]", "#card", "section.result"],
    "emotion": [".emotion-chip", "#emotion", "[data-role=emotion]", ".emotion", ".tag-emotion"],
    "copy": ["#copy", "button:has-text('複製')"],
    "favorite": ["#fav", "#favorite", "button:has-text('收藏')"],
    "share": ["#share", "button:has-text('轉送')", "button:has-text('給別人')", "button:has-text('送給')"],
    "favlist": ["#favlist", "#favorites", ".favorites", "#collection", "[data-role=favorites]"],
    "crisis": ["#crisis", ".crisis", "[data-role=crisis]"],
    "reset": ["#reset", "button:has-text('清除')", "button:has-text('重新')"],
}


def load_ui() -> dict:
    f = HERE / "ui_map.json"
    if f.exists():
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
            merged = dict(DEFAULT_UI)
            merged.update({k: v for k, v in data.items() if v})
            log(f"使用 ui_map.json（{len(data)} 個選擇器）")
            return merged
        except Exception as exc:  # noqa: BLE001
            log(f"ui_map.json 解析失敗，改用預設：{exc}")
    return DEFAULT_UI


def first_visible(page, selectors: list[str], timeout: float = 6.0):
    """回傳第一個可見的元素（list of selectors，逐一嘗試）。"""
    for sel in selectors:
        try:
            loc = page.locator(sel).first
            loc.wait_for(state="visible", timeout=timeout * 1000)
            return loc, sel
        except Exception:
            continue
    return None, None


# --------------------------------------------------------------------------
# 主流程
# --------------------------------------------------------------------------
def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=3210)
    ap.add_argument("--url", default=None, help="直接指定網址（預設 http://127.0.0.1:<port>/）")
    ap.add_argument("--dump-ui", action="store_true", help="只dump UI 結構，不錄影")
    ap.add_argument("--no-record", action="store_true", help="不錄影，只驗證流程可跑")
    ap.add_argument("--headed", action="store_true", help="顯示瀏覽器視窗")
    args = ap.parse_args()

    url = args.url or f"http://127.0.0.1:{args.port}/"
    if not wait_port(args.port):
        log(f"!! 127.0.0.1:{args.port} 沒有回應 —— 網站尚未可跑（等 builder 回報）")
        return 2

    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    ui = load_ui()
    chrome = find_chrome()
    log(f"瀏覽器：{chrome}")

    # 依實際螢幕決定擷取區域（螢幕不夠高時縮到上限，輸出由 assemble.py 放大）
    global WIN_X, WIN_Y, REC_W, REC_H, VIEW_W, VIEW_H
    WIN_X, WIN_Y, REC_W, REC_H = detect_capture_size()
    VIEW_W, VIEW_H = REC_W, REC_H
    log(f"擷取區域 {REC_W}x{REC_H} @ ({WIN_X},{WIN_Y})")

    script = HERE / "demo_steps.py"
    if not script.exists():
        log("!! 找不到 demo_steps.py")
        return 3
    sys.path.insert(0, str(HERE))
    import demo_steps  # noqa: PLC0415

    with sync_playwright() as pw:
        launch_args = [
            f"--app={url}",
            "--no-first-run",
            "--no-default-browser-check",
            "--disable-features=Translate,OptimizationHints,MediaRouter",
            "--disable-sync",
            "--hide-crash-restore-bubble",
            "--disable-session-crashed-bubble",
            "--disable-infobars",
            "--force-device-scale-factor=1",
            f"--window-position={WIN_X},{WIN_Y}",
            f"--window-size={REC_W},{REC_H + BROWSER_EXTRA_H}",
            "--lang=zh-TW",
            "--disable-notifications",
        ]
        # user-data-dir 必須透過 launch_persistent_context 傳（Playwright 會拒絕放在 args 裡）。
        # 用獨立的乾淨 profile ＝ 沒有書籤、沒有歷史、沒有登入狀態、沒有推薦捷徑。
        profile = HERE / "chrome-profile"
        profile.mkdir(parents=True, exist_ok=True)
        ctx = pw.chromium.launch_persistent_context(
            user_data_dir=str(profile),
            headless=not args.headed,
            executable_path=chrome,
            args=launch_args,
            viewport={"width": VIEW_W, "height": VIEW_H},
            locale="zh-TW",
            timezone_id="Asia/Taipei",
            color_scheme="light",
        )
        ctx.set_default_timeout(15000)
        browser = ctx.browser
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.set_viewport_size({"width": VIEW_W, "height": VIEW_H})

        if args.dump_ui:
            page.goto(url, wait_until="domcontentloaded")
            page.wait_for_timeout(1200)
            info = page.evaluate(
                """() => {
                    const pick = (el) => ({
                        tag: el.tagName.toLowerCase(),
                        id: el.id || null,
                        cls: (el.className && String(el.className).slice(0,80)) || null,
                        text: (el.innerText || '').trim().slice(0, 40),
                        role: el.getAttribute('data-role'),
                    });
                    return {
                        title: document.title,
                        bodyText: document.body.innerText.slice(0, 1500),
                        interactive: [...document.querySelectorAll(
                            'button, a, textarea, input, [role=button], [data-role]'
                        )].map(pick),
                    };
                }"""
            )
            (HERE / "ui_dump.json").write_text(
                json.dumps(info, ensure_ascii=False, indent=2), encoding="utf-8"
            )
            log("已寫出 ui_dump.json")
            ctx.close()
            return 0

        # ---- 開始擷取 ----
        proc = None
        if not args.no_record:
            raw = RAW / "demo_raw.mp4"
            if raw.exists():
                raw.unlink()
            cmd = [
                "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
                "-f", "gdigrab", "-framerate", "30",
                "-offset_x", str(WIN_X), "-offset_y", str(WIN_Y),
                "-video_size", f"{REC_W}x{REC_H}",
                "-draw_mouse", "1", "-i", "desktop",
                "-pix_fmt", "yuv420p", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "18", str(raw),
            ]
            log("啟動 ffmpeg gdigrab 錄製…")
            proc = subprocess.Popen(cmd, stdin=subprocess.PIPE,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
            time.sleep(2.5)   # 讓擷取穩定
            if proc.poll() is not None:
                err = proc.stderr.read().decode("utf-8", "replace") if proc.stderr else ""
                log("!! ffmpeg 立刻結束：" + err[-800:])
                ctx.close()
                return 4

        run_error = None
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
            # 先把錄影收乾淨（這一步最重要，不能因為後面關瀏覽器失敗而前功盡棄）
            if proc is not None:
                time.sleep(0.6)
                try:
                    proc.communicate(input=b"q", timeout=20)
                except Exception:  # noqa: BLE001
                    proc.kill()
            # 關瀏覽器。Chrome 在長時間錄影後有時會在 teardown 崩潰，
            # 那是**關閉階段**的問題，不影響已寫入的 mp4，所以只警告不中斷。
            try:
                ctx.close()
            except Exception as exc:  # noqa: BLE001
                log(f"   （關閉瀏覽器時發生非致命錯誤，已忽略：{type(exc).__name__}）")

    raw = RAW / "demo_raw.mp4"
    if not args.no_record:
        size = raw.stat().st_size if raw.exists() else 0
        log(f"demo_raw.mp4 = {size/1024/1024:.1f} MB")
        if size < 200_000:
            log("!! 錄影檔過小，可能擷取失敗")
            return 5
    if run_error is not None:
        log(f"!! demo 步驟未完整跑完：{run_error}")
        return 6
    log("完成")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
