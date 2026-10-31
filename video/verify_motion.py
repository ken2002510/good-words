#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_motion.py — 驗證「畫面上真的有在動」（時間軸上的變化）。

## 為什麼需要這支程式（第三個教訓）

  教訓 1：只驗「檔案存在、大小 > 0」 → 結果錄到整個桌面。
  教訓 2：只驗「單張畫面的內容」     → 結果 Demo 段整段凍結。
  教訓 3（本檔）：要驗的是**時間軸上的變化**。

先前 Demo 段被量到：網站區域（字幕帶除外）平均像素差 0.87、97% 時間不動
—— 因為 viewport 設成 1080x1920 使 maxScroll=0，所有捲動都是 no-op。

## 判準

裁掉底部字幕帶，只比較網站區域，fps=2 取樣相鄰幀的平均像素差：
  * 全片       ：變化步數比例 ≥ 15%
  * Demo 段    ：變化步數比例 ≥ 15%（任務要求）
低於門檻 → FAIL，不進組裝。

排除字幕帶很重要：字幕一直在換行，會讓「全片」看起來很會動，
把畫面凍結的事實蓋掉（我上次就是被這個騙了）。
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent

FW, FH = 135, 215          # 縮圖尺寸（快又夠敏感）
SUB_BAND = 190             # 底部字幕帶高度（assemble.py 用同一個值）


def measure(video: Path, fps: int = 2) -> tuple[list[float], int, int]:
    """回傳 (每步平均像素差, 寬, 高)。裁掉底部字幕帶。"""
    # 先取得影片高度
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", str(video)],
        capture_output=True, text=True)
    w, h = (int(x) for x in r.stdout.strip().split(","))
    crop_h = h - SUB_BAND
    if crop_h % 2:
        crop_h -= 1

    r = subprocess.run([
        "ffmpeg", "-v", "error", "-i", str(video),
        "-vf", f"fps={fps},crop={w}:{crop_h}:0:0,scale={FW}:{FH},format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ], capture_output=True)
    raw = r.stdout
    fsz = FW * FH
    n = len(raw) // fsz
    frames = [raw[i * fsz:(i + 1) * fsz] for i in range(n)]
    diffs = []
    for i in range(1, n):
        a, b = frames[i - 1], frames[i]
        diffs.append(sum(abs(x - y) for x, y in zip(a, b)) / fsz)
    return diffs, w, h


def report(name: str, seg: list[float], need: float = 15.0) -> bool:
    if not seg:
        print(f"  {name}: 無資料")
        return False
    big = sum(1 for d in seg if d > 2.0)
    pct = 100 * big / len(seg)
    mean = sum(seg) / len(seg)
    ok = pct >= need
    print(f"  {name:22s} n={len(seg):4d}  mean={mean:7.3f}  max={max(seg):7.2f}  "
          f"變化步數={pct:5.1f}%  {'✓' if ok else '✗'} (需 ≥{need}%)")
    return ok


def main() -> int:
    import argparse  # noqa: PLC0415

    ap = argparse.ArgumentParser()
    ap.add_argument("video")
    ap.add_argument("--demo-start", type=float, default=42.9)
    ap.add_argument("--demo-end", type=float, default=141.7)
    ap.add_argument("--need", type=float, default=15.0)
    args = ap.parse_args()

    video = Path(args.video)
    if not video.exists():
        print(f"!! 找不到 {video}")
        return 2

    diffs, w, h = measure(video)
    total = len(diffs) / 2.0
    print(f"[motion] {video.name}  裁掉底部 {SUB_BAND}px 字幕帶，只比網站區域")
    print(f"[motion] 取樣 fps=2，共 {len(diffs)} 步（約 {total:.1f}s）\n")

    print("=== 變化率 ===")
    ok_all = report("全片", diffs, args.need)
    demo = diffs[int(args.demo_start * 2):int(args.demo_end * 2)]
    ok_demo = report(f"Demo {args.demo_start:.0f}-{args.demo_end:.0f}s", demo, args.need)

    # 最長凍結區段
    longest, run_start, cur_best = 0, None, (0, 0.0, 0.0)
    for i, d in enumerate(diffs):
        if d < 2.0:
            if run_start is None:
                run_start = i
        else:
            if run_start is not None:
                ln = i - run_start
                if ln > cur_best[0]:
                    cur_best = (ln, run_start / 2, i / 2)
                run_start = None
    if run_start is not None and (len(diffs) - run_start) > cur_best[0]:
        cur_best = (len(diffs) - run_start, run_start / 2, len(diffs) / 2)
    print(f"\n  最長連續凍結：{cur_best[0]/2:.1f}s（{cur_best[1]:.1f}s → {cur_best[2]:.1f}s）")

    # 逐 10 秒
    print("\n=== 每 10 秒 mean diff ===")
    for s in range(0, int(total), 10):
        seg = diffs[s * 2:(s + 10) * 2]
        if seg:
            flag = "  <== 凍結" if sum(seg) / len(seg) < 0.5 else ""
            print(f"  {s:3d}-{s+10:3d}s  mean={sum(seg)/len(seg):7.3f}  "
                  f"max={max(seg):7.2f}{flag}")

    verdict = ok_all and ok_demo
    print(f"\n=== 判定：{'PASS' if verdict else 'FAIL'} ===")
    if not verdict:
        print("  （畫面變化不足 → 疑似靜態輪播或捲動失效，不可進組裝）")
    return 0 if verdict else 1


if __name__ == "__main__":
    raise SystemExit(main())
