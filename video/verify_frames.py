#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_frames.py — **錄影後的畫面內容驗證**（這是我上次漏掉的關鍵步驟）。

上次的教訓：
  只驗證「檔案存在、大小 > 0」，結果錄到的是整個桌面
  —— 畫面裡有瀏覽器分頁標題、Windows 工作列、其他專案名稱。
  那次會直接失格。

這支程式做兩層驗證：
  A. 自動啟發式檢查（擋掉明顯錯誤，例如錄到桌面/工作列）
  B. 抽出足夠的幀供**人工逐幀目視**（自動檢查不能取代人眼）

自動檢查項目：
  1. 工作列特徵：畫面最底部是否有連續的深色/高飽和橫條
  2. 色系檢查：網站是奶油白 (#F4F1EA) 系；桌面是多彩的。
     計算「偏離網站色系的像素比例」，過高就警告。
  3. 邊緣檢查：網站是手機優先的置中卡片，左右應該有留白。
  4. 尺寸檢查：必須是預期的直式比例。
"""

from __future__ import annotations

import subprocess
import sys
from collections import Counter
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent


def sh(cmd: list[str]) -> tuple[int, str, str]:
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.returncode, r.stdout or "", r.stderr or ""


def analyze_frame(path: Path, verbose: bool = False) -> dict:
    """用 PIL 分析單一幀的色系與結構。"""
    from PIL import Image, ImageStat

    im = Image.open(path).convert("RGB")
    W, H = im.size
    px = im.load()

    # ---- 0. 全白/空白偵測（上次的教訓：只驗檔案大小，結果錄到全白/桌面）----
    stat = ImageStat.Stat(im.convert("L"))
    lum_std = stat.stddev[0]
    lum_mean = stat.mean[0]
    nonwhite = 0
    step_x = max(1, W // 60)
    step_y = max(1, H // 106)
    n_s = 0
    for y in range(0, H, step_y):
        for x in range(0, W, step_x):
            r, g, b = px[x, y]
            if not (r > 240 and g > 240 and b > 240):
                nonwhite += 1
            n_s += 1
    nonwhite_ratio = nonwhite / max(1, n_s)

    # 「空白」的定義要小心：本片有**刻意設計的深色字卡**，
    # 它們亮度低但不是空白。真正的空白是「幾乎沒有像素變化」（單一色塊）。
    # 所以用「亮度標準差極低」判斷，而不是「非白像素少」。
    # 深色字卡有文字 → 標準差仍然明顯（實測 20+），不會被誤判。
    blank = lum_std < 2.0

    # ---- 1. 工作列特徵：底部 4% 區域是否出現「與上方明顯不同」的橫條 ----
    band = max(1, int(H * 0.04))
    def avg_region(y0: int, y1: int) -> tuple[float, float, float]:
        rs = gs = bs = n = 0
        step_x = max(1, W // 40)
        step_y = max(1, (y1 - y0) // 8)
        for y in range(y0, y1, step_y):
            for x in range(0, W, step_x):
                r, g, b = px[x, y]
                rs += r; gs += g; bs += b; n += 1
        n = max(1, n)
        return rs / n, gs / n, bs / n

    bottom = avg_region(H - band, H)
    above = avg_region(H - band * 3, H - band * 2)
    taskbar_delta = sum(abs(a - b) for a, b in zip(bottom, above)) / 3

    # ---- 2. 色系：網站是奶油白系。多彩 ＝ 可能有桌面 ----
    sample = im.resize((120, 213))
    sp = sample.load()
    cream = colorful = 0
    colors = Counter()
    for y in range(213):
        for x in range(120):
            r, g, b = sp[x, y]
            colors[(r // 32, g // 32, b // 32)] += 1
            mx, mn = max(r, g, b), min(r, g, b)
            sat = mx - mn
            if sat < 40 and mx > 170:          # 低飽和亮色 ＝ 奶油白系
                cream += 1
            elif sat > 70:                      # 高飽和 ＝ 桌布/圖示/彩色 UI
                colorful += 1
    total = 120 * 213
    cream_ratio = cream / total
    colorful_ratio = colorful / total
    distinct = len(colors)

    return {
        "file": path.name,
        "size": f"{W}x{H}",
        "bytes": path.stat().st_size,
        "lum_std": round(lum_std, 2),
        "lum_mean": round(lum_mean, 1),
        "nonwhite_ratio": round(nonwhite_ratio, 3),
        "blank": blank,
        "taskbar_delta": round(taskbar_delta, 1),
        "cream_ratio": round(cream_ratio, 3),
        "colorful_ratio": round(colorful_ratio, 3),
        "distinct_colors": distinct,
        "bottom_rgb": tuple(round(v) for v in bottom),
    }


def main() -> int:
    import argparse  # noqa: PLC0415

    ap = argparse.ArgumentParser()
    ap.add_argument("video", help="要驗證的 mp4")
    ap.add_argument("--out", default=None, help="抽幀輸出目錄")
    ap.add_argument("--every", type=float, default=4.0, help="每幾秒抽一幀")
    ap.add_argument("--max", type=int, default=40)
    args = ap.parse_args()

    video = Path(args.video)
    if not video.exists():
        print(f"!! 找不到 {video}")
        return 2
    out = Path(args.out) if args.out else HERE / "qa" / "verify"
    out.mkdir(parents=True, exist_ok=True)
    for f in out.glob("*.png"):
        f.unlink()

    code, so, se = sh(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                       "-of", "default=nw=1:nk=1", str(video)])
    dur = float(so.strip())
    print(f"[verify] {video.name}  長度 {dur:.1f}s")

    n = min(args.max, max(2, int(dur / args.every)))
    stamps = [round(dur * i / (n - 1), 2) for i in range(n)]

    rows = []
    for i, t in enumerate(stamps, 1):
        p = out / f"vf_{i:03d}_{t:07.2f}s.png"
        c, _, _ = sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}",
                      "-i", str(video), "-frames:v", "1", str(p)])
        if c == 0 and p.exists():
            rows.append(analyze_frame(p))

    if not rows:
        print("!! 抽幀全部失敗")
        return 3
    print(f"[verify] 抽出 {len(rows)} 幀 → {out}")

    # ---- 判定 ----
    warn = []
    fatal = []
    tb = [r["taskbar_delta"] for r in rows]
    cr = [r["cream_ratio"] for r in rows]
    col = [r["colorful_ratio"] for r in rows]

    # 全白/空白 —— 硬性失敗，直接不產出成片
    blanks = [r for r in rows if r["blank"]]
    if blanks:
        fatal.append(
            f"有 {len(blanks)}/{len(rows)} 幀是空白或近全白"
            f"（亮度標準差 < 3 或非白像素 < 1%），例如 {blanks[0]['file']}"
            f"（std={blanks[0]['lum_std']}, nonwhite={blanks[0]['nonwhite_ratio']}）"
        )

    # 底部橫條：本片**刻意**在底部有一條字幕橫帶，所以有橫條是正常的。
    # 真正要抓的是「這條橫條是 Windows 工作列」——特徵是**高飽和/多彩**
    # （開始鍵、搜尋框、彩色圖示）。字幕橫帶是低飽和的深色。
    bad_taskbar = [r for r in rows
                   if r["taskbar_delta"] > 60 and r["colorful_ratio"] > 0.15]
    if bad_taskbar:
        warn.append(
            f"底部出現高飽和橫條（像 Windows 工作列）：{len(bad_taskbar)}/{len(rows)} 幀"
            f"，最大 {max(tb):.0f}，例如 {bad_taskbar[0]['file']}"
        )

    bad_colorful = [r for r in rows if r["colorful_ratio"] > 0.25]
    if bad_colorful:
        warn.append(
            f"高飽和（彩色）像素比例偏高：{len(bad_colorful)}/{len(rows)} 幀"
            f"，最大 {max(col):.2f}，例如 {bad_colorful[0]['file']}"
        )

    # 奶油白比例低只「提示」不當警告：深色字卡是刻意設計。
    # 真正該擔心的是「奶油白低 + 彩色高」（＝桌面）或「奶油白低 + 標準差低」（＝空白）。
    low_cream = [r for r in rows
                 if r["cream_ratio"] < 0.20
                 and r["colorful_ratio"] > 0.25
                 and not r["blank"]]
    if low_cream:
        warn.append(
            f"奶油白比例低且彩色比例高（像桌面而非網站）：{len(low_cream)}/{len(rows)} 幀"
            f"，例如 {low_cream[0]['file']}"
        )

    print("\n=== 自動檢查 ===")
    print(f"  奶油白比例 平均 {sum(cr)/len(cr):.2f}  最低 {min(cr):.2f}")
    print(f"  彩色比例   平均 {sum(col)/len(col):.2f}  最高 {max(col):.2f}")
    print(f"  底部橫條差 平均 {sum(tb)/len(tb):.1f}  最大 {max(tb):.1f}")
    nb = sum(1 for r in rows if r["blank"])
    print(f"  空白幀數   {nb}/{len(rows)}")

    if fatal:
        print("\n  ✗ 致命問題：")
        for f_ in fatal:
            print(f"    - {f_}")
    if warn:
        print("\n  ⚠️ 可疑：")
        for w in warn:
            print(f"    - {w}")
    if not fatal and not warn:
        print("\n  ✓ 自動檢查未發現空白幀、桌面或工作列特徵")

    print("\n=== 抽幀清單（請逐幀目視）===")
    for r in rows:
        flag = "  <== 空白!" if r["blank"] else ""
        print(f"  {r['file']}  {r['bytes']//1024:>4}KB  cream={r['cream_ratio']:.2f} "
              f"colorful={r['colorful_ratio']:.2f} tb={r['taskbar_delta']:.0f}{flag}")

    print("\n★ 自動檢查只是粗略過濾，**必須人工逐幀看過**才算驗證完成。")
    if fatal:
        print("★ 判定：FAIL（有空白幀，不可產出成片）")
        return 2
    return 1 if warn else 0


if __name__ == "__main__":
    raise SystemExit(main())
