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
    uv run --offline --with playwright --with pillow python record_demo.py --port 3210 --with-wall

`--with-wall` 會在本機自行拉起「好話牆雲端模式」所需的兩個行程：
    1. node video/mock_kv.cjs          → mock Vercel KV REST（127.0.0.1:59997，內建 seed 虛構牆資料）
    2. node C:\prodcut\app\server.js   → 本機網站，env 設 KV_REST_API_URL 指向 mock KV、
                                          OLLAMA_URL 指到死港（走 rules 引擎）
    等 /api/health 回報 engines.wall.enabled === true 後才開錄。
"""

from __future__ import annotations

import argparse
import json
import os
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

# ---- --with-wall 用的行程路徑 ----
NODE_EXE = os.environ.get("DSH_NODE") or (
    r"C:\Users\User\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
)
if not Path(NODE_EXE).exists():
    NODE_EXE = "node"  # 退回 PATH
APP_SERVER = r"C:\prodcut\app\server.js"
MOCK_KV = HERE / "mock_kv.cjs"
MOCK_KV_PORT = int(os.environ.get("MOCK_KV_PORT", "59997"))

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


def wait_health_wall(port: int, timeout: float = 40.0) -> dict:
    """等 /api/health 回來且 engines.wall.enabled === true，回傳 health JSON。"""
    deadline = time.time() + timeout
    last = None
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(
                f"http://127.0.0.1:{port}/api/health", timeout=2.0
            ) as r:
                h = json.loads(r.read().decode("utf-8"))
                last = h
                if (h.get("engines") or {}).get("wall", {}).get("enabled") is True:
                    return h
        except Exception as exc:  # noqa: BLE001
            last = exc
        time.sleep(0.4)
    raise RuntimeError(f"health 未達 wall.enabled=true：{last}")


def start_wall_stack(port: int, log) -> list[subprocess.Popen]:
    """--with-wall：spawn mock_kv.cjs + app/server.js（雲端牆模式），回傳行程清單。"""
    procs: list[subprocess.Popen] = []
    kv_log = (RAW / "mockkv.out.log").open("wb")
    kv_err = (RAW / "mockkv.err.log").open("wb")
    kv = subprocess.Popen([NODE_EXE, str(MOCK_KV)], stdout=kv_log, stderr=kv_err)
    procs.append(kv)
    if not wait_port(MOCK_KV_PORT, timeout=15.0):
        raise RuntimeError(f"mock KV ({MOCK_KV_PORT}) 沒有回應")
    log(f"mock KV 已啟動：127.0.0.1:{MOCK_KV_PORT}（seed 虛構牆資料）")

    env = dict(os.environ)
    env["PORT"] = str(port)
    env["KV_REST_API_URL"] = f"http://127.0.0.1:{MOCK_KV_PORT}"
    env["KV_REST_API_TOKEN"] = "test-token"
    env["OLLAMA_URL"] = "http://127.0.0.1:59999"      # 死港 → 走 rules 引擎
    env["OLLAMA_TIMEOUT_MS"] = "3000"                    # 死港會立刻 ECONNREFUSED，這只是保險
    env.pop("NVIDIA_API_KEY", None)                      # 不走雲端，避免真的打出去
    env.pop("NVKEY", None)
    srv_log = (RAW / "server.out.log").open("wb")
    srv_err = (RAW / "server.err.log").open("wb")
    srv = subprocess.Popen([NODE_EXE, APP_SERVER], env=env, stdout=srv_log, stderr=srv_err)
    procs.append(srv)

    h = wait_health_wall(port)
    log(f"app server 已啟動：127.0.0.1:{port}，wall.enabled="
        f"{h['engines']['wall']['enabled']}，ollama.alive={h['engines']['ollama']['alive']}")
    return procs


def stop_procs(procs: list[subprocess.Popen], log) -> None:
    for p in procs:
        try:
            p.terminate()
            p.wait(timeout=5)
        except Exception:  # noqa: BLE001
            try:
                p.kill()
            except Exception:  # noqa: BLE001
                pass
    if procs:
        log("已關閉 --with-wall 暫起的行程（mock_kv + app server）")


def demo_window_from_timeline() -> dict:
    """依 assemble.py 的公式從 timeline.json 推導 demo 視窗。

    含 card=="demo" 的段：起點 -1s 到結束 +1s（timeline 座標）；
    成片座標 = timeline + head_pad(1.2s)。
    """
    tl_path = HERE / "assets" / "audio" / "timeline.json"
    head_pad = 1.2
    try:
        tl = json.loads(tl_path.read_text(encoding="utf-8"))
        demo_segs = [t for t in tl if t.get("card") == "demo"]
        w0 = min(t["start"] for t in demo_segs) - 1.0
        w1 = max(t["end"] for t in demo_segs) + 1.0
    except Exception:  # noqa: BLE001
        w0, w1 = 42.15, 129.226
    return {
        "head_pad": head_pad,
        "demo_window_timeline": [round(w0, 3), round(w1, 3)],
        "demo_window_video": [round(w0 + head_pad, 3), round(w1 + head_pad, 3)],
        "demo_window_len": round(w1 - w0, 3),
    }


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
    ap.add_argument("--with-wall", action="store_true",
                    help="自行 spawn mock_kv.cjs + app/server.js（雲端牆模式，seed 虛構資料），錄完自動關閉")
    args = ap.parse_args()

    url = args.url or f"http://127.0.0.1:{args.port}/"

    # ---- --with-wall：先把 mock KV + app server 拉起來 ----
    wall_procs: list[subprocess.Popen] = []
    if args.with_wall:
        try:
            wall_procs = start_wall_stack(args.port, log)
        except Exception as exc:  # noqa: BLE001
            log(f"!! --with-wall 行程啟動失敗：{exc}")
            stop_procs(wall_procs, log)
            return 3
    elif not wait_port(args.port):
        log(f"!! 127.0.0.1:{args.port} 沒有回應 —— 網站尚未可跑（--with-wall 可自行拉起）")
        return 2

    try:
        return _run(args, url)
    finally:
        stop_procs(wall_procs, log)


def _run(args, url: str) -> int:
    from playwright.sync_api import sync_playwright  # noqa: PLC0415

    ui = load_ui()
    sys.path.insert(0, str(HERE))
    import demo_steps  # noqa: PLC0415

    demo_steps.ENTRY_URL["url"] = url
    demo_steps.WITH_WALL = bool(args.with_wall)

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

        # ---- 錄影前的防呆檢查 —— 在「不錄影」的暫用 context 上跑 ----
        # ★ 重要：preflight 會真的送出一次心事再量 maxScroll，這些動作
        #   **不可以進錄影**（會浪費 demo 視窗的秒數、且狀態不乾淨）。
        #   所以 preflight 用另一個沒有 record_video_dir 的 context，結束後關掉；
        #   正式錄影的 context 是全新的 → demo_raw.mp4 的 t=0 就是 demo 步驟起點，
        #   assemble.py 的 demo 視窗（raw[0:demo_len]）對到的正是 demo 步驟本身。
        pctx = browser.new_context(**{k: v for k, v in ctx_kwargs.items()
                                       if k not in ("record_video_dir", "record_video_size")})
        pctx.set_default_timeout(20000)
        page = pctx.new_page()
        page.set_viewport_size({"width": VIEW_W, "height": VIEW_H})
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
                pctx.close(); browser.close()
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
                pctx.close(); browser.close()
                return 8
            log(f"   ✓ maxScroll={max_scroll} ≥ {MIN_MAX_SCROLL}，捲動有效")
        except Exception as exc:  # noqa: BLE001
            log(f"!! 開錄前檢查失敗：{exc}")
            try:
                pctx.close(); browser.close()
            except Exception:  # noqa: BLE001
                pass
            return 7
        finally:
            # preflight context 用完即丟（它有送出過測試心事，localStorage 也髒了）
            try:
                pctx.close()
            except Exception:  # noqa: BLE001
                pass

        # ---- 正式錄影 context：全新、乾淨、從 t=0 開始錄 demo ----
        ctx = browser.new_context(**ctx_kwargs)
        ctx.set_default_timeout(20000)
        page = ctx.new_page()
        page.set_viewport_size({"width": VIEW_W, "height": VIEW_H})

        try:
            log("執行 demo 步驟…")
            t0 = time.time()
            demo_steps.run(page, ui, log)
            took = time.time() - t0
            win = demo_window_from_timeline()
            state = demo_steps.get_state()
            log(f"demo 步驟實測 {took:.1f}s（demo 視窗 {win['demo_window_len']:.3f}s，"
                f"成片座標 {win['demo_window_video'][0]:.2f}-{win['demo_window_video'][1]:.2f}s）")
            fit = took <= win["demo_window_len"] + 0.5
            if not fit:
                log(f"!! 實測 {took:.1f}s 超出 demo 視窗 {win['demo_window_len']:.3f}s —— "
                    f"成片尾端會被 trim 切掉，請刪減 demo_steps 步驟")
            timing = {
                "with_wall": bool(args.with_wall),
                "seconds": round(took, 2),                 # demo 步驟實際秒數（= raw 起訖）
                "demo_start_raw": 0.0,                      # preflight 不錄影，raw t=0 即 demo 起點
                "demo_end_raw": round(took, 2),
                "fit_window": fit,
                "marks": state.get("marks", {}),
                "evidence": state.get("evidence", {}),
                **win,                                      # head_pad / demo_window_* / demo_window_len
                "note": "demo_raw.mp4 的 [0, demo_window_len) 被 assemble 疊進成片；"
                        "成片座標 = timeline 座標 + head_pad(1.2s)",
            }
            (RAW / "demo_timing.json").write_text(
                json.dumps(timing, ensure_ascii=False, indent=2),
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
