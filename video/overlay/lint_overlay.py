#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
lint_overlay.py — overlay.json 硬規則體檢（獨立 CLI，build_overlay.py 也會 import）。

硬規則：
  R1 每卡時長 >= 2500ms
  R2 同側相鄰卡間隙 >= 300ms
  R3 同一時刻同側最多 1 張卡（不重疊）
  R4 圖形類卡（number-roll/compare-bars/stat-board/progress-ring/timeline-milestones）占比 >= 50%
  R5 顏色只用語意色 accent/data/support/special，params 內禁任何十六進制色值
  R6 params 禁用 speed/scale 保留字
  R7 effect 必須是 10 張合法卡之一；start/end為非負整數毫秒，end>start
用法：python lint_overlay.py [overlay.json 路徑]
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
DEFAULT_JSON = HERE / "overlay.json"

LEGAL_EFFECTS = {
    "big-statement", "compare-bars", "keyword-matrix", "number-roll",
    "progress-ring", "quote-reveal", "segment-board", "stat-board",
    "step-checklist", "timeline-milestones",
}
GRAPHICAL = {
    "number-roll", "compare-bars", "stat-board", "progress-ring", "timeline-milestones",
}
SEMANTIC_COLORS = {"accent", "data", "support", "special"}
RESERVED_KEYS = {"speed", "scale"}
HEX_RE = re.compile(r"#[0-9a-fA-F]{3,8}\b")

MIN_CARD_MS = 2500
MIN_GAP_MS = 300
MIN_GRAPH_RATIO = 0.5


def lint(doc: dict) -> list[dict]:
    issues: list[dict] = []

    def err(msg, card_id=None):
        issues.append({"level": "error", "msg": msg, "card": card_id})

    def warn(msg, card_id=None):
        issues.append({"level": "warn", "msg": msg, "card": card_id})

    if doc.get("version") != 1:
        warn(f"version={doc.get('version')}（預期 1）")
    cards = doc.get("cards") or []
    if not cards:
        err("cards 為空")

    seen = set()
    for c in cards:
        cid = c.get("id")
        if cid in seen:
            err(f"重複 id {cid}", cid)
        seen.add(cid)
        eff = c.get("effect")
        if eff not in LEGAL_EFFECTS:
            err(f"effect 不在 10 卡目錄: {eff}", cid)
        s, e = c.get("start"), c.get("end")
        if not (isinstance(s, int) and isinstance(e, int) and s >= 0 and e > s):
            err(f"start/end 非法: start={s} end={e}", cid)
            continue
        dur = e - s
        if dur < MIN_CARD_MS:
            err(f"R1 每卡需 >= {MIN_CARD_MS}ms，此卡 {dur}ms", cid)
        if c.get("side") not in ("left", "right"):
            err(f"side 非法: {c.get('side')}", cid)
        for k, v in (c.get("params") or {}).items():
            if k in RESERVED_KEYS:
                err(f"R6 params 禁用保留字: {k}", cid)
            if isinstance(v, str) and HEX_RE.search(v):
                err(f"R5 params 含十六進制色值: {v!r}", cid)
            if k.lower().endswith("color") and v not in SEMANTIC_COLORS:
                err(f"R5 語意色非法: {k}={v!r}（只准 accent/data/support/special）", cid)

    # R2 + R3：同側
    for side in ("left", "right"):
        same = sorted((c for c in cards if c.get("side") == side),
                      key=lambda c: c["start"])
        for i in range(len(same)):
            for j in range(i + 1, len(same)):
                a, b = same[i], same[j]
                if b["start"] >= a["end"]:
                    break
                err(f"R3 同側同時超過 1 張: {a['id']} 與 {b['id']} 重疊", b["id"])
            if i + 1 < len(same):
                gap = same[i + 1]["start"] - same[i]["end"]
                if gap < MIN_GAP_MS:
                    err(f"R2 同側相鄰間隙 {gap}ms < {MIN_GAP_MS}ms: "
                        f"{same[i]['id']} -> {same[i + 1]['id']}", same[i + 1]["id"])

    # R4 圖形卡占比
    if cards:
        g = sum(1 for c in cards if c.get("effect") in GRAPHICAL)
        ratio = g / len(cards)
        if ratio < MIN_GRAPH_RATIO:
            err(f"R4 圖形類卡占比 {ratio*100:.1f}% < 50%（{g}/{len(cards)}）")

    # segs 色與 dimAt
    for s in doc.get("segs") or []:
        if s.get("color") not in SEMANTIC_COLORS:
            err(f"seg {s.get('id')} 色非法: {s.get('color')}", s.get("id"))
        d = s.get("dimAt")
        if d is not None and not (0.0 <= d <= 1.0):
            err(f"seg {s.get('id')} dimAt 越界: {d}", s.get("id"))

    return issues


def main() -> int:
    path = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_JSON
    doc = json.loads(path.read_text(encoding="utf-8"))
    issues = lint(doc)
    errors = [i for i in issues if i["level"] == "error"]
    warns = [i for i in issues if i["level"] == "warn"]
    print(f"[lint] {path}")
    print(f"[lint] cards={len(doc.get('cards') or [])} segs={len(doc.get('segs') or [])} "
          f"errors={len(errors)} warns={len(warns)}")
    for i in issues:
        tag = i["level"].upper()
        cid = f"  (card {i['card']})" if i.get("card") else ""
        print(f"  [{tag}] {i['msg']}{cid}")
    if errors:
        print("[lint] FAIL")
        return 1
    print("[lint] PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
