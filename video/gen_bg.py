#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
gen_bg.py — 程序化「生成」1080x1920@30 動畫背景（取代純色底）。

做法：低解析度 (270x480) float場上疊加 K 個漂移高斯光斑（種子確定性、
每段 run 用不同暖色 palette並在邊界 2s 交叉淡變），加 film grain 與
vignette，再 bicubic 放大到 1080x1920 逐幀輸出 PNG，最後 ffmpeg 合成
assets/bg/bg.mp4（h264 crf18）。demo 視窗內背景被 demo 蓋掉，給中性深色。

輸出：assets/bg/frames/g%05d.png、assets/bg/bg.mp4、assets/bg/samples/*.png
用法：python gen_bg.py            # 全部
     python gen_bg.py --smoke    # 只生 30 幀樣張
"""
from __future__ import annotations

import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
VIDEO = HERE
AUDIO = VIDEO / "assets" / "audio"
BG = VIDEO / "assets" / "bg"
FRAMES = BG / "frames"
SAMPLES = BG / "samples"
for d in (FRAMES, SAMPLES):
    d.mkdir(parents=True, exist_ok=True)

W, H, FPS = 1080, 1920, 30
LW, LH = 270, 480          # 低解析度場
HEAD_PAD = 1.2
TOTAL_TARGET = 176.0

# 每個非 demo run 的背景 palette：底色 + 光斑顏色們（品牌暖色系）
PALETTES = {
    "q_self":    ((26, 21, 18), [(226, 145, 138), (120, 80, 70)]),          # 深褐 + 玫瑰微光
    "title":     ((30, 23, 18), [(232, 179, 106), (200, 130, 80), (226, 145, 138)]),  # 琥珀暖光
    "rules":     ((24, 20, 19), [(210, 120, 100), (140, 90, 80)]),          # 暗紅暖
    "demo":      ((20, 17, 15), [(60, 55, 50)]),                            # 中性深（被 demo 蓋）
    "threegood": ((28, 22, 17), [(232, 179, 106), (240, 200, 130), (226, 145, 138)]),  # 金黃
    "tech":      ((24, 22, 20), [(232, 179, 106), (140, 180, 190), (226, 145, 138)]),  # 暖 + 一點藍綠（牆）
    "end":       ((32, 24, 17), [(240, 200, 130), (232, 179, 106), (226, 145, 138)]),  # 日出金
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
    vo_total = tl[-1]["end"]
    total = vo_total + HEAD_PAD + 3.164
    return wins, total


class BlobField:
    def __init__(self, seed: int, n: int = 12):
        rng = np.random.default_rng(seed)
        self.n = n
        self.bx = rng.uniform(0, 1, n)
        self.by = rng.uniform(0, 1, n)
        self.br = rng.uniform(0.10, 0.34, n)          # 光斑半徑（低解析比例）
        self.amp = rng.uniform(0.25, 1.0, n)
        self.px = rng.uniform(0, math.tau, n)         # 漂移相位
        self.py = rng.uniform(0, math.tau, n)
        self.sx = rng.uniform(0.008, 0.03, n)         # 漂移速度
        self.sy = rng.uniform(0.006, 0.02, n)
        self.pulse = rng.uniform(0.05, 0.25, n)       # 呼吸速度
        self.pp = rng.uniform(0, math.tau, n)

    def render(self, t: float, palette) -> np.ndarray:
        base_rgb, blob_rgbs = palette
        img = np.zeros((LH, LW, 3), dtype=np.float32)
        img[:] = np.array(base_rgb, dtype=np.float32) / 255.0
        yy, xx = np.mgrid[0:LH, 0:LW].astype(np.float32)
        xx /= LW
        yy /= LH
        # 長寬比校正：x 方向拉長（因為 9:16）
        aspect = LW / LH
        for i in range(self.n):
            cx = (self.bx[i] + self.sx[i] * math.sin(t * 0.11 + self.px[i])) % 1.0
            cy = (self.by[i] + self.sy[i] * math.cos(t * 0.09 + self.py[i])) % 1.0
            dx = (xx - cx) / (self.br[i] * aspect)
            dy = (yy - cy) / self.br[i]
            g = np.exp(-(dx * dx + dy * dy))
            a = self.amp[i] * (0.75 + 0.25 * math.sin(t * 0.23 + self.pp[i]))
            col = np.array(blob_rgbs[i % len(blob_rgbs)], dtype=np.float32) / 255.0
            img += g[:, :, None] * (col[None, None, :] * a) * 0.55
        return np.clip(img, 0, 1)


def vignette() -> np.ndarray:
    yy, xx = np.mgrid[0:LH, 0:LW].astype(np.float32)
    xx = (xx / LW - 0.5) * 2
    yy = (yy / LH - 0.5) * 2
    r = np.sqrt(xx * xx + yy * yy)
    return np.clip(1.15 - 0.55 * r, 0.35, 1.0)[:, :, None]


def palette_at(wins, t):
    """t 秒對應的 run palette；邊界 2s 內與前一段交叉淡變。"""
    cur = wins[0]
    for w in wins:
        if w[1] <= t <= w[2]:
            cur = w
            break
    else:
        cur = wins[-1] if t > wins[-1][2] else wins[0]
    # 找前一段做交叉淡變
    prev = None
    for w in wins:
        if w[2] <= t < w[1] if False else (w[2] <= t):
            prev = w
    if prev and cur is not prev and t - prev[2] < 2.0 and prev[2] < cur[1]:
        # 只在兩段之間的空隙交叉淡
        k = max(0.0, min(1.0, 1.0 - (t - prev[2]) / 2.0))
        pa, pb = PALETTES[prev[0]], PALETTES[cur[0]]
        base = tuple(int(a * k + b * (1 - k)) for a, b in zip(pa[0], pb[0]))
        cols = []
        for i in range(max(len(pa[1]), len(pb[1]))):
            ca = pa[1][i % len(pa[1])]
            cb = pb[1][i % len(pb[1])]
            cols.append(tuple(int(a * k + b * (1 - k)) for a, b in zip(ca, cb)))
        return (base, cols)
    return PALETTES[cur[0]]


def main() -> int:
    smoke = "--smoke" in sys.argv
    wins, total = load_runs()
    n_frames = int((total + 2.0) * FPS) if not smoke else 30
    print(f"[gen_bg] runs={[(w[0], round(w[1],2), round(w[2],2)) for w in wins]}")
    print(f"[gen_bg] total={total:.3f}s frames={n_frames} res={LW}x{LH}->{W}x{H}")
    field = BlobField(seed=20261105, n=12)
    vig = vignette()
    rng = np.random.default_rng(7)
    for f in range(n_frames):
        t = f / FPS
        pal = palette_at(wins, t)
        img = field.render(t, pal)
        img *= vig
        # film grain
        grain = rng.normal(0, 0.012, (LH, LW, 1)).astype(np.float32)
        img = np.clip(img + grain, 0, 1)
        # 慢速整體漂移（Ken Burns 微動）
        arr = (img * 255).astype(np.uint8)
        im = Image.fromarray(arr, "RGB").resize((W, H), Image.BICUBIC)
        im.save(FRAMES / f"g{f:05d}.png")
        if f % 300 == 0 or f == n_frames - 1:
            print(f"[gen_bg] {f+1}/{n_frames} t={t:.1f}s", flush=True)
        if smoke and f == 29:
            im.save(SAMPLES / "smoke.png")
    if smoke:
        print("[gen_bg] smoke done (30 frames)")
        return 0
    out = BG / "bg.mp4"
    subprocess.run([
        "ffmpeg", "-y", "-v", "error", "-framerate", str(FPS),
        "-i", str(FRAMES / "g%05d.png"),
        "-c:v", "libx264", "-preset", "medium", "-crf", "18",
        "-pix_fmt", "yuv420p", "-r", str(FPS),
        str(out),
    ], check=True)
    # 抽樣張
    for f in [0, 300, 900, 2400, 4200, 5279]:
        if (FRAMES / f"g{f:05d}.png").exists():
            Image.open(FRAMES / f"g{f:05d}.png").save(SAMPLES / f"sample_f{f:05d}.png")
    print(f"[gen_bg] DONE -> {out} ({out.stat().st_size/1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
