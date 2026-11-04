#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
render_frames.py — 逐幀渲染透明疊層。

開 file://.../index.html?export=1（esbuild 打包的靜態頁，內嵌 overlay.json），
每幀 t=round(f*1000/30)：clock.exportMode=true → clock.seekExport(t) → double-rAF →
page.screenshot(clip 1080x1920, omit_background=True) → assets/overlay/frames/f%05d.png

用法：
  python render_frames.py                 # 全部 5276 幀（f=0..5275）
  python render_frames.py 6 0             # 只渲 6 幀（從 f=0 起）— 冒煙測試
  python render_frames.py --at 30,400,880,1000,1650,4300,4520,5100   # 指定幀
預設 chromium 走 puppeteer 快取的 chrome；可用環境變數 OVERLAY_CHROME 覆寫。
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parent
FRAMES = VIDEO / "assets" / "overlay" / "frames"
PAGE = (HERE / "index.html").as_uri() + "?export=1"
CHROME = os.environ.get(
    "OVERLAY_CHROME",
    r"C:\Users\User\.cache\puppeteer\chrome\win64-152.0.7977.42\chrome-win64\chrome.exe",
)
W, H, FPS, N = 1080, 1920, 30, 5276


def parse_args() -> list[int]:
    argv = sys.argv[1:]
    if argv and argv[0] == "--at":
        return [int(x) for x in argv[1].split(",") if x.strip()]
    limit = int(argv[0]) if argv else N
    start = int(argv[1]) if len(argv) > 1 else 0
    return list(range(start, min(start + limit, N)))


def main() -> int:
    frames = parse_args()
    FRAMES.mkdir(parents=True, exist_ok=True)
    t0 = time.time()
    print(f"[render] page={PAGE}", flush=True)
    print(f"[render] chrome={CHROME}", flush=True)
    print(f"[render] frames={len(frames)} (of {N}) -> {FRAMES}", flush=True)
    with sync_playwright() as p:
        browser = p.chromium.launch(
            executable_path=CHROME,
            args=["--no-sandbox", "--disable-gpu", "--hide-scrollbars",
                  "--force-color-profile=srgb", "--disable-lcd-text"],
        )
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=1)
        page.goto(PAGE)
        page.wait_for_function("window.__overlayAPI && window.__overlayAPI.ready === true",
                               timeout=30000)
        page.evaluate("document.fonts.ready")  # 等 NotoSansTC-VF / msjh 就緒
        page.evaluate("window.__overlayAPI.clock.exportMode = true")
        page.wait_for_timeout(300)
        for i, f in enumerate(frames):
            t = round(f * 1000 / FPS)
            page.evaluate("(t)=>{ window.__overlayAPI.clock.seekExport(t) }", t)
            page.evaluate("new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))")
            page.screenshot(path=str(FRAMES / f"f{f:05d}.png"),
                            clip={"x": 0, "y": 0, "width": W, "height": H},
                            omit_background=True)
            if i % 100 == 0 or i == len(frames) - 1:
                el = time.time() - t0
                done = i + 1
                print(f"[render] {done}/{len(frames)}  f={f} t={t}ms  "
                      f"{el:.0f}s elapsed  {done / max(el, 0.001):.1f} f/s", flush=True)
        browser.close()
    print(f"[render] DONE  {time.time() - t0:.0f}s", flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
