# repo 根目錄的 `api/` — 這是「備援」，不是主要入口

## 一句話

**實際生效的入口是 `app/api/`。** 這裡的檔案是保險，不是主線。

## 為什麼會有兩份

2026-10-29 部署時我們實測發現：**Vercel 認定的「專案根目錄」是 `app/`，不是 repo 根**。

判斷依據（全部是線上實測，不是推測）：

```
GET /index.html              → 200   ✅
GET /app.js                  → 200   ✅
GET /app/public/index.html   → 404   ← 若服務 repo 根，這應該 200
GET /package.json            → 404   ← repo 根的檔案取不到
GET /content/emotions.json   → 404   ← 同上
GET /vercel.json             → 404   ← 同上
```

→ 靜態服務的根是 `app/public/`，而 **Vercel 的專案根是 `app/`**。

在該前提下，放在 **repo 根**的 `api/` 完全落在 Vercel 專案範圍之外，
**從未被編譯成 serverless function** → `/api/*` 全部 404（`X-Vercel-Error: NOT_FOUND`）。

這也是為什麼當時**改 `vercel.json` 怎麼改都沒用** —— 問題不在設定，在專案範圍。

## 修法

把入口放進 `app/api/`（Vercel 看得到的根）。修正後線上驗收 **40/40 PASS**。

## 那為什麼不把這裡刪掉？

因為「以哪個目錄為專案根」是 **Vercel 的偵測行為**，不是我們能完全控制的：

- 若日後 Vercel 改變偵測邏輯
- 若有人調整了 `app/package.json` 或新增 repo 根的設定檔
- 若 Preview 部署與 Production 的判定不同

**任一種情況發生時，`app/api/` 可能失效，而這裡會自動接手。**
留著這 4 個小檔案的代價接近零，換來的是對抗判定變化的保險。

`vercel.json` 的 `functions` 區塊也**同時宣告了兩邊**，所以兩邊都會被正確設定。

## 兩份實作只有一份

這裡的檔案**只做轉發**，真正的邏輯仍然只有一份：

```
api/respond.js      ─┐
app/api/respond.js  ─┴→  deploy/api/respond.js   ← 單一事實來源
```

`app/api/*.js` 額外會先呼叫 `_bundle.js` 的 `prepare()`（設定 `CONTENT_DIR`、
註冊內嵌語料），因為 `app/lib/data.js` 在 module load 當下就鎖定路徑，順序不能顛倒。

詳見 [`app/api/respond.js`](../app/api/respond.js) 與 [`deploy/api/respond.js`](../deploy/api/respond.js) 的註解。

## 相關文件

- [`deploy/DEPLOY-GUIDE.md`](../deploy/DEPLOY-GUIDE.md) — 部署指令與疑難排解
- [`deploy/GO-LIVE.md`](../deploy/GO-LIVE.md) — 執行清單
- [`deploy/PUBLIC-LINK.md`](../deploy/PUBLIC-LINK.md) — 公開網址與驗收紀錄
