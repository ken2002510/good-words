# 評審報告 → 修正對應表（2026-11-15）

對應來源：《好好說話_評審報告.md》（黑箱實測 129+ 次請求 ＋ 原始碼審閱）。
本表只列**有實際動手**的項目；每項都附可重跑的證據指令。

## P0

| # | 評審發現 | 修正 | 證據 |
|---|---|---|---|
| P0-1 | 9 項 PII 只有 1 項被擋；全形數字／插空白／插橫線／諧音／全形身分證／空白身分證／全形 LINE ID／地址省略市名 **8 種變體全部上牆** | `screen.js` 個資偵測前先做三種偵測視圖：**NFKC 正規化 → 去分隔符（含！？）→ 中文數字諧音轉寫**；規則擴充到市話、身分證、地址（含省略市名）、LINE ID、學校、班級、姓名（含「我是說真的」誤判黑名單）。訊息只回類別、不回原文 | `node qa/_safety_test.cjs` → **53/53**（含 9 項原文 + 8 種繞過） |
| P0-2 | 「我已經想好方法了，也知道時間」（方法＋時間＝最高危險）判為 crisis:false，零熱線 | `safety.js` 加入**組合式風險 R1–R4**（計畫／方法／時間／致命手段／低落語境）；組合命中視為強訊號，不被「累死／笑死」guard 抵銷。並修兩項誤判：email 位址內的英文字串不再誤觸危機、「你去死」改走攻擊字過濾 | `qa/_safety_test.cjs`（必攔 7 句、必不誤判 5 句）；**正式站實測**：危機句回 `crisis:true` 並附 1925/1995/1980/119 |
| P0-3 | 「不會被評價」與排行榜／+N 分 toast 直接衝突；第一眼就是「0 分／尚未上榜」 | 文案改「**AI 不會評價你寫的內容**」；個資保證改誠實版（3 處）；掛牆與鼓勵 toast **不再報分數**；分數 0 顯示「**本週還沒開始**」、排名顯示「—」；我的紀錄加註「分數來自你給別人的鼓勵，不是你的心事被評價」 | 正式站首頁實測：以上字串皆已上線 |
| P0-4 | `--ink-faint` 3.13:1／2.67:1；深色模式主要按鈕 **2.71:1**；`focus-visible` 全站 0 筆；`role="tablist"` 誤用；smooth scroll 未受 reduced-motion 控制 | `--ink-faint` → `#6f665f`（淺）／`#a1978d`（深）、`--accent` → `#9c4f2a`、新增 `--on-accent`；全站 `:focus-visible`；`role="group"`+`aria-pressed`；`scrollToNode()` 依 `prefers-reduced-motion` 決定 smooth/auto；輸入框旁常駐危機資源小字 | **WCAG 公式獨立複算**：淺色 11/11、深色 11/11 全過（主要按鈕 5.89:1／5.23:1、`--ink-faint` 5.61:1／5.45:1）；首頁 `role="tablist"` 殘留 **0** |

## P1

| # | 評審發現 | 修正 | 證據 |
|---|---|---|---|
| P1-1a | `POST /api/wall` 直接採用客戶端 `ai` 欄位 → 可偽造 AI 背書 | 客戶端 `ai` 一律不採用，AI 回應只由伺服器產生；回應附 `serverGenerated:true`、`clientAiOffered`（僅記錄有人試圖指定） | `qa/_wall_api_verify.cjs`（偽造文字不會出現在牆上） |
| P1-1b | 同一句罐頭鼓勵連送 12 次、每次 +7 分，衝上第 4 名 | ① 同句（正規化後，含只改標點）→ **409**；② 同一人同一篇只給一次分（以 `anonHash` 比對，不用可碰撞的公開 handle）；③ 每日「能得分的鼓勵篇數」上限；KV 不可用時退化為記憶體擋同句 | 同左，並含「只加！？」的繞過案例 |
| P1-1c | 匿名 handle = anon 後 4 碼，可預測、可冒充（`牆友#0001` 出現三次） | `anonHandle()` 改 **HMAC-SHA256(anon) 前 4 碼**；需 env `HANDLE_SECRET`（未設時安全退回舊行為） | `qa/_safety_test.cjs`（不可反推、500 個 anon 碰撞 <5、未設時不壞） |
| P1-2 | 站上**沒有任何刪除路徑**（DELETE 12 種組合全 405），31 筆測試資料無法回收 | 新增 `DELETE /api/wall`：`x-admin-token` == env `WALL_ADMIN_TOKEN`（constant-time 比對）；`?id=`／`?ids=`／`?purge=test|all`／`?anon=`／`?before=`／`?dry=1`；刪除同時把測試帳號從排行榜 hash 移除。附清理腳本 `qa/cleanup_test_posts.mjs` | `qa/_wall_api_verify.cjs`：dry-run 不動資料、實際刪 2 篇、正常貼文不誤刪、排行榜已清；權杖未設 503／錯誤 401／其他動詞 405 |
| P1-3a | `/api/health` 公開檔案路徑與完整 export 清單（含黑名單名稱）＝攻擊地圖 | 回應只留 `{ok, engine, degraded, counts}`；連部署包裝層額外附加的 `libLoaded`／`contentDir` 也移除 | 正式站實測：回應不含 `libLoaded`／`contentDir`／`app/lib`／`.js`／pattern 名稱 |
| P1-3b | 應用層無 per-user 配額，可耗盡 NVIDIA 免費額度；6.5 秒逾時過長（使用者空等 6,844ms） | `deploy/api/respond.js` 加**每來源每小時 40 次**上限（KV 計數，KV 不可用不阻擋）；`NVIDIA_TIMEOUT_MS` 6500 → **2500ms**（實測 P95 1.6s） | 正式站實測 `/api/respond` 200、三段齊全、**2.07s** |

## 測試套件（Lead 逐項獨立複跑）

| 套件 | 結果 | 內容 |
|---|---|---|
| `qa/_safety_test.cjs` | **53 / 53** | PII 9 項＋8 繞過、反向不誤擋、危機分級、handle |
| `qa/_wall_api_verify.cjs` | **30 / 30** | 偽造 AI、刷分、去重、刪除、health 回應形狀、權杖行為 |
| `qa/_wall_test.cjs` | **34 / 34** | 既有牆整合測試（含語意更新：辱罵≠危機） |
| `app/test/run-tests.js` | **77 / 77** | 既有單元／對抗輸入測試 |

## 需要維運設定的環境變數（未設不會壞，但功能不生效）

| 變數 | 用途 | 未設時的行為 |
|---|---|---|
| `WALL_ADMIN_TOKEN` | 啟用 `DELETE /api/wall` 與清理腳本 | DELETE 回 503（安全地停用） |
| `HANDLE_SECRET` | 讓匿名 handle 不可由 anon 反推 | 退回舊的「後 4 碼」 |
| `RESP_PER_HOUR`（選用） | 調整每來源每小時回應上限（預設 40） | 用預設值 |

## 複測 v2（2026-11-17）追加修正

來源：《好好說話_複測報告_v2.md》。該輪評價為「實質而非表面的修正」，殘留 4 項未修＋4 項新發現，
全部已處理：

| 類別 | 發現 | 修正 | 證據 |
|---|---|---|---|
| ❌→✅ | 危機判定搶先於攻擊判定：罵人氣話（「你他媽的是個白痴廢物，去死一死算了」）被當危機、吞掉改寫結果 | 新增 `findDirectedAttack()`：句中有第二人稱、且攻擊詞之前沒有第一人稱 → 走攻擊字（422），不進危機分支；第一人稱自傷仍是 crisis | 正式站實測：該句與「你去死啦…」都回 **422 人身攻擊**；「我真的好想死一死」回 **crisis:true** |
| ❌→✅ | 含 email 的正常句被誤判 crisis（crisis 早於 PII） | `safety.normalize()` 先把 email／網址／@帳號整段遮掉再比對；該句改由個資規則回 422 | `qa/_safety_test.cjs`（含 email 句子 → 非 crisis、422 email） |
| ❌→✅ | `/api/respond` 的 meta 仍洩漏廠商與模型名（只修了 health 一半） | 新增 `publicMeta()`：只回白名單 engine ＋中性 `provider`，**不再回 model** | 正式站實測：meta 無 `model`、無 `nemotron/bolt-e4b` 等字樣 |
| ⚠️→✅ | emoji／任意符號夾雜可繞過 PII（`0912😢345😢678` 上牆） | 改用「數字間容忍 ≤2 個非數字字元」的寬鬆比對，並確認「2026 年 11 月，我 35 歲」等正常數字不誤擋 | `qa/_safety_test.cjs` 新增 5 種夾雜變體全擋、2 種正常數字不誤擋 |
| ⚠️→✅ | 新版洩漏 `anonHash`（16 位 hex＝可跨發文追蹤的穩定鍵） | 新增 `publicEnc()`：回應與牆列表只輸出顯示欄位，`anonHash` 僅內部比對用 | `qa/_wall_api_verify.cjs`：回應與列表皆無 `anonHash` |
| ⚠️→✅ | 刷分去重只做 per-item，換貼文送同句仍每次 +7 | 新增「同一人同一天同一句話只用一次」（KV hash 計數，跨貼文） | `qa/_wall_api_verify.cjs`：換貼文送同句 → `delta 0` |
| ⚠️→✅ | handle 4 碼 hex（65,536）比 v1 base36 更小、碰撞率升高 | 一律用雜湊並取 **8 碼 hex**；**沒設 `HANDLE_SECRET` 也用 sha256＋固定鹽**（上線驗證發現 Vercel 未設該變數，舊退路仍可預測） | `qa/_safety_test.cjs`（有／無密鑰皆為 8 碼 hex、不可反推、不碰撞） |
| ⚠️→✅ | `placeholder` 是「意外修好」：靠 `health.engines` 的死碼，加回去缺陷就復活 | 直接移除該段（它會洩漏模型名、又蓋掉改寫模式的提示文字） | 首頁 placeholder 只由 `PLACEHOLDER[mode]` 決定 |

> 註：牆上**既有**的鼓勵仍顯示舊的 4 碼 handle —— 因為 handle 是在寫入時就存進 KV 的。
> 新寫入的一律是 8 碼；舊列會在測試資料清理時一併消失。

## 尚未處理（屬產品決策或新功能，未動）

- 評審建議的**移除排行榜與分數**（改為「本週最多人收到鼓勵的話」）：本次只移除掛牆 toast 的分數與 0 分觀感，排行榜本體保留 → 需產品決定。
- 報告「豐富方向」：情緒軌跡、小步驟實踐累積、危機分級與安全計畫、照顧者模式、語音輸入。
- 本機開發伺服器 `app/server.js` 的 `/api/wall` 未實作 DELETE（Vercel 路由已實作）；本機要清資料請直接操作 KV。
- 31 筆評審測試資料仍在 KV：需先設 `WALL_ADMIN_TOKEN`，再跑 `node qa/cleanup_test_posts.mjs`（預設 dry-run）。
