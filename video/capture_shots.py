#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
capture_shots.py — 重拍《好好說話》線上 UI 截圖 S1–S10（競賽版，防個資）。

## 重點
- 本機起 node app/server.js（PORT=3210，OLLAMA_URL 指死 port，只當靜態檔伺服器用）。
- **所有動態資料都用 page.route 攔截、回傳虛構 JSON** —— 真實牆內容絕對不入鏡
  （競賽零個資紅線）：/api/respond、/api/wall(GET/POST)、/api/encourage、
  /api/leaderboard、/api/health、/api/share。
- localStorage 以 add_init_script 注入固定 demo 身分與分數（hsh.anon.v1 / hsh.profile.v1），
  讓 #me-panel 直接有總分/本週分數/稱號/排名可截。
- 虛構貼文/鼓勵/回應皆無 email/電話/網址/@帳號/真人姓名/學校，且不含禁語罐頭（加油等）。
- viewport 540x960 + device_scale_factor=2 → 恰為 1080x1920（9:16）；
  S3 用 full_page；S4–S9 用區塊（element）截圖、高度自動；S10 手機版 375x812 dsf=2 → 750x1624。
- locale zh-TW、timezone Asia/Taipei、color_scheme light。
- 每張存檔後用 PIL 檢查尺寸與 stddev≥3（防全黑/全白），log 寫到 video/raw/shots_log.txt。

用法：
    uv run --offline --with playwright --with pillow python capture_shots.py
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

HERE = Path(__file__).resolve().parent          # C:\prodcut\video
ROOT = HERE.parent                               # C:\prodcut
SHOTS = HERE / "assets" / "shots"
RAW = HERE / "raw"
LOG_PATH = RAW / "shots_log.txt"
SHOTS.mkdir(parents=True, exist_ok=True)
RAW.mkdir(parents=True, exist_ok=True)

NODE = r"C:\Users\User\.dsh\dsh-runtimes\dsh-primary-runtime\dependencies\node\bin\node.exe"
SERVER_JS = ROOT / "app" / "server.js"
PORT = 3210
BASE = f"http://127.0.0.1:{PORT}"

VIEW_W, VIEW_H = 540, 960      # dsf=2 → 1080x1920
MOB_W, MOB_H = 375, 812        # dsf=2 → 750x1624

# ── 固定虛構身分（前端 handle = '牆友#' + anon 後 4 碼大寫 → 牆友#BB22）──
ANON = "demo-shots-a3f9aa11bb22"
ME_HANDLE = "牆友#BB22"
WEEK = "2026-W45"
MODEL = "nvidia/nemotron-3.5-bolt-e4b"

TOPICS = [
    {"id": "work", "name": "工作"}, {"id": "love", "name": "感情"},
    {"id": "family", "name": "家庭"}, {"id": "self", "name": "自我價值"},
    {"id": "lonely", "name": "孤單"}, {"id": "anger", "name": "憤怒"},
    {"id": "anxiety", "name": "焦慮"}, {"id": "other", "name": "其他"},
]
TOPIC_NAME = {t["id"]: t["name"] for t in TOPICS}


def log(msg: str) -> None:
    print(f"[shots] {msg}", flush=True)


def _uuid(n: int) -> str:
    return f"shot0000-0000-4000-8000-{n:012d}"


def _ts(hours_ago: float) -> int:
    return int(time.time() * 1000) - int(hours_ago * 3600 * 1000)


# ── 虛構輸入文字（不含個資、不含禁語）──
CHAT_INPUT = "昨天下午三點開會被念，回家一直覺得自己很沒用。"
REWRITE_INPUT = "我怎麼這麼沒用，什麼事都做不好。"
CRISIS_INPUT = "我真的撐不下去了，不想活了。"
ENC_INPUT = "昨天下午三點那場會議我也聽到了，你的委屈我懂。"

# ── 虛構 API 回應 ─────────────────────────────────────────────

CHAT_BODY = {
    "crisis": False,
    "emotion": {"id": "work", "name": "工作壓力", "intensity": 4,
                "situation": "下午的會議中被指責，回家後一直覺得自己沒用"},
    "accept": "下午三點的那場會議聽起來讓你對自己很失望，那種感覺是真的。",
    "goodword": "被念的當下很難受，但那一句話不等於你這個人沒有價值。",
    "smallstep": "今晚睡前，寫下明天開會時一件可以先做好的小事。",
    "meta": {"engine": "nvidia", "model": MODEL, "mode": "chat", "degraded": False, "elapsedMs": 1700},
}

REWRITE_BODY = {
    "crisis": False,
    "emotion": {"id": "self", "name": "自我責怪", "intensity": 4,
                "situation": "對自己說過的重話，想找一個說得出口的版本"},
    "accept": "你願意把這句重話拿出來看，代表你已經覺得它不對了。",
    "goodword": "「這次沒做好」比「我什麼都做不好」更接近事實。",
    "smallstep": "下次再想責怪自己時，把那句話改成只講這一次的事。",
    "meta": {"engine": "nvidia", "model": MODEL, "mode": "rewrite", "degraded": False, "elapsedMs": 1500},
}

CRISIS_BODY = {
    "crisis": True,
    "accept": "你願意說出來，這件事很重要。現在最重要的不是想清楚，是讓一個真人聽到。",
    "resources": [
        {"name": "1925 安心專線", "tel": "1925", "note": "24 小時，免付費。心情困住、想找人說話都可以打。"},
        {"name": "1995 生命線", "tel": "1995", "note": "24 小時。覺得撐不下去的時候，有人會聽。"},
        {"name": "1980 張老師", "tel": "1980", "note": "週一至週六 09:00–21:00、週日 09:00–17:00。談心事、談家裡的事。"},
        {"name": "119 / 110", "tel": "119", "note": "如果你或身邊的人正在發生立即的危險，請直接打 119 或 110。"},
    ],
    "meta": {"engine": "safety", "degraded": False, "elapsedMs": 120},
}

HEALTH_BODY = {
    "ok": True, "app": "好好說話", "time": "2026-11-05T05:00:00.000Z",
    "engines": {
        "ollama": {"url": "http://127.0.0.1:9/", "model": "qwen3:4b-instruct", "alive": False, "timeoutMs": 800},
        "nvidia": {"enabled": True, "model": MODEL, "url": "https://integrate.api.nvidia.com/v1/chat/completions", "timeoutMs": 6500},
        "cloud": {"enabled": False},
        "rules": {"enabled": True},
        "wall": {"enabled": True},
    },
    "content": {"source": "content-dir", "emotions": 14, "goodwordSets": 14, "warnings": []},
    "recentErrors": [],
}

# 虛構牆上貼文（4 篇；handle皆為 牆友#XXXX，內容無個資無禁語）
WALL_ITEMS = [
    {
        "id": _uuid(1), "handle": "牆友#K7Q2", "topic": "work", "topicName": "工作",
        "text": "上週五的專案檢討被當眾糾正，這週一直覺得抬不起頭。",
        "accept": "上週五被當眾糾正，那種抬不起頭的感覺會一直留著。",
        "goodword": "被糾正的是那份專案，不是你這個人。",
        "smallstep": "下次檢討前，先把自己這週做好的三件事寫下來。",
        "engine": "nvidia", "model": MODEL, "createdAt": _ts(50),
        "encs": [{"id": _uuid(11), "handle": "牆友#M3X9",
                 "text": "上週五我也在場，你願意提出來的那一刻我有聽到。", "score": 8, "createdAt": _ts(30)}],
    },
    {
        "id": _uuid(2), "handle": "牆友#T8W1", "topic": "self", "topicName": "自我價值",
        "text": "每次比賽前一晚都睡不好，怕拖大家後腿。",
        "accept": "睡不著的夜晚，通常是心裡有件事在反覆確認。",
        "goodword": "會怕拖累別人，正代表你在意這個團隊。",
        "smallstep": "今晚睡前寫下三件你這次已經做到的事。",
        "engine": "nvidia", "model": MODEL, "createdAt": _ts(26),
        "encs": [
            {"id": _uuid(12), "handle": "牆友#R5L6", "text": "睡不好的夜晚很磨人，但你願意準備已經是責任感了。", "score": 10, "createdAt": _ts(20)},
            {"id": _uuid(13), "handle": "牆友#D4M7", "text": "比賽前緊張是正常的，代表你在乎這件事。", "score": 6, "createdAt": _ts(5)},
        ],
    },
    {
        "id": _uuid(3), "handle": "牆友#F9N1", "topic": "family", "topicName": "家庭",
        "text": "過年回家又被問什麼時候結婚，我真的不知道怎麼回答。",
        "accept": "過年被問這種問題，壓力會一下子冒上來。",
        "goodword": "你不需要馬上有答案，這個問題本身就很重。",
        "smallstep": "下次被問時，可以先說「我還在想」，給自己一點空間。",
        "engine": "rules", "model": "", "createdAt": _ts(8),
        "encs": [],
    },
    {
        "id": _uuid(4), "handle": "牆友#J6P3", "topic": "lonely", "topicName": "孤單",
        "text": "搬來新城市半年了，還沒認識什麼朋友。",
        "accept": "新城市的半年，孤單是很真實的感覺。",
        "goodword": "願意把孤單說出來，已經是認識新朋友的第一步。",
        "smallstep": "這週挑一天去同一個地方待一會兒，慢慢累積熟悉感。",
        "engine": "nvidia", "model": MODEL, "createdAt": _ts(3),
        "encs": [{"id": _uuid(14), "handle": "牆友#H8K2",
                 "text": "搬來新城市的頭半年最難熬，你願意留下來已經不容易。", "score": 7, "createdAt": _ts(1)}],
    },
]

# 掛牆成功後，別人留給「我」的那篇貼文的鼓勵（出現在 #me-panel 的我的牆上貼文）
RECV_ENC = {"id": _uuid(15), "handle": "牆友#K7Q2",
            "text": "謝謝你願意把這件事說出來，被念的感覺我懂。", "score": 8, "createdAt": _ts(2)}


def _board_entry(rank: int, handle: str, pts: int) -> dict:
    title = {1: "好話燈塔", 2: "溫暖推手", 3: "善意達人"}.get(rank, "好話夥伴")
    return {"rank": rank, "handle": handle, "pts": pts, "title": title}


BOARD_BODY = {
    "ok": True, "wallEnabled": True, "week": WEEK,
    "top": [
        _board_entry(1, "牆友#H8K2", 87), _board_entry(2, ME_HANDLE, 41), _board_entry(3, "牆友#D4M7", 38),
        _board_entry(4, "牆友#F9N1", 33), _board_entry(5, "牆友#J6P3", 29), _board_entry(6, "牆友#L2R8", 26),
        _board_entry(7, "牆友#Q5T9", 22), _board_entry(8, "牆友#S7V4", 19), _board_entry(9, "牆友#U1X6", 15),
        _board_entry(10, "牆友#W3Z8", 12),
    ],
    "me": {"handle": ME_HANDLE, "pts": 41, "rank": 2, "title": "溫暖推手", "allPts": 96},
}

# ── 可變狀態（route handler 共用）──
STATE = {"crisis": False, "published": None}

# ── localStorage 注入（add_init_script）──
_NOW = int(time.time() * 1000)
PROFILE = {
    "week": WEEK, "weekPts": 41, "allPts": 96,
    "history": [
        {"ts": _NOW - 2 * 3600 * 1000, "type": "post", "delta": 23,
         "note": "篇幅具體、有時間/次數細節、AI 有接住 +5"},
        {"ts": _NOW - 90 * 60 * 1000, "type": "enc", "delta": 10, "note": "有回應到貼文內容"},
        {"ts": _NOW - 40 * 60 * 1000, "type": "encRecv", "delta": 5, "note": "你的貼文收到鼓勵"},
    ],
}
# 注意：不要包成 "() => {...}" —— Playwright 會把字串原樣 evaluate，
# 箭頭函式只會被建立而不被呼叫，localStorage 就不會寫入（已實測踩過）。
INIT_JS = (
    "try {"
    " localStorage.setItem('hsh.anon.v1', " + json.dumps(ANON) + ");"
    " localStorage.setItem('hsh.profile.v1', " + json.dumps(PROFILE, ensure_ascii=False) + ");"
    "} catch (e) {}"
)


def make_published_item(post_data: str | None) -> dict:
    try:
        pd = json.loads(post_data or "{}")
    except Exception:
        pd = {}
    topic = pd.get("topic") or "work"
    ai = pd.get("ai") or {}
    return {
        "id": _uuid(50), "handle": ME_HANDLE, "topic": topic,
        "topicName": TOPIC_NAME.get(topic, "其他"),
        "text": pd.get("text") or "",
        "accept": ai.get("accept") or "",
        "goodword": ai.get("goodword") or "",
        "smallstep": ai.get("smallstep") or "",
        "engine": ai.get("engine") or "nvidia",
        "model": ai.get("model") or MODEL,
        "createdAt": int(time.time() * 1000),
        "encs": [],
    }


def install_routes(page) -> None:
    """所有 /api/* 都回虛構資料；真實牆內容絕不入鏡。"""

    def fj(route, obj, status=200):
        route.fulfill(status=status, content_type="application/json; charset=utf-8",
                      body=json.dumps(obj, ensure_ascii=False))

    def on_respond(route):
        mode = "chat"
        try:
            pd = route.request.post_data
            if pd:
                mode = (json.loads(pd) or {}).get("mode") or "chat"
        except Exception:
            pass
        if STATE["crisis"]:
            fj(route, CRISIS_BODY)
        elif mode == "rewrite":
            fj(route, REWRITE_BODY)
        else:
            fj(route, CHAT_BODY)

    def on_wall(route):
        req = route.request
        if req.method == "POST":
            STATE["published"] = make_published_item(req.post_data)
            fj(route, {
                "ok": True, "wallEnabled": True, "week": WEEK,
                "points": 23,
                "scoreWhy": ["篇幅具體", "有時間/次數細節", "AI 有接住 +5"],
                "item": STATE["published"],
            })
            return
        if "mine=1" in req.url:
            items = []
            if STATE["published"]:
                it = dict(STATE["published"])
                it["encs"] = [dict(RECV_ENC)]
                items = [it]
            fj(route, {"ok": True, "wallEnabled": True, "week": WEEK, "topics": TOPICS, "items": items})
            return
        items = ([STATE["published"]] if STATE["published"] else []) + WALL_ITEMS
        fj(route, {"ok": True, "wallEnabled": True, "week": WEEK, "topics": TOPICS, "items": items})

    def on_encourage(route):
        try:
            pd = json.loads(route.request.post_data or "{}")
        except Exception:
            pd = {}
        item_id = pd.get("itemId")
        enc = {"id": _uuid(99), "text": pd.get("text") or "", "handle": ME_HANDLE,
               "score": 10, "createdAt": int(time.time() * 1000)}
        pool = ([STATE["published"]] if STATE["published"] else []) + WALL_ITEMS
        for it in pool:
            if it["id"] == item_id:
                it.setdefault("encs", []).append(enc)
                break
        fj(route, {"ok": True, "wallEnabled": True, "week": WEEK, "delta": 10, "posterDelta": 5,
                   "scoreWhy": ["有回應到貼文內容"], "enc": enc})

    def on_board(route):
        fj(route, BOARD_BODY)

    def on_health(route):
        fj(route, HEALTH_BODY)

    def on_share(route):
        fj(route, {"text": "嗨，最近還好嗎。\n\n「這次沒做好，不代表你什麼事都做不好。」\n\n不用回我，看完就好。",
                   "copyText": "嗨，最近還好嗎。\n\n「這次沒做好，不代表你什麼事都做不好。」\n\n不用回我，看完就好。"})

    page.route("**/api/respond*", on_respond)
    page.route("**/api/wall*", on_wall)
    page.route("**/api/encourage*", on_encourage)
    page.route("**/api/leaderboard*", on_board)
    page.route("**/api/health*", on_health)
    page.route("**/api/share*", on_share)


# ── 人味操作 helper（沿用 demo_steps.py）──
sys.path.insert(0, str(HERE))
import demo_steps  # noqa: E402

human_type = demo_steps.human_type
scroll_to = demo_steps.scroll_to

LAUNCH_KWARGS = dict(
    headless=True,
    args=["--no-first-run", "--no-default-browser-check",
          "--disable-features=Translate,MediaRouter",
          "--disable-notifications", "--hide-scrollbars"],
)


def ctx_kwargs(w: int, h: int) -> dict:
    return dict(viewport={"width": w, "height": h}, device_scale_factor=2,
                locale="zh-TW", timezone_id="Asia/Taipei", color_scheme="light")


def save_shot(page, name: str, full_page: bool = False, selector: str | None = None,
              expect: tuple | None = None) -> dict:
    from PIL import Image, ImageStat

    path = SHOTS / f"{name}.png"
    if selector:
        page.locator(selector).screenshot(path=str(path))
    else:
        page.screenshot(path=str(path), full_page=full_page)
    im = Image.open(path)
    w, h = im.size
    std = round(ImageStat.Stat(im.convert("L")).stddev[0], 2)
    ok = std >= 3.0
    if expect is not None:
        ok = ok and (w, h) == expect
    else:
        ok = ok and w >= 700 and h >= 300
    rec = {"name": name, "file": path.name, "w": w, "h": h, "std": std, "ok": bool(ok)}
    log(f"  {path.name} {w}x{h} stddev={std} {'OK' if ok else '!! FAIL'}")
    return rec


def wait_wall(page) -> None:
    page.wait_for_selector("#wall-list .wall-item", state="attached", timeout=20000)


def run_desktop(browser, results: list) -> None:
    ctx = browser.new_context(**ctx_kwargs(VIEW_W, VIEW_H))
    ctx.set_default_timeout(20000)
    ctx.add_init_script(INIT_JS)
    page = ctx.new_page()
    install_routes(page)

    # ── S1 乾淨首頁 ──
    log("S1 home_clean")
    page.goto(BASE, wait_until="networkidle", timeout=30000)
    page.wait_for_selector("#input", state="visible", timeout=20000)
    wait_wall(page)
    page.wait_for_timeout(800)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(400)
    results.append(save_shot(page, "S1_home_clean", expect=(1080, 1920)))

    # ── S2 改寫模式結果 ──
    log("S2 rewrite_result")
    page.click('.mode-btn[data-mode="rewrite"]')
    page.wait_for_timeout(300)
    human_type(page, page.locator("#input"), REWRITE_INPUT, delay_ms=95)
    page.click("#btn-submit")
    page.wait_for_selector("#result-body", state="visible", timeout=20000)
    page.wait_for_timeout(900)
    scroll_to(page, "#result", block="start", duration=1.2)
    page.wait_for_timeout(500)
    results.append(save_shot(page, "S2_rewrite_result", expect=(1080, 1920)))

    # ── 重新載入，準備 S3（chat 模式）──
    page.goto(BASE, wait_until="networkidle", timeout=30000)
    page.wait_for_selector("#input", state="visible", timeout=20000)
    wait_wall(page)
    page.wait_for_timeout(600)

    # ── S3 chat 三段回應（full_page）──
    log("S3 response_3part (full_page)")
    human_type(page, page.locator("#input"), CHAT_INPUT, delay_ms=95)
    page.click("#btn-submit")
    page.wait_for_selector("#result-body", state="visible", timeout=20000)
    page.wait_for_timeout(1000)
    results.append(save_shot(page, "S3_response_3part", full_page=True))

    # ── S4 掛牆成功，牆上出現新貼文 ──
    log("S4 wall_after_publish")
    page.select_option("#publish-topic", "work")
    page.wait_for_timeout(200)
    page.click("#btn-publish")
    page.wait_for_function(
        "(t) => { const el = document.querySelector('#wall-list .wall-item .wall-text');"
        " return !!(el && el.textContent.includes(t)); }",
        arg=CHAT_INPUT, timeout=15000)
    page.wait_for_timeout(900)
    scroll_to(page, "#wall-section", block="start", duration=1.2)
    page.wait_for_timeout(500)
    results.append(save_shot(page, "S4_wall_after_publish", selector="#wall-section"))

    # ── S5 主題過濾「工作」──
    log("S5 wall_filter（工作）")
    page.click('.filter-chip[data-topic="work"]')
    page.wait_for_timeout(600)
    results.append(save_shot(page, "S5_wall_filter", selector="#wall-section"))

    # ── S6 對一篇牆上貼文留鼓勵，出現 +分 ──
    log("S6 encourage_flow")
    page.click('.filter-chip[data-topic="all"]')
    page.wait_for_timeout(500)
    first_item = page.locator("#wall-list .wall-item").first
    human_type(page, first_item.locator(".enc-input"), ENC_INPUT, delay_ms=80)
    first_item.locator(".enc-send").click()
    page.wait_for_selector("#wall-list .wall-item .enc-item", state="attached", timeout=15000)
    page.wait_for_timeout(400)
    scroll_to(page, "#wall-list .wall-item", block="center", duration=1.2)
    page.wait_for_timeout(400)
    results.append(save_shot(page, "S6_encourage_flow", expect=(1080, 1920)))

    # ── S7 我的好話紀錄 ──
    log("S7 me_panel")
    scroll_to(page, "#me-panel", block="start", duration=1.2)
    page.wait_for_timeout(600)
    results.append(save_shot(page, "S7_me_panel", selector="#me-panel"))

    # ── S8 本週排行榜前 10 ──
    log("S8 leaderboard_top10")
    scroll_to(page, "#board", block="start", duration=1.2)
    page.wait_for_timeout(600)
    results.append(save_shot(page, "S8_leaderboard_top10", selector="#board"))

    # ── S9 危機轉介畫面 ──
    log("S9 crisis_panel")
    STATE["crisis"] = True
    scroll_to(page, "#input", block="center", duration=1.2)
    page.wait_for_timeout(300)
    human_type(page, page.locator("#input"), CRISIS_INPUT, delay_ms=110)
    page.click("#btn-submit")
    page.wait_for_function(
        "() => { const c = document.getElementById('crisis'); return c && !c.hidden; }",
        timeout=20000)
    page.wait_for_timeout(900)
    results.append(save_shot(page, "S9_crisis_panel", selector="#crisis"))
    STATE["crisis"] = False

    ctx.close()


def run_mobile(browser, results: list) -> None:
    ctx = browser.new_context(**ctx_kwargs(MOB_W, MOB_H))
    ctx.set_default_timeout(20000)
    ctx.add_init_script(INIT_JS)
    page = ctx.new_page()
    install_routes(page)

    log("S10 mobile_375 home")
    page.goto(BASE, wait_until="networkidle", timeout=30000)
    page.wait_for_selector("#input", state="visible", timeout=20000)
    page.wait_for_timeout(900)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(400)
    results.append(save_shot(page, "S10_mobile_375_home", expect=(750, 1624)))

    log("S10 mobile_375 result")
    human_type(page, page.locator("#input"), CHAT_INPUT, delay_ms=95)
    page.click("#btn-submit")
    page.wait_for_selector("#result-body", state="visible", timeout=20000)
    page.wait_for_timeout(900)
    scroll_to(page, "#result", block="start", duration=1.0)
    page.wait_for_timeout(500)
    results.append(save_shot(page, "S10_mobile_375_result", expect=(750, 1624)))

    ctx.close()


def start_server():
    env = dict(os.environ)
    env.update({
        "PORT": str(PORT),
        "HOST": "127.0.0.1",
        "OLLAMA_URL": "http://127.0.0.1:9/",   # 死 port：connection refused，走 rules 降級
        "OLLAMA_TIMEOUT_MS": "800",
    })
    errf = tempfile.TemporaryFile()
    proc = subprocess.Popen([NODE, str(SERVER_JS)], cwd=str(ROOT / "app"),
                            env=env, stdout=subprocess.DEVNULL, stderr=errf)
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"{BASE}/api/health", timeout=2) as r:
                if r.status == 200:
                    return proc, errf
        except urllib.error.HTTPError:
            return proc, errf
        except Exception:
            time.sleep(0.4)
    errf.seek(0)
    log("server stderr: " + errf.read().decode("utf-8", "replace")[-2000:])
    raise RuntimeError("本機 server 未在 30s 內回 200")


def write_log(results: list) -> None:
    lines = []
    lines.append("# capture_shots.py 截圖 log（task-2 重拍線上 UI 截圖 S1–S10）")
    lines.append(f"#時間: {time.strftime('%Y-%m-%d %H:%M:%S')} (Asia/Taipei)")
    lines.append(f"#來源: 本機 {BASE} — node app/server.js, PORT={PORT}, OLLAMA_URL=http://127.0.0.1:9/ (死 port)")
    lines.append("#攔截: page.route 虛構回應 /api/respond, /api/wall(GET/POST/mine), /api/encourage, /api/leaderboard, /api/health, /api/share")
    lines.append("#localStorage: add_init_script 注入 hsh.anon.v1=demo-shots-a3f9aa11bb22（顯示 牆友#BB22）、hsh.profile.v1(week 2026-W45, weekPts 41, allPts 96, history 3 筆)")
    lines.append("#畫面: viewport 540x960 dsf=2 → 1080x1920；S10 375x812 dsf=2 → 750x1624；locale zh-TW / Asia/Taipei / light；S3 full_page，S4-S9 區塊截圖")
    lines.append("#防呆: PIL 檢查 stddev≥3（防全黑/全白）；目視欄由人工 read_image 逐張確認後填寫")
    lines.append("")
    lines.append("| 檔名 | 像素尺寸 | stddev | 機械檢查 | 目視結果 |")
    lines.append("|---|---|---|---|---|")
    for r in results:
        lines.append(f"| {r['file']} | {r['w']}x{r['h']} | {r['std']} | {'PASS' if r['ok'] else 'FAIL'} | 待目視 |")
    lines.append("")
    lines.append(f"共 {len(results)} 張 PNG，全部機械檢查 {'PASS' if all(r['ok'] for r in results) else '有 FAIL'}")
    LOG_PATH.write_text("\n".join(lines) + "\n", encoding="utf-8")
    log(f"log → {LOG_PATH}")


def main() -> int:
    log(f"啟動本機 server: {NODE} {SERVER_JS} (PORT={PORT}, OLLAMA_URL 死 port)")
    proc, errf = start_server()
    log("server /api/health 已回 200")
    results: list = []
    try:
        from playwright.sync_api import sync_playwright
        with sync_playwright() as pw:
            browser = pw.chromium.launch(**LAUNCH_KWARGS)
            try:
                run_desktop(browser, results)
                run_mobile(browser, results)
            finally:
                browser.close()
    finally:
        try:
            proc.terminate()
            proc.wait(timeout=5)
        except Exception:
            proc.kill()
    write_log(results)
    log(f"完成 {len(results)} 張 → {SHOTS}")
    bad = [r for r in results if not r["ok"]]
    if bad:
        log("!! 有未過機械檢查的圖: " + ", ".join(r["file"] for r in bad))
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
