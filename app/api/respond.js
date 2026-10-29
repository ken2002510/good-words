'use strict';

/**
 * POST /api/respond — Vercel serverless 入口（相對於 app/ 專案根）
 *
 * 【為什麼放在這裡】
 * 線上實測證據顯示 Vercel 認定的「專案根目錄」是 `app/`，不是 repo 根：
 *     GET /index.html              → 200
 *     GET /app/public/index.html   → 404   ← 若服務 repo 根，這應該 200
 *     GET /content/emotions.json   → 404
 *     GET /package.json            → 404
 * 也就是靜態服務的根是 `app/public/`，Vercel 的專案根是 `app/`。
 * 因此放在 **repo 根** 的 `api/` 完全落在 Vercel 專案範圍之外，從未被編譯成
 * serverless function → `/api/*` 全部 404。
 *
 * 修法：讓 `api/` 也出現在 `app/` 底下（Vercel 實際看得到的根）。
 * 這樣不論 Vercel 最後判定哪個是專案根，`api/` 都在它的視野內，
 * 不依賴任何偵測邏輯，也不需要使用者進後台改設定。
 *
 * 【★ 順序很重要】
 * 必須先 `prepare()` 再 require handler —— 因為 `app/lib/data.js` 在 module load
 * 當下就鎖定 `CONTENT_DIR`，晚設定就無效（詳見 _bundle.js 的說明）。
 *
 * 真正邏輯仍在 `deploy/api/respond.js`（單一事實來源），這裡只做轉發與環境準備。
 */

// 1) 先準備環境（設定 CONTENT_DIR、註冊 bundled lib）
require('./_bundle.js').prepare();

// 2) 再載入真正的 handler
module.exports = require('../../deploy/api/respond.js');
