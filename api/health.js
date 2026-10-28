'use strict';

/**
 * GET /api/health — Vercel serverless 入口（標準 api/ 目錄）
 *
 * 見 api/respond.js 的說明：根目錄 api/ 是 Vercel 零設定保證會偵測到的位置，
 * 真正邏輯仍只有一份（deploy/api/health.js），這裡只做轉發。
 *
 * 這支是部署後排除問題最快的方法：一眼看出 Vercel 到底看到了哪些 lib / content。
 */

module.exports = require('../deploy/api/health.js');
