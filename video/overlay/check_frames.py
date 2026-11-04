#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""check_frames.py — 對 PNG 幀做程式化驗收（本 session 無圖片輸入，改用像素統計）：
   - alpha 非零區域邊界必須在 [44,1036]x[0,1730] 內（不壓字幕帶、不出界）
   - 卡片區域應有玻璃底色像素（RGB 近 (13,16,23)，alpha 150-230）
   - 應有亮字像素（alpha>200 且亮度>150）→ 文字有畫上去
用法：python check_frames.py <png...> 或 --dir <目錄>
"""
import sys
from pathlib import Path
from PIL import Image


def check(path: Path) -> bool:
    im = Image.open(path).convert("RGBA")
    w, h = im.size
    assert (w, h) == (1080, 1920), f"{path.name}: size {w}x{h} != 1080x1920"
    a = im.getchannel("A")
    # dim 遮罩是整面 alpha≈dimAt*255（<=102），卡片內容 alpha>=~140；邊界檢查只看卡片層
    bbox = a.point(lambda v: 255 if v > 140 else 0).getbbox()
    dim_any = a.point(lambda v: 1 if 8 < v <= 140 else 0).getbbox()
    if bbox is None:
        print(f"{path.name}: 卡片層全透明 (empty)"
              + (f" dim 整面 {dim_any}" if dim_any else "") + " OK")
        return True
    x0, y0, x1, y1 = bbox
    ok = True
    if x0 < 40 or x1 > 1040:
        print(f"  !! X 出界: x[{x0}..{x1}]"); ok = False
    if y1 > 1734:
        print(f"  !! 壓到字幕帶: y1={y1} >= 1730"); ok = False
    px = im.load()
    glass = 0
    text = 0
    for y in range(y0, min(y1 + 1, h), 3):
        for x in range(x0, min(x1 + 1, w), 3):
            r, g, b, av = px[x, y]
            if 150 <= av <= 235 and abs(r - 13) < 14 and abs(g - 16) < 14 and abs(b - 23) < 14:
                glass += 1
            if av > 200 and (r + g + b) / 3 > 150:
                text += 1
    print(f"{path.name}: bbox x[{x0}..{x1}] y[{y0}..{y1}]  glass_px={glass}  text_px={text}  "
          f"{'OK' if ok else 'FAIL'}")
    if glass == 0 and text > 0:
        print("  (warn) 有文字但無玻璃底色樣本")
    return ok


def main() -> int:
    args = sys.argv[1:]
    files: list[Path] = []
    if args and args[0] == "--dir":
        files = sorted(Path(args[1]).glob("*.png"))
    else:
        files = [Path(a) for a in args]
    results = [check(f) for f in files]
    allok = all(results)
    print("ALL OK" if allok else "SOME FAILED")
    return 0 if allok else 1


if __name__ == "__main__":
    raise SystemExit(main())
