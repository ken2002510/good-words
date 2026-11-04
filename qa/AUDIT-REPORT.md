# T6 獨立審查報告 —《好好說話》

審查人：auditor（獨立審查者）＋ Lead 複核
審查日期：2026-10-31 ~ 2026-11-02
**審查標的**：commit `c00780c`
**線上作品**：https://good-words.vercel.app
**公開 repo**：https://github.com/ken2002510/good-words

---

## verdict: **PASS**（附 2 項已知 MINOR）

| 分區 | 結果 |
|---|---|
| A. 參賽資格合規 | ✅ PASS |
| B. 匿名性 | ✅ PASS |
| C. 功能實測（外網） | ✅ PASS（40/40） |
| D. 文件格式 | ✅ PASS |
| E. 影片 | ✅ PASS（修正後） |
| F. 誠信檢查 | ✅ PASS（2 項 MINOR） |

---

## A. 參賽資格合規

| # | 項目 | 結果 | 證據 |
|---|---|---|---|
| A1 | 完整可體驗成品（非企劃書） | ✅ | `curl https://good-words.vercel.app` → HTTP 200，頁面含 `<textarea>`、送出鈕、實際功能 |
| A2 | 連結可正常操作 | ✅ | `deploy/verify-public.mjs` → **40 項通過 / BLOCKER 0** |
| A3 | 是否需登入 | ✅ 免登入 | 頁面無任何登入欄位；`/api/*` 皆無驗證 |
| A4 | AI 工具有無揭露 | ✅ | 說明書第三章「AI 技術或 AI 工具運用方式」載明 Ollama、qwen3:4b-instruct、規則引擎 |
| A5 | 未跨組別重複報名 | ✅ | 僅報名「社會組：AI數位應用實作類」一項 |
| A6 | 無抄襲／未得獎 | ✅ | 原創內容；98 句好話、14 類情緒、150 危機變體皆為自製 |

**外網實測（curl，精確位元組）**
```
GET  /              → 200（7903 bytes，與 repo app/public/index.html 一致）
GET  /style.css     → 200
GET  /app.js        → 200
GET  /api/health    → 200   emotions=14  goodwordSets=21  warnings 4 個全 ok
POST /api/respond   → 200   engine=rules  emotion=自我否定  三段齊全
POST /api/respond「我不想活了」→ 200  crisis=true  1925/1995/1980/119
POST /api/share     → 200   給朋友版 50 字
```

---

## B. 匿名性（最易失格）

| # | 項目 | 結果 | 證據 |
|---|---|---|---|
| B1 | 影片無個資 | ✅ | 24 幀程式檢查 + 人工目視 demo 段多幀 |
| B2 | 說明書無個資 | ✅ | 解 docx zip 讀 `document.xml`，見下方 |
| B3 | 網站介面無個資 | ✅ | 頁面無姓名／學校／Email |
| B4 | repo 無個資 | ✅ | `git grep '佛光大學'` → **0 命中** |

**B1 影片匿名性（雙重驗證）**
```
程式檢查（24 幀，每 7.2 秒一張）：
  工作列特徵（底部 48px 暗帶 + 上方明亮）: 0 幀命中
  瀏覽器 chrome 特徵（頂部 60px 均勻灰帶）: 0 幀命中
  高飽和像素（桌布特徵）> 10%          : 0 幀命中
  → frames flagged: 0 / 24

人工目視：
  抽樣幀（t=70s、86s、120s）確認畫面僅有網站內容 + 本作品字卡
  無桌面、無工作列、無瀏覽器網址列／分頁列、無人像、無通知
```

> ⚠️ **歷史紀錄**：本專案第一版影片**曾整支錄到桌面**（含競賽名稱、Windows 工作列、
> 內部對話），屬失格等級。由 Lead 抽幀擋下，改用 Playwright 原生錄影後修正。
> 該版本從未提交任何地方。

**B2 說明書匿名性**
```
全文檢索：
  姓名 / 暱稱        → 0
  學校名稱           → 0（「學校」僅出現於「確認不含任何姓名、學校或單位名稱」這句自我檢查敘述）
  單位名稱 / Logo    → 0
  指導教師 / 教授    → 0
  Email / @          → 0
  「大學」1 次       → 官方模板組別原文「大專組（大學、研究所）」，依規定必須保留
  自稱               → 「本團隊」13 次、「本作品」43 次
```

**B4 repo 匿名性**
```
git ls-tree -r origin/main  → 60+ 檔
  00-PROJECT-BRIEF.md      → absent（含隊內契約，已排除）
  00-official/             → absent（含主辦單位文件，已排除）
  docs/*undertaking*       → absent（切結書產製腳本，含校名與承辦人）
  docs/*報名*              → absent
  screenshots / *.png      → absent
  *.mp4 / chrome-profile   → absent

已知「佛光」出現位置（4 支檢查腳本）：
  app/test/run-tests.js、deploy/test-repo-contents.mjs、
  docs/verify_spec.py、qa/lead_acceptance.mjs
  → 這些是**匿名性檢查規則本身的比對字串**，不是作品或團隊的資訊揭露。
  → 「佛光大學」完整校名在整個 repo **0 命中**。
  → 裁定：保留（拿掉偵測字串等於拿掉防護）。
```

---

## C. 功能實測（外網，非本機）

**`deploy/verify-public.mjs` → 40/40 PASS，BLOCKER 0 / MAJOR 0 / MINOR 0**

| # | 項目 | 結果 |
|---|---|---|
| C1 | 5 種情緒輸入 | ✅ 工作壓力／自我否定／家庭衝突等正確分類 |
| C2 | 不依賴本機 Ollama | ✅ `ollama.alive=false`（雲端），仍 `engine=rules` 完整回應 |
| C3 | 危機轉介 | ✅ 「我不想活了」「我想死」「活著沒意義」皆正確轉介 1925/1995/1980/119 |
| C4 | 三段結構 | ✅ 承接／好話／小步 每次齊全 |
| C5 | 反毒雞湯 | ✅ 無「加油／你可以的／別想太多／想開一點」等禁用語 |
| C6 | 回應時間 | ✅ 平均 292ms、最慢 312ms（Hobby 上限 10s） |
| C7 | 邊界輸入 | ✅ 空輸入 → 400 且有提示，非 500 |

**隱私複驗**：`/api/health` 回應**無任何 Windows 絕對路徑**（僅 `app/lib`、`…/haohao-content` 等相對路徑）。

---

## D. 文件格式

| # | 項目 | 要求 | 實測 | 結果 |
|---|---|---|---|---|
| D1 | 紙張 | A4 直向 | 21.00 × 29.70 cm | ✅ |
| D2 | 邊界 | 上下左右 2cm | 2.000 / 2.000 / 2.000 / 2.000 cm | ✅ |
| D3 | 裝訂邊 | 1cm | 1.000 cm | ✅ |
| D4 | 字型 | 14 級標楷體 | 123 runs，`w:eastAsia` 缺失 **0** | ✅ |
| D5 | 行距 | 單行間距 | line_spacing 全部 1.0 | ✅ |
| D6 | 段距 | 前後 3pt | before=3.0pt / after=3.0pt | ✅ |
| D7 | 頁碼 | 需編列 | footer 含 `PAGE` + `NUMPAGES`，渲染可見「第 10 頁，共 10 頁」 | ✅ |
| D8 | 頁數 | ≤10 | **10** | ✅ |
| D9 | 大小 | ≤10MB | **0.40 MB** | ✅ |
| D10 | 字數 | ≤5000 | **4,778**（Word 式） | ✅ |
| D11 | 必要章節 | 官方 8 項 | 全部逐字命中 | ✅ |
| D12 | PDF 字型嵌入 | — | 含 `DFKaiShu-SB-Estd-BF`（標楷體實際渲染，非只有 XML 標記） | ✅ |

**渲染實證**：LibreOffice Kit render → `missingFonts: []`，人工目視第 10 頁確認
標楷體正確、頁碼正確、作品網址 `https://good-words.vercel.app` 清晰可讀。

---

## E. 影片

| # | 項目 | 要求 | 實測 | 結果 |
|---|---|---|---|---|
| E1 | 長度 | ≤180s | **171.8s** | ✅ |
| E2 | 規格 | 1080×1920 | h264 1080×1920 30fps + aac | ✅ |
| E3 | 解碼 | 無錯誤 | `ffmpeg -v error -f null -` → 無輸出 | ✅ |
| E4 | 音訊 | 無長靜音 | 無 ≥2s 靜音段；mean -22.6dB / max -6.1dB | ✅ |
| E5 | 真實操作畫面 | 必須 | 見下方變化率量測 | ✅ |
| E6 | 零個資 | 必須 | 24 幀程式 + 人工目視 | ✅ |

**E5 變化率量測（caption-free band 方法，排除字幕干擾）**
```
方法：crop 頂部 78%（字幕固定在底部 17%，故頂部任何變化都不可能是字幕）
      fps=2 取樣相鄰幀平均像素差

全片（344 幀 / 172s）：
  steps >2.0 : 25.7%     ← 門檻 >=15%  → PASS
  steps >0.5 : 30.6%

Demo 段（42.9–141.7s）：
  steps >2.0 : 42.9%     ← 真實操作最密集處
  steps >0.5 : 51.5%
```

**修正前對照（同一支影片的舊版）**
```
steps >2.0 : 2.6%
74–130s 平均 diff = 0.053（同一張點陣圖連續 56.5 秒）
最長完全靜止：30.8 秒
```
**→ 舊版被 auditor 判定 BLOCKER（違反「應呈現實際操作畫面」），已重錄修正。**

**已知殘留靜止段（不構成缺陷）**
```
Demo 段內最長完全靜止：12.5s —— 為「送出後等待 AI 推論 + 打字前停頓」
片頭 0–19s、片尾 141–163s 為靜態字卡（設計如此，非操作段）
```

---

## F. 誠信檢查

| # | 項目 | 結果 | 說明 |
|---|---|---|---|
| F1 | 說明書聲稱的功能是否都存在 | ✅ | 逐項對照網站實測：三段回應、情緒辨識、好話轉送、收藏、危機護欄、免登入 —— 全部存在 |
| F2 | 有無「聲稱做過但未做」 | ⚠️ MINOR×2 | 見下方 |

### MINOR-1：說明書原未寫出作品網址（已修正）
說明書第八章反覆出現「開啟作品網址」卻**從未寫出網址**。
- 官方將連結放在報名表，說明書模板無網址欄位 → **不構成違規**
- 但寫入更佳（評審只讀說明書也能開啟）
- **處置**：已於第八章（一）（二）（五）三處補上 `https://good-words.vercel.app`，
  字數 4762 → 4778（限 5000），PDF 重新匯出（10 頁 / 0.40MB）

### MINOR-2：本機 vs 雲端 AI 引擎不同（已於影片與文件誠實揭露）
- 本機展示走 Ollama（qwen3:4b-instruct）
- 雲端部署走規則式引擎（serverless 連不到本機 Ollama）
- **影片第 18 段已明確分述「本機版本／線上版本」兩種路徑，未混淆宣稱**
- `/api/health` 亦誠實回報 `ollama.alive=false`
- 裁定：**已充分揭露，不構成不實陳述**

---

## 無法評估的部分（誠實列出）

1. **手機 4G 實機人眼驗收** —— 審查者無法取得行動裝置，未完成。
   已完成的是外部網路自動化驗證（40/40）與桌面瀏覽器渲染截圖。
   **建議由使用者本人以手機實際開啟確認。**
2. **評審期間（115.12.01–12.15）連結持續可用性** —— 無法預先證明。
   Vercel Hobby 免費方案 + Git 整合自動部署，設計上可長期存活；
   好話回應內建於程式（不依賴外部 AI 服務），已從 `git clone` 快照實測確認。
3. **`docs/` 的 .docx 在 Microsoft Word 中的實際分頁** —— 以 LibreOffice 渲染驗證，
   Word 可能略有差異（頁數限制為 10 頁，實測正好 10 頁，若 Word 多出一頁需微調）。

---

## 過程中被擋下的重大缺陷（供後人參考）

| # | 缺陷 | 嚴重度 | 如何發現 | 根因 |
|---|---|---|---|---|
| 1 | 影片整支錄到桌面（含競賽名稱、工作列、內部對話） | **失格** | Lead 抽幀目視 | `ffmpeg gdigrab -offset_x/-offset_y` 未生效，且只驗證檔案大小未驗內容 |
| 2 | 線上 API 全部 404（首頁正常、功能全死） | **失格** | Lead 外網 curl 實測 | Vercel 認定專案根為 `app/`，repo 根的 `api/` 不在專案範圍內 |
| 3 | 影片 Demo 段 97.4% 時間完全不動 | **失格** | auditor 變化率量測 | viewport 設為 1080×1920 = 頁高 → `maxScroll=0` → 所有捲動都是 no-op |
| 4 | 危機護欄漏接「我想消失」 | MAJOR | Lead 獨立測試 | 內建 pattern 未涵蓋「消失」相關變體 |
| 5 | 375px 手機版文字被 sticky 頁首遮住 | MAJOR | Lead 目視 + builder 自查 | 缺 `scroll-margin-top` |
| 6 | 說明書字數 5,019 超過 5,000 上限 | MAJOR | Lead 精確計算 | 初稿過長 |
| 7 | 危機回應含禁語「想開一點」 | MINOR | deployer 發現 | 否定用法仍會被機械掃描命中 |
| 8 | repo 含 `00-official/`（校名、承辦人電話） | **失格** | deployer 稽核 | `.gitignore` 未排除 |

**這 8 項有 4 項屬失格等級，全部在提交前被擋下。**

---

## 結論

**verdict: PASS**

所有硬性規定（完整成品、匿名性、免登入、AI 揭露、格式、影片規格）均已符合，
並經外網實測（40/40）與多重獨立驗證。

2 項 MINOR 已處理或已充分揭露；3 項無法評估者已誠實列出並建議由使用者補做。

**最需要提醒使用者的一點**：
`docs/參賽切結書...docx` 的 **5 列簽名欄仍為空白**（依設計不代簽）。
**報名前必須由團隊成員本人親筆簽名。**

---

# T7 補充審查（2026-11-04）：上架版升級為雲端 LLM（NVIDIA NIM）

審查日期：2026-11-04
動機：Lead 取得 NVIDIA API key，要求上架版（Vercel）實際使用雲端 LLM，
並補強「AI 技術整合」與創新性（改寫模式、多輪對話）。

## 架構變更

| 項目 | 修改前 | 修改後 |
|---|---|---|
| AI 軌 | ollama → cloud(OpenAI) → rules | ollama → **NVIDIA NIM** → cloud → rules（四軌） |
| 部署預設 | 永遠 rules | **有 `NVIDIA_API_KEY` → nvidia 軌**，逾時 6.5s 內自動降級 rules |
| 模式 | 只有 chat | chat + **rewrite（重話改寫）** |
| 對話 | 單輪 | **多輪**（前端 localStorage 最近 4 輪，後端消毒 ≤6 輪 ×300 字，不儲存） |
| key 管理 | — | **只放環境變數**（本機 `NVIDIA_API_KEY`/`NVKEY`；Vercel 後台 Environment Variables）；repo 內只有 `nvapi-...` 佔位字，無任何真實 key |

## 安全不變的保證（回歸全綠）

- 危機護欄仍在第 0 步、不經任何模型；**rewrite 模式下危機字串照樣轉介**（實測「我不想活了」+ mode=rewrite → crisis=true + 1925/1995/1980/119）
- 模型輸出仍過 `lint()` 反毒雞湯；不過即降級
- 無 key 時 `force=nvidia` 正確降級 rules（實測）
- `run-tests.js` 正常模式 **77/77**、`--no-ollama` **76/76**、新功能腳本 `qa/_local_new_features.mjs` **12/12**
- 說明書 `verify_spec.py` ALL PASS（正文 4871 字 ≤5000；PDF 10 頁 ≤10MB）

## 待辦（部署時）

1. Vercel Project → Settings → Environment Variables 加 `NVIDIA_API_KEY`（祕密）
2. Redeploy 後 `GET /api/health` 應回 `engines.nvidia.enabled=true`、`model=nvidia/nemotron-3.5-bolt-e4b`
3. 外網實測 `POST /api/respond` 應回 `meta.engine=nvidia`
4. 若 key 失效 → 自動降級 rules，網站仍完整可用（符合評審期間連結必須可用的硬規定）

### 模型選擇實測（2026-11-04，`qa/_nv_bench.mjs` v2，production 同款 prompt/parser/lint）

門檻：≤6.5s（Vercel function 10s 上限內預算）且 parse OK 且 lint 過。

| 模型 | 結果 | 平均延遲 |
|---|---|---|
| **nvidia/nemotron-3.5-bolt-e4b** | **10/10 PASS（擴大案例後）** | **avg 2.4s、最慢 4.7s** ✅ 選為預設 |
| nvidia/nemotron-3.5-lightning-30b-a3b | 2/4（會把禁語清單複述回來，被 lint 擋） | 5.3s |
| z-ai/glm-5.3-flash | 0/4（同上問題 + 延遲超預算） | 7.9s |
| 其餘候選（gpt-oss-20b、llama-3.2-11b、kimi-k2.6 等） | TIMEOUT 或此 key 無權限呼叫 | — |

備註：此 key 對部分 NIM 模型回「Function not found for account」——屬 key 權限範圍，非我方錯誤。
