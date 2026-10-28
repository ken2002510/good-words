# READINESS.md — task-5 部署就緒狀態（交接用）

> 給 Lead / T6 審查者：一眼看清「什麼已完成、什麼在等、怎麼接手」。
> 最後更新：2026-10-29

---

## 一句話總結

**部署層已 100% 完成並通過多層驗證；唯一阻塞是「使用者本人登入 GitHub / Vercel」。**
放行後約 10 分鐘可完成部署與驗收。

---

## 一、已完成（全部有實測證據）

| 交付物 | 路徑 | 狀態 |
|---|---|---|
| Vercel 設定 | [`vercel.json`](../vercel.json) | ✅ |
| Serverless API（實作） | `deploy/api/{respond,share,health}.js` | ✅ |
| Vercel 原生入口 | `api/{respond,share,health}.js` | ✅ |
| 共用來源解析 | `deploy/lib/resolve.js` | ✅ |
| 部署指南 | [`DEPLOY-GUIDE.md`](DEPLOY-GUIDE.md) | ✅ |
| 公開連結紀錄 | [`PUBLIC-LINK.md`](PUBLIC-LINK.md) | ✅（網址待填） |
| 執行清單 | [`GO-LIVE.md`](GO-LIVE.md) | ✅ |
| 使用者登入說明 | [`USER-LOGIN-STEPS.md`](USER-LOGIN-STEPS.md) | ✅ |
| 排除規則 | [`.gitignore`](../.gitignore) | ✅ |

### 自動化檢查（6 支，全部可重跑）

| 腳本 | 用途 | 結果 |
|---|---|---|
| `preflight.mjs` | 部署前一鍵閘門（跑底下 4 支） | ✅ 4/4 |
| `test-routing.mjs` | `vercel.json` 路由與前端呼叫一致 | ✅ |
| `test-serverless.mjs` | API 契約、危機護欄、禁語、邊界 | ✅ 18/18 |
| `test-coldstart.mjs` | 複製到乾淨目錄模擬 Vercel | ✅ |
| `test-repo-contents.mjs` | `.gitignore`／大檔／個資／BOM | ✅ |
| `verify-deploy-layer.mjs` | **T6 可複驗證據包**（從 git HEAD 實測） | ✅ 18/18 |
| `verify-public.mjs` | 部署後外網驗收 | ⏳ 待部署後執行 |

### 已驗證的三個層次（由弱到強）

1. **工作區測試** — 證明「本機能跑」
2. **`test-coldstart.mjs`**（複製部分檔案）— 證明「檔案不全時仍能跑」
3. ★ **`git clone` / `git archive HEAD` 實測** — 證明 **「Vercel 實際收到的內容」能跑**

第 3 層最關鍵：實測結果 `57 檔齊全 / health: 14 類情緒 21 組好話 / 規則軌三段齊全 / 危機轉介 1925-1995-1980 / verify-public 36-37 PASS BLOCKER 0`。

---

## 二、待完成（阻塞於使用者登入）

```
vercel whoami  →  exit=1  "Logged out."
git remote -v  →  空（尚未設定）
```

**需要使用者本人提供：**
1. GitHub repo 網址（建議名稱 `good-words`）
2. 「Vercel 登入好了」

**部署者不會代填帳密、不會繞過驗證**（依使用者明確指示）。

---

## 三、接手步驟（給任何人）

依 [`GO-LIVE.md`](GO-LIVE.md) 執行，摘要：

```powershell
cd C:\prodcut

# 0. 確認登入
vercel whoami

# 1. 接 remote 並 push
git remote add origin <使用者給的網址>
git push -u origin main

# 2. ★ push 後立刻複查遠端沒有個資
git ls-tree -r --name-only origin/main | Select-String "00-PROJECT-BRIEF|00-official|screenshots|undertaking|報名|切結書|\.mp4|\.png"
#    預期：無輸出

# 3. 部署（專案名必須是 good-words）
vercel --prod

# 4. 外網驗收（判定標準：BLOCKER = 0）
node deploy\verify-public.mjs https://<公開網址> --write-md

# 5. ★ 人眼驗收（不可省略）
#    關 Ollama → 手機 4G → 開網址 → 截圖 3 張（首頁／三段好話／危機轉介）

# 6. 填 PUBLIC-LINK.md → commit → 回報 Lead → complete task-5
```

---

## 四、關鍵設計決策（含理由，供審查）

| 決策 | 理由 |
|---|---|
| API 走 **Vercel 原生 root `api/`**，不用 rewrite 派發 | 「rewrite 指向非 `api/` 目錄的 .js 能否被當成 function」文件不明確、無法查證。**不在無法驗證的假設上賭**；原生 `api/` 是零設定 100% 會動的路徑。邏輯仍單一來源（入口只轉發）。 |
| 入口只做轉發，實作在 `deploy/api/` | 同時滿足「標準路徑」與「單一事實來源」，避免兩份實作漂移。 |
| 部署版**預設強制規則軌** | serverless 打 `127.0.0.1:11434` 必然失敗且浪費 1.5s；function 上限 10s，探測可能導致 504。要開 Ollama 需明設 `DEPLOY_TRY_OLLAMA=1`。 |
| 拿掉 `regions` | 無法在本機驗證（`vercel build` 需登入）。**「無法驗證的效能優化」vs「保證部署成功」→ 選後者**，評審期間掛掉的代價遠大於延遲。 |
| `.gitignore` 從嚴排除 `00-official/`、切結書腳本、截圖 | BRIEF §8 是**失格紅線**。這些檔案含校名／承辦人資訊。**檔案仍在磁碟，使用者照常可簽名繳交**。 |
| README 說明「檢查腳本中的校名字串」時**不引用該字串** | 「解釋某個字串為什麼存在」最安全的寫法是不寫出它，否則說明本身變成揭露（此坑實際踩過）。 |

---

## 五、已知限制（誠實揭露）

1. **`vercel.json` 未經 Vercel 伺服器端驗證** —— `vercel build` 需要登入，本機無法驗證 schema。
   緩解：JSON 合法、欄位保守、避開未驗證的設定（如 `regions`）。部署時若報錯，會立即回報。
2. **部署版 AI 是規則軌** —— 不是模型生成。這是 BRIEF §10 的刻意設計（保證永遠有回應），
   但也意味著**回應品質 100% 取決於 `content/` 語料庫**。
3. **`verify-public.mjs` 只能驗網址，不能驗影片** —— 影片匿名性需人工逐幀檢視。
4. **本機 Ollama 不可用於部署版** —— 雲端 serverless 無法連回本機（BRIEF §10 已載明）。

---

## 六、聯絡與交接

- 部署負責：teammate `deployer`
- 阻塞解除條件：使用者完成 GitHub + Vercel 登入
- 相關任務：task-5（本任務）；task-6 依賴本任務完成
