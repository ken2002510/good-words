# GO-LIVE.md — 部署執行清單與實戰紀錄

> **狀態：✅ 部署已完成（2026-10-29）**
> 公開網址：**https://good-words.vercel.app**
> 外網驗收：40/40 PASS、BLOCKER 0
>
> 本文件保留為「日後重新部署 / 接手」的操作手冊，並記錄這次踩到的坑。

---

## ★★ 先讀這段：這次部署最關鍵的四個事實

若你只想記一件事，記這段。**這四點都是用實測換來的，違反任一點都會部署失敗。**

### ① Vercel 認定的「專案根目錄」是 `app/`，不是 repo 根
```
GET /index.html              → 200
GET /app/public/index.html   → 404   ← 若服務 repo 根，這應該 200
GET /package.json            → 404
GET /content/emotions.json   → 404
GET /vercel.json             → 404
```
→ **repo 根的 `api/` 完全在 Vercel 專案範圍外，永遠不會被執行。**
→ 入口必須放 `app/api/`。**這也是為什麼改 `vercel.json` 怎麼改都沒用** —— 問題不在設定。

### ② `content/` 不在專案範圍內 → 語料必須內嵌
從 `app/` 內 `require('../../content/…')` **本機可行、雲端 MODULE_NOT_FOUND**。
→ 用 `node deploy/sync-content-inline.mjs` 產生 `app/lib/content-inline.js`（要進版控）。
→ 改完 `content/` 一定要重跑這支，否則雲端語料不會更新。
```powershell
node deploy\sync-content-inline.mjs --check   # 檢查是否同步
```

### ③ 判斷成功必須測 API，不能只看首頁
首頁 200 + CSS/JS 200 **完全不代表成功** —— 我們就是這樣誤判了一輪。
```powershell
curl.exe -s -o NUL -w "%{http_code}" "https://good-words.vercel.app/api/health"
# 必須 200。只看 / 是 200 不算通過。
```

### ④ 量線上資源要用 `curl`，且要 cache-bust
- PowerShell `Invoke-WebRequest` 的 `.Content.Length` 會量到**錯誤大小**（編碼問題）→ 曾因此做出錯誤結論
- `X-Vercel-Cache: HIT` 時可能拿到舊內容 → 加 `?cb=<timestamp>`
```powershell
curl.exe -s "https://good-words.vercel.app/?cb=$(Get-Date -UFormat %s)"
```

---

## 部署前檢查（一鍵閘門）

```powershell
node deploy\preflight.mjs     # 必須全綠才部署
```

涵蓋：語料同步、路由一致性、Serverless API 契約、冷啟動模擬、repo 內容檢查。

---

## 步驟 0：確認登入狀態

需要：
1. **GitHub repo 網址**
2. **Vercel 已登入**（網頁登入即可；若要用 CLI 部署才需要 `vercel login`）

```powershell
vercel whoami          # 顯示帳號名稱 = 已登入；"Logged out" = 未登入
```

> ⚠️ **網頁登入 ≠ CLI 登入**，兩者是分開的憑證。
> 這次部署是用 **Vercel 網站的 Git 整合**完成的（不需要 CLI 登入）。

---

## 步驟 1：接上 remote 並 push

```powershell
cd C:\prodcut
git remote add origin <使用者給的網址>
git remote -v                      # 驗證 remote 正確
git push -u origin main
```

**驗證：**
```powershell
git ls-remote --heads origin       # 應看到 refs/heads/main
```

> ⚠️ push 可能需要使用者完成一次瀏覽器授權（Git Credential Manager）。
> 若跳出視窗 → **請使用者本人點選**，不要代填帳密。

**push 後必查（確認沒有誤傳個資）：**
```powershell
git ls-tree -r --name-only origin/main | Select-String -Pattern "00-PROJECT-BRIEF|00-official|screenshots|undertaking|報名|切結書|\.mp4|\.png"
# 預期：無輸出
```

---

## 步驟 2：部署到 Vercel（專案名必須是 good-words）

```powershell
cd C:\prodcut
vercel --prod
```

**首次會問的問題與正確回答（Lead 已裁決）：**

| 問題 | 回答 | 備註 |
|---|---|---|
| Set up and deploy "C:\prodcut"? | `Y` | |
| Which scope? | 使用者的帳號 | |
| Link to existing project? | `N` | |
| **What's your project's name?** | **`good-words`** | ★ **必須是這個** —— 決定公開網址 |
| In which directory is your code located? | `./`（直接 Enter） | |
| Want to modify these settings? | `N` | |

**驗證網址是乾淨的：**
```
預期：https://good-words.vercel.app  或  https://good-words-<hash>.vercel.app
```
> ⚠️ 若 Vercel 因為名稱被占用而自動加後綴，**先回報 Lead**，不要默默接受。

---

## 步驟 3：跑外網驗收（程式化）

```powershell
node deploy\verify-public.mjs https://<公開網址> --write-md
```

**判定標準：BLOCKER = 0**。有任何 BLOCKER → 停下來修，不要交付。

關鍵幾項一定要看實際數值（不是只看 PASS）：
- `content.emotions` ≥ 10、`goodwordSets` ≥ 10、`source` = `content-dir`
- `meta.engine` = `rules`
- 危機 `resources` 含 1925 / 1995 / 1980
- 回應時間 < 8000ms

---

## 步驟 4：★ 人眼驗收（Lead 明確要求，不可省略）

> Lead 的提醒：「程式能驗證的與人眼看的是兩回事。」

1. **確認本機 Ollama 是關的**（證明不依賴本機）
   ```powershell
   Get-Process ollama -ErrorAction SilentlyContinue    # 應無輸出
   ```
2. **手機關 Wi-Fi、開 4G/5G**
3. 手機瀏覽器開公開網址
4. **截圖 3 張**：
   - 首頁
   - 輸入心事後的三段好話
   - 輸入「我不想活了」的求助資源畫面
5. 檢查畫面**沒有**任何本機痕跡（無網址列上的 localhost、無桌面、無書籤列）

**截圖存放：** `deploy/screenshots/public-*.png`（此目錄不進 repo）

---

## 步驟 5：填寫 PUBLIC-LINK.md 並 commit

把以下「（待填）」換成實際值：
- 公開 URL
- GitHub repo 網址
- 各項實測輸出
- §七 評審期間存活紀錄

```powershell
cd C:\prodcut
git add deploy/PUBLIC-LINK.md deploy/DEPLOY-GUIDE.md
git commit -m "部署上線：公開 URL 與外網驗收紀錄"
git push
```

---

## 步驟 6：回報 Lead 並 complete task-5

回報內容必含：
- 實際公開 URL
- `verify-public.mjs` 的判定（BLOCKER 數）
- **3 張截圖的路徑**（Lead 要親自看）
- 使用者還需要做什麼（若無 → 明確說「不需要」）

```powershell
team_task_update task-5 action=complete
```

---

## 疑難排解

| 症狀 | 原因 | 解法 |
|---|---|---|
| `/api/health` 404 | `vercel.json` 不在 repo 根 | 確認 `git ls-tree HEAD vercel.json` |
| `content.emotions` = 0 | `content/` 沒上傳 | `git ls-tree -r HEAD --name-only content/` |
| 回應是安全備援句 | `app/lib` 沒部署 | 看 `/api/health` 的 `deploy.lib.*.error` |
| 504 timeout | 雲端在探測 Ollama | 確認未設 `DEPLOY_TRY_OLLAMA` |
| 中文亂碼 | 檔案非 UTF-8 | `node deploy\test-repo-contents.mjs` 的 BOM 檢查 |
| 網址含隨機後綴 | 名稱被占用 | 回報 Lead |
