#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
build_overlay.py — 讀 assets/audio/timeline.json，依段邊界推導卡窗，輸出 overlay.json。

時間軸：成片時間 = timeline + 1200ms head_pad（與 assemble.py / subtitles_shifted.srt 一致）。
卡窗推導（不硬編碼絕對時間）：
  * 同 card 連續 run → run 視窗 [首段start, 尾段end]，再內縮 150ms
  * 一個 run 安排 N 張卡時，把 run 視窗等分 N 段，每段再內縮 150ms
  * 全部乘 1000 + 1200ms（head_pad）
demo 段（seg3/seg4，即 demo 視窗 [含「真實」的 seg3 起點-1s, 最後 seg4 結束+1s] 內）：
  卡片 offsetY = -560（上移避開 demo 視窗中央），對應 seg 的 dimAt = 0.12，其餘 0.40。

19 段編排沿用 OVERLAY-ORCHESTRATION-REPORT.md 的段→卡綁定（q_self/title/rules/demo/
threegood/tech/end），卡種/side/色/params 見 PLAN；seg5（tech，好話牆）三張卡內容
對應新旁白（stat-board 好話牆運作 / number-roll 前十名有稱號 / segment-board 每週一重算・公開排行榜）。

輸出：overlay/overlay.json（{version:1, theme:'dark', style:'glass', segs[], cards[]}）
      並同步複製到 overlay/src/overlay.json 供 esbuild 打包進 ?export 頁。
最後跑 lint_overlay 硬規則，FAIL 則非零退出。
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent          # C:\prodcut\video\overlay
VIDEO = HERE.parent                              # C:\prodcut\video
TIMELINE = VIDEO / "assets" / "audio" / "timeline.json"
OUT_JSON = HERE / "overlay.json"
SRC_JSON = HERE / "src" / "overlay.json"

CARD_W = 860          # 一般段落卡寬（畫面 73%；左右一致＝視覺平衡）
CARD_W_DEMO = 780     # demo 段卡寬（讓真實網站畫面仍看得見）
HEAD_MS = 1200          # 成片 head_pad（= assemble.py head_pad）
INSET_MS = 150          # 卡窗內縮
DEMO_OFFSET_Y = -560    # demo 段卡片上移
DEMO_DIM = 0.04   # demo 段幾乎不壓暗：真實網站畫面要清楚（評審要看得出是真的在用）
NORMAL_DIM = 0.40
# 個別段落覆寫暗化值：seg2/seg5 都在播「真實截圖」，壓暗要輕（複驗指出 seg5 仍像抽象模板）
SEG_DIM = {2: 0.15, 5: 0.18}
CARD_W_SEG5 = 700     # seg5 卡片略窄，讓背後的好話牆真截圖露出來

# ---------------------------------------------------------------- 19 段編排
# key = timeline idx；value = list of card specs（一個 run 安排多張卡時依序平分 run 視窗）
PLAN: dict[int, list[dict]] = {
    1: [dict(effect="big-statement", side="left", params=dict(
        text="搞砸了，第一個念頭是\n「我怎麼這麼沒用」", fontSize=86, color="accent"))],
    2: [dict(effect="quote-reveal", side="right", params=dict(
        lines="換成別人對你說\n你早就生氣了\n對自己說，卻覺得理所當然",
        highlight="生氣", fontSize=58, color="special"))],
    # seg2：前半只留一張流程卡（window 0→0.52），後半留白給「全幅真實截圖」
    # （assemble.py 會在 0.54→1.0 插入 S2_rewrite_result / S10_mobile_375_result）
    3: [dict(effect="timeline-milestones", side="left", window=(0.0, 0.52), params=dict(
        items="打進心事\n接住情緒\n給你一句好話", color="support", spreadMs=1400))],
    4: [],   # 原「先辨識，再給話」數據卡移除（審查：抽象數據卡最像套模板，改用真畫面）
    5: [dict(effect="compare-bars", side="left", params=dict(
        title="它不說…", leftLabel="「加油」", leftValue=6, leftColor="support",
        rightLabel="具體的好話", rightValue=94, rightColor="accent",
        footnote="也不假裝你的困難不存在"))],
    # ---- demo 段（seg3/seg4）：offsetY 上移、dim 0.12 ----
    6: [dict(effect="big-statement", side="right", params=dict(
        text="這是真實的網站畫面\n不是簡報", fontSize=66, color="support"))],
    7: [dict(effect="progress-ring", side="left", params=dict(
        title="心事已送出", percent=100, durMs=900,
        label="不用修飾", sublabel="直接打出來", color="data"))],
    8: [dict(effect="stat-board", side="right", params=dict(
        title="AI 情緒辨識",
        stats="聽到的:工作壓力\n強度:4/5\n訊號:自我價值\n回應:先承接", color="data"))],
    9: [dict(effect="step-checklist", side="left", params=dict(
        items="① 承接\n用它的話，把處境說一次", doneColor="special"))],
    10: [dict(effect="quote-reveal", side="right", params=dict(
        lines="② 好話\n「我聽見你為自己講話的\n每一秒都認真」",
        highlight="認真", fontSize=54, color="accent"))],
    11: [dict(effect="step-checklist", side="left", params=dict(
        items="③ 小步\n今晚就能做的一件小事", doneColor="data"))],
    12: [dict(effect="keyword-matrix", side="right", params=dict(
        words="複製\n收藏\n轉送\n朋友\n家人\n同事", hotIndex=2, color="support",
        tagline="換對象，生成不同的說法"))],
    13: [dict(effect="compare-bars", side="left", params=dict(
        title="換一個對象", leftLabel="對自己說", leftValue=28, leftColor="support",
        rightLabel="送給別人", rightValue=86, rightColor="accent",
        footnote="就變成可以送出去的善意"))],
    14: [dict(effect="stat-board", side="right", params=dict(
        title="收藏清單",
        stats="存在:你的瀏覽器\n登入:不用\n上傳:不會\n帳號:不綁", color="data"))],
    15: [dict(effect="big-statement", side="left", params=dict(
        text="危機訊號\n立刻給求助資源", fontSize=70, color="special"))],
    16: [dict(effect="stat-board", side="right", params=dict(
        title="求助資源",
        stats="1925:安心專線\n1995:生命線\n1980:張老師\n底線:AI 不當諮商師", color="special"))],
    17: [dict(effect="timeline-milestones", side="left", params=dict(
        items="說好話・核心\n做好事・轉送\n存好心・不評價\n信心・歡喜・希望・方便",
        color="data", spreadMs=1600))],
    # ---- seg5（tech，現在是講好話牆）：三張卡平分該段 ----
    18: [
        dict(effect="stat-board", side="left", params=dict(
            title="好話牆運作",
            stats="匿名掛牆:是\nAI 先回應:一輪\n鼓勵經 AI 審核:才顯示\n雙方得分:是",
            color="data")),
        dict(effect="number-roll", side="right", params=dict(
            title="排行榜", value=10, suffix=" 名", caption="前十名有稱號",
            durMs=1400, color="special")),
        dict(effect="segment-board", side="left", params=dict(
            title="每週一重算",
            items="重算|每週一重算排行榜\n公開|排行榜公開透明\n稱號|前十名有稱號\n隱私|分數只存在你的瀏覽器",
            color="support")),
    ],
    19: [dict(effect="quote-reveal", side="right", params=dict(
        lines="好好說話\n先對自己說一句\n再把它送給別人",
        highlight="好好說話", fontSize=62, color="accent"))],
}

# 段頭板（segs[]）：依 timeline 的 seg 欄位分組，標題/標籤/色固定，時間由段邊界推導
# 段頭板標題：刻意改成**短標籤**，不要和旁白字幕／卡片寫同一句話
# （實測 seg1 段頭「最不會說好話的對象」與字幕「我們最不會說好話的對象…」完全重複）
SEG_META = {
    1: ("PROBLEM", "痛點", "accent"),
    2: ("INTRO", "作品登場", "support"),
    3: ("LIVE DEMO", "操作示範", "data"),
    4: ("SAFETY", "安全底線", "special"),
    5: ("WALL", "參與方式", "accent"),
    6: ("END", "結語", "special"),
}


def ms(sec: float) -> int:
    return int(round(sec * 1000)) + HEAD_MS


def build() -> dict:
    tl = json.loads(TIMELINE.read_text(encoding="utf-8"))
    assert len(tl) == 19, f"timeline 段數異常: {len(tl)}"

    # demo 視窗（timeline 秒）：含「真實」的 seg3 起點 -1s 至最後 seg4 結束 +1s
    seg3_first = next(it for it in tl if it["seg"] == 3 and "真實" in it["vo"])
    demo_start = seg3_first["start"] - 1.0
    demo_end = [it for it in tl if it["seg"] == 4][-1]["end"] + 1.0

    # ---- 同 card 連續 run 聚合 ----
    runs: list[dict] = []
    for it in tl:
        if runs and runs[-1]["card"] == it["card"]:
            runs[-1]["items"].append(it)
        else:
            runs.append({"card": it["card"], "items": [it]})

    cards: list[dict] = []
    for run in runs:
        items = run["items"]
        first, last = items[0], items[-1]
        run_start, run_end = first["start"], last["end"]           # 秒（timeline）
        is_demo = all(it["seg"] in (3, 4) for it in items)          # demo 段卡片上移
        specs: list[dict] = []
        for it in items:
            specs.extend(PLAN[it["idx"]])
        n = len(specs)
        # 卡窗推導（全部由段邊界算出，不寫死絕對時間）：
        #  - run 只排 1 張卡：同 card 連續 run 取 [首段start, 尾段end] 再內縮 150ms
        #  - 每段恰一張卡：依各段 [start, end] 各自內縮 150ms
        #  - 一段多張卡（如 seg5 三張）：把 run 視窗等分後再各內縮 150ms
        win_override = next((s.get("window") for s in specs if s.get("window")), None)
        if win_override:
            # 自帶分數視窗（相對 run 起訖）：用來刻意留出「全幅真畫面」的時段
            f0, f1 = win_override
            span = run_end - run_start
            wins = [(run_start + span * f0 + INSET_MS / 1000,
                     run_start + span * f1 - INSET_MS / 1000)]
        elif n == 1:
            wins = [(run_start + INSET_MS / 1000, run_end - INSET_MS / 1000)]
        elif n == len(items):
            wins = [(it["start"] + INSET_MS / 1000, it["end"] - INSET_MS / 1000) for it in items]
        else:
            span = (run_end - run_start) / n
            wins = [(run_start + span * k + INSET_MS / 1000,
                     run_start + span * (k + 1) - INSET_MS / 1000) for k in range(n)]
        for k, spec in enumerate(specs):
            sub_a, sub_b = wins[k]
            start_ms = ms(sub_a)
            end_ms = ms(sub_b)
            cid = f"c{items[0]['idx']}" if n == 1 else f"c{items[0]['idx']}-{k + 1}"
            card = {
                "id": cid,
                "effect": spec["effect"],
                "start": start_ms,
                "end": end_ms,
                "side": spec["side"],
                "params": spec["params"],
                # 統一卡寬（約畫面 73%/66%）：左右兩側寬度一致才平衡；
                # demo 段略窄，保留真實網站畫面可見面積。
                "width": (CARD_W_DEMO if is_demo
                          else (CARD_W_SEG5 if all(it["seg"] == 5 for it in items) else CARD_W)),
            }
            if is_demo:
                card["offsetY"] = DEMO_OFFSET_Y
            cards.append(card)

    # ---- segs[] 段頭板：依 seg 欄位分組，時間由段邊界推導 ----
    seg_groups: list[dict] = []
    for it in tl:
        if seg_groups and seg_groups[-1]["seg"] == it["seg"]:
            seg_groups[-1]["items"].append(it)
        else:
            seg_groups.append({"seg": it["seg"], "items": [it]})
    segs: list[dict] = []
    for g in seg_groups:
        num = g["seg"]
        tag, title, color = SEG_META[num]
        s0, e0 = g["items"][0]["start"], g["items"][-1]["end"]
        # demo 段 = 段中點落在 demo 視窗內的 seg（即 seg3/seg4）；其餘 0.40
        mid = (s0 + e0) / 2
        is_demo = demo_start <= mid <= demo_end
        segs.append({
            "id": f"seg-{num}",
            "title": title,
            "tag": tag,
            "color": color,
            "start": ms(s0),
            "end": ms(e0),
            "dimAt": DEMO_DIM if is_demo else SEG_DIM.get(num, NORMAL_DIM),
        })

    return {
        "version": 1,
        "theme": "dark",
        "style": "glass",
        "segs": segs,
        "cards": cards,
    }


def main() -> int:
    doc = build()
    OUT_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")
    SRC_JSON.write_text(json.dumps(doc, ensure_ascii=False, indent=2), encoding="utf-8")

    vo_end = json.loads(TIMELINE.read_text(encoding="utf-8"))[-1]["end"]
    print(f"[build] timeline 19 段，旁白尾 {vo_end:.3f}s，成片時間軸 +{HEAD_MS}ms head_pad")
    print(f"[build] 寫出 {OUT_JSON}（同步 {SRC_JSON}）")
    print(f"[build] segs={len(doc['segs'])} cards={len(doc['cards'])}")
    for c in doc["cards"]:
        dur = (c["end"] - c["start"]) / 1000
        print(f"  {c['id']:>7}  {c['start']/1000:8.3f} -> {c['end']/1000:8.3f}s "
              f"({dur:5.2f}s)  {c['effect']:<20} {c['side']:<5} "
              f"offsetY={c.get('offsetY', 0)}")

    from lint_overlay import lint
    issues = lint(doc)
    errors = [i for i in issues if i["level"] == "error"]
    for i in issues:
        print(f"  [{i['level'].upper()}] {i['msg']}" + (f" (card {i['card']})" if i.get("card") else ""))
    if errors:
        print(f"[build] lint FAIL（{len(errors)} errors）")
        return 1
    g = sum(1 for c in doc["cards"]
            if c["effect"] in {"number-roll", "compare-bars", "stat-board",
                               "progress-ring", "timeline-milestones"})
    print(f"[build] lint PASS（圖形卡 {g}/{len(doc['cards'])} = {g/len(doc['cards'])*100:.1f}%）")
    return 0


if __name__ == "__main__":
    sys.exit(main())
