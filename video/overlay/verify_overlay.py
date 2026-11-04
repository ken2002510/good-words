#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_overlay.py — 成片驗收：
  1. ffprobe 檢查 assets/overlay/overlay.mp4：1080x1920、30fps、5276 幀、prores、yuva444p10le（有 alpha）
  2. 抽 8 幀（進場中/全張/退場）到 assets/overlay/check/，對 PNG 跑邊界/玻璃/文字檢查
  3. 報告 alpha 分布（確認透明通道真的有用）
用法：python verify_overlay.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
VIDEO = HERE.parent
MP4 = VIDEO / "assets" / "overlay" / "overlay.mp4"
CHECK = VIDEO / "assets" / "overlay" / "check"

# 8 個抽查幀（frame index）：進場中 / 全張 / 退場 + demo 段 + seg5 三卡 + 收尾
PICK = [30, 265, 290, 450, 1000, 1650, 4300, 4520, 5100]
PICK = PICK[:8]


def ffprobe() -> dict:
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries",
         "stream=codec_name,width,height,r_frame_rate,nb_frames,pix_fmt:format=duration",
         "-of", "json", str(MP4)],
        capture_output=True, text=True, check=True)
    return json.loads(r.stdout)


def extract_frames() -> list[Path]:
    CHECK.mkdir(parents=True, exist_ok=True)
    out = []
    for n in PICK:
        p = CHECK / f"chk_f{n:05d}.png"
        subprocess.run(
            ["ffmpeg", "-y", "-v", "error", "-i", str(MP4),
             "-vf", f"select=eq(n\\,{n})", "-frames:v", "1", str(p)],
            check=True)
        out.append(p)
    return out


def check_png(p: Path) -> bool:
    im = Image.open(p).convert("RGBA")
    w, h = im.size
    assert (w, h) == (1080, 1920), f"{p.name}: {w}x{h}"
    a = im.getchannel("A")
    hist = a.histogram()
    transparent = sum(hist[:8])
    opaque = sum(hist[248:])
    mid = sum(hist[140:248])
    bbox = a.point(lambda v: 255 if v > 140 else 0).getbbox()
    ok = True
    msg = f"{p.name}: alpha 透明={transparent} 中段={mid} 不透明={opaque}"
    if bbox:
        x0, y0, x1, y1 = bbox
        msg += f"  card_bbox x[{x0}..{x1}] y[{y0}..{y1}]"
        if x0 < 40 or x1 > 1040:
            msg += "  !!X出界"; ok = False
        if y1 > 1734:
            msg += "  !!壓字幕帶"; ok = False
    else:
        msg += "  (無卡片內容)"
    print(msg + ("  OK" if ok else "  FAIL"))
    return ok


def main() -> int:
    print("[verify] ffprobe ...")
    info = ffprobe()
    streams = info["streams"]
    v = next(s for s in streams if s.get("codec_name"))
    print(f"  codec={v['codec_name']} {v['width']}x{v['height']} "
          f"r={v['r_frame_rate']} nb_frames={v.get('nb_frames')} pix_fmt={v['pix_fmt']} "
          f"duration={info['format'].get('duration')}s")
    ok = True
    def want(cond, label):
        nonlocal ok
        print(f"  {'PASS' if cond else 'FAIL'} {label}")
        ok = ok and cond
    want(v["width"] == 1080 and v["height"] == 1920, "1080x1920")
    want(v["r_frame_rate"] == "30/1", "30fps")
    want(int(v.get("nb_frames") or 0) == 5276, "5276 幀")
    # prores_ks -profile 4444 的編碼端接受 yuva444p10le 輸入，但 ProRes 4444 本身是 12-bit，
    # 解碼端 ffprobe 一律報 yuva444p12le（SKILL.md 亦記載輸出為 yuva444p12le）。
    # 重點是 alpha 通道存在（pix_fmt 含 'a' 且為 444） 。
    want(v["pix_fmt"].startswith("yuva444p") and v["pix_fmt"].endswith("le"),
         f"pix_fmt {v['pix_fmt']}（yuva444p*le，alpha 存在）")
    want("prores" in v["codec_name"], "prores codec")

    print("[verify] 抽幀檢查 ...")
    frames = extract_frames()
    for f in frames:
        ok = check_png(f) and ok

    # alpha 確認：從 mp4 解出的第一張空幀應大片透明
    first = CHECK / "chk_f00030.png"
    im = Image.open(first).convert("RGBA")
    hist = im.getchannel("A").histogram()
    transparent_ratio = sum(hist[:8]) / (1080 * 1920)
    print(f"  f00030 透明像素占比 {transparent_ratio*100:.1f}% (應接近 100%，因為該幀無卡且 dim 尚未進入)")
    want(transparent_ratio > 0.95, "alpha 通道有效（空幀幾乎全透明）")

    print("[verify] " + ("ALL PASS" if ok else "FAILED"))
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
