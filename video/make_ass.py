#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_ass.py — 把 SRT 轉成「好看的字幕」ASS（取代 SRT + drawbox 黑底的做法）。

設計依據（來自本機 skill `bilingual-subtitles/references/formatting.md`）：
  * 直式 1080x1920：主要語言字級 = 4.8% 畫面高（PlayRes=1080x1920 時 Fontsize≈92；
    libass 中文墨高 ≈ 0.58 em → 92 約 53px 墨高）
  * 描邊 3–6px 黑 + 陰影 1–2px（可讀性保險），**不要底框**（BorderStyle=1）
  * 中文每行 12–16 字、1–2 行；cue 提早 0.2s 出現、延後 0.3s 消失
  * 字體：Noto Sans TC（OFL 可散布）；不要用 Microsoft JhengHei（版權）
  * 中文字與拉丁字母／數字之間補一個空格（可讀性）

用法：
  python make_ass.py                     # 用預設樣式產生 assets/audio/subtitles_shifted.ass
  python make_ass.py --font "LXGW WenKai TC" --size 100 --out tmp.ass
"""
from __future__ import annotations

import argparse
import re
from pathlib import Path

HERE = Path(__file__).resolve().parent
AUDIO = HERE / "assets" / "audio"
FONTS = Path(r"C:\Users\User\Documents\ig-reels-auto-editor\fonts")

W, H = 1080, 1920
SRT = AUDIO / "subtitles_shifted.srt"
OUT_DEFAULT = AUDIO / "subtitles_shifted.ass"

# 乾淨的白字 + 黑描邊（不用底框）
PRIMARY = "&H00FFFFFF"      # 白
OUTLINE = "&H00000000"      # 黑
SHADOW_COL = "&H64000000"   # 40% 黑（柔和陰影）

ASS_HEADER = """[Script Info]
ScriptType: v4.00+
WrapStyle: 0
ScaledBorderAndShadow: yes
PlayResX: {w}
PlayResY: {h}
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Main,{font},{size},{primary},{primary},{outline},{shadow},-1,0,0,0,100,100,{spacing},0,1,{ol},{sh},2,{ml},{mr},{mv},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""


def ts(sec: float) -> str:
    if sec < 0:
        sec = 0.0
    h = int(sec // 3600)
    m = int(sec % 3600 // 60)
    s = sec % 60
    return f"{h:d}:{m:02d}:{s:05.2f}"


def parse_srt(path: Path) -> list[tuple[float, float, str]]:
    raw = path.read_text(encoding="utf-8-sig")
    cues = []
    for block in re.split(r"\n\s*\n", raw.strip()):
        lines = [l for l in block.splitlines() if l.strip()]
        if len(lines) < 2:
            continue
        # SRT 區塊第一行是序號、第二行才是時間碼（有些檔沒有序號）→ 掃描找時間碼
        ti = next((i for i, l in enumerate(lines) if "-->" in l), None)
        if ti is None:
            continue
        m = re.search(r"(\d+):(\d+):(\d+)[,.](\d+)\s*-->\s*(\d+):(\d+):(\d+)[,.](\d+)", lines[ti])
        if not m:
            continue
        g = [int(x) for x in m.groups()]
        a = g[0] * 3600 + g[1] * 60 + g[2] + g[3] / 1000
        b = g[4] * 3600 + g[5] * 60 + g[6] + g[7] / 1000
        text = "\n".join(lines[ti + 1:]).strip()
        cues.append((a, b, text))
    return cues


def cjk_latin_space(s: str) -> str:
    """中文與拉丁字母／數字之間補一個空格（skill §4）。"""
    s = re.sub(r"([\u4e00-\u9fff])([A-Za-z0-9])", r"\1 \2", s)
    s = re.sub(r"([A-Za-z0-9])([\u4e00-\u9fff])", r"\1 \2", s)
    return s


def em_width(s: str) -> float:
    """估算字串寬度（單位＝em）：中日韓全形 1.0，其餘（拉丁／數字／空白／標點）0.5。"""
    w = 0.0
    for ch in s:
        o = ord(ch)
        if 0x2E80 <= o <= 0x9FFF or 0xF900 <= o <= 0xFAFF or 0xFF00 <= o <= 0xFF60:
            w += 1.0                      # CJK 與全形
        elif ch == "　":
            w += 1.0
        else:
            w += 0.5
    return w


def wrap_zh(text: str, max_em: float) -> list[str]:
    """依「實際寬度」換行（em 為單位），並在兩行時取最平衡的切法。

    為什麼不用字數：中英數混排時「1925 安心專線 · 1995 生命線」用字數會誤判過長，
    導致過度換行；用 em 估算才貼近 libass 實際排版。
    """
    text = text.strip()
    if not text:
        return []
    if em_width(text) <= max_em:
        return [text]
    # 先切成 token：CJK 逐字、拉丁／數字「整串」不可拆（避免 AI→A / I）
    tokens: list[str] = []
    i = 0
    while i < len(text):
        ch = text[i]
        if ch.isascii() and (ch.isalnum() or ch in "%$./-'"):
            j = i
            while j < len(text) and text[j].isascii() and (text[j].isalnum() or text[j] in "%$./-'"):
                j += 1
            tokens.append(text[i:j])
            i = j
        else:
            tokens.append(ch)
            i += 1
    # 貪婪斷行（以 token 為單位）
    lines: list[str] = []
    cur = ""
    for tk in tokens:
        if em_width(cur + tk) > max_em and cur:
            lines.append(cur)
            cur = tk
        else:
            cur += tk
    if cur:
        lines.append(cur)
    # 兩行時改成最平衡的切法（**只切在 token 邊界**，避免把 AI 這種詞拆開）
    if len(lines) == 2:
        best, best_score = None, None
        for k in range(1, len(tokens)):
            a = "".join(tokens[:k])
            b = "".join(tokens[k:])
            if em_width(a) > max_em or em_width(b) > max_em:
                continue
            sc = max(em_width(a), em_width(b))
            if best_score is None or sc < best_score:
                best, best_score = (a, b), sc
        if best:
            lines = list(best)
    # 禁則處理（放在平衡切法「之後」，否則平衡會又把標點推到行首）：
    # 收尾標點不可落在行首（併回上一行，容許些微超寬）、開頭括號不可落在行尾
    CLOSING = "。，、；：！？）」』】》〉…·.,;:!?)]}"
    OPENING = "「『（【《〈"
    i = 1
    while i < len(lines):
        while lines[i] and lines[i][0] in CLOSING:
            lines[i - 1] += lines[i][0]
            lines[i] = lines[i][1:]
        if not lines[i]:
            lines.pop(i)
            continue
        i += 1
    for i in range(len(lines) - 1):
        while lines[i] and lines[i][-1] in OPENING:
            lines[i + 1] = lines[i][-1] + lines[i + 1]
            lines[i] = lines[i][:-1]
    return lines


def build(font: str, size: int, outline: float, shadow: float, margin_v: int,
          max_chars: int, lead_in: float, lead_out: float, fade: int,
          srt: Path, out: Path, margin_lr: int = 90) -> int:
    cues = parse_srt(srt)
    head = ASS_HEADER.format(w=W, h=H, font=font, size=size, primary=PRIMARY,
                             outline=OUTLINE, shadow=SHADOW_COL, spacing=0.4,
                             ol=outline, sh=shadow, ml=margin_lr, mr=margin_lr, mv=margin_v)
    # 每行可用寬度換算成 em（避免任何一行超出畫面被裁）
    max_em = (W - 2 * margin_lr) / size
    events = []
    shrunk = 0
    for a, b, text in cues:
        text = cjk_latin_space(text.replace("\n", ""))
        lines = wrap_zh(text, max_em)
        # 塞不下 2 行就逐級縮字（\fs 覆寫），維持「最多兩行」的版面
        sc = 1.0
        while len(lines) > 2 and sc > 0.78:
            sc = round(sc - 0.04, 2)
            lines = wrap_zh(text, (W - 2 * margin_lr) / (size * sc))
        if sc < 1.0:
            shrunk += 1
        lines = [l.strip() for l in lines if l.strip()]
        body = r"\N".join(lines)
        tags = []
        # 固定位置（\an2 + \pos）：cue 之間有 0.2/0.3s 重疊時，libass 的防碰撞
        # 會把較晚那條往上搬、甚至搬出畫面（實測 7/31 條 cue 因此在成片裡消失）。
        # 用 \pos 直接釘住「底緣置中」，位置就完全不受其他 cue 影響。
        tags.append(f"\\an2\\pos({W // 2},{H - margin_v})")
        if fade > 0:
            tags.append(f"\\fad({fade},{fade})")
        if sc < 1.0:
            tags.append(f"\\fs{int(round(size * sc))}")
        prefix = "{" + "".join(tags) + "}" if tags else ""
        events.append(f"Dialogue: 0,{ts(a - lead_in)},{ts(b + lead_out)},Main,,0,0,0,,{prefix}{body}")
    out.write_text(head + "\n".join(events) + "\n", encoding="utf-8")
    print(f"[make_ass] {out.name}: {len(events)} cues, font={font} size={size} "
          f"outline={outline} shadow={shadow} MarginV={margin_v} "
          f"每行上限={max_em:.1f}em 縮字cue={shrunk}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--font", default="Noto Sans TC")
    ap.add_argument("--size", type=int, default=96)
    ap.add_argument("--outline", type=float, default=4.0)
    ap.add_argument("--shadow", type=float, default=2.0)
    ap.add_argument("--marginv", type=int, default=260)
    ap.add_argument("--maxchars", type=int, default=16)
    ap.add_argument("--lead-in", type=float, default=0.2)
    ap.add_argument("--lead-out", type=float, default=0.3)
    ap.add_argument("--fade", type=int, default=100)
    ap.add_argument("--srt", default=str(SRT))
    ap.add_argument("--out", default=str(OUT_DEFAULT))
    a = ap.parse_args()
    return build(a.font, a.size, a.outline, a.shadow, a.marginv, a.maxchars,
                 a.lead_in, a.lead_out, a.fade, Path(a.srt), Path(a.out))


if __name__ == "__main__":
    raise SystemExit(main())
