#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
narration.py — 產生《好好說話》3 分鐘介紹影片的旁白與字幕。

語音：zh-TW-HsiaoChenNeural，rate +18%（任務建議 +6%，但 +6% 會超出 180s 硬上限，
      經 Lead 核准改用 +18%）
輸出：
    assets/tts/seg_NN.mp3     每段旁白音檔
    assets/audio/timeline.json 每段起訖時間（給 assemble.py 用）
    assets/audio/subtitles.srt

每段的實際長度用 ffprobe 量測，時間軸以「實測長度」為準，
不是用字數估算 —— 這樣字幕才會跟旁白同步。
"""

from __future__ import annotations

import asyncio
import json
import re
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
TTS_DIR = HERE / "assets" / "tts"
AUDIO_DIR = HERE / "assets" / "audio"
for d in (TTS_DIR, AUDIO_DIR):
    d.mkdir(parents=True, exist_ok=True)

VOICE = "zh-TW-HsiaoChenNeural"
# 任務建議 +6%，但 +6% 時旁白總長 178.9s，加上片頭/片尾墊片會突破 180s 硬上限。
# +18% 為實測最佳平衡：旁白 161.3s，保留約 17s 給片頭/片尾與段落呼吸，
# 語速仍在自然範圍（實測無吃字、無機械感）。
RATE = "+18%"
VOLUME = "+0%"
PITCH = "+0Hz"

# ---------------------------------------------------------------------------
# 腳本（依任務指定的 6 段結構）
#   seg  : 段落編號
#   start: 目標起始秒（僅供對齊參考；實際以音檔長度串接）
#   vo   : 旁白（唸出來的）
#   subs : 字幕（螢幕上顯示，通常比旁白短）
#   card : 這一段畫面用什麼（給 assemble.py）
# ---------------------------------------------------------------------------
SCRIPT: list[dict] = [
    {
        "seg": 1,
        "start": 0,
        "vo": "我們最不會說好話的對象，往往是自己。"
              "事情搞砸了，第一個念頭是「我怎麼這麼沒用」。",
        "subs": ["我們最不會說好話的對象，往往是自己。",
                 "搞砸的時候，第一個念頭總是「我怎麼這麼沒用」。"],
        "card": "q_self",
    },
    {
        "seg": 1,
        "start": 8,
        "vo": "這句話如果換成別人對你說，你早就生氣了。"
              "但對自己說，我們卻覺得理所當然。",
        "subs": ["這句話如果換成別人對你說，你早就生氣了。",
                 "但對自己說，卻覺得理所當然。"],
        "card": "q_self",
    },
    {
        "seg": 2,
        "start": 16,
        "vo": "《好好說話》，是一個陪你說好話的網站。"
              "你把說不出口的心事打進去，它先接住你的情緒，"
              "再給你一句具體、真誠、可以說出口的好話。",
        "subs": ["《好好說話》— 一個陪你說好話的網站",
                 "先接住情緒，再給你一句能說出口的好話"],
        "card": "title",
    },
    {
        "seg": 2,
        "start": 29,
        "vo": "它不是心靈雞湯。它會先判斷情緒是什麼、強度多強、"
              "處境是工作、感情還是家庭，最後才給話。",
        "subs": ["不是心靈雞湯：先辨識情緒與處境，最後才給話"],
        "card": "title",
    },
    {
        "seg": 2,
        "start": 40,
        "vo": "而且它不說「加油」、不說「別想太多」，也不假裝你的困難不存在。",
        "subs": ["不說「加油」、不說「別想太多」，也不假裝困難不存在"],
        "card": "rules",
    },
    {
        "seg": 3,
        "start": 46,
        "vo": "現在，我們實際操作一次。這是真實的網站畫面，不是簡報。",
        "subs": ["以下為真實操作畫面"],
        "card": "demo",
    },
    {
        "seg": 3,
        "start": 53,
        "vo": "把心事寫下來，不用修飾。",
        "subs": ["輸入心事，不用修飾"],
        "card": "demo",
    },
    {
        "seg": 3,
        "start": 60,
        "vo": "送出之後，AI 先辨識情緒。它聽到的不是「我很沒用」，"
              "而是工作壓力，強度四級。",
        "subs": ["AI 情緒辨識：工作壓力・強度 4／5",
                 "同時偵測到「自我價值」的訊號"],
        "card": "demo",
    },
    {
        "seg": 3,
        "start": 71,
        "vo": "接著是固定三段。第一段承接，用它的話把處境說一次，"
              "讓你知道自己被聽懂了。",
        "subs": ["① 承接 — 把你的處境說一次"],
        "card": "demo",
    },
    {
        "seg": 3,
        "start": 80,
        "vo": "第二段好話，一句真誠、具體的話。"
              "「我聽見你為自己講話的每一秒都認真，那不是沒用，是正在學會怎麼說。」",
        "subs": ["② 好話 — 一句具體、不空洞的話"],
        "card": "demo",
    },
    {
        "seg": 3,
        "start": 91,
        "vo": "第三段小步，一個今晚就能做的極小行動。"
              "不安慰完就結束，而是給一個做得到的下一步。",
        "subs": ["③ 小步 — 今晚就能做的一件小事"],
        "card": "demo",
    },
    {
        "seg": 3,
        "start": 100,
        "vo": "這句好話可以複製、可以收藏，也可以轉送給別人。"
              "網站會依照朋友、家人、同事，生成不同的說法。",
        "subs": ["複製 · 收藏 · 轉送給別人"],
        "card": "demo",
    },
    {
        "seg": 3,
        "start": 110,
        "vo": "同一個念頭，換一個對象，就變成一種可以送出去的善意。"
              "轉送不需要對方也用這個網站。",
        "subs": ["轉送給朋友／家人／同事 — 善意可以轉出去"],
        "card": "demo",
    },
    {
        "seg": 3,
        "start": 119,
        "vo": "收藏清單存在你自己的瀏覽器裡，不用登入，也不會上傳。",
        "subs": ["收藏只存在你的裝置，免登入、不上傳"],
        "card": "demo",
    },
    {
        "seg": 4,
        "start": 125,
        "vo": "最後，也是最重要的。如果偵測到自傷或危機訊號，"
              "系統會立刻停止一般回應，直接給出真實的求助資源。",
        "subs": ["危機護欄：立即停止一般回應"],
        "card": "demo",
    },
    {
        "seg": 4,
        "start": 134,
        "vo": "一九二五安心專線、一九九五生命線、一九八零張老師。"
              "AI 不扮演諮商師，因為那需要真人。",
        "subs": ["1925 安心專線 · 1995 生命線 · 1980 張老師",
                 "AI 不扮演諮商師，因為那需要真人"],
        "card": "demo",
    },
    {
        "seg": 4,
        "start": 143,
        "vo": "這一條護欄不是功能，是底線。三好四給是這樣落地的："
              "說好話是核心，做好事是轉送，存好心是不評價；"
              "給人信心、歡喜、希望、方便。",
        "subs": ["說好話＝核心　做好事＝轉送　存好心＝不評價",
                 "給人信心 · 歡喜 · 希望 · 方便"],
        "card": "threegood",
    },
    {
        "seg": 5,
        "start": 154,
        "vo": "技術上有兩條路。本機版本走 Ollama 本機模型，"
              "在你自己的電腦上推論——免費、離線，心事不會離開你的裝置。"
              "線上版本為了在任何環境都能運作，改用內建語料庫的規則引擎。"
              "兩條路都給得出完整的三段回應，也都不需要登入。",
        "subs": ["本機版：Ollama 本機模型推論 · 離線 · 不上傳",
                 "線上版：內建語料庫規則引擎，一樣給出三段回應",
                 "兩條路都免登入"],
        "card": "tech",
    },
    {
        "seg": 6,
        "start": 169,
        "vo": "好好說話。先對自己說一句，再把它送給別人。",
        "_note": "收尾",
        "subs": ["好好說話", "先對自己說一句，再送給別人"],
        "card": "end",
    },
]


def probe_duration(path: Path) -> float:
    """用 ffprobe 量測音檔長度（秒）。"""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", str(path)],
        capture_output=True, text=True, check=True,
    ).stdout.strip()
    return float(out)


async def synth(text: str, out: Path) -> None:
    import edge_tts  # noqa: PLC0415

    communicate = edge_tts.Communicate(text, VOICE, rate=RATE, volume=VOLUME, pitch=PITCH)
    await communicate.save(str(out))


def srt_ts(sec: float) -> str:
    ms = int(round(sec * 1000))
    h, ms = divmod(ms, 3600_000)
    m, ms = divmod(ms, 60_000)
    s, ms = divmod(ms, 1000)
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main() -> int:
    import argparse  # noqa: PLC0415

    ap = argparse.ArgumentParser()
    ap.add_argument("--clean", action="store_true", help="刪掉舊音檔重錄")
    ap.add_argument("--gap", type=float, default=0.35, help="段間留白秒數")
    ap.add_argument("--speed", type=float, default=1.0, help="整體節奏倍率（>1 較慢）")
    args = ap.parse_args()

    if args.clean and TTS_DIR.exists():
        for f in TTS_DIR.glob("seg_*.mp3"):
            f.unlink()

    async def build() -> list[dict]:
        items = []
        cursor = 0.0
        for i, seg in enumerate(SCRIPT, start=1):
            mp3 = TTS_DIR / f"seg_{i:02d}.mp3"
            if not mp3.exists():
                print(f"[tts] 合成 {mp3.name} …", flush=True)
                await synth(seg["vo"], mp3)
            dur = probe_duration(mp3)
            items.append({
                "idx": i,
                "seg": seg["seg"],
                "file": str(mp3.relative_to(HERE)).replace("\\", "/"),
                "start": round(cursor, 3),
                "dur": round(dur, 3),
                "end": round(cursor + dur, 3),
                "vo": seg["vo"],
                "subs": seg["subs"],
                "card": seg["card"],
                "target_start": seg["start"],
            })
            cursor += dur + args.gap
        return items

    items = asyncio.run(build())

    total = items[-1]["end"] if items else 0.0
    print(f"\n[tts] 旁白總長 {total:.1f}s（含段間留白）")
    if total > 172:
        print(f"[tts] !! 超過影片安全上限（172s），建議調快或精簡 {total - 172:.1f}s")
    else:
        print(f"[tts] 剩餘可分配給片頭/片尾墊片：{172 - total:.1f}s")

    tl = AUDIO_DIR / "timeline.json"
    tl.write_text(json.dumps(items, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[tts] 已寫出 {tl}")

    # ---- 字幕 SRT ----
    lines = []
    n = 0
    for it in items:
        subs = it["subs"] or [""]
        # 把一段的多行字幕平均切在該段時間內
        span = it["dur"] / len(subs)
        for j, s in enumerate(subs):
            n += 1
            a = it["start"] + j * span
            b = it["start"] + (j + 1) * span
            lines.append(f"{n}\n{srt_ts(a)} --> {srt_ts(b)}\n{s}\n")
    srt = AUDIO_DIR / "subtitles.srt"
    srt.write_text("\n".join(lines), encoding="utf-8")
    print(f"[tts] 已寫出 {srt}（{n} 條字幕）")

    # ---- 純文字稿（給 QA / 說明書複用）----
    txt = AUDIO_DIR / "narration.txt"
    txt.write_text(
        "\n".join(f"[{it['start']:6.1f}-{it['end']:6.1f}] {it['vo']}" for it in items),
        encoding="utf-8",
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
