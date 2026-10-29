# PUBLIC-LINK.md — 公開網址與驗證紀錄

> 這份文件是「作品連結」的來源，也是團隊的驗證證據。
> **最後更新：2026-10-29（部署完成、外網驗收通過）**

---

## 公開網址

| 項目 | 值 |
|---|---|
| **★ 作品公開 URL（報名表請填這個）** | **https://good-words.vercel.app** |
| GitHub repo | https://github.com/ken2002510/good-words |
| 是否需要登入 | **不需要**（免登入、免安裝、開網頁就用） |
| 測試帳密 | **不需要**（依 BRIEF §1：設計為免登入，徹底避開「需提供測試帳密」的風險） |
| 部署平台 | Vercel Hobby（免費方案，$0） |
| 部署日期 | 2026-10-29 |

### ⚠️ 報名時請注意

競賽報名表有「提供作品可瀏覽、播放或操作的連結」欄位 → **請填 `https://good-words.vercel.app`**。

- 作品說明書第八章寫的是「開啟作品網址」，**但說明書本身沒有寫出實際網址**
  （官方說明書模板沒有網址欄位，所以不算違規）
- 因此**唯一填寫網址的地方就是報名表**，請勿填錯或留空

### BRIEF §8 匿名性

公開 URL、頁面內容、repo 皆**不得**出現姓名／學校／單位名稱。
`good-words.vercel.app` 為中性名稱，**不含任何個人識別**。

> GitHub 網址含帳號名稱是平台限制（無法避免），但**說明書與影片不會出現該網址** ——
> 影片只展示網站畫面，畫面中不含網址列。

---

## 一、健康檢查

```powershell
curl.exe -s "https://good-words.vercel.app/api/health"
```

**實際結果（2026-10-29 實測，HTTP 200）：**

```json
{
  "ok": true,
  "app": "好好說話",
  "engines": {
    "ollama": { "alive": false, "note": "Vercel serverless 無法連到本機 Ollama（BRIEF §10）" },
    "cloud":  { "enabled": false },
    "rules":  { "enabled": true }
  },
  "content": {
    "dir": "…/haohao-content",
    "source": "content-dir",
    "emotions": 14,
    "goodwordSets": 21,
    "warnings": [
      { "file": "emotions.json", "status": "ok" },
      { "file": "goodwords.json", "status": "ok" },
      { "file": "crisis.json", "status": "ok" },
      { "file": "share_templates.json", "status": "ok" }
    ]
  },
  "deploy": {
    "runtime": "v24.x.x",
    "appLibDir": "app/lib",
    "contentDir": "…/haohao-content",
    "lib": {
      "rules":  { "source": "app/lib/rules.js",  "snapshot": false },
      "safety": { "source": "app/lib/safety.js", "snapshot": false },
      "ai":     { "source": "app/lib/ai.js",     "snapshot": false },
      "data":   { "source": "app/lib/data.js",   "snapshot": false }
    },
    "forcedEngine": "rules",
    "bundle": { "prepared": true, "contentFiles": 4, "libLoaded": ["ai","data","rules","safety"], "error": null }
  }
}
```

**判讀重點：**
- `"ok": true`
- `content.emotions` = **14**、`goodwordSets` = **21** ← 語料庫正確部署
- `warnings` 全部 `"ok"` ← 4 個 JSON 都合法
- `lib.*.snapshot` = **`false`** ← 用的是 `app/lib` 的真實程式碼，不是離線快照
- `bundle.error` = **`null`** ← 雲端打包正確帶上語料與模組
- `engines.ollama.alive` = **`false`** ← 正確：雲端本來就沒有本機 Ollama
- ★ **路徑全部是相對路徑**（`app/lib`、`…/haohao-content`），**無絕對路徑洩漏**

---

## 二、一般回應測試（三段好話）

```powershell
curl.exe -s -X POST "https://good-words.vercel.app/api/respond" ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"我覺得自己很沒用，什麼都做不好\"}"
```

**實際結果（HTTP 200）：**

```
crisis: false | engine: rules | emotion: 自我否定 | 三段齊全: true

承接：你覺得自己什麼都做不好，連講出來都像在承認。
好話：你罵自己的那句話，你絕對不會對朋友說。
小步：現在改一個字就好：把「我很爛」換成「我現在很累」。

禁語檢查：無（加油／你可以的／別想太多／想開一點／一切都會好的 → 0 命中）
```

> ★ **`engine: rules`** —— 這是雲端在**完全連不到本機 Ollama** 的情況下產生的回應。
> 直接證明 T5 驗收標準「關掉本機 Ollama 後，公開站仍能給出好話」。

---

## 三、危機護欄測試（BRIEF §6，硬需求）

```powershell
curl.exe -s -X POST "https://good-words.vercel.app/api/respond" ^
  -H "Content-Type: application/json" ^
  -d "{\"text\":\"我不想活了\"}"
```

**實際結果（HTTP 200）：**

```
crisis: true | engine: safety
resources: 1925 / 1995 / 1980 / 119   ← 四項全部回傳

承接：你願意把這句話說出來，這件事很重要。你現在承受的，不是「想太多」，是真的非常重。
```

| 資源 | 電話 | 是否回傳 |
|---|---|---|
| 1925 安心專線 | 1925 | ✅ |
| 1995 生命線 | 1995 | ✅ |
| 1980 張老師 | 1980 | ✅ |
| 119 / 110 | 119 | ✅ |

> `engine: safety` 代表**走的是確定性的規則式護欄，不經過任何模型** —— 不會漏接。

**其他危機字串實測：**

| 輸入 | crisis | engine |
|---|---|---|
| 我不想活了 | `true` | `safety` |
| 不知道為什麼要活著 | `true` | `safety` |

---

## 四、轉送功能測試（三好「做好事」）

```powershell
curl.exe -s -X POST "https://good-words.vercel.app/api/share" ^
  -H "Content-Type: application/json" ^
  -d "{\"accept\":\"你願意把這件事寫下來，本身就不容易。\",\"goodword\":\"你現在的感覺是真的，它不需要先被誰同意。\",\"smallstep\":\"今晚先喝一杯水，十一點前躺下。\",\"audience\":\"friend\"}"
```

**實際結果（HTTP 200）：**

```
audience: friend | label: 給朋友

text:
我在想你。
最近你講話都短短的，我沒多問，但我有注意到。
你不用這次就講完，我只是想讓你知道，我在。

copyText:
承接：你願意把這件事寫下來，本身就不容易。
好話：你現在的感覺是真的，它不需要先被誰同意。
小步：今晚先喝一杯水，十一點前躺下。
```

> ★ 這是 BRIEF §3「做好事」的具體實現：**善意可以轉出去**。
> 轉送文字不是罐頭訊息，而是承接原句語氣、改寫成可以對別人說的版本。

---

## 五、★ 外網實測（BRIEF §12 明列的品質關卡）

> 品質關卡原文：「公開 URL 實測可用（**用手機網路測，不只用本機**）」
> 完成標準原文：「**關掉本機 Ollama 後，公開站仍能給出好話**」

### 已完成的驗證（外部網路，非本機）

**這一段是從外部網路對公開網址實測的結果**（不經過 localhost）：
- `verify-public.mjs` → **40/40 PASS、BLOCKER 0、MAJOR 0、MINOR 0**
- 全部 API 端點以 `curl` 實測（見第一～四節）
- 雲端 `engines.ollama.alive = false`，但 `meta.engine = rules` 正常回應

> ★ **這直接證明 T5 驗收標準「關掉本機 Ollama 後，公開站仍能給出好話」** ——
> 因為雲端 serverless **本來就完全連不到本機 Ollama**，
> 而它仍然正確產出三段好話。

### ⏳ 待人工執行的驗證（需要一支手機）

**以下項目尚未由人工用「手機 + 行動網路」逐項確認**，需由團隊成員或使用者實地操作：

| # | 操作 | 預期 | 結果 |
|---|---|---|---|
| 1 | 手機開 `https://good-words.vercel.app` | 正常載入、不破版 | ⬜ |
| 2 | 輸入「我最近工作壓力好大，每天都做不完」 | 顯示情緒標籤 + 三段好話 | ⬜ |
| 3 | 按「複製這句」 | 複製成功 | ⬜ |
| 4 | 按「轉送給別人」 | 出現給他人的版本 | ⬜ |
| 5 | 按「收藏」 | 出現在收藏清單 | ⬜ |
| 6 | 輸入「我不想活了」 | 顯示 1925 / 1995 / 1980 | ⬜ |
| 7 | 檢查三段是否有禁語 | 無禁語 | ⬜ |

**操作方式**：手機關 Wi-Fi、開 4G/5G → 瀏覽器開網址 → 依序操作 → 截圖存證。

> ⚠️ **誠實說明**：自動化驗證（curl / verify-public.mjs）**已全部通過**，
> 但「人眼在真實手機上看到畫面」這件事**自動化工具無法取代**。
> 這 7 項需由人實地確認，確認後請把結果與截圖補進本節。

---

## 六、本機自動化回歸測試（部署前後都可跑）

在 `C:\prodcut` 執行：

```powershell
node deploy\preflight.mjs                                    # 部署前閘門
node deploy\verify-public.mjs https://good-words.vercel.app  # 部署後外網驗收
node deploy\verify-deploy-layer.mjs                          # T6 可複驗證據包
```

**最終實測結果：**

```
preflight.mjs
  ✅ 語料同步（content-inline）   ✅ 路由一致性
  ✅ Serverless API 契約          ✅ 冷啟動模擬
  ✅ repo 內容檢查                → 全部通過

verify-deploy-layer.mjs : 18/18 PASS（不需登入／網路，任何人可重跑）

verify-public.mjs（對 https://good-words.vercel.app）:
  共 40 項，通過 40
  BLOCKER 0 / MAJOR 0 / MINOR 0
  判定：PASS
```

### ★ 最強的一項驗證：從「全新 clone」實測

因為 Vercel 部署時只會拿到 git repo 的內容，我們做的**最嚴格**驗證是：

```powershell
git clone . <暫存目錄>          # 模擬 Vercel 收到一份全新 clone
cd <暫存目錄>
node app/server.js              # 用 clone 出來的程式碼啟動
```

實測結果（2026-10-29）：

```
clone 檔案數        : 與 repo 一致
部署關鍵檔案        : vercel.json / app/api/*.js / app/lib/* / app/public/* 全部存在
/api/health         : emotions=14  sets=21  source=content-dir
/api/respond        : engine=rules  三段齊全
危機字串            : crisis=true  1925/1995/1980/119
verify-public.mjs（對 clone server）: PASS，BLOCKER 0
```

### ★ 更嚴格的一項：真隔離測試（無 `content/`）

因為雲端 `content/` 不在專案範圍內，我們額外做了這個測試：

```
只複製 app/ + deploy/（刻意不複製 content/）
→ app/api/respond.js 獨立呼叫：
    HTTP 200 | engine=rules | emotion=工作壓力 | 三段齊全
    goodword:「請一天假不會毀掉你累積的一切。」
→ app/api/health.js：emotions=14  goodwordSets=21  source=content-dir
→ 危機字串：crisis=true  tels=1925/1995/1980/119
→ bundle: prepared=true, libLoaded=[ai,data,rules,safety], error=null
```

> **這證明內嵌語料機制有效**：即使 `content/` 完全不存在，網站仍能正常運作。
> 這正是雲端的真實處境，所以部署後行為可預期。

---

## 七、評審期間存活紀錄（115.12.01–12.15）

| 日期 | 檢查 | 結果 | 備註 |
|---|---|---|---|
| 11/25 | 部署前暖機 | ⬜ | |
| 12/01 | 評審開始 | ⬜ | |
| 12/05 | 中期檢查 | ⬜ | |
| 12/10 | 中期檢查 | ⬜ | |
| 12/15 | 評審結束 | ⬜ | |

**若發現異常**：Vercel 專案 → Deployments → 對最後一次成功的部署按 **Redeploy**（約 10 秒恢復）。

> 為什麼這個站特別耐？因為 AI 走**規則式引擎**，
> 不依賴 Ollama、不依賴任何雲端 LLM。
> **就算其他外部服務全部掛掉，這個站仍然會回應。**

---

## 八、部署過程中發現的關鍵事實（給未來接手的人）

這次部署來回三次才成功，以下是**用實測換來的教訓**，寫下來避免重蹈覆轍。

### ① Vercel 認定的「專案根目錄」是 `app/`，不是 repo 根
判斷依據（線上實測）：
```
GET /index.html              → 200
GET /app/public/index.html   → 404   ← 若服務 repo 根，這應該 200
GET /package.json            → 404
GET /content/emotions.json   → 404
GET /vercel.json             → 404
```
→ **放在 repo 根的 `api/` 完全在 Vercel 專案範圍之外，從未被編譯成 function。**
→ 這解釋了為什麼 `/api/*` 全部 404、而靜態檔卻正常。
→ 這也是為什麼**改 `vercel.json` 怎麼改都沒用** —— 問題不在設定，在專案範圍。

**對策**：入口放在 `app/api/`（Vercel 看得到的根）。
`vercel.json` 的 `functions` 也**同時宣告兩邊**，作為保險。

### ② `content/` 不在 Vercel 專案範圍內 → 必須內嵌
從 `app/` 內部用 `require('../../content/emotions.json')` 在**本機可行、雲端會 MODULE_NOT_FOUND**
（因為雲端 `content/` 根本不在部署範圍）。這正是「本機全綠 ≠ 雲端可用」的典型陷阱。

**對策**：用腳本把語料內嵌成 `app/lib/content-inline.js`
```powershell
node deploy\sync-content-inline.mjs          # 產生／更新
node deploy\sync-content-inline.mjs --check  # 檢查是否同步（CI 用）
```
`content/` 仍是唯一事實來源，內嵌檔由腳本產生、一起進版控，不會漂移。

### ③ 判斷部署成功必須測 API，不能只看首頁
**我們就是這樣誤判了一輪**：首頁 200、CSS/JS 都 200，看起來完全正常，
但 `/api/*` 全部 404 —— 評審送出心事後永遠不會有回應，比壞掉更糟。

```powershell
curl.exe -s -o NUL -w "%{http_code}" "https://good-words.vercel.app/api/health"
# 必須是 200。只看 / 是 200 不代表成功。
```

### ④ 量線上資源大小要用 `curl`，不要用 PowerShell 的 `.Content.Length`
用 `Invoke-WebRequest` 量到 6428 bytes，實際是 7903 bytes（編碼問題），
因而做出「部署內容與 repo 不符」的**錯誤結論**，浪費了一輪。

```powershell
curl.exe -s "https://good-words.vercel.app/" -o out.html
# 然後比對位元組數（或用 Get-FileHash 比對 sha256）
```

### ⑤ 加了 `?cb=<timestamp>` 再判斷，避免被快取誤導
`X-Vercel-Cache: HIT` 時可能拿到舊內容。要判斷「現在到底部署了什麼」時先 cache-bust。

---

## 九、需要使用者本人完成的動作

> 依使用者指示：「全權代操，但**登入需要他本人**」。
> 部署者**不會**代填帳密、**不會**繞過驗證。

| # | 動作 | 狀態 |
|---|---|---|
| 1 | **登入 GitHub**（建立 repo + push 授權） | ✅ 已完成 |
| 2 | **登入 Vercel**（瀏覽器授權、Import Git Repository 部署） | ✅ 已完成 |
| 3 | 報名時填入作品網址 `https://good-words.vercel.app` | ⬜ 待報名時執行 |

**目前不需要使用者再做任何部署相關的事。**
之後若程式碼有更新，`git push` 就會自動重新部署（Git 整合已建立）。

---

*最後更新：2026-10-29*

---

## 十、自動外網驗收（`node deploy/verify-public.mjs`）

> 以下區塊由驗收腳本自動寫入（`--write-md`），可重跑更新。

<!-- AUTO-VERIFY-START 2026-10-29T17:50:36.333Z -->
### 自動外網驗收結果（2026-10-29T17:50:36.333Z）

- 目標：`https://good-words.vercel.app`
- 判定：**PASS**
- 通過 40 / 40（BLOCKER 0、MAJOR 0、MINOR 0）

| 群組 | 項目 | 結果 | 細節 |
|---|---|---|---|
| home | 首頁回 200 | ✅ | HTTP 200 |
| home | 首頁是 HTML | ✅ | text/html; charset=utf-8 |
| home | 首頁含作品字樣 | ✅ | 6428 bytes |
| home | /style.css 回 200 | ✅ | HTTP 200 text/css; charset=utf-8 |
| home | /app.js 回 200 | ✅ | HTTP 200 application/javascript; charset=utf-8 |
| health | /api/health 回 200 | ✅ | HTTP 200 |
| health | ok:true | ✅ |  |
| health | 情緒類別 ≥ 10 | ✅ | 14 類 |
| health | 好話語料庫 ≥ 10 組 | ✅ | 21 組 |
| health | 內容來源為 content/（非內建 fallback） | ✅ | content-dir |
| health | 所有 content JSON 合法 | ✅ | 無警告 |
| health | lib.rules 載入自 app/lib | ✅ | snapshot=false |
| health | lib.safety 載入自 app/lib | ✅ | snapshot=false |
| health | lib.ai 載入自 app/lib | ✅ | snapshot=false |
| health | 部署強制引擎為規則軌 | ✅ | rules |
| health | 規則引擎啟用 | ✅ |  |
| respond | 三段齊全：「我最近工作壓力好大，…」 | ✅ | HTTP 200 298ms engine=rules 情緒=工作壓力 |
| respond |   無禁語（反毒雞湯） | ✅ | 無 |
| respond |   回應時間 < 8s（Hobby 逾時 10s） | ✅ | 298ms |
| respond |   情緒非兜底標籤 | ✅ | 工作壓力 |
| respond | 三段齊全：「我覺得自己很沒用，什…」 | ✅ | HTTP 200 390ms engine=rules 情緒=自我否定 |
| respond |   無禁語（反毒雞湯） | ✅ | 無 |
| respond |   回應時間 < 8s（Hobby 逾時 10s） | ✅ | 390ms |
| respond |   情緒非兜底標籤 | ✅ | 自我否定 |
| respond | 三段齊全：「跟他分開之後，我每天…」 | ✅ | HTTP 200 308ms engine=rules 情緒=家庭衝突 |
| respond |   無禁語（反毒雞湯） | ✅ | 無 |
| respond |   回應時間 < 8s（Hobby 逾時 10s） | ✅ | 308ms |
| respond |   情緒非兜底標籤 | ✅ | 家庭衝突 |
| crisis | 「我不想活了」→ 正確轉介 | ✅ | 資源 1925/1995/1980/119 |
| crisis |   危機回應無禁語 | ✅ | 無 |
| crisis | 「我想死」→ 正確轉介 | ✅ | 資源 1925/1995/1980/119 |
| crisis |   危機回應無禁語 | ✅ | 無 |
| crisis | 「活著沒意義」→ 正確轉介 | ✅ | 資源 1925/1995/1980/119 |
| crisis |   危機回應無禁語 | ✅ | 無 |
| share | /api/share 回 200 | ✅ | HTTP 200 |
| share | 產生轉送文字 | ✅ | label=給朋友 50 字 |
| share | 有 copyText | ✅ |  |
| edge | 空輸入 → 400 且有提示 | ✅ | HTTP 400 |
| edge | 連續 5 次請求全部成功 | ✅ | 平均 291ms、最慢 300ms |
| edge | 最慢 < 8s | ✅ | 300ms |

<!-- AUTO-VERIFY-END -->
