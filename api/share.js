'use strict';

/**
 * POST /api/share — Vercel serverless 入口（標準 api/ 目錄）
 *
 * 見 api/respond.js 的說明：根目錄 api/ 是 Vercel 零設定保證會偵測到的位置，
 * 真正邏輯仍只有一份（deploy/api/share.js），這裡只做轉發。
 *
 * BRIEF §3「做好事」＝好話轉送，前端「轉送給別人」按鈕打的就是這裡。
 */

module.exports = require('../deploy/api/share.js');
