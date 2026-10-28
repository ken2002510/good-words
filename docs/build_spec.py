# -*- coding: utf-8 -*-
"""
build_spec.py — 產生「作品說明書.docx」

官方格式硬規定（逐項落實）：
  - 14 級中文標楷體（run.font.name + w:eastAsia 雙設）
  - A4 直向；上下左右邊界 2cm、裝訂邊 1cm
  - 編列頁碼（footer PAGE 欄位）
  - 單行間距、前後段距離 3pt
  - 5000 字以內
匿名性：全文以「本團隊」「本作品」自稱，無人名、校名、單位名。
"""
import copy
import os

from docx import Document
from docx.enum.section import WD_ORIENT
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Cm, Pt

OUT = r"C:\prodcut\docs\作品說明書.docx"

FONT_CN = "標楷體"
FONT_EN = "Times New Roman"
SIZE = Pt(14)

TEAM_NAME = "三好說好話"
WORK_NAME = "《好好說話》"
GROUP = "社會組：AI數位應用實作類"


# ───────────────────────── 字型工具 ─────────────────────────

def set_run_font(run, size=SIZE, bold=False, font_cn=FONT_CN, font_en=FONT_EN):
    """同時設定 ascii/hAnsi 與 eastAsia。

    只設 run.font.name 只會寫 w:ascii/w:hAnsi，中文字會退回預設字型；
    必須另外寫 w:eastAsia，中文字才會真的是標楷體。
    """
    run.font.size = size
    run.font.bold = bold
    run.font.name = font_en
    rpr = run._element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), font_en)
    rfonts.set(qn("w:hAnsi"), font_en)
    rfonts.set(qn("w:eastAsia"), font_cn)
    rfonts.set(qn("w:cs"), font_en)
    # 東亞版式：不自動調整中西文間距造成的奇怪空隙
    return run


def fmt_para(p, space_before=3, space_after=3, line_spacing=1.0,
             align=None, first_line_indent=None):
    """單行間距 + 前後段距離 3pt。"""
    pf = p.paragraph_format
    pf.space_before = Pt(space_before)
    pf.space_after = Pt(space_after)
    pf.line_spacing = line_spacing
    if align is not None:
        p.alignment = align
    if first_line_indent is not None:
        pf.first_line_indent = first_line_indent
    return p


def add_body(doc, text, align=WD_ALIGN_PARAGRAPH.JUSTIFY, indent=True, bold=False):
    p = doc.add_paragraph()
    fmt_para(p, align=align,
             first_line_indent=Cm(0.85) if indent else None)
    set_run_font(p.add_run(text), bold=bold)
    return p


def add_heading(doc, text, level=1):
    p = doc.add_paragraph()
    if level == 1:
        fmt_para(p, space_before=12, space_after=6)
        set_run_font(p.add_run(text), size=Pt(16), bold=True)
    else:
        fmt_para(p, space_before=8, space_after=3)
        set_run_font(p.add_run(text), size=Pt(14), bold=True)
    return p


# ───────────────────────── 頁碼 ─────────────────────────

def add_page_number_footer(section):
    """footer 置中：第 X 頁 / 共 Y 頁（PAGE / NUMPAGES 欄位）。"""
    footer = section.footer
    footer.is_linked_to_previous = False
    p = footer.paragraphs[0] if footer.paragraphs else footer.add_paragraph()
    for r in list(p.runs):
        r._element.getparent().remove(r._element)
    p.text = ""
    fmt_para(p, space_before=0, space_after=0,
             align=WD_ALIGN_PARAGRAPH.CENTER)

    def field(instr):
        r = p.add_run()
        set_run_font(r, size=Pt(12))
        b = OxmlElement("w:fldChar"); b.set(qn("w:fldCharType"), "begin")
        i = OxmlElement("w:instrText"); i.set(qn("xml:space"), "preserve"); i.text = instr
        s = OxmlElement("w:fldChar"); s.set(qn("w:fldCharType"), "separate")
        t = OxmlElement("w:t"); t.text = "1"
        e = OxmlElement("w:fldChar"); e.set(qn("w:fldCharType"), "end")
        for el in (b, i, s, t, e):
            r._element.append(el)
        return r

    set_run_font(p.add_run("第 "), size=Pt(12))
    field(" PAGE ")
    set_run_font(p.add_run(" 頁，共 "), size=Pt(12))
    field(" NUMPAGES ")
    set_run_font(p.add_run(" 頁"), size=Pt(12))


# ───────────────────────── 版面 ─────────────────────────

def setup_section(section):
    section.orientation = WD_ORIENT.PORTRAIT
    section.page_width = Cm(21.0)
    section.page_height = Cm(29.7)
    section.top_margin = Cm(2)
    section.bottom_margin = Cm(2)
    section.left_margin = Cm(2)
    section.right_margin = Cm(2)
    section.gutter = Cm(1)          # 裝訂邊 1cm
    section.header_distance = Cm(1.25)
    section.footer_distance = Cm(1.25)
    add_page_number_footer(section)


def set_doc_defaults(doc):
    """Normal style 也一併設東亞字型，避免未指定時退回新細明體。"""
    st = doc.styles["Normal"]
    st.font.name = FONT_EN
    st.font.size = SIZE
    rpr = st.element.get_or_add_rPr()
    rfonts = rpr.find(qn("w:rFonts"))
    if rfonts is None:
        rfonts = OxmlElement("w:rFonts")
        rpr.insert(0, rfonts)
    rfonts.set(qn("w:ascii"), FONT_EN)
    rfonts.set(qn("w:hAnsi"), FONT_EN)
    rfonts.set(qn("w:eastAsia"), FONT_CN)
    st.paragraph_format.line_spacing = 1.0
    st.paragraph_format.space_before = Pt(3)
    st.paragraph_format.space_after = Pt(3)


def shade(cell, color="D9D9D9"):
    tcpr = cell._tc.get_or_add_tcPr()
    sh = OxmlElement("w:shd")
    sh.set(qn("w:val"), "clear")
    sh.set(qn("w:color"), "auto")
    sh.set(qn("w:fill"), color)
    tcpr.append(sh)


# ───────────────────────── 主文件 ─────────────────────────

def build():
    doc = Document()
    set_doc_defaults(doc)
    setup_section(doc.sections[0])

    # ── 標題 ──
    p = doc.add_paragraph()
    fmt_para(p, space_before=0, space_after=6, align=WD_ALIGN_PARAGRAPH.CENTER)
    set_run_font(p.add_run("「2026 三好AI創新應用競賽」"), size=Pt(18), bold=True)

    p = doc.add_paragraph()
    fmt_para(p, space_before=0, space_after=12, align=WD_ALIGN_PARAGRAPH.CENTER)
    set_run_font(p.add_run("作品說明書"), size=Pt(22), bold=True)

    # ── 開頭資訊表格 ──
    rows = [
        ("編號", "（此欄位由主辦單位填寫）"),
        ("組別", f"○高中職組：AI 數位內容創作類　○大專組（大學、研究所）\n"
                 f"○ A類：AI 數位內容創作類　○ B類：AI 數位應用實作類\n"
                 f"●{GROUP}"),
        ("團隊名稱", TEAM_NAME),
        ("參賽作品名稱", WORK_NAME),
        ("AI 工具使用揭露",
         "本作品於開發階段使用生成式 AI 作為輔助工具，清單如下，並於第 3 節詳述其用途與界線：\n"
         "（1）大型語言模型（LLM）推理引擎：Ollama 本機推論執行 qwen3:4b-instruct，"
         "為本作品線上服務之核心回應引擎。\n"
         "（2）程式碼撰寫輔助：AI 程式開發助手，用於程式骨架、除錯與測試案例草擬。\n"
         "（3）文案與語料輔助：AI 語言模型，用於「好話」語料之發想與改寫，"
         "成品均由本團隊逐句人工審閱與修訂。\n"
         "本作品之核心創意、系統架構、安全護欄設計、三好四給功能對應與內容審定，"
         "均由本團隊自行構思與完成。AI 僅為工具，不取代本團隊之判斷與責任。"),
    ]

    table = doc.add_table(rows=0, cols=2)
    table.style = "Table Grid"
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    for k, v in rows:
        row = table.add_row()
        c0, c1 = row.cells
        c0.width = Cm(3.6)
        c1.width = Cm(13.4)
        shade(c0)
        pp = c0.paragraphs[0]
        fmt_para(pp, space_before=2, space_after=2)
        set_run_font(pp.add_run(k), bold=True)
        for i, line in enumerate(v.split("\n")):
            pp = c1.paragraphs[0] if i == 0 else c1.add_paragraph()
            fmt_para(pp, space_before=2, space_after=2)
            set_run_font(pp.add_run(line))

    # ── 內容大綱說明（照官方模板文字）──
    p = doc.add_paragraph()
    fmt_para(p, space_before=8, space_after=3)
    set_run_font(p.add_run("作品說明書須包含下列內容：(5000字以內)"), bold=True)

    outline = [
        "創作動機與欲解決之問題。",
        "作品內容及主要特色。",
        "AI 技術或 AI 工具運用方式。",
        "作品製作或開發過程。",
        "如何展現「三好」、「四給」精神之融入與實踐。",
        "作品實際應用方式或預期效益。",
        "結語。",
        "作品操作、觀看或使用說明。",
    ]
    for i, t in enumerate(outline, 1):
        p = doc.add_paragraph()
        fmt_para(p, space_before=0, space_after=0)
        p.paragraph_format.left_indent = Cm(0.8)
        set_run_font(p.add_run(f"{i}.{t}"), size=Pt(14))

    doc.add_page_break()

    # ── 正文 8 節 ──
    for h, paras in SECTIONS:
        add_heading(doc, h, level=1)
        for kind, text in paras:
            if kind == "h2":
                add_heading(doc, text, level=2)
            elif kind == "b":          # 條列
                p = doc.add_paragraph()
                fmt_para(p, align=WD_ALIGN_PARAGRAPH.JUSTIFY)
                p.paragraph_format.left_indent = Cm(0.8)
                p.paragraph_format.first_line_indent = Cm(-0.8)
                set_run_font(p.add_run(text))
            else:
                add_body(doc, text)

    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    doc.save(OUT)
    print("saved:", OUT)
    return OUT


# ───────────────────────── 正文內容 ─────────────────────────
SECTIONS = [
    ("一、創作動機與欲解決之問題", [
        ("p", "本作品的起點是一個常見卻很少被好好回應的處境：人在最低潮時往往說不出話；"
              "就算說了，得到的也常是「加油」「別想太多」「想開一點」。"
              "這些話不是出於惡意，共同的問題是——沒有先理解對方發生什麼事。"
              "當一個人鼓起勇氣說出難處，卻只換來一句放諸四海皆準的口號，"
              "他學到的不是被安慰，而是「我的困難不值得被認真看待」。"),
        ("p", "本團隊觀察到，市面上多數正向語錄工具本質上是「隨機金句產生器」："
              "同一句話發給所有人，看起來溫暖，卻沒有真的聽。"
              "真正有價值的事不是生產更多正向句子，"
              "而是讓一句話「剛好對上」一個人的處境。"),
        ("p", "因此，本作品要解決的問題可以具體寫成三點："),
        ("b", "1. 說不出口：心裡有情緒，但當下沒有力氣、也沒有對象可以好好說。"),
        ("b", "2. 被錯誤回應：說出來了，卻被敷衍、被評價、被要求立刻正向起來，"
              "結果比不說更孤單。"),
        ("b", "3. 正向語言的空洞化：現成語錄缺乏處境理解，無法讓人感覺「被聽懂」。"),
        ("p", "本作品的假設是：先正確辨識情緒與處境，再生成對應的話語，"
              "「好話」才可能真的被接收——這是與一般語錄工具最根本的分野。"),
        ("p", "還有一個更貼近生活的原因：關心之所以難以出口，"
              "往往不是不在意，而是怕說錯話造成二度傷害。"
              "本作品希望成為中介者——先示範什麼叫做「接住」，"
              "再讓使用者把這份感覺轉送給他在意的人。"),
    ]),

    ("二、作品內容及主要特色", [
        ("p", "本作品是一個免登入、開網頁即可使用的「說好話」AI 陪伴網站。"
              "使用者把講不出口的心事打成文字送出，系統先辨識情緒類別與強度，"
              "再產生固定三段結構的回應，最後提供一個「今晚就能做」的極小行動。"),
        ("h2", "（一）三段式回應：承接、好話、小步"),
        ("p", "所有回應都遵守同一結構，這是內容層的硬約束，不是風格建議："),
        ("b", "• 承接：用系統自己的話重述使用者的處境，讓他確認「我被聽懂了」。"),
        ("b", "• 好話：一句真誠、具體、指涉當下處境的話，不喊口號，不假裝問題不存在。"),
        ("b", "• 小步：一個當晚即可完成的極小行動，例如「今晚十一點前關掉工作訊息」，"
              "重點是「做得到」，而不是「應該做」。"),
        ("h2", "（二）情緒辨識與強度分級"),
        ("p", "系統內建 14 類情緒處境，涵蓋自我否定、工作壓力、感情失落、家庭衝突、"
              "孤獨、焦慮、內疚、疲憊、被誤解、未來迷惘、被忽略、憤怒與無力、"
              "挫敗與失去、討好與界線，共對應 310 個關鍵詞。"
              "系統依使用者的用詞強度（例如「有點」到「完全」）判斷情緒強度，"
              "以 1 至 5 級呈現，並在同時觸及多個類別時提示次要情緒。"
              "這是「先聽懂再說話」的具體落實。"),
        ("h2", "（三）反毒雞湯：以規則擋掉空洞語言"),
        ("p", "本作品在生成規則中明文禁止「加油」「你可以的」「別想太多」「想開一點」"
              "「一切都會好的」這類無效安慰，也禁止說教與評價語（如「你應該」「你必須」）、"
              "禁止醫療或診斷語言，並禁止「根據分析」這類後設語氣——"
              "好話必須直接說。此外限制「好話」不超過三句、以 30 字為上限。"
              "這些不是事後過濾，而是寫在規則裡的硬約束："
              "違反的句子不會被送出，而由其他語句遞補。"
              "本作品要的不是「聽起來很暖」，而是「剛好說到心裡」。"),
        ("h2", "（四）好話轉送：讓善意可以傳出去"),
        ("p", "使用者可把自己收到的話，一鍵轉換成「給他人的版本」，"
              "提供給朋友、給家人、給同事三種語境、共 11 組模板，切換對象即時改變措辭，"
              "且不需對方也使用本作品，複製貼上即可。"
              "這是把「做好事」延伸為人與人之間善意的流動。"),
        ("h2", "（五）危機護欄：不可妥協的底線"),
        ("p", "若使用者的文字出現自傷、自殺或危機訊號，系統會立即中止一般回應流程，"
              "改為顯示台灣真實可撥打的求助資源（1925 安心專線、1995 生命線、"
              "1980 張老師、119／110），並以「你願意把這句話說出來，這件事很重要」開場。"
              "此判斷採規則式比對，不經語言模型，結果確定且可重現；"
              "比對前先去除空白與標點，避免以「加空格」規避，"
              "詞庫涵蓋諧音、注音與英文寫法。本作品絕不讓 AI 扮演諮商師，"
              "也不提供危機處理建議——這是作品能否被信任的底線。"),
        ("h2", "（六）免登入、手機優先、永不白畫面"),
        ("p", "本作品免登入、免安裝，不需提供任何帳號或個人資料。"
              "這既是對使用者隱私的尊重——心事不應成為註冊成本，"
              "也讓作品在評審期間不因帳密問題而無法操作；介面以手機優先設計。"
              "此外採自動降級架構：優先用本機推論引擎，"
              "不可用則退回規則式引擎，保證任何情況下都有合理回應，"
              "使用者不會看到錯誤畫面。"),
    ]),

    ("三、AI 技術或 AI 工具運用方式", [
        ("p", "本作品將 AI 用在兩個層次：服務核心的回應生成，"
              "以及開發過程的輔助工具。以下分別說明並揭露其界線。"),
        ("h2", "（一）核心：本機大型語言模型推論"),
        ("p", "本作品的主要 AI 引擎為 Ollama 本機推論服務，執行 qwen3:4b-instruct 模型。"
              "選擇本機推論而非雲端 API，有四個明確理由："),
        ("b", "• 免費：不產生任何 API 費用，作品可長期維持運作。"),
        ("b", "• 離線可用：不依賴外部服務，網路中斷或額度用盡仍可運作。"),
        ("b", "• 隱私：使用者的心事不需要離開他自己的裝置。"
              "如果一個談「存好心」的作品卻把使用者最脆弱的文字上傳到第三方，"
              "那是自我矛盾。"),
        ("b", "• 穩定：不會因為外部服務的額度、限流或政策變動而中斷。"),
        ("p", "本機已實測該模型可完成推論，並正確產出符合三段結構的回應。"),
        ("h2", "（二）AI 層的可插拔設計與自動降級"),
        ("p", "本作品將 AI 層設計為可插拔的供應者介面，並具備自動降級能力："),
        ("b", "• 第一順位：本機 LLM 推論，語意理解與生成能力最佳。"),
        ("b", "• 第二順位：規則式內容引擎。以情緒關鍵詞比對為基礎，"
              "從已審定的語料中挑選對應處境的三段式回應。"),
        ("p", "這個設計的直接效果是：網站永遠有回應。"
              "對評審與使用者而言，「偶爾很聰明」遠不如「永遠可用」來得重要。"),
        ("h2", "（三）規則式判斷與模型判斷的分工"),
        ("p", "本作品刻意把最不能出錯的部分交給規則，而不是模型："
              "危機訊號的偵測完全採關鍵詞正規化比對，不經任何語言模型。"
              "理由是危機判斷需要「寧可多接住」的確定性，"
              "而非機率性的語意推測。這是本作品在 AI 運用上最重要的取捨。"),
        ("h2", "（四）AI 工具使用揭露與界線"),
        ("p", "本作品於開發過程中使用生成式 AI 作為輔助工具，用途如下："),
        ("b", "• 程式開發輔助：用於程式骨架草擬、除錯與測試案例發想。"),
        ("b", "• 文案與語料輔助：用於「好話」語料的發想與語氣修訂。"),
        ("p", "必須明確說明其界線：本作品的核心創意、系統架構、情緒分類設計、"
              "安全護欄規則、三好四給的功能對應與內容審定，"
              "均由本團隊自行構思與決定。AI 產出的文字語料，"
              "都經過本團隊逐句人工審閱、修訂或淘汰——"
              "特別是「反毒雞湯」規則，即是本團隊對 AI 產出的人工修正。"
              "AI 在本作品中是工具，不是作者，也不取代本團隊的判斷與責任。"),
    ]),

    ("四、作品製作或開發過程", [
        ("p", "本作品的開發歷程可分為四個階段，每個階段都以「可驗證」為驗收標準。"),
        ("h2", "（一）第一階段：定義問題與確立設計原則"),
        ("p", "首先收斂作品定位：不做一般的語錄產生器，"
              "而是做一個「先理解處境，才給話」的陪伴服務。"
              "此階段最關鍵的產出，是訂下反毒雞湯的生成規則——"
              "明文列出禁止使用的語言與回應的固定三段結構。"
              "原則是先寫下來的，後續的程式與內容都必須服從它。"),
        ("h2", "（二）第二階段：內容層建置"),
        ("p", "建立情緒分類與對應語料。本階段完成 14 類情緒處境分類，"
              "每一類定義關鍵詞、處境描述與強度用詞，並撰寫 7 組三段式語料，"
              "全庫共 98 組。品質門檻是：必須指涉具體處境、必須承接情緒、"
              "必須提供做得到的極小行動；不合門檻的句子直接淘汰，"
              "不因數量不足而放寬標準。"),
        ("p", "本階段另一重點是建立自動化內容檢查工具，逐句掃描四類問題詞表："
              "空洞安慰語、醫療診斷語、說教語、假裝問題不存在的否認語，"
              "並檢查三段結構、情緒類別對應與檔案編碼。"
              "這道檢查可重複執行且維持零錯誤——"
              "內容品質不是靠人工印象把關，而有一致且可重現的判定標準。"),
        ("h2", "（三）第三階段：系統實作與安全設計"),
        ("p", "實作網站前端、後端 API 與 AI 供應者介面，完成四個 API 端點："
              "產生好話、生成轉送版本、服務健康狀態查詢、情緒類別清單。"
              "後端採零外部依賴設計，僅使用執行環境內建模組，"
              "以降低部署失敗風險；靜態檔案服務亦具備路徑穿越防護。"
              "同時完成危機護欄模組：危機詞庫、正規化比對邏輯、"
              "以及危機情境下的固定回應與求助資源清單。"),
        ("h2", "（四）第四階段：降級驗證與品質關卡"),
        ("p", "最後進行三項驗證，這也是本作品的品質關卡："),
        ("b", "• 降級驗證：在 AI 推論服務關閉的情況下，"
              "網站仍必須能給出合理回應，確保服務不中斷。"),
        ("b", "• 安全驗證：以危機語句測試，確認系統正確中止一般流程並顯示求助資源。"),
        ("b", "• 匿名性驗證：對作品介面與文件進行全文檢索，"
              "確認不含任何姓名、學校或單位名稱等可辨識身分之資訊。"),
        ("p", "本作品採「先立規則、再做內容、最後實作」的順序，"
              "而非先做完功能再補規則，這是能維持內容品質與安全底線的主因。"),
    ]),

    ("五、如何展現「三好」、「四給」精神之融入與實踐", [
        ("p", "「三好」與「四給」若只停留在文案層次，就只是口號。"
              "因此本作品把它們逐一對應到具體功能，每一項都可實際操作驗證。"),
        ("h2", "（一）三好"),
        ("b", "• 說好話：這是本作品的核心功能。本作品處理的是「說好話」中最難的一種——"
              "對自己說好話。系統會把「我很爛」「我完蛋了」這類自我攻擊，"
              "改寫成不虛假、不說教的正向語言。"),
        ("b", "• 做好事：「好話轉送」功能讓使用者把收到的話，"
              "一鍵生成給朋友、家人或同事的版本，使善意可以實際傳遞出去。"),
        ("b", "• 存好心：對話全程不評判、不貼標籤、不給分數，"
              "並以生成規則明文禁止說教與評價。使用者不需要表現良好，也能被好好對待。"),
        ("h2", "（二）四給"),
        ("b", "• 給人信心：每一次回應的結尾，聚焦「你已經做到了什麼」，"
              "而不是「你還缺什麼」。例如「會累，是因為你一直在做一件不容易的事」。"),
        ("b", "• 給人歡喜：回應語氣溫暖、口語、有畫面感，"
              "並可將句子收藏帶走，讓被安慰的感覺可以延續到關掉網頁之後。"),
        ("b", "• 給人希望：不做空泛安慰，而是提供下一步的極小行動。"
              "希望在本作品中的定義是「知道自己今晚能做什麼」。"),
        ("b", "• 給人方便：免登入、免安裝、開網頁就能用，手機優先，可一鍵複製帶走。"
              "使用門檻越低，能被接住的人就越多。"),
        ("h2", "（三）最關鍵的實踐：先接住，再說好話"),
        ("p", "本作品對「三好四給」最核心的實踐，是把它們落在同一個順序上："
              "先接住情緒，才給話。一個人在被理解之前，任何好話都只是噪音；"
              "被理解之後，一句樸素的話就有重量。本作品把「存好心」放在流程最前面——"
              "先不評價地聽，後面的「說好話」才有意義。"),
        ("p", "危機護欄的存在本身就是「存好心」的極致表現：本作品選擇在最短時間內"
              "承認自己能力不足，把使用者交給真正能幫上忙的專業資源，"
              "而不是讓 AI 假裝自己能處理。願意放手，也是一種善意。"),
    ]),

    ("六、作品實際應用方式或預期效益", [
        ("h2", "（一）實際應用方式"),
        ("p", "本作品為免登入的網頁服務，開啟網址即可使用，不需安裝或註冊。"
              "使用情境包括："),
        ("b", "• 個人自我照顧：情緒卡住的當下，需要一個不評價自己的地方說出來，"
              "並得到一句具體的話與一個當晚可執行的小行動。"),
        ("b", "• 練習如何關心他人：不知道該怎麼安慰朋友或家人時，"
              "可先在本作品整理感受，再用「好話轉送」產出適切的表達版本，"
              "降低說錯話的顧慮。"),
        ("b", "• 教育與輔導情境的輔助工具：作為引導學生練習情緒表達與自我覺察的媒介。"),
        ("b", "• 校園或社區關懷活動：可作為現場互動裝置，讓參與者寫下一句話、帶走一句話。"),
        ("h2", "（二）預期效益"),
        ("p", "本作品的效益可從三個層面來看："),
        ("b", "• 對個人：把「說不出口」變成「說得出來」，"
              "並在情緒最需要出口的時候，提供一個零門檻、不評判的接住點。"),
        ("b", "• 對人際關係：透過好話轉送，讓善意有具體的形式可以流動，"
              "關心他人不再需要天生擅長說話，而可以有方法地練習。"),
        ("b", "• 對社會：把「三好四給」從道德呼籲，轉譯為可以每天打開來用的工具。"),
        ("h2", "（三）可持續性"),
        ("p", "本作品以零外部依賴與本機 AI 推論為基礎，不需負擔持續的 API 費用，"
              "且具備降級設計，服務不因成本或外部服務變動而中斷，"
              "適合長期推廣。"),
    ]),

    ("七、結語", [
        ("p", "本作品想做的事，其實很小：在一個人最不想講話的時候，"
              "給他一個地方把話放下來，然後回他一句真的聽得懂的話。"),
        ("p", "但這個「小」並不容易。它要求系統先放下急著安慰的衝動，"
              "先去理解對方發生什麼事；要求內容不抄近路去喊口號；"
              "也要求在最壞的情況下誠實承認自己幫不上忙，把使用者交給專業資源。"
              "本團隊在開發過程中反覆確認的一件事是："
              "一個談善意的作品，不能只在順境時善意。"),
        ("p", "「說好話」最難的對象是自己。本作品希望提供一個練習的起點："
              "從被好好對待一次開始，慢慢學會也這樣對待自己，再把這份能力傳給身邊的人。"
              "這就是本團隊對「三好」與「四給」的實踐——"
              "不是把它們寫在牆上，而是做成一個可以打開來用的網頁。"),
    ]),

    ("八、作品操作、觀看或使用說明", [
        ("h2", "（一）使用環境"),
        ("p", "使用現代瀏覽器（Chrome、Edge、Safari、Firefox）開啟作品網址即可使用，"
              "不需安裝軟體、不需註冊帳號、不需提供個人資料。"
              "手機、平板與電腦皆可操作，介面以手機直式優先設計。"),
        ("h2", "（二）操作步驟"),
        ("b", "步驟 1：開啟作品網址進入首頁，不需登入即可直接使用。"),
        ("b", "步驟 2：在輸入區把當下最想說、卻說不出口的心事打成一段文字；"
              "不需要整理成完整句子，想到什麼就寫什麼。"),
        ("b", "步驟 3：送出後，系統先顯示辨識到的情緒類別與強度，"
              "讓使用者確認系統是否理解自己的處境。"),
        ("b", "步驟 4：接著顯示「好話卡片」：承接（重述你的處境）、"
              "好話（一句具體真誠的話）、小步（一個今晚就能做的極小行動）。"),
        ("b", "步驟 5：可一鍵複製整段回應，或將其中的句子收藏起來。"),
        ("b", "步驟 6：如需把這份心意傳給別人，使用「好話轉送」，"
              "選擇給朋友、給家人或給同事，即可生成對應語境的版本。"),
        ("h2", "（三）危機情況的處理方式"),
        ("p", "若使用者輸入的內容包含自傷、自殺或危機訊號，"
              "系統將不會繼續一般回應流程，而是直接顯示求助資源，"
              "包含 1925 安心專線、1995 生命線、1980 張老師，"
              "以及立即危險時的 119／110。此時畫面會以"
              "「你願意把這句話說出來，這件事很重要」開場，"
              "不恐慌、不說教，並明確說明 AI 不適合取代專業協助。"),
        ("h2", "（四）使用者體驗注意事項"),
        ("b", "• 本作品提供陪伴與支持性語言，不具醫療或心理治療功能，"
              "亦不提供診斷。若情緒困擾持續影響生活，建議尋求專業協助。"),
        ("b", "• 所有輸入內容僅用於產生當次回應，不需登入、不需填寫任何個人資料。"),
        ("b", "• 本作品採降級設計，即使 AI 推論服務暫時不可用，"
              "仍會由規則式引擎提供回應，不會出現空白畫面。"),
        ("h2", "（五）評審操作提示"),
        ("p", "本作品為免登入服務，評審無需測試帳號即可直接操作。"
              "建議順序：先輸入情緒困擾文字，觀察情緒辨識與三段式回應；"
              "再試用「好話轉送」；最後測試危機護欄的轉介，約需一至兩分鐘。"),
    ]),
]

if __name__ == "__main__":
    build()
