# -*- coding: utf-8 -*-
"""verify_spec.py — 重開 作品說明書.docx，逐項驗證官方格式硬規定。"""
import re
import sys
import zipfile

import docx
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

PATH = r"C:\prodcut\docs\作品說明書.docx"
W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"

ok = True
def chk(label, cond, detail=""):
    global ok
    mark = "PASS" if cond else "FAIL"
    if not cond:
        ok = False
    print(f"[{mark}] {label}" + (f"  -> {detail}" if detail else ""))

d = docx.Document(PATH)
s = d.sections[0]

print("=" * 70)
print("A. 版面設定")
print("=" * 70)
# page size in cm
w_cm = s.page_width.cm; h_cm = s.page_height.cm
chk("A4 直向 (21.0 x 29.7 cm)", abs(w_cm-21.0) < 0.05 and abs(h_cm-29.7) < 0.05 and w_cm < h_cm,
    f"{w_cm:.2f} x {h_cm:.2f} cm")
for name, val in [("上", s.top_margin), ("下", s.bottom_margin),
                  ("左", s.left_margin), ("右", s.right_margin)]:
    chk(f"{name}邊界 = 2cm", abs(val.cm - 2.0) < 0.02, f"{val.cm:.3f} cm")
chk("裝訂邊 = 1cm", abs(s.gutter.cm - 1.0) < 0.02, f"{s.gutter.cm:.3f} cm")

print()
print("=" * 70)
print("B. 字型（標楷體 + eastAsia）")
print("=" * 70)
def runs_all(doc):
    for p in doc.paragraphs:
        for r in p.runs:
            yield p, r
    for t in doc.tables:
        for row in t.rows:
            for c in row.cells:
                for p in c.paragraphs:
                    for r in p.runs:
                        yield p, r

tot = 0; miss_ea = []; miss_sz = []; wrong_ea = []
for p, r in runs_all(d):
    if not r.text.strip():
        continue
    tot += 1
    rpr = r._element.find(qn("w:rPr"))
    rf = rpr.find(qn("w:rFonts")) if rpr is not None else None
    ea = rf.get(qn("w:eastAsia")) if rf is not None else None
    if ea is None:
        miss_ea.append(r.text[:20])
    elif ea != "標楷體":
        wrong_ea.append((ea, r.text[:20]))
    sz = r.font.size
    if sz is None:
        miss_sz.append(r.text[:20])

print(f"非空白 run 總數: {tot}")
chk("每個 run 都有 w:eastAsia", len(miss_ea) == 0, f"缺 {len(miss_ea)} 個: {miss_ea[:3]}")
chk("w:eastAsia 皆為標楷體", len(wrong_ea) == 0, f"例外: {wrong_ea[:3]}")
chk("每個 run 都有明確字級", len(miss_sz) == 0, f"缺 {len(miss_sz)} 個: {miss_sz[:3]}")

sizes = {}
for p, r in runs_all(d):
    if r.text.strip() and r.font.size:
        sizes[r.font.size.pt] = sizes.get(r.font.size.pt, 0) + 1
print("字級分布:", dict(sorted(sizes.items())))
body14 = sum(v for k, v in sizes.items() if k == 14)
chk("14 級為本文主體", body14 > 0, f"14 級 run = {body14}")

# Normal style eastAsia
st = d.styles["Normal"]
rpr = st.element.find(qn("w:rPr"))
rf = rpr.find(qn("w:rFonts")) if rpr is not None else None
nea = rf.get(qn("w:eastAsia")) if rf is not None else None
chk("Normal style 預設 eastAsia = 標楷體", nea == "標楷體", f"實際: {nea}")

print()
print("=" * 70)
print("C. 行距 / 段距")
print("=" * 70)
ls = {}; sb = {}; sa = {}
for p in d.paragraphs:
    pf = p.paragraph_format
    if p.text.strip():
        ls[str(pf.line_spacing)] = ls.get(str(pf.line_spacing), 0) + 1
        sb[str(pf.space_before.pt if pf.space_before is not None else None)] = \
            sb.get(str(pf.space_before.pt if pf.space_before is not None else None), 0) + 1
        sa[str(pf.space_after.pt if pf.space_after is not None else None)] = \
            sa.get(str(pf.space_after.pt if pf.space_after is not None else None), 0) + 1
print("line_spacing:", ls)
print("space_before:", sb)
print("space_after:", sa)
chk("全部單行間距 (1.0)", set(ls) <= {"1.0"}, f"{ls}")

print()
print("=" * 70)
print("D. 頁碼 footer")
print("=" * 70)
z = zipfile.ZipFile(PATH)
footers = [n for n in z.namelist() if re.match(r"word/footer\d*\.xml", n)]
chk("存在 footer part", len(footers) > 0, str(footers))
allf = "".join(z.read(n).decode("utf-8") for n in footers)
chk("footer 含 PAGE 欄位", "PAGE" in allf)
chk("footer 含 NUMPAGES 欄位", "NUMPAGES" in allf)
chk("footer 含 fldChar", "fldChar" in allf)
m = re.findall(r"<w:t[^>]*>([^<]*)</w:t>", allf)
print("footer 可見文字片段:", [x for x in m if x.strip()])

print()
print("=" * 70)
print("E. 章節標題（照官方模板）")
print("=" * 70)
REQ = [
    "創作動機與欲解決之問題",
    "作品內容及主要特色",
    "AI 技術或 AI 工具運用方式",
    "作品製作或開發過程",
    "如何展現「三好」、「四給」精神之融入與實踐",
    "作品實際應用方式或預期效益",
    "結語",
    "作品操作、觀看或使用說明",
]
full = "\n".join(p.text for p in d.paragraphs)
for i, t in enumerate(REQ, 1):
    chk(f"章節 {i}: {t}", t in full)

print()
print("=" * 70)
print("F. 開頭表格必要欄位")
print("=" * 70)
tbl = d.tables[0]
cells = [c.text.strip() for row in tbl.rows for c in row.cells]
tbltext = "\n".join(cells)
for k in ["編號", "組別", "團隊名稱", "參賽作品名稱", "AI 工具使用揭露"]:
    chk(f"欄位「{k}」存在", k in tbltext)
chk("組別標記社會組", "社會組" in tbltext and "AI數位應用實作類" in tbltext)
chk("組別以●標記選取", "●社會組" in tbltext)

print()
print("=" * 70)
print("G. 字數統計（中文，不含空白）")
print("=" * 70)
alltext = full + "\n" + tbltext
for t in d.tables:
    for row in t.rows:
        for c in row.cells:
            alltext += "\n" + c.text
nospace = re.sub(r"\s+", "", alltext)
# Word 的中文「字數」＝ 每個 CJK 字算 1，連續英數算 1 詞。
# 以「正文 8 節」為計算範圍（開頭表格為報名欄位、大綱為官方模板原文，非本團隊撰寫內容）。
body_start = full.find("一、創作動機")
body = full[body_start:] if body_start >= 0 else ""
def word_count(s):
    return len(re.findall(r"[\u4e00-\u9fff]|[A-Za-z0-9]+", s))
def cjk_count(s):
    return len(re.findall(r"[\u4e00-\u9fff]", s))
print(f"正文 8 節：Word 式字數 = {word_count(body)}；純 CJK 字 = {cjk_count(body)}")
print(f"全文（含開頭表格與大綱）：Word 式字數 = {word_count(alltext)}")
chk("正文 5000 字以內（Word 式計數）", word_count(body) <= 5000,
    f"{word_count(body)} 字，餘裕 {5000 - word_count(body)}")
chk("正文 5000 字以內（純 CJK 最嚴算法）", cjk_count(body) <= 5000,
    f"{cjk_count(body)} 字")

print()
print("=" * 70)
print("H. 匿名性檢查")
print("=" * 70)
# 白名單：官方模板必填文字與真實求助專線名稱，不算個資
WHITELIST_CONTEXT = [
    "1980 張老師",              # 求助專線正式名稱
    "○大專組（大學、研究所）",     # 官方模板組別選項原文
    "○高中職組",                 # 官方模板組別選項原文
]

BANNED_PAT = [
    (r"佛光", "學校名"), (r"學校名稱:?\s*\S", "學校名"),
    (r"指導教師", "指導教師"), (r"指導老師", "指導老師"),
    (r"教授", "教授"), (r"本校", "本校"), (r"系所", "系所"),
    (r"[\w.]+@[\w.]+\.\w+", "Email"), (r"https?://\S+", "URL"),
    (r"kken200210", "帳號"), (r"沈先生", "人名"),
    (r"[\u4e00-\u9fff]{2,3}(先生|小姐|老師)(?!\s*(，|。|、|以|，))", "疑似人名"),
]
hits = []
for pat, label in BANNED_PAT:
    for m in re.finditer(pat, alltext):
        a = max(0, m.start() - 25); b = min(len(alltext), m.end() + 25)
        ctx = alltext[a:b]
        if any(w in alltext[m.start():m.end()] or w in ctx for w in WHITELIST_CONTEXT):
            continue
        hits.append((label, m.group(0), ctx.replace("\n", " ")))
if hits:
    for h in hits[:20]:
        print("  命中:", h)
chk("無姓名/學校/單位/Email/帳號", len(hits) == 0, f"{len(hits)} 命中")

# 逐項列出白名單命中，供人工複核
print("  -- 白名單（已排除，需人工確認合理）--")
for w in WHITELIST_CONTEXT:
    if w in alltext:
        print(f"     OK 合理: 「{w}」 x{alltext.count(w)}")

# 自稱檢查
chk("使用「本團隊」自稱", "本團隊" in alltext, f"{alltext.count('本團隊')} 次")
chk("使用「本作品」自稱", "本作品" in alltext, f"{alltext.count('本作品')} 次")

print()
print("=" * 70)
print("RESULT:", "ALL PASS" if ok else "SOME FAILED")
print("=" * 70)
sys.exit(0 if ok else 1)
