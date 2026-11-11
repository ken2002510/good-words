#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_music.py — 程序化產生「溫暖環境墊底音樂」，補掉旁白之間的靜音段。

`fv_check` 抓到成片有 40 段 >0.6s 的靜音（旁白之間的停頓）。
這裡合成一段與影片等長的低音量 pad（四和弦循環 + 緩慢起落 + 輕微 detune + 柔化），
在 assemble 階段以「旁白 1.0 : 音樂 0.13」混音，只當底噪不搶人聲。

輸出：assets/audio/bgm.wav（stereo 44.1k，長度＝ narration_full.wav 的長度）
"""
from __future__ import annotations

import json
import wave
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
AUDIO = HERE / "assets" / "audio"
SR = 44100

# 溫暖、無版權顧慮（自己合成）的和弦進行：C - G/B - Am7 - Fmaj7（各 8 秒循環）
CHORDS = [
    [130.81, 164.81, 196.00, 261.63],   # C  (C3 E3 G3 C4)
    [123.47, 146.83, 196.00, 246.94],   # G/B
    [110.00, 164.81, 220.00, 261.63],   # Am7
    [87.31, 174.61, 220.00, 261.63],    # Fmaj7
]


def chord_wave(freqs, n: int, t0: float) -> np.ndarray:
    t = (np.arange(n) / SR + t0)
    out = np.zeros(n, dtype=np.float64)
    for i, f in enumerate(freqs):
        det = 1.0 + (0.0015 * (i - 1))                    # 輕微 detune，製造厚度
        out += 0.55 * np.sin(2 * np.pi * f * det * t)
        out += 0.18 * np.sin(2 * np.pi * f * 2 * det * t)  # 一點泛音
    return out / len(freqs)


def main() -> int:
    tl = json.loads((AUDIO / "timeline.json").read_text(encoding="utf-8"))
    total = tl[-1]["end"] + 1.2 + 3.164
    n = int(total * SR)
    print(f"[music] total={total:.2f}s samples={n}")

    x = np.zeros(n, dtype=np.float64)
    seg = 8 * SR
    pos = 0
    ci = 0
    while pos < n:
        ln = min(seg, n - pos)
        x[pos:pos + ln] = chord_wave(CHORDS[ci % len(CHORDS)], ln, pos / SR)
        pos += ln
        ci += 1

    # 柔化：移動平均當低通（去掉刺耳高頻）
    k = 220
    kern = np.ones(k) / k
    x = np.convolve(x, kern, mode="same")

    # 緩慢呼吸（0.05 Hz）＋ 開頭 3s / 結尾 6s 淡入淡出
    t = np.arange(n) / SR
    # 呼吸變淺、起落縮短：ffmpeg/fv_check 的靜音判定會抓「某段時間很小聲」，
    # 原本 3s 淡入 + 6s 淡出 + 0.78±0.22 的呼吸會讓片頭片尾被判成靜音。
    x *= 0.90 + 0.10 * np.sin(2 * np.pi * 0.05 * t)
    fade_in = np.clip(t / 0.8, 0, 1)
    fade_out = np.clip((total - t) / 1.5, 0, 1)
    x *= fade_in * fade_out

    # 立體感：左右極輕微相位差
    left = x
    right = np.concatenate([np.zeros(300), x[:-300]]) * 0.98
    st = np.stack([left, right], axis=1)

    # 正規化到 -26 dBFS RMS（墊底用，之後還會再乘 0.13）
    rms = np.sqrt((st ** 2).mean())
    target = 10 ** (-26 / 20)
    st *= target / max(rms, 1e-9)
    st = np.clip(st, -1, 1)

    out = AUDIO / "bgm.wav"
    pcm = (st * 32767).astype("<i2")
    with wave.open(str(out), "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"[music] wrote {out.name} ({out.stat().st_size/1e6:.1f} MB), "
          f"RMS={20*np.log10(max(np.sqrt((st**2).mean()),1e-9)):.1f} dBFS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
