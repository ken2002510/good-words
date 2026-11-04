# 《好好說話》

> 一個「說好話」主題的 AI 陪伴網站。
> 當你把說不出口的心事打進去，它會先接住你的情緒，再給你一句具體、真誠、可以對自己或對別人說的「好話」。

**免登入、免安裝、開網頁就能用。** 手機優先。零外部依賴。

---

## 這個 repo 有什麼

| 目錄 | 內容 |
|---|---|
| `app/` | 網站本體：前端（`public/`）+ Node 零依賴後端（`server.js`）+ AI 引擎（`lib/`） |
| `content/` | 好話語料庫、情緒分類、危機詞庫、轉送模板 |
| `deploy/` | Vercel 部署層（serverless API）與自動化檢查腳本 |
| `api/` | Vercel serverless 入口（原生 `api/` 目錄） |
| `docs/` | 作品說明書產製腳本 |
| `video/` | 作品介紹影片產製腳本 |
| `qa/` | 驗收腳本 |

## 本機執行

```bash
node app/server.js
```

然後開 <http://127.0.0.1:3000>。不用 `npm install`（本專案沒有任何 dependencies）。

---

## ⚠️ 關於檢查腳本中的學校／人名等字串

本專案的自動化檢查腳本（`app/test/`、`deploy/test-repo-contents.mjs`、`qa/`、`docs/verify_spec.py`）
裡面會出現學校名稱、帶隊老師姓名等字串。

**那是匿名性檢查規則所比對的「目標字串」，不是本作品或本團隊的資訊揭露。**

競賽規定要求作品不得出現校名、人名、單位名稱，這些腳本正是用來**確保這件事**的。
換句話說，那些字串的存在恰好證明了匿名性檢查有在做。

作品本身（網站介面、說明書、影片）已確認不含任何校名、姓名或可辨識資訊。

> 本說明刻意不寫出實際校名 —— 因為那會讓說明文字本身變成揭露。
> 要知道比對清單，請直接看 `deploy/test-repo-contents.mjs` 的 `PII_PATTERNS`。

---

## AI 設計（四軌自動降級，為什麼不會白畫面）

順序固定、逐軌降級：

1. **本機 Ollama**（`qwen3:4b-instruct`）— 免費、離線、不上傳，本機展示時最強
2. **NVIDIA NIM 雲端 LLM**（`integrate.api.nvidia.com`）—— **上架版（Vercel）主力**，key 只放環境變數 `NVIDIA_API_KEY`，絕不進 repo
3. **其他 OpenAI 相容雲端 API** — 有 key 才啟用
4. **規則式引擎** — **保證一定有回應**

部署到 Vercel 時：serverless function 連不到本機 Ollama，所以**有 `NVIDIA_API_KEY`
就走 NVIDIA 雲端 LLM**（逾時 6.5s 內自動降級）；沒有 key 就走規則式引擎。

這不是妥協，而是刻意的設計：**規則式引擎不依賴任何外部服務，
所以就算雲端 AI 服務全部中斷，網站的連結仍然可以正常使用。**

另外兩個 AI 應用：

- **改寫模式（rewrite）**：貼上一句對自己/別人說的重話，AI 改寫成說得出口的好話
- **多輪對話**：最近 4 輪存在瀏覽器 localStorage，送出時帶給模型；後端不儲存

部署版無 key 時的回應品質，取決於 `content/` 語料庫的品質。

### 在 Vercel 後台設定環境變數（上架版啟用雲端 LLM）

Project → Settings → Environment Variables 新增：

| 名稱 | 值 | 說明 |
|---|---|---|
| `NVIDIA_API_KEY` | `nvapi-...` | **祕密**，不要提交到 repo |
| `NVIDIA_MODEL` | （可選）預設 `nvidia/nemotron-3.5-bolt-e4b` | 實測 4/4 PASS、avg 1.2s（見 `qa/_nv_bench.mjs`） |
| `NVIDIA_TIMEOUT_MS` | （可選）預設 6500 | 逾時後自動降級規則式 |

設好後重新 deploy，`GET /api/health` 會回報 `engines.nvidia.enabled: true`。

---

## 安全護欄

偵測到自傷／自殺／危機訊號時，**立即停止一般回應流程**，改為顯示真實求助資源
（1925 安心專線、1995 生命線、1980 張老師、119／110）。

這個判斷是**規則式的、確定性的**，不經過任何模型，避免漏接。

---

## 授權

競賽參賽作品。
