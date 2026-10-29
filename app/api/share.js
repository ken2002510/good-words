'use strict';

/**
 * POST /api/share — Vercel serverless 入口（相對於 app/ 專案根）
 *
 * 見 app/api/respond.js 的完整說明：
 * 線上證據顯示 Vercel 的專案根目錄是 `app/`，所以放在 repo 根的 api/ 看不到。
 * 這裡提供同一條 API 的另一個入口，讓 api/ 一定落在 Vercel 的視野內。
 *
 * ★ 順序同 respond.js：必須先 prepare() 再 require handler。
 *
 * BRIEF §3「做好事」＝好話轉送，前端「轉送給別人」按鈕打的就是這條。
 * 真正邏輯仍在 `deploy/api/share.js`（單一事實來源）。
 */

require('./_bundle.js').prepare();

module.exports = require('../../deploy/api/share.js');
