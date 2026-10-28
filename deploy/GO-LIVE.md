# GO-LIVE.md — 部署執行清單（使用者登入後照做）

> 內部執行文件（deployer 用）。使用者登入完成後，照這份一次做完。
> 每個步驟都有「驗證方式」，不靠印象。

---

## 前置狀態（已完成）

```
✅ task-5 claimed
✅ commit 0fa5cfe（57 檔）
✅ preflight 4/4 全綠
✅ git clone 全新實測 PASS（最強的部署前驗證）
✅ 工作區乾淨、部署關鍵檔案與 HEAD 零差異
✅ vercel CLI 65.5.0 已安裝
```

---

## 步驟 0：確認使用者已完成登入

需要使用者提供：
1. **GitHub repo 網址**（例如 `https://github.com/<account>/good-words.git`）
2. **「Vercel 登入好了」**

**若任一未完成 → 停下來，不要嘗試代替登入。**

驗證登入狀態：

```powershell
vercel whoami          # 應顯示帳號名稱，不是 "Not logged in"
```

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
