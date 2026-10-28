# 好好說話 — 可操作網站

> 當你把說不出口的心事打進去，它會先接住你的情緒，再給你一句具體、真誠、可以對自己或對別人說的「好話」。

**零外部依賴**（只用 Node 內建模組）、**免登入**、**手機優先**、**介面零個資**。

---

## 快速啟動

```bash
cd C:\prodcut\app
node server.js
```

然後開 <http://127.0.0.1:3000>

不用 `npm install` —— 本專案沒有任何 dependencies。Node 18 以上即可（實測 v24.15.0）。

換 port：

```powershell
$env:PORT=8080; node server.js
```

---

## AI 三軌（自動降級，順序不可變）

| 順序 | 引擎 | 何時使用 | 逾時 |
|---|---|---|---|
| ① | **Ollama** `qwen3:4b-instruct` @ `127.0.0.1:11434` | 本機有開 Ollama（最強、免費、離線、不上傳） | 20s |
| ② | **雲端** OpenAI 相容端點 | 只有設了 `CLOUD_LLM_API_KEY` 才會啟用 | 8s |
| ③ | **規則式** `lib/rules.js` | 以上都不可用時 | 即時 |

**第 0 步永遠是危機護欄**（`lib/safety.js`），完全不經過任何模型。

每一軌的輸出都必須通過 `lib/rules.js` 的 `lint()`：禁用「加油」「你可以的」「別想太多」等毒雞湯、
禁用醫療診斷語言、禁用「AI 認為」這類後設語言。**不過就自動往下掉一軌。**

### 環境變數

| 變數 | 預設 | 說明 |
|---|---|---|
| `PORT` | `3000` | 監聽埠 |
| `HOST` | `0.0.0.0` | 監聽位址 |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama 位址 |
| `OLLAMA_MODEL` | `qwen3:4b-instruct` | 模型名稱 |
| `OLLAMA_TIMEOUT_MS` | `20000` | Ollama 逾時 |
| `CLOUD_LLM_API_KEY` | （無） | 有值才啟用雲端軌 |
| `CLOUD_LLM_URL` | OpenAI chat completions | 雲端端點 |
| `CONTENT_DIR` | `../content` | 內容 JSON 位置 |
| `AI_ENGINE` | `auto` | 強制指定 `auto`/`rules`/`ollama`/`cloud`（測試用） |

---

## API

| 方法 | 路徑 | 說明 |
|---|---|---|
| `POST` | `/api/respond` | 主端點。`{text}` → 三段好話或危機轉介 |
| `POST` | `/api/share` | `{accept,goodword,smallstep,audience,toneId?}` → 轉送版本 |
| `GET` | `/api/health` | 引擎狀態、內容來源、最近錯誤 |
| `GET` | `/api/content` | 情緒類別清單 + 語料句數 + `ready` 旗標 |

### `POST /api/respond` 回應

```jsonc
{
  "crisis": false,
  "emotion": {
    "id": "self_negation",
    "name": "自我否定",
    "intensity": 4,              // 1–5
    "situation": "把自己整個否定掉…",
    "alternatives": ["工作壓力"],  // 次要情緒
    "unlabeled": false
  },
  "accept":   "承接…",   // 把使用者的處境用自己的話說一次
  "goodword": "好話…",   // 一句真誠、具體、不空洞的話
  "smallstep":"小步…",   // 一個今晚就能做的極小行動
  "resources": null,      // 危機時才有
  "meta": {
    "engine": "ollama",   // ollama | cloud | rules | safety
    "model": "qwen3:4b-instruct",
    "degraded": false,
    "elapsedMs": 3434,
    "contentSource": "content-dir",
    "templateFromContent": true
  }
}
```

危機時 `crisis: true`、`meta.engine: "safety"`、`resources` 帶 1925 / 1995 / 1980 / 119。
**不會呼叫任何模型。**

---

## 安全護欄（BRIEF §6）

`lib/safety.js` 採三層設計：

1. **主要詞庫** — 讀 `content/crisis.json` 的 `patterns[].variants`（149 條，含 severity 分級）。
   補詞只要改 content，不必改程式。
2. **內建保底 pattern** — content/ 整包不見，護欄依然成立。
3. **negative_guard** — `笑死`／`想死你了`／`累死`／`死黨`／`死線` 等口語誇飾**不誤觸轉介**；
   但句中若同時出現強訊號（`不想活`／`自殺`／`想消失`…）則覆蓋 guard，照樣轉介。

正規化（去空白、去標點、全形轉半形）讓「我 不 想 活 了！」也攔得住。

> 誤判的容忍方向是「寧可多接住」。`我好想睡死喔` 會被判定為危機 —— 這是刻意的。

---

## 內容層（`lib/data.js`）

讀 `../content/` 的 `emotions.json`、`goodwords.json`、`crisis.json`、`share_templates.json`。

- **每個檔案獨立容錯**：缺席或壞掉 → 該部分退回內建 fallback，不 throw、不白畫面。
- 內建 fallback 涵蓋 8 類情緒 × 6 句，並透過 id 映射對到 content 的 14 類。
- 讀取一律剝除 UTF-8 BOM（已踩過的坑）。
- 啟動時與 `/api/health`、`/api/content` 都會回報每個檔案的載入狀態。

---

## 測試

```bash
cd C:\prodcut\app

node test/run-tests.js              # 77 項（Ollama 可用時走 Ollama）
node test/run-tests.js --no-ollama  # 76 項（模擬 Ollama 關閉，驗證規則降級）
node test/mobile-check.js           # 20 項（320/375/414/768px 版面 + sticky 頁首遮擋）
```

`mobile-check.js` 用 headless Chrome 的 CDP 直接量測（**不需安裝 puppeteer**），
並在 375px 產出截圖到 `test/screenshots/`（該目錄已列入 `.gitignore`）。

> ⚠️ 跑測試前請先關掉舊的 node 行程，否則會用到舊程式碼，追出不存在的 bug。

---

## 檔案結構

```
app/
├── server.js            Node 內建 http，零依賴
├── package.json         dependencies: {} （空的）
├── lib/
│   ├── ai.js            三軌 provider（ollama → cloud → rules）
│   ├── rules.js         規則引擎 + 反毒雞湯 lint + 情緒分類
│   ├── data.js          內容載入 + 內建 fallback + id 映射
│   └── safety.js        危機護欄（讀 content 詞庫 + 硬編碼保底 + negative_guard）
├── public/
│   ├── index.html       手機優先、語意化、無外部資源
│   ├── style.css        深色模式、320px 斷點、reduced-motion
│   └── app.js           零依賴、零追蹤、收藏走 localStorage
└── test/
    ├── run-tests.js     驗收測試
    └── mobile-check.js  版面與遮擋檢查（headless Chrome）
```

---

## 隱私與匿名性

- **免登入**：沒有帳號、沒有 cookie、沒有 session。
- **零追蹤**：沒有 analytics、沒有 CDN、沒有 web font，全部自家檔案。
- **不儲存對話**：後端不記錄使用者輸入；收藏只存在使用者自己瀏覽器的 localStorage。
- **不上傳**（本機版）：心事送到自己電腦上的 Ollama 處理。
- 介面上沒有任何姓名／單位／logo／可辨識帳號。

---

## 部署到 Vercel 的注意事項

Vercel 的 serverless function **連不到本機 Ollama**，所以部署版實際上會走：

- **③ 規則式**（保證永遠有回應）
- 若設了 `CLOUD_LLM_API_KEY`，才會升級到 **② 雲端**

程式碼不需修改，① 連不上會自動跳過。`/api/health` 的 `engines.ollama.alive` 可即時確認。
