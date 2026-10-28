# PUBLIC-LINK.md — 公開網址與驗證紀錄

> 這份文件是交給評審的「作品連結」來源，也是團隊的驗證證據。
> **部署完成後，把下面的 `（待填）` 換成實際值。**

---

## 公開網址

| 項目 | 值 |
|---|---|
| **作品公開 URL** | `（待填）https://good-words-xxxx.vercel.app` |
| GitHub repo | `（待填）https://github.com/<帳號>/good-words` |
| 是否需要登入 | **不需要**（免登入、免安裝、開網頁就用） |
| 測試帳密 | **不需要**（依 BRIEF §1：設計為免登入，徹底避開「需提供測試帳密」的風險） |
| 部署平台 | Vercel Hobby（免費方案） |
| 部署日期 | `（待填）` |

⚠️ **BRIEF §8 匿名性**：公開 URL、頁面內容、repo 皆**不得**出現姓名／學校／單位名稱。
上面 GitHub 帳號欄請只填帳號本身，**不要**填真實姓名。

---

## 一、健康檢查

```powershell
curl.exe -s https://<網址>/api/health
```

**預期輸出（節錄）：**

```json
{
  "ok": true,
  "service": "好好說話 — deploy api",
  "runtime": "v22.x.x",
  "appLibDir": "/var/task/app/lib",
  "contentDir": "/var/task/content",
  "lib": {
    "rules":  { "snapshot": false, "exports": ["respond","classifyEmotion","buildShare","toCopyText","lint","hashSeed","BANNED","LAST_RESORT"] },
    "safety": { "snapshot": false },
    "ai":     { "snapshot": false, "exports": ["generate","buildShare","toCopyText", "..."] }
  },
  "content": {
    "emotions.json":        { "present": true },
    "goodwords.json":       { "present": true },
    "crisis.json":          { "present": true },
    "share_templates.json": { "present": true }
  }
}
```

**判讀重點：**
- `"ok": true`
- `lib.*.snapshot` 應為 **`false`** ← 代表用的是 `app/lib` 的真實程式碼，不是離線快照
- `content.*.present` 應全部 **`true`** ← 代表好話語料庫有正確部署

**實際結果：**

```
（待填：貼上實際輸出）
```

---

## 二、一般回應測試（三段好話）

```powershell
curl.exe -s -X POST https://<網址>/api/respond -H "Content-Type: application/json" -d "{\"text\":\"我最近工作壓力好大，每天都做不完\"}"
```

**預期：** `accept` / `goodword` / `smallstep` 三段皆有內容，`meta.engine` = `rules`。

**實際結果：**

```
（待填）
```

---

## 三、危機護欄測試（BRIEF §6，硬需求）

```powershell
curl.exe -s -X POST https://<網址>/api/respond -H "Content-Type: application/json" -d "{\"text\":\"我不想活了\"}"
```

**預期：** `"crisis": true`，`resources` 至少包含：

| 資源 | 電話 |
|---|---|
| 1925 安心專線 | 1925 |
| 1995 生命線 | 1995 |
| 1980 張老師 | 1980 |

**實際結果：**

```
（待填）
```

---

## 四、轉送功能測試（三好「做好事」）

```powershell
curl.exe -s -X POST https://<網址>/api/share -H "Content-Type: application/json" -d "{\"accept\":\"承接句\",\"goodword\":\"好話句\",\"smallstep\":\"小步句\",\"audience\":\"friend\"}"
```

**預期：** 回傳 `label`（給朋友）、`text`（完整轉送文字）、`copyText`。

**實際結果：**

```
（待填）
```

---

## 五、★ 外網實測（BRIEF §12 明列的品質關卡）

> 品質關卡原文：「公開 URL 實測可用（**用手機網路測，不只用本機**）」
> 完成標準原文：「**關掉本機 Ollama 後，公開站仍能給出好話**」

### 測試步驟

1. **確認本機 Ollama 是關閉的**（這是重點：要證明雲端站不依賴本機）
   ```powershell
   Get-Process ollama -ErrorAction SilentlyContinue   # 應該沒有輸出
   ```
2. **關掉筆電 Wi-Fi**，手機開 4G/5G 行動網路
3. 手機瀏覽器開 `<公開網址>`
4. 依序操作：

| # | 操作 | 預期 | 結果 |
|---|---|---|---|
| 1 | 開啟首頁 | 正常載入、手機不破版 | ⬜ |
| 2 | 輸入「我最近工作壓力好大，每天都做不完」 | 顯示情緒標籤 + 三段好話 | ⬜ |
| 3 | 按「複製這句」 | 複製成功 | ⬜ |
| 4 | 按「轉送給別人」 | 出現給他人的版本 | ⬜ |
| 5 | 按「收藏」 | 出現在收藏清單 | ⬜ |
| 6 | 輸入「我不想活了」 | 顯示 1925 / 1995 / 1980 | ⬜ |
| 7 | 檢查三段是否有禁語（加油／你可以的／別想太多） | 無禁語 | ⬜ |

**實測證據（截圖檔名 / 操作時間）：**

```
（待填）
```

---

## 六、本機自動化回歸測試（部署前後都可跑）

在 `C:\prodcut` 執行：

```powershell
node deploy\preflight.mjs                       # 一鍵跑完底下 4 套（部署前閘門）
node deploy\verify-public.mjs <網址>            # 部署後外網驗收（37 項）
```

**部署前實測結果：**

```
preflight.mjs
  ✅ 路由一致性        ✅ Serverless API 契約
  ✅ 冷啟動模擬        ✅ repo 內容檢查
  → 全部通過

verify-public.mjs（對本機 server） : 37 項，通過 36，BLOCKER 0，MAJOR 0 → PASS
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
clone 檔案數        : 57（與 repo 一致）
部署關鍵檔案        : vercel.json / api/*.js / app/lib/* / app/public/* / content/* 全部存在
/api/health         : emotions=14  sets=21  source=content-dir
/                   : HTTP 200 6596 bytes
/style.css          : HTTP 200 15344 bytes
/app.js             : HTTP 200 16156 bytes
deploy/api/respond.js 直接呼叫（強制規則軌、無外部 AI）：
  「工作壓力好大每天加班」→ engine=rules  emotion=工作壓力  三段齊全
verify-public.mjs（對 clone server）: 36/37 PASS，BLOCKER 0
```

> **這證明「commit 裡的東西」本身可獨立運作**，不只是工作區能跑。
> 這正是 Vercel 會收到的內容，所以部署後行為可預期。

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

## 八、需要使用者本人完成的動作

> 依使用者指示：「全權代操，但**登入需要他本人**」。
> 以下兩件事**必須由使用者親自完成**，部署者不會代填帳密、不會繞過驗證。

| # | 動作 | 指令 | 狀態 |
|---|---|---|---|
| 1 | **登入 GitHub**（建立 repo + push 授權） | 見 `DEPLOY-GUIDE.md` §3 | ⬜ |
| 2 | **登入 Vercel**（`vercel login` 瀏覽器授權） | 見 `DEPLOY-GUIDE.md` §4.2 | ⬜ |

完成這兩步之後，其餘（部署、驗證、填寫本文件）都由部署者處理。

---

*最後更新：`（待填）`*
