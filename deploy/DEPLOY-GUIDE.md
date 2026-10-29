# DEPLOY-GUIDE.md — 《好好說話》免費永久上架指南

> 目標：把作品放上 **GitHub public repo + Vercel Hobby（免費）**，
> 讓評審期間（115.12.01–12.15）連結**一直活著、一直能用**。
>
> 全程 **$0**，不需要伺服器、不需要資料庫、不需要信用卡。
>
> **✅ 已上線：<https://good-words.vercel.app>（2026-10-29，外網驗收 40/40 PASS）**

---

## ⚠️ 0. 先讀：四個會讓部署失敗的陷阱（實測換來的）

這份指南的其餘部分是「怎麼做」；這一節是「**為什麼會做不成**」。
這四點各讓這次部署多花了一輪，全部是實測結果，不是推測。

### ① Vercel 的「專案根目錄」是 `app/`，不是 repo 根
```
GET /index.html              → 200   ✅
GET /app.js                  → 200   ✅
GET /app/public/index.html   → 404   ← 若服務 repo 根，這應該 200
GET /package.json            → 404   ← repo 根的檔案取不到
GET /content/emotions.json   → 404
GET /vercel.json             → 404
```
→ 靜態服務的根是 `app/public/`，**而 Vercel 認定的專案根是 `app/`**
（因為 `app/package.json` 存在）。
→ **放在 repo 根的 `api/` 完全在專案範圍之外，永遠不會被編譯成 function。**
→ **這就是為什麼「改 `vercel.json` 怎麼改都沒用」** —— 問題不在設定，在專案範圍。

**對策**：serverless 入口放 `app/api/`（本專案兩邊都放，`vercel.json` 也兩邊都宣告，作為保險）。

### ② `content/` 不在 Vercel 專案範圍內 → 語料必須內嵌
從 `app/` 內部寫 `require('../../content/emotions.json')`：
- **本機可行**（content/ 就在旁邊）
- **雲端 `MODULE_NOT_FOUND`** → function 直接崩潰

這是「**本機全綠 ≠ 雲端可用**」的典型陷阱。

**對策**：
```powershell
node deploy\sync-content-inline.mjs          # 產生 app/lib/content-inline.js
node deploy\sync-content-inline.mjs --check  # 檢查是否同步（不同步 exit 1）
```
`content/` 仍是唯一事實來源；內嵌檔由腳本產生、一起進版控，不會漂移。
**★ 改完 `content/` 一定要重跑這支，否則雲端語料不會更新。**

### ③ 判斷部署成功必須測 API，不能只看首頁
首頁 200、CSS 200、JS 200 —— **看起來完全正常，但 `/api/*` 可能全部 404**。
那樣評審送出心事後永遠不會有回應，**比網站壞掉更糟**（會被判定「功能不完整」）。

```powershell
curl.exe -s -o NUL -w "%{http_code}" "https://good-words.vercel.app/api/health"
# 必須 200。只看 / 是 200 不算通過。
```

### ④ 量線上資源要用 `curl` 精確位元組 + cache-bust
- PowerShell `Invoke-WebRequest` 的 `.Content.Length` 會量到**錯誤大小**，
  曾因此做出「部署內容與 repo 不符」的**錯誤結論**，白費一輪
- `X-Vercel-Cache: HIT` 可能回舊內容 → 加 `?cb=<timestamp>` 再判斷

```powershell
curl.exe -s "https://good-words.vercel.app/?cb=$(Get-Date -UFormat %s)" -o out.html
# 用位元組數或 sha256 比對，不要靠 HTTP client 的 Content.Length
```

---

## 0. 先看懂：為什麼這樣部署

| 層 | 方案 | 為什麼 |
|---|---|---|
| 原始碼 | GitHub public repo | 免費、永久、可作為「製作過程」的證據 |
| 網站 | **Vercel Hobby** | 免費、永久、自動 HTTPS、附 `*.vercel.app` 網域 |
| AI | **規則式引擎**（`app/lib/rules.js`） | **保證永遠有回應**，不依賴任何外部服務 |
| 雲端 LLM | 可選，**預設關閉** | 實測 `NVIDIA_API_KEY` 逾時、HF 推論 402 → 不可依賴（BRIEF §4） |

### ★ 最重要的一件事

**Vercel 的 serverless function 連不到你筆電的 Ollama。**

`127.0.0.1:11434` 在 Vercel 上指的是「Vercel 自己那台容器」，不是你家的 RTX 5060。
所以部署版**必須**走規則式引擎。

這不是妥協，而是 BRIEF §10 已經定案的架構：

> 「AI 層必須是可插拔的 —— 本機開發走 Ollama，Vercel 部署走規則式引擎（保證永遠有回應）」

也因此，**部署版的品質 100% 取決於 `content/` 的好話語料庫有多好**。
語料庫越好，公開站越好。這是規則軌的價值所在。

---

## 1. 前置檢查（本機）

```powershell
cd C:\prodcut
node -v          # 需要 >= 18（本機 v24.15.0 ✅）
git --version    # 需要已安裝（本機 2.54.0 ✅）
```

**部署前檢查（一鍵，必做）：**

```powershell
node deploy\preflight.mjs
```

這支會依序跑完 4 套檢查，**全部 PASS 才往下走**：

| 檢查 | 驗什麼 |
|---|---|
| `test-routing.mjs` | `vercel.json` 路由與前端實際呼叫是否一致 |
| `test-serverless.mjs` | 模擬雲端（無 Ollama）的 API 契約、危機護欄、反毒雞湯、邊界 |
| `test-coldstart.mjs` | 複製到乾淨目錄，模擬 Vercel 只看得到 repo 內容的冷啟動 |
| `test-repo-contents.mjs` | `.gitignore` 是否誤排除必需檔、大檔、個資、UTF-8 BOM |

> 個別執行也可以，例如 `node deploy\test-serverless.mjs --ollama-down`。

**部署後**則跑外網驗收（見 §5.0）。

---

## 2. 建立 git repo

```powershell
cd C:\prodcut
git init
git branch -M main

# 確認 .gitignore 有生效：影片大檔不該進 repo
git status --short
```

⚠️ **確認 `video/out/*.mp4` 沒有被列入**。若不小心加了，用：

```powershell
git rm --cached -r video/out
```

第一次提交：

```powershell
git add .
git commit -m "《好好說話》：說好話主題的 AI 陪伴網站（前端 + 規則式 AI + 危機護欄）"
```

檢查有沒有誤加個資或大檔：

```powershell
# 大檔檢查（應該都要 < 1MB）
git ls-files | ForEach-Object { if (Test-Path $_) { $f=Get-Item $_; if ($f.Length -gt 1MB) { "{0:N2} MB  {1}" -f ($f.Length/1MB), $_ } } }

# 個資檢查（BRIEF §8）：應該 0 命中
#   注意：這裡刻意不把要搜尋的關鍵字直接寫進本文件 ——
#   本文件會進 public repo，寫出來等於自己把校名／帳號放上去。
#   請執行自動化檢查，它會用內部的樣式清單比對：
node deploy\test-repo-contents.mjs
```

---

## 3. 🔴 需要使用者登入：GitHub

> **到這裡必須停下來，由使用者本人操作。**
> 不要代填帳密、不要繞過驗證。這是使用者的明確要求。

### 方式 A：用瀏覽器（最簡單，建議）

1. 使用者開啟 https://github.com/new
2. Repository name：`good-words`（或任何名稱，**程式碼裡不要放個資**）
3. 選 **Public**
4. **不要**勾 Add README / .gitignore / license（我們本機已經有了）
5. 按 **Create repository**
6. 把頁面上顯示的網址告訴部署者，或直接由使用者執行下面兩行：

```powershell
cd C:\prodcut
git remote add origin https://github.com/<你的帳號>/good-words.git
git push -u origin main
```

推的時候會跳瀏覽器要求授權（Git Credential Manager）→ **由使用者本人完成**。

### 方式 B：安裝 `gh` CLI（本機目前未安裝）

```powershell
winget install --id GitHub.cli
gh auth login      # ← 由使用者本人完成瀏覽器授權
gh repo create good-words --public --source=. --push
```

---

## 4. 🔴 需要使用者登入：Vercel

### 4.1 ★ 建議做法：用 Vercel 網站的 Git 整合（本次實際採用）

**這個方法不需要安裝任何 CLI、不需要 `vercel login`，也不需要把憑證交給任何人。**
而且完成後每次 `git push` 都會自動重新部署 —— 對評審期間的長期存活最有利。

1. 使用者登入 <https://vercel.com/signup>（**Continue with GitHub** 最省事）
   - ⚠️ 務必選 **Hobby（免費）**，不要誤入 Pro（要收費）
2. 開 <https://vercel.com/new>
3. 選 **Import Git Repository** → 授權 GitHub → 選 `good-words`
4. **Project Name 填 `good-words`** ← ★ 這決定公開網址，務必確認
   - ⚠️ 若名稱已被占用而自動加後綴（如 `good-words-abc`），
     **網址就會不同** → 要同步更新 `PUBLIC-LINK.md`
5. **Framework Preset 選 `Other`**；**Root Directory 保持 `./`**；其他全部預設
6. 按 **Deploy**，等約 1 分鐘

完成後網址形如：

```
https://good-words.vercel.app
```

> 💡 **為什麼不用 CLI 部署**：CLI 需要 `vercel login` 產生**獨立於網頁登入的憑證**。
> 本次使用者已在網頁登入，但 CLI 仍回報 `Logged out`
> （`vercel whoami` → exit 1、"No existing credentials found"）。
> 網頁登入與 CLI 登入是兩套憑證 —— 用 Git 整合可完全避開這個問題。

### 4.2 （選用）CLI 部署

只有在需要從命令列部署、或有自動化需求時才用：

```powershell
npm i -g vercel
vercel login        # ← 由使用者本人在瀏覽器完成授權
vercel --prod
```

首次會問幾個問題：

| 問題 | 回答 |
|---|---|
| Set up and deploy "C:\prodcut"? | `Y` |
| Which scope? | 使用者自己的帳號 |
| Link to existing project? | `N` |
| What's your project's name? | `good-words` |
| In which directory is your code located? | `./`（直接 Enter） |
| Want to modify these settings? | `N` |

**這就是要交給評審的公開 URL。** 記到 `PUBLIC-LINK.md`。

### 4.3 部署後一定要確認網址正確

```powershell
curl.exe -s -o NUL -w "%{http_code}" "https://good-words.vercel.app/api/health"
# 200 = 正確；404 = 見第 0 節的陷阱 ①
```

---

## 5. 部署後必做驗證（不可跳過）

### 5.0 一鍵外網驗收（建議先跑這個）

```powershell
node deploy\verify-public.mjs https://<你的網址>.vercel.app
```

自動跑 37 項檢查，涵蓋 BRIEF §12 品質關卡，並以 BLOCKER / MAJOR / MINOR 分級：

- 首頁與靜態資源可從外網開啟
- `/api/health` 內容完整度（情緒類別 ≥10、好話 ≥10 組、來源為 `content/`）
- 三段結構齊全、**無禁語**（會正確忽略「我不會叫你想開一點」這類否定用法）
- **危機字串 → 1925 / 1995 / 1980**
- 好話轉送可用
- 邊界：空輸入、連續 5 次請求、**回應時間 < 8s（Hobby 逾時 10s）**

有 BLOCKER 就 exit 1。加上 `--write-md` 會把逐項結果寫回 `PUBLIC-LINK.md`。

```powershell
node deploy\verify-public.mjs https://<你的網址>.vercel.app --write-md
```

下面 5.1–5.5 是同一件事的手動版，想逐項確認時可照著做。

### 5.1 自檢端點

```powershell
curl.exe -s https://<你的網址>.vercel.app/api/health
```

預期看到 `"ok": true`，且 `lib.rules.source`、`content` 都有值。
**若 `content` 全部 `present: false`，代表 `content/` 沒被部署上去** → 見 §7 疑難排解。

### 5.2 API 實測（三段好話）

```powershell
curl.exe -s -X POST https://<你的網址>.vercel.app/api/respond `
  -H "Content-Type: application/json" `
  -d "{\"text\":\"我最近工作壓力好大，每天都做不完\"}"
```

預期：`accept` / `goodword` / `smallstep` 三段都有內容，且 `meta.engine` 是 `rules`。

### 5.3 危機護欄實測（BRIEF §6 硬需求）

```powershell
curl.exe -s -X POST https://<你的網址>.vercel.app/api/respond `
  -H "Content-Type: application/json" `
  -d "{\"text\":\"我不想活了\"}"
```

預期：`"crisis": true`，且 `resources` 含 **1925 / 1995 / 1980**。

### 5.4 轉送功能

```powershell
curl.exe -s -X POST https://<你的網址>.vercel.app/api/share `
  -H "Content-Type: application/json" `
  -d "{\"accept\":\"承接句\",\"goodword\":\"好話句\",\"smallstep\":\"小步句\",\"audience\":\"friend\"}"
```

### 5.5 ★ 外網實測（BRIEF §12 明列）

> 品質關卡：「公開 URL 實測可用（**用手機網路測，不只用本機**）」

**關掉筆電 Wi-Fi，用手機 4G/5G 開網址**，跑一次完整流程：

1. 首頁能開、手機不破版
2. 輸入一段心事 → 出現情緒標籤 + 三段好話
3. 按「轉送給別人」→ 出現給他人的版本
4. 輸入「我不想活了」→ 出現 1925 / 1995 / 1980
5. **此時本機 Ollama 是關著的** —— 這正是要證明的：雲端站不靠本機也能給好話

---

## 6. 綁定 GitHub 自動部署（建議做）

Vercel 專案 → **Settings → Git → Connect Git Repository** → 選 `good-words`。

之後每次 `git push` 到 `main`，Vercel 自動重新部署。
評審期間若需要改錯字，改完 push 就好，不必再跑 CLI。

---

## 7. 疑難排解

| 症狀 | 原因 | 解法 |
|---|---|---|
| `/api/health` 回 404 | rewrite 沒生效 | 確認 `vercel.json` 在 **repo 根目錄**（不是 deploy/ 裡面） |
| `content` 全部 `present:false` | `content/` 沒進 repo | `git ls-files content/` 確認；檢查 `.gitignore` 有沒有誤排除 |
| 回應是「安全備援句」 | `app/lib` 沒被部署 | 看 `/api/health` 的 `lib` 欄位；確認 `app/lib/*.js` 已 commit |
| 部署 504 / timeout | 雲端在探測 Ollama | 確認未設 `DEPLOY_TRY_OLLAMA`；預設已是純規則軌 |
| 中文變亂碼 | 檔案存成 Big5 | 所有 `.js`/`.json`/`.html` 必須 **UTF-8 無 BOM** |
| Vercel build 失敗 | 有 `package.json` 但無 dependencies | `vercel.json` 已設 `installCommand` 跳過安裝 |
| 網址被停用 | Hobby 閒置政策 | 評審前一週先打開一次（見 §8） |

---

## 8. 評審期間存活策略（115.12.01–12.15）

Vercel Hobby 是免費方案，有兩個要留意的點：

1. **流量上限**：Hobby 每月有免費額度（含 bandwidth 與 function 呼叫數）。
   本作品每個請求只回幾 KB 的 JSON，**正常評審用量遠遠用不到上限**。
2. **閒置**：長期無人訪問的專案可能被降速或需喚醒。

**保險做法（建議在 11/25 前完成）：**

```
□ 11/25 先開一次網址，確認正常
□ 12/01 評審開始當天早上再開一次
□ 12/05 中間再開一次（避免長期閒置）
□ 若發現異常 → 立刻在 Vercel 按 Redeploy（10 秒恢復）
```

因為 AI 走**規則式**、不依賴任何外部 API，
**就算全世界其他服務都掛了，這個站還是會回應** —— 這是本架構最大的優點。

---

## 9. 選用：升級 AI 品質（非必要）

規則式已經是可靠的預設。**只有在拿到穩定可用的雲端 key 時**才考慮：

Vercel 專案 → Settings → Environment Variables 新增：

| 名稱 | 值 | 說明 |
|---|---|---|
| `CLOUD_LLM_API_KEY` | `sk-...` | OpenAI 相容端點的金鑰 |
| `CLOUD_LLM_MODEL` | `gpt-4o-mini` | 模型名 |
| `CLOUD_LLM_URL` | （選填） | 預設 `https://api.openai.com/v1/chat/completions` |
| `DEPLOY_AI_ENGINE` | `auto` | 改為 auto 才會嘗試雲端；**預設是 rules** |

> ⚠️ **BRIEF §4 已實測：`NVIDIA_API_KEY` 逾時、HF 推論 402。**
> 不要因為「有 key」就切換 —— 必須先實測該 key 真的能通。
> 若雲端失敗，`ai.js` 會自動降級回規則軌，**不會白畫面**，所以風險有限。

---

## 10. 交付清單

```
□ GitHub public repo 已建立、程式碼已推上去
□ Vercel 部署成功，拿到 https://xxx.vercel.app
□ /api/health 回 ok:true 且 content 有值
□ /api/respond 三段好話正常
□ 危機字串 → 1925 / 1995 / 1980
□ 手機 4G 外網實測通過（本機 Ollama 關閉狀態下）
□ 公開 URL 已記錄到 deploy/PUBLIC-LINK.md 並回報給團隊
```
