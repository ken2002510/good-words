#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_bg_from_shots.py — 用**真實產品截圖**做「有意義的背景」，取代原本的抽象光斑圖。

理由（使用者反映「背景太沒意義」）：原本 6 張 Flow 抽象圖與內容無關，看起來像填充物。
改成每段用**該段相關的真實網站畫面**，經高斯模糊 + 壓暗 + 暗角處理：
畫面隱約看得出產品本身，文字卡與字幕仍清楚可讀。

對應：
  q_self   ← S1_home_clean（輸入心事的地方）
  title    ← S2_rewrite_result（核心輸出：承接／好話／小步）
  rules    ← S3_response_3part（三段回應）
  threegood← S4_wall_after_publish（好話牆）
  tech     ← S8_leaderboard_top10（排行榜／我的紀錄）
  end      ← S10_mobile_375_home（手機優先）

輸出：assets/bg/img/{name}.jpg（gen_bg_img.py 會拿去做 Ken Burns 推鏡）
"""
from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
SHOTS = HERE / "assets" / "shots"
OUT = HERE / "assets" / "bg" / "img"
OUT.mkdir(parents=True, exist_ok=True)
W, H = 1080, 1920

MAP = {
    "q_self": "S1_home_clean",
    "title": "S2_rewrite_result",
    "rules": "S3_response_3part",
    "threegood": "S4_wall_after_publish",
    "tech": "S8_leaderboard_top10",
    "end": "S10_mobile_375_home",
}


def cover(im: Image.Image, w: int, h: int) -> Image.Image:
    r = max(w / im.width, h / im.height)
    im = im.resize((max(1, int(im.width * r)), max(1, int(im.height * r))), Image.LANCZOS)
    x = (im.width - w) // 2
    y = (im.height - h) // 2
    return im.crop((x, y, x + w, y + h))


def vignette(w: int, h: int, strength: float = 0.55) -> np.ndarray:
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    xx = (xx / w - 0.5) * 2
    yy = (yy / h - 0.5) * 2
    r = np.sqrt(xx * xx + yy * yy)
    return np.clip(1.0 - strength * r ** 1.4, 0.35, 1.0)[:, :, None]


def main() -> int:
    vig = vignette(W, H)
    for name, shot in MAP.items():
        p = SHOTS / f"{shot}.png"
        if not p.exists():
            print(f"!! 缺截圖 {p}")
            return 1
        im = cover(Image.open(p).convert("RGB"), W, H)
        # 模糊 10px（而非 30px）：仍看得出是網站的版面（導覽列／卡片／按鈕），
        # 但細節糊掉不會搶文字。30px 時被視覺審查判為「看不出是網站、仍像抽象光斑」。
        im = im.filter(ImageFilter.GaussianBlur(10))
        a = np.asarray(im).astype(np.float32)
        a *= 0.46                                             # 壓暗到 46%（保留可辨識度）
        a *= vig
        a += np.array([12, 8, 6], dtype=np.float32)           # 一點暖色底
        out = np.clip(a, 0, 255).astype(np.uint8)
        dst = OUT / f"{name}.jpg"
        Image.fromarray(out).save(dst, quality=92)
        print(f"[bg] {name:10s} ← {shot:26s} -> {dst.name} "
              f"(mean {out.reshape(-1,3).mean(axis=0).round(1)}, std {out.std():.1f})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
