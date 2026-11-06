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

# 卡窗完全由 assets/audio/timeline.json 推導（OVERLAY-ORCHESTRATION-REPORT §缺口 1），不寫死
HEAD_PAD = 1.2         # 旁白整體平移（成片座標 = timeline 座標 + head_pad）
CARD_INSET = 0.15      # 非 demo 卡窗內縮 150ms
DEMO_PAD = 1.0         # demo 例外：含 card=="demo" 的 run，起點 -1s、結束 +1s


def aggregate_runs(tl: list[dict]) -> list[list]:
    """同 card 的連續 run 聚合成 [card, 首段start, 尾段end]（timeline 座標）。"""
    runs: list[list] = []
    for it in tl:
        c = it.get("card", "")
        if runs and runs[-1][0] == c:
            runs[-1][2] = it["end"]
        else:
            runs.append([c, it["start"], it["end"]])
    return runs


def card_windows(runs: list[list], head_pad: float) -> dict[str, tuple[float, float]]:
    """run → 成片座標卡窗。

    demo 例外照舊：起點 -1s、結束 +1s；其餘卡窗內縮 150ms；全部再加 head_pad。
    （demo 視窗應等於 raw/demo_timing.json 的 demo_window_video。）
    """
    wins: dict[str, tuple[float, float]] = {}
    for c, s, e in runs:
        if c == "demo":
            wins[c] = (s - DEMO_PAD + head_pad, e + DEMO_PAD + head_pad)
        else:
            wins[c] = (s + CARD_INSET + head_pad, e - CARD_INSET + head_pad)
    return wins


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

    overlay_mp4 = ASSETS / "overlay" / "overlay.mp4"
    if not overlay_mp4.exists():
        print("!! 找不到 assets/overlay/overlay.mp4 —— 請先跑 overlay/build_overlay.py")
        return 4
    overlay_dur = ffprobe_dur(overlay_mp4)

    # ---- 卡窗由 timeline 推導（OVERLAY-ORCHESTRATION-REPORT §缺口 1）----
    head_pad = HEAD_PAD
    runs = aggregate_runs(tl)
    wins = card_windows(runs, head_pad)
    png_cards = [c for c, _, _ in runs if c != "demo"]
    for c, s, e in runs:
        print(f"[assemble] run card={c:10s} timeline {s:8.3f}-{e:8.3f}  "
              f"成片窗 {wins[c][0]:8.3f}-{wins[c][1]:8.3f}")

    # 目標總長：旁白 + 片頭/片尾墊片，且不得超過 180s（熔斷保留）
    vo_total = tl[-1]["end"]
    tail_pad = max(1.0, min(6.0, total_target - vo_total - head_pad))
    total = vo_total + head_pad + tail_pad
    if total > 179.5:
        raise SystemExit(f"總長 {total:.1f}s 超過 180s 上限")
    print(f"[assemble] total={total:.3f}s (vo {vo_total:.3f} + head {head_pad} + tail {tail_pad:.3f}), "
          f"overlay={overlay_dur:.3f}s → tpad/trim 對齊到 total")

    # ---- Demo 視窗（由含 card=="demo" 的 run 推導，應等於 demo_timing.json 的 demo_window_video）----
    demo_start, demo_end = wins["demo"]
    demo_len = demo_end - demo_start
    print(f"[assemble] Demo 視窗 {demo_start:.3f}s → {demo_end:.3f}s（{demo_len:.3f}s）")
    if demo_len > demo_dur:
        print(f"[assemble] !! Demo 視窗比錄影長（{demo_len:.1f}s > {demo_dur:.1f}s），"
              f"尾端會凍結；錄影時請加長停頓")

    # ---- seg5（card=tech）截圖視窗：S4/S7/S8 依序平分該 run 的成片時間 ----
    tech_run = next(r for r in runs if r[0] == "tech")
    shot_a, shot_b = tech_run[1] + head_pad, tech_run[2] + head_pad
    shot_names = ["S4_wall_after_publish", "S7_me_panel", "S8_leaderboard_top10"]
    n_shot = len(shot_names)
    seg_len = (shot_b - shot_a) / n_shot
    shot_wins: list[tuple[str, float, float]] = []
    for i, nm in enumerate(shot_names):
        a = shot_a + i * seg_len
        b = shot_a + (i + 1) * seg_len if i < n_shot - 1 else shot_b
        shot_wins.append((nm, a, b))
        print(f"[assemble] shot {nm}: {a:.3f}-{b:.3f} ({b - a:.3f}s)")

    # 旁白整體平移 head_pad
    for it in tl:
        it["start"] += head_pad
        it["end"] += head_pad
    vo_wav = AUDIO / "narration_full.wav"
    concat_audio(tl, 0.0, vo_wav)

    bg_mp4 = ASSETS / "bg" / "bg.mp4"
    if not bg_mp4.exists():
        print("!! 找不到 assets/bg/bg.mp4 —— 請先跑 gen_bg.py")
        return 5
    cmd = [
        "ffmpeg", "-y", "-hide_banner", "-loglevel", "error",
        # 0: 生成的動畫背景（gen_bg.py，分段暖色光斑，長度 total+2s）。
        # 用 -stream_loop -1 無限迴圈當底（-loop 只給 image2 用）；
        # 片尾 EOF 空白由 [0:v]trim 控制。
        "-stream_loop", "-1", "-i", str(bg_mp4),
        # 1: demo 錄影
        "-i", str(demo_raw),
        # 2: 旁白
        "-i", str(vo_wav),
    ]
    # 3..: 字卡 PNG（迴圈輸入，最長 total+5 緩衝，見舊注解：PTS 位移疊圖需要緩衝）
    card_files = []
    for name in png_cards:
        p = CARDS / f"{name}.png"
        if not p.exists():
            print(f"!! 缺字卡 {p} —— 請先跑 make_cards.py")
            return 3
        card_files.append(p)
    for p in card_files:
        cmd += ["-loop", "1", "-t", f"{total + 5.0:.3f}", "-i", str(p)]
    # seg5 截圖（同樣迴圈輸入 + 緩衝）
    shot_paths = []
    for nm, _, _ in shot_wins:
        p = ASSETS / "shots" / f"{nm}.png"
        if not p.exists():
            print(f"!! 缺截圖 {p} —— 請先跑 capture_shots.py")
            return 3
        shot_paths.append(p)
    for p in shot_paths:
        cmd += ["-loop", "1", "-t", f"{total + 5.0:.3f}", "-i", str(p)]
    # 動態疊卡（ProRes 4444，帶 alpha）
    cmd += ["-i", str(overlay_mp4)]

    IDX_CARD0 = 3
    IDX_SHOT0 = IDX_CARD0 + len(card_files)
    IDX_OVL = IDX_SHOT0 + len(shot_paths)

    # ---- filter ----
    # demo 畫面：scale+crop 填滿 1080x1920
    f: list[str] = []
    f.append(f"[1:v]scale={W}:{H}:force_original_aspect_ratio=increase,"
             f"crop={W}:{H},setsar=1,fps={FPS},format=yuv420p[demo]")
    # demo 只在 demo 視窗出現，其餘用背景色
    f.append(f"[demo]trim=0:{demo_len:.3f},setpts=PTS-STARTPTS+{demo_start:.3f}/TB[demoT]")
    f.append(f"[0:v]trim=0:{total:.3f},setpts=PTS-STARTPTS[bg]")
    f.append(f"[bg][demoT]overlay=0:0:eof_action=pass[v1]")

    # 字卡疊加（淡入淡出）。卡窗 = timeline 推導（見 card_windows）。
    cur = "v1"
    for i, name in enumerate(png_cards):
        a, b = wins[name]
        a = max(0.0, a)
        b = min(total, b)
        is_last = (name == png_cards[-1])
        if is_last:
            b = total  # 尾卡撐到片尾、不淡出，避免片尾留一段空白（保留舊行為）
        if b - a < 1.0:
            continue
        idx = IDX_CARD0 + i
        tag = f"c{i}"
        # 靜態字卡壓到低 alpha（尾卡較亮）：背景現在是生成圖，避免和 overlay 動態字卡的文字重疊
        card_aa = 0.55 if is_last else 0.12
        # 淡入／淡出必須寫在 setpts 位移「之後」，且 st 用**絕對秒數**：
        # setpts=PTS-STARTPTS+a/TB 之後，串流的 pts 已是絕對時間（a+k/25），
        # 所以 fade=t=in 用 st=a、fade=t=out 用 st=b-0.6。
        # （實測：若 fade 放在 setpts 前、或用相對 st=(b-a)-0.6，
        #  全部幀的 pts 都 > st+d，fade out 會把整張卡 alpha 降成 0 → 完全不輸出。）
        fade_in = "" if a <= 0.01 else f"fade=t=in:st={a:.3f}:d=0.6:alpha=1,"
        fade_out = "" if is_last else \
            f"fade=t=out:st={max(0.0, b - 0.6):.3f}:d=0.6:alpha=1,"
        f.append(
            f"[{idx}:v]format=rgba,"
            f"colorchannelmixer=aa={card_aa},"
            f"setpts=PTS-STARTPTS+{a:.3f}/TB,"
            f"{fade_in}{fade_out}"
            f"null[{tag}]"
        )
        f.append(f"[{cur}][{tag}]overlay=0:0:eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[v{tag}]")
        cur = f"v{tag}"

    # ---- seg5 截圖疊加（在字卡之上；scale=contain 到 1080x1920，底色 pad）----
    for j, (nm, a, b) in enumerate(shot_wins):
        idx = IDX_SHOT0 + j
        tag = f"s{j}"
        # 同字卡：setpts 之後 pts 為絕對時間，fade 的 st 用絕對秒數
        fade_in = "" if a <= 0.01 else f"fade=t=in:st={a:.3f}:d=0.6:alpha=1,"
        fade_out = f"fade=t=out:st={max(0.0, b - 0.6):.3f}:d=0.6:alpha=1,"
        f.append(
            f"[{idx}:v]format=rgba,"
            f"scale={W}:{H}:force_original_aspect_ratio=decrease,"
            f"pad={W}:{H}:(ow-iw)/2:(oh-ih)/2:color={BG},setsar=1,"
            f"setpts=PTS-STARTPTS+{a:.3f}/TB,"
            f"{fade_in}{fade_out}"
            f"null[{tag}]"
        )
        f.append(f"[{cur}][{tag}]overlay=0:0:eof_action=pass:enable='between(t,{a:.3f},{b:.3f})'[v{tag}]")
        cur = f"v{tag}"

    # ---- 動態疊卡 overlay.mp4（ProRes 4444 yuva，自動用 alpha 疊加）----
    # 疊在「字幕帶之前那一層」之後、字幕帶之前；字幕永遠最後。
    # 長度對齊：trim 到 total+2 後再 tpad clone 2s ——
    # 無論 overlay 比 total 長或短，串流都 ≥ total，EOF 不會提前結束。
    f.append(
        f"[{IDX_OVL}:v]fps={FPS},trim=0:{total + 2.0:.3f},setpts=PTS-STARTPTS,"
        f"tpad=stop_mode=clone:stop_duration=2.0[ovl]"
    )
    f.append(f"[{cur}][ovl]overlay=0:0:eof_action=pass[v_ovl]")
    cur = "v_ovl"

    # 字幕：固定在最底部的專屬橫帶（永遠最後疊），並加一層半透明底，
    # 避免和字卡的文字重疊（先前抽幀看到字幕蓋在字卡文字上）。
    srt = AUDIO / "subtitles.srt"
    shifted = AUDIO / "subtitles_shifted.srt"
    _shift_srt(srt, shifted, head_pad)
    esc = str(shifted).replace("\\", "/").replace(":", "\\:")
    band_h = 220                          # 字幕橫帶高度（y=1700..1920 安全區）
    band_y = H - band_h
    f.append(
        f"[{cur}]drawbox=x=0:y={band_y}:w={W}:h={band_h}:"
        f"color=0x120E0C@0.55:t=fill[vband]"
    )
    # v4：字號縮小（19→16）、上移（MarginV 3→12），避免「太大又太下面」；
    # 實測 FontSize=15/MarginV=34 會浮在帶上方，此組合讓兩行落在 y≈1700-1830
    f.append(
        f"[vband]subtitles='{esc}':"
        f"force_style='FontName=Microsoft JhengHei,FontSize=16,"
        f"PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,"
        f"Outline=1,Shadow=1,Alignment=2,MarginV=12'[vsub]"
    )
    # 色彩範圍正規化：bg 圖源是 full-range，統一壓成 limited tv，避免 yuvj420p
    f.append("[vsub]scale=in_range=auto:out_range=tv,format=yuv420p,setsar=1[vout]")

    cmd += [
        "-filter_complex", ";".join(f),
        "-map", "[vout]", "-map", "2:a",
        "-c:v", "libx264", "-preset", "medium", "-crf", "23",
        "-pix_fmt", "yuv420p", "-color_range", "tv",
        "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709",
        "-profile:v", "high", "-level", "4.1",
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
