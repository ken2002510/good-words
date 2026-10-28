#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
make_cards.py — 產生 1080x1920 字卡 PNG（給 assemble.py 疊在非 Demo 段落）。

字卡只用在「問題／作品登場／規則／三好四給／技術／收尾」，
Demo 段落（真實操作畫面）**完全不遮**，確保評審看到的是真畫面。

用 Pillow 畫，不依賴任何外部素材 → 零授權風險、零個資。
"""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
CARDS = HERE / "assets" / "cards"
CARDS.mkdir(parents=True, exist_ok=True)

W, H = 1080, 1920
BG = (26, 21, 18)
CREAM = (245, 238, 228)
GOLD = (232, 179, 106)
MUTED = (176, 160, 146)
ROSE = (226, 145, 138)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    """找一個有繁體中文字型的字體。"""
    names = (
        ["msjhbd.ttc", "msjh.ttc", "Microsoft JhengHei Bold.ttf"]
        if bold else
        ["msjh.ttc", "msjhbd.ttc", "Microsoft JhengHei.ttf"]
    )
    for n in names:
        for base in (r"C:\Windows\Fonts",):
            p = Path(base) / n
            if p.exists():
                try:
                    return ImageFont.truetype(str(p), size)
                except Exception:
                    continue
    return ImageFont.load_default()


def wrap_cjk(draw: ImageDraw.ImageDraw, text: str, f, max_w: int) -> list[str]:
    """中文逐字換行。"""
    lines, cur = [], ""
    for ch in text:
        if ch == "\n":
            lines.append(cur); cur = ""; continue
        trial = cur + ch
        if draw.textlength(trial, font=f) <= max_w:
            cur = trial
        else:
            lines.append(cur)
            cur = ch
    if cur:
        lines.append(cur)
    return lines


def base_card() -> tuple[Image.Image, ImageDraw.ImageDraw]:
    img = Image.new("RGB", (W, H), BG)
    d = ImageDraw.Draw(img)
    # 柔和漸層（上深下淺），避免死板
    for y in range(H):
        t = y / H
        r = int(26 + 22 * t)
        g = int(21 + 18 * t)
        b = int(18 + 16 * t)
        d.line([(0, y), (W, y)], fill=(r, g, b))
    return img, d


def draw_paragraph(d, lines, f, x, y, lh, fill, align="left", max_w=W - 200):
    for ln in lines:
        w = d.textlength(ln, font=f)
        if align == "center":
            d.text(((W - w) / 2, y), ln, font=f, fill=fill)
        else:
            d.text((x, y), ln, font=f, fill=fill)
        y += lh
    return y


def card_q_self() -> Image.Image:
    img, d = base_card()
    f_huge = font(104, bold=True)
    f_mid = font(52)
    f_sm = font(40)

    d.text((100, 300), "我們最不會說好話的對象", font=f_mid, fill=MUTED)
    d.text((100, 380), "是自己。", font=f_huge, fill=CREAM)

    # 對話泡泡：自我攻擊的內心話
    quotes = [
        "「我怎麼這麼沒用。」",
        "「都是我搞砸的。」",
        "「別人一定覺得我很雷。」",
    ]
    y = 660
    fq = font(46)
    for q in quotes:
        w = d.textlength(q, font=fq)
        d.rounded_rectangle([100, y, 100 + w + 80, y + 108], radius=54,
                            outline=(120, 100, 88), width=3)
        d.text((140, y + 28), q, font=fq, fill=ROSE)
        y += 150

    d.text((100, 1200), "如果這些話是別人對你說的，", font=f_sm, fill=MUTED)
    d.text((100, 1268), "你早就生氣了。", font=f_sm, fill=CREAM)
    d.text((100, 1380), "但對自己說，", font=f_sm, fill=MUTED)
    d.text((100, 1448), "我們卻說得理所當然。", font=f_sm, fill=GOLD)
    return img


def card_title() -> Image.Image:
    img, d = base_card()
    d.text((100, 420), "好好說話", font=font(140, bold=True), fill=CREAM)
    d.text((104, 600), "HAO HAO SHUO HUA", font=font(36), fill=GOLD)

    d.line([(104, 700), (104 + 240, 700)], fill=GOLD, width=5)

    f = font(48)
    y = 780
    for ln in ["把說不出口的心事打進去，", "它先接住你的情緒，",
               "再給你一句具體、真誠、", "真的可以說出口的好話。"]:
        d.text((100, y), ln, font=f, fill=CREAM if y < 1000 else MUTED)
        y += 82

    # 三段結構預告
    y = 1340
    for num, label in (("1", "承接"), ("2", "好話"), ("3", "小步")):
        d.ellipse([100, y, 168, y + 68], outline=GOLD, width=4)
        d.text((122, y + 12), num, font=font(38, bold=True), fill=GOLD)
        d.text((196, y + 12), label, font=font(42), fill=CREAM)
        y += 100
    return img


def card_rules() -> Image.Image:
    img, d = base_card()
    d.text((100, 380), "不是心靈雞湯", font=font(84, bold=True), fill=CREAM)
    d.text((100, 500), "先判斷情緒與處境，最後才給話", font=font(42), fill=MUTED)

    fban = font(50)
    y = 720
    for w in ["加油！你可以的", "別想太多", "想開一點", "一切都會好的"]:
        d.line([(100, y + 40), (100 + d.textlength(w, font=fban) + 40, y + 40)],
               fill=ROSE, width=4)
        d.text((120, y), w, font=fban, fill=(130, 110, 100))
        y += 110

    d.text((100, 1300), "這些話，我們一句都不說。", font=font(52, bold=True), fill=GOLD)
    d.text((100, 1410), "它必須先聽懂你的處境，", font=font(40), fill=MUTED)
    d.text((100, 1470), "才給一句真的說得出口的話。", font=font(40), fill=CREAM)
    return img


def card_threegood() -> Image.Image:
    img, d = base_card()
    d.text((100, 200), "三好 · 四給", font=font(76, bold=True), fill=CREAM)
    d.text((100, 310), "不是口號，是功能", font=font(40), fill=MUTED)

    rows = [
        ("說好話", "把自我攻擊改寫成不虛假的話"),
        ("做好事", "好話轉送 —— 善意可以轉出去"),
        ("存好心", "全程不評價、不貼標籤、不給分數"),
    ]
    y = 470
    for k, v in rows:
        d.rounded_rectangle([90, y, W - 90, y + 190], radius=28,
                            fill=(38, 31, 27), outline=(80, 66, 58), width=2)
        d.text((130, y + 34), k, font=font(52, bold=True), fill=GOLD)
        d.text((130, y + 110), v, font=font(36), fill=CREAM)
        y += 220

    d.line([(100, y + 10), (W - 100, y + 10)], fill=(80, 66, 58), width=2)
    y += 60
    for k, v in [("給人信心", "聚焦你已經做到了什麼"),
                 ("給人歡喜", "收藏一句帶走"),
                 ("給人希望", "今晚只要做一件小事"),
                 ("給人方便", "免登入、手機優先")]:
        d.text((100, y), k, font=font(42, bold=True), fill=CREAM)
        d.text((360, y + 4), v, font=font(34), fill=MUTED)
        y += 82
    return img


def card_tech() -> Image.Image:
    img, d = base_card()
    d.text((100, 300), "技術與隱私", font=font(80, bold=True), fill=CREAM)

    items = [
        ("本機 AI 推論", "在你自己的電腦上跑，不上傳"),
        ("離線可用", "沒有網路也能給出回應"),
        ("免費部署", "評審期間連結持續活著"),
        ("免登入 · 免安裝", "開網頁就能用，手機優先"),
    ]
    y = 540
    for k, v in items:
        d.ellipse([100, y + 12, 136, y + 48], fill=GOLD)
        d.text((180, y), k, font=font(52, bold=True), fill=CREAM)
        d.text((180, y + 78), v, font=font(36), fill=MUTED)
        y += 210

    d.rounded_rectangle([90, y + 20, W - 90, y + 200], radius=28,
                        fill=(38, 31, 27), outline=(120, 100, 88), width=2)
    d.text((130, y + 60), "你的心事", font=font(44), fill=MUTED)
    d.text((130, y + 122), "不會離開你的裝置。", font=font(52, bold=True), fill=GOLD)
    return img


def card_end() -> Image.Image:
    img, d = base_card()
    d.text((100, 640), "好好說話", font=font(150, bold=True), fill=CREAM)
    d.text((104, 850), "先對自己說一句，", font=font(56), fill=MUTED)
    d.text((104, 930), "再把這句話送給別人。", font=font(56), fill=GOLD)

    d.line([(104, 1100), (104 + 300, 1100)], fill=GOLD, width=5)
    d.text((104, 1180), "免登入 · 不上傳 · 手機優先", font=font(38), fill=MUTED)
    return img


CARDS_MAP = {
    "q_self": card_q_self,
    "title": card_title,
    "rules": card_rules,
    "threegood": card_threegood,
    "tech": card_tech,
    "end": card_end,
}


def main() -> int:
    for name, fn in CARDS_MAP.items():
        img = fn()
        p = CARDS / f"{name}.png"
        img.save(p, "PNG")
        print(f"[cards] {p.name}  {img.size}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
