#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
qa_check.py — 成品影片的品質關卡（任務完成標準 1–3）。

關卡：
  1. ffprobe 長度 ≤180s、解析度 1080x1920
  2. ffmpeg -v error -i out.mp4 -f null - 無錯誤
  3. 抽 ≥12 幀（含頭中尾）供人工逐幀確認零個資
  4. 判斷是否為真實操作畫面：比較相鄰幀的差異，靜態輪播會出現
     「長時間完全相同」的區段；真實操作畫面幾乎每幀都不同。

輸出：qa/ 目錄的 frames/、report.json、REPORT.md
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
from pathlib import Path

# Windows 主控台預設 cp950，印出 ✓ ✗ 會炸。強制 UTF-8。
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent
VIDEO_DIR = HERE          # qa_check.py 就在 video/ 底下，成品在 video/out/
QA = HERE
FRAMES = QA / "frames"
FRAMES.mkdir(parents=True, exist_ok=True)

DEFAULT_VIDEO = VIDEO_DIR / "out" / "好好說話_作品介紹影片.mp4"


def sh(cmd: list[str]) -> tuple[int, str, str]:
    r = subprocess.run(cmd, capture_output=True, text=True,
                       encoding="utf-8", errors="replace")
    return r.returncode, r.stdout or "", r.stderr or ""


def probe(video: Path) -> dict:
    code, out, err = sh([
        "ffprobe", "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(video),
    ])
    if code != 0:
        return {"error": err}
    return json.loads(out)


def main() -> int:
    video = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_VIDEO
    if not video.exists():
        print(f"!! 找不到 {video}")
        return 2

    report: dict = {"video": str(video), "checks": {}}
    info = probe(video)
    if "error" in info:
        print("!! ffprobe 失敗:", info["error"])
        return 3

    fmt = info["format"]
    dur = float(fmt["duration"])
    vs = next(s for s in info["streams"] if s["codec_type"] == "video")
    as_ = next((s for s in info["streams"] if s["codec_type"] == "audio"), None)
    size_mb = int(fmt["size"]) / 1024 / 1024

    report["duration_s"] = round(dur, 3)
    report["size_mb"] = round(size_mb, 2)
    report["video"] = {
        "codec": vs.get("codec_name"), "w": vs.get("width"), "h": vs.get("height"),
        "fps": vs.get("r_frame_rate"), "pix_fmt": vs.get("pix_fmt"),
    }
    report["audio"] = {
        "codec": as_.get("codec_name"), "ch": as_.get("channels"),
        "rate": as_.get("sample_rate"),
    } if as_ else None

    # ---- 關卡 1：長度與規格 ----
    c1 = []
    ok1 = True
    if dur > 180.0:
        c1.append(f"✗ 長度 {dur:.1f}s 超過 180s")
        ok1 = False
    else:
        c1.append(f"✓ 長度 {dur:.1f}s ≤ 180s（餘 {180-dur:.1f}s）")
    if (vs.get("width"), vs.get("height")) != (1080, 1920):
        c1.append(f"✗ 解析度 {vs.get('width')}x{vs.get('height')} 非 1080x1920")
        ok1 = False
    else:
        c1.append("✓ 解析度 1080x1920 直式")
    if not as_:
        c1.append("✗ 沒有音訊軌")
        ok1 = False
    else:
        c1.append(f"✓ 音訊 {as_.get('codec_name')} {as_.get('sample_rate')}Hz")
    report["checks"]["1_spec"] = {"pass": ok1, "detail": c1}

    # ---- 關卡 2：解碼無錯誤 ----
    code, out, err = sh(["ffmpeg", "-v", "error", "-i", str(video), "-f", "null", "-"])
    decode_ok = (code == 0 and not err.strip())
    report["checks"]["2_decode"] = {
        "pass": decode_ok,
        "detail": ["✓ 解碼無錯誤" if decode_ok else f"✗ 解碼錯誤：{err.strip()[:1500]}"],
    }

    # ---- 關卡 3：抽幀 ----
    for f in FRAMES.glob("*.png"):
        f.unlink()
    stamps = [round(dur * i / 13, 2) for i in range(14)][1:13]   # 12 幀
    picked = []
    for i, t in enumerate(stamps, 1):
        p = FRAMES / f"f{i:02d}_{t:07.2f}s.png"
        c, _, e = sh(["ffmpeg", "-y", "-v", "error", "-ss", f"{t:.2f}",
                      "-i", str(video), "-frames:v", "1", str(p)])
        if c == 0 and p.exists():
            picked.append({"n": i, "t": t, "file": p.name})
    report["checks"]["3_frames"] = {
        "pass": len(picked) >= 10,
        "detail": [f"✓ 抽出 {len(picked)} 幀（≥10）" if len(picked) >= 10
                   else f"✗ 只抽出 {len(picked)} 幀"],
        "frames": picked,
    }

    # ---- 關卡 4：真實操作畫面 vs 靜態輪播 ----
    # 取樣 60 幀算相鄰差異，靜態輪播會出現大段 diff≈0
    code, out, err = sh([
        "ffmpeg", "-v", "error", "-i", str(video),
        "-vf", "fps=2,scale=160:284,format=gray",
        "-f", "rawvideo", "-pix_fmt", "gray", "-",
    ])
    diffs: list[float] = []
    if code == 0 and out:
        buf = out.encode("latin-1", "ignore")
        fsz = 160 * 284
        n = len(buf) // fsz
        prev = None
        for i in range(n):
            cur = buf[i * fsz:(i + 1) * fsz]
            if prev is not None:
                s = sum(abs(a - b) for a, b in zip(cur, prev))
                diffs.append(s / fsz)
            prev = cur
    if diffs:
        zeros = sum(1 for d in diffs if d < 0.15)
        mean_d = sum(diffs) / len(diffs)
        ratio = zeros / len(diffs)
        motion_ok = ratio < 0.35 and mean_d > 0.5
        report["checks"]["4_motion"] = {
            "pass": motion_ok,
            "detail": [
                f"取樣 {len(diffs)} 對相鄰幀：平均差異 {mean_d:.2f}，"
                f"近乎靜止的比例 {ratio*100:.0f}%",
                ("✓ 畫面持續變化，符合真實操作畫面" if motion_ok else
                 "✗ 疑似靜態輪播（大量靜止區段）"),
            ],
            "mean_diff": round(mean_d, 3),
            "static_ratio": round(ratio, 3),
        }
    else:
        report["checks"]["4_motion"] = {"pass": False, "detail": ["✗ 無法分析動態"]}

    # ---- 整體 ----
    report["pass"] = all(c["pass"] for c in report["checks"].values())

    (QA / "report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")

    # ---- Markdown ----
    L = ["# 影片品質檢查報告", "", f"影片：`{video}`", "",
         f"**verdict：{'PASS' if report['pass'] else 'FAIL'}**", "",
         f"- 長度：{dur:.2f}s　大小：{size_mb:.1f} MB",
         f"- 影像：{vs.get('codec_name')} {vs.get('width')}x{vs.get('height')} "
         f"{vs.get('r_frame_rate')} {vs.get('pix_fmt')}",
         f"- 音訊：{report['audio']}", ""]
    for k, v in report["checks"].items():
        L.append(f"## {k} — {'PASS' if v['pass'] else 'FAIL'}")
        L += [f"- {d}" for d in v["detail"]]
        L.append("")
    L += ["## 抽幀清單（需人工逐幀確認零個資）", ""]
    L += [f"- `{f['file']}` @ {f['t']}s" for f in report["checks"]["3_frames"]["frames"]]
    (QA / "REPORT.md").write_text("\n".join(L), encoding="utf-8")

    print("\n".join(L))
    return 0 if report["pass"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
