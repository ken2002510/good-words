#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
assemble.py — 把 Demo 錄影 + 字卡 + 旁白 + 字幕組成 1080x1920 成品。

做法（重要設計決策）：
  * 全部用 ffmpeg filter_complex 一次合成，不做中間檔輪播 —— 確保
    **Demo 段落是連續的真實操作影片**，不是靜態截圖。
  * 字卡（canvas 產生 PNG）只出現在 00:00-00:50 與 02:30-03:00，
    即「問題」「作品登場」「技術」「收尾」；中間 Demo 段落完全不遮畫面。
  * 直式 1080x1920：Demo 畫面 640x1138 等比放大 → 1080x1920 會裁掉左右，
    因此改成「置中 + 上下留白補底色」，並在留白處放字卡與字幕。
  * 字幕燒在底部安全區（IG/YouTube 都不會被裁到）。

輸出：
    out/好好說話_作品介紹影片.mp4
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
RAW = HERE / "raw"
ASSETS = HERE / "assets"
CARDS = ASSETS / "cards"
AUDIO = ASSETS / "audio"
TTS = ASSETS / "tts"
OUT = HERE / "out"
OUT.mkdir(parents=True, exist_ok=True)

W, H = 1080, 1920
FPS = 30
BG = "0x1A1512"          # 溫暖深底
BG2 = "0x2A211C"

# 時間軸（秒）—— 與 narration.py 的 timeline.json 對齊後會覆寫
DEMO_START = 46.0
DEMO_END = 125.0


def run(cmd: list[str], label: str) -> None:
    print(f"[assemble] {label}", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode != 0:
        print(r.stdout[-3000:])
        print(r.stderr[-4000:])
        raise SystemExit(f"ffmpeg 失敗：{label}")


def ffprobe_dur(p: Path) -> float:
    return float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(p)],
        capture_output=True, text=True, check=True).stdout.strip())


def concat_audio(items: list[dict], gap: float, out: Path) -> None:
    """把 TTS 段落依 timeline 串成單一 wav（含段間留白）。"""
    inputs: list[str] = []
    filt: list[str] = []
    for i, it in enumerate(items):
        inputs += ["-i", str(HERE / it["file"])]
        filt.append(f"[{i}:a]adelay={int(it['start']*1000)}|{int(it['start']*1000)}[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(items)))
    total = items[-1]["end"] + gap
    filt.append(f"{mix}amix=inputs={len(items)}:normalize=0:dropout_transition=0[mixed]")
    filt.append(f"[mixed]apad,atrim=0:{total:.3f},asetpts=N/SR/TB[out]")
    run([
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        *inputs,
        "-filter_complex", ";".join(filt),
        "-map", "[out]", "-ar", "44100", "-ac", "2", str(out),
    ], "串接旁白")


def main() -> int:
    ap_argv = sys.argv[1:]
    total_target = 176.0
    if "--target" in ap_argv:
        total_target = float(ap_argv[ap_argv.index("--target") + 1])

    tl = json.loads((AUDIO / "timeline.json").read_text(encoding="utf-8"))
    demo_raw = RAW / "demo_raw.mp4"
    if not demo_raw.exists():
        print("!! 找不到 raw/demo_raw.mp4 —— 請先跑 record_demo.py")
        return 2
    demo_dur = ffprobe_dur(demo_raw)
    print(f"[assemble] demo_raw 長度 {demo_dur:.1f}s")

    # 目標總長：旁白 + 片頭/片尾墊片，且不得超過 180s
    vo_total = tl[-1]["end"]
    head_pad = 1.2
    tail_pad = max(1.0, min(6.0, total_target - vo_total - head_pad))
    total = vo_total + head_pad + tail_pad
    if total > 179.5:
        raise SystemExit(f"總長 {total:.1f}s 超過 180s 上限")

    # 旁白整體平移 head_pad
    for it in tl:
        it["start"] += head_pad
        it["end"] += head_pad
    vo_wav = AUDIO / "narration_full.wav"
    concat_audio(tl, 0.0, vo_wav)

    # ---- Demo 段落時間窗 ----
    # 找 seg3 開始（第 6 段的 vo 起點）到 seg4 crisis 結束
    seg3 = next(it for it in tl if it["seg"] == 3 and "真實" in it["vo"])
    seg4 = [it for it in tl if it["seg"] == 4]
    demo_start = seg3["start"] - 1.0
    demo_end = seg4[-1]["end"] + 1.0
    demo_len = demo_end - demo_start
    print(f"[assemble] Demo 段落 {demo_start:.1f}s → {demo_end:.1f}s（{demo_len:.1f}s）")
    if demo_len > demo_dur:
        print(f"[assemble] !! Demo 段落比錄影長（{demo_len:.1f}s > {demo_dur:.1f}s），"
              f"尾端會凍結；錄影時請加長停頓")

    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        # 0: 背景色（整片）。多給 10s 緩衝：
        # 它是 overlay 的底，若長度剛好等於 total，片尾最後幾格會因為
        # 上游 EOF 而變空白（先前抽幀看到 167s 之後全空）。
        "-f", "lavfi", "-i", f"color=c={BG}:s={W}x{H}:r={FPS}:d={total + 10.0:.3f}",
        # 1: demo 錄影
        "-i", str(demo_raw),
        # 2: 旁白
        "-i", str(vo_wav),
    ]
    # 3..: 字卡 PNG（迴圈輸入，最長 total）
    card_order = ["q_self", "title", "rules", "threegood", "tech", "end"]
    card_files = []
    for name in card_order:
        p = CARDS / f"{name}.png"
        if not p.exists():
            print(f"!! 缺字卡 {p} —— 請先跑 make_cards.py")
            return 3
        card_files.append(p)
    # 字卡輸入要比總長再長一點：字卡是用 PTS 位移疊上去的，
    # 若輸入長度剛好等於 total，最後一張（位移到 163.8s）會沒有足夠
    # 的畫面可疊，導致片尾變成空白。多給 5s 緩衝。
    for p in card_files:
        cmd += ["-loop", "1", "-t", f"{total + 5.0:.3f}", "-i", str(p)]

    # ---- 字卡時間窗 ----
    def window(card: str) -> tuple[float, float]:
        if card == "q_self":
            return 0.0, 20.0
        if card == "title":
            return 20.0, 36.0
        if card == "rules":
            return 36.0, demo_start
        if card == "threegood":
            return demo_end, min(total, demo_end + 14.0)
        if card == "tech":
            # 留 0.35s 交錯緩衝，避免與下一張的 enable 區間在邊界重疊
            return min(total, demo_end + 14.0), total - 8.0
        # 收尾字卡：撐到最後一刻（不淡出，避免片尾留一段空白）
        return total - 8.0, total + 1.0

    def _windows_for_debug() -> list[tuple[str, float, float]]:
        out = []
        for nm in card_order:
            x, y = window(nm)
            out.append((nm, max(0.0, x), min(total, y)))
        return out

    # ---- filter ----
    # demo 畫面：640x1138 → 放大到 1080 寬（1.6875x）→ 1138*1.6875=1920.4 → 1080x1920
    f: list[str] = []
    f.append(f"[1:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
             f"crop={W}:{H},setsar=1,fps={FPS},format=yuv420p[demo]")
    # demo 只在 demo_start..demo_end 出現，其餘用背景色
    f.append(f"[demo]trim=0:{demo_len:.3f},setpts=PTS-STARTPTS+{demo_start:.3f}/TB[demoT]")
    f.append(f"[0:v]trim=0:{total:.3f},setpts=PTS-STARTPTS[bg]")
    f.append(f"[bg][demoT]overlay=0:0:eof_action=pass[v1]")

    # 字卡疊加（淡入淡出）
    cur = "v1"
    for i, name in enumerate(card_order):
        a, b = window(name)
        a = max(0.0, a)
        b = min(total, b)
        if b - a < 1.0:
            continue
        idx = 3 + i
        tag = f"c{i}"
        # 第一張字卡（q_self）從 0 秒就開始 → **不能淡入**，
        # 否則影片開頭 0.6s 會是純底色（抽幀會看到一張全空畫面）。
        # 淡入／淡出都必須寫在**位移之後**的時間軸上：
        # 先把 setpts 位移好，再對位移後的串流做 fade，
        # 否則 fade 的 st 會落在原始（未位移）的時間軸上 ——
        # 實測：`fade=t=in:st=163.804` 放在 setpts 之前，會讓整張字卡
        # 從 163.8s 之後完全不輸出，片尾變成一片空白。
        # 正確順序：format → setpts(位移) → fade(用位移後的相對秒數)。
        # 位移後串流的「相對秒數 0」＝ 絕對時間 a，
        # 所以淡入 st 固定用 0，淡出 st 用 (b - a - 0.6)。
        fade_in = "" if a <= 0.01 else "fade=t=in:st=0:d=0.6:alpha=1,"
        # 最後一張字卡撐到片尾 → 不淡出，避免片尾留一段空白
        is_last = (name == card_order[-1])
        fade_out = "" if is_last else \
            f"fade=t=out:st={max(0.0, (b - a) - 0.6):.3f}:d=0.6:alpha=1,"
        f.append(
            f"[{idx}:v]format=rgba,"
            f"setpts=PTS-STARTPTS+{a:.3f}/TB,"
            f"{fade_in}{fade_out}"
            f"null[{tag}]"
        )
        f.append(f"[{cur}][{tag}]overlay=0:0:eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[v{tag}]")
        cur = f"v{tag}"

    # 字幕：固定在最底部的專屬橫帶，並加一層半透明底，
    # 避免和字卡的文字重疊（先前抽幀看到字幕蓋在字卡文字上）。
    srt = AUDIO / "subtitles.srt"
    shifted = AUDIO / "subtitles_shifted.srt"
    _shift_srt(srt, shifted, head_pad)
    esc = str(shifted).replace("\\", "/").replace(":", "\\:")
    band_h = 190                          # 字幕橫帶高度
    band_y = H - band_h
    f.append(
        f"[{cur}]drawbox=x=0:y={band_y}:w={W}:h={band_h}:"
        f"color=0x120E0C@0.82:t=fill[vband]"
    )
    f.append(
        f"[vband]subtitles='{esc}':"
        f"force_style='FontName=Microsoft JhengHei,FontSize=15,"
        f"PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,"
        f"Outline=2,Shadow=0,Alignment=2,MarginV=34'[vout]"
    )

    cmd += [
        "-filter_complex", ";".join(f),
        "-map", "[vout]", "-map", "2:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "20",
        "-pix_fmt", "yuv420p", "-profile:v", "high", "-level", "4.1",
        "-r", str(FPS), "-g", str(FPS * 2),
        "-c:a", "aac", "-b:a", "160k", "-ar", "44100", "-ac", "2",
        "-movflags", "+faststart",
        "-t", f"{total:.3f}",
        str(OUT / "好好說話_作品介紹影片.mp4"),
    ]
    run(cmd, "合成影片")

    out = OUT / "好好說話_作品介紹影片.mp4"
    print(f"[assemble] 完成：{out}  ({out.stat().st_size/1024/1024:.1f} MB, "
          f"{ffprobe_dur(out):.1f}s)")
    return 0


def _shift_srt(src: Path, dst: Path, offset: float) -> None:
    import re

    def sh(ts: str) -> str:
        h, m, rest = ts.split(":")
        s, ms = rest.split(",")
        t = int(h) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000 + offset
        t = max(0.0, t)
        H = int(t // 3600); t -= H * 3600
        M = int(t // 60); t -= M * 60
        S = int(t)
        MS = int(round((t - S) * 1000))
        if MS == 1000:
            S += 1; MS = 0
        return f"{H:02d}:{M:02d}:{S:02d},{MS:03d}"

    text = src.read_text(encoding="utf-8")
    text = re.sub(
        r"(\d{2}:\d{2}:\d{2},\d{3}) --> (\d{2}:\d{2}:\d{2},\d{3})",
        lambda m: f"{sh(m.group(1))} --> {sh(m.group(2))}",
        text,
    )
    dst.write_text(text, encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
