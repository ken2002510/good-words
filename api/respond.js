'use strict';

/**
 * POST /api/respond — Vercel serverless 入口（標準 api/ 目錄）
 *
 * 為什麼根目錄要有這一支：
 *   Vercel 的**零設定**偵測只認專案根目錄的 `api/` 資料夾。
 *   放在 `deploy/api/` 的檔案雖然有 rewrite 指向，但「rewrite 能否把請求
 *   派發給非 api/ 目錄的 .js 當成 function」在文件上並不明確 —— 這是本專案
 *   風險最高的假設。與其賭它，不如讓入口檔落在 Vercel 100% 保證會偵測到的位置。
 *
 *   這裡刻意**只做轉發**，真正的邏輯仍然只有一份：
 *       deploy/api/respond.js  ← 單一事實來源（含完整註解與測試）
 *
 *   這樣「標準路徑」與「單一事實來源」兩個需求同時成立，不會出現兩份實作漂移。
 *
 * 若日後想簡化，可把 deploy/api/*.js 的內容直接搬進這裡 —— 因為
 * deploy/lib/resolve.js 用 `__dirname/../..` 定位專案根，
 * 搬到 api/ 之後路徑假設依然成立（已在本機驗證）。
 */

module.exports = require('../deploy/api/respond.js');
