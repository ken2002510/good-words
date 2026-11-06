#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_bg_img.py — 用 Google Flow 生成的 6 張 9:16 背景圖，組出 1080x1920@30 的
Ken Burns 動畫背景 bg.mp4（每個 timeline run 一張圖，慢 zoom 1.0→1.10，
段間 0.5s crossfade）。demo 視窗用深色段（會被 demo 錄影蓋掉）。

輸入：assets/bg/img/{q_self,title,rules,threegood,tech,end}.png|jpg（768x1376 或任意 9:16）
輸出：assets/bg/bg.mp4（total+2 秒，h264 crf18 yuv420p）

用法：python gen_bg_img.py
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
AUDIO = HERE / "assets" / "audio"
BG = HERE / "assets" / "bg"
IMG = BG / "img"
TMP = BG / "_segs"
W, H, FPS = 1080, 1920, 30
HEAD_PAD = 1.2
DEMO_BG = "0x141110"

RUN_IMG = {
    "q_self": "q_self",
    "title": "title",
    "rules": "rules",
    "demo": None,          # 深色段
    "threegood": "threegood",
    "tech": "tech",
    "end": "end",
}


def load_runs():
    tl = json.loads((AUDIO / "timeline.json").read_text(encoding="utf-8"))
    runs = []
    for it in tl:
        c = it.get("card", "")
        if runs and runs[-1][0] == c:
            runs[-1][2] = it["end"]
        else:
            runs.append([c, it["start"], it["end"]])
    wins = []
    for c, s, e in runs:
        if c == "demo":
            wins.append((c, s - 1.0 + HEAD_PAD, e + 1.0 + HEAD_PAD))
        else:
            wins.append((c, s + 0.15 + HEAD_PAD, e - 0.15 + HEAD_PAD))
    total = tl[-1]["end"] + HEAD_PAD + 3.164
    return wins, total


def find_img(name: str) -> Path:
    for ext in (".png", ".jpg", ".jpeg", ".webp"):
        for cand in (IMG / f"{name}{ext}", IMG / f"gwbg-{name}{ext}"):
            if cand.exists():
                return cand
    # 也接受 gwbg-01..06 依 RUN_IMG順序
    raise FileNotFoundError(f"找不到背景圖: {IMG}/{name}.*")


def prep_image(src: Path, dst: Path):
    """9:16 圖 → 1296x2304（1.2x 上緣，給 zoompan 放大空間），LANCZOS。"""
    im = Image.open(src).convert("RGB")
    im = im.resize((1296, 2304), Image.LANCZOS)
    im.save(dst, quality=95)


def make_seg_img(img_path: Path, dur: float, out: Path):
    n = max(2, int(round(dur * FPS)))
    # zoompan：從 1.0 放大到 1.10，中心微幅漂移
    vf = (
        "zoompan=z='min(1+0.10*on/%d,1.10)':x='iw/2-(iw/zoom/2)+6*sin(2*PI*on/%d)':"
        "y='ih/2-(ih/zoom/2)+8*cos(2*PI*on/%d)':d=%d:s=%dx%d:fps=%d,"
        "scale=%d:%d:flags=lanczos,format=yuv420p"
        % (n, n, n, n, W, H, FPS, W, H)
    )
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-loop", "1", "-framerate", str(FPS), "-i", str(img_path),
        "-vf", vf, "-frames:v", str(n),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        str(out),
    ], check=True)


def make_seg_color(dur: float, out: Path):
    n = max(2, int(round(dur * FPS)))
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "lavfi", "-i", f"color=c={DEMO_BG}:s={W}x{H}:r={FPS}",
        "-frames:v", str(n),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-pix_fmt", "yuv420p",
        str(out),
    ], check=True)


def main() -> int:
    wins, total = load_runs()
    IMG.mkdir(parents=True, exist_ok=True)
    TMP.mkdir(parents=True, exist_ok=True)
    for d in TMP.glob("seg*.mp4"):
        d.unlink()
    print(f"[gen_bg_img] total={total:.3f}s runs={[(w[0], round(w[1],2), round(w[2],2)) for w in wins]}")

    # 連續覆蓋 [0, total+2]：頭段用第一張圖補到第一個 run 起點；
    # run 之間的空隙用「前一段」的圖延伸，避免 concat 時時間軸跑掉
    cover = []  # (name, a, b)
    t = 0.0
    prev_name = wins[0][0]
    for (name, a, b) in wins:
        if a > t + 0.01:
            cover.append((prev_name, t, a))
        cover.append((name, max(a, t), b))
        t = b
        prev_name = name
    if total + 2.0 > t + 0.01:
        cover.append((prev_name, t, total + 2.0))

    segs = []
    for i, (name, a, b) in enumerate(cover):
        dur = b - a
        if dur <= 0.05:
            continue
        out = TMP / f"seg{i:02d}_{name}.mp4"
        key = RUN_IMG.get(name)
        if key:
            src = find_img(key)
            prep = TMP / f"prep_{key}.jpg"
            if not prep.exists():
                prep_image(src, prep)
            make_seg_img(prep, dur, out)
            print(f"[gen_bg_img] seg{i:02d} {name} {a:.2f}-{b:.2f} img={src.name}")
        else:
            make_seg_color(dur, out)
            print(f"[gen_bg_img] seg{i:02d} {name} {a:.2f}-{b:.2f} (color)")
        segs.append(out)

    lst = TMP / "list.txt"
    lst.write_text("".join(f"file '{s}'\n" for s in segs), encoding="utf-8")
    out = BG / "bg.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error",
        "-f", "concat", "-safe", "0", "-i", str(lst),
        "-t", f"{total + 2.0:.3f}",
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS), "-movflags", "+faststart",
        str(out),
    ], check=True)
    print(f"[gen_bg_img] DONE -> {out} ({out.stat().st_size/1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
