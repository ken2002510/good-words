'use strict';

/**
 * GET /api/health — Vercel serverless 入口（相對於 app/ 專案根）
 *
 * 見 app/api/respond.js 的完整說明：
 * 線上證據顯示 Vercel 的專案根目錄是 `app/`，所以放在 repo 根的 api/ 看不到。
 *
 * ★ 順序同 respond.js：必須先 prepare() 再 require handler。
 *
 * 這支是部署後排除問題最快的方法：一眼看出 Vercel 看到了哪些 lib / content。
 * 真正邏輯仍在 `deploy/api/health.js`（單一事實來源）。
 */

const bundle = require('./_bundle.js');
const bundleState = bundle.prepare();

const handler = require('../../deploy/api/health.js');

/**
 * 包一層：在原本的 health 回應上附加**最小**的打包診斷。
 *
 * ★ 2026-11 評審 P1-3：這裡原本會回 `libLoaded`（載入了哪些模組）與 `contentDir`，
 *   等於告訴攻擊者「這個服務有哪些模組、關鍵字黑名單叫什麼名字」——那是白送的攻擊地圖。
 *   現在只保留「打包有沒有成功」與「帶上幾個內容檔」這兩個不含名稱的訊號：
 *     deploy.bundle = { prepared, contentFiles:<數字>, failed:<bool> }
 *   要更細的診斷請看 Vercel log，不要放在公開端點上。
 */
module.exports = (req, res) => {
  const origJson = res.json.bind(res);
  res.json = (payload) => {
    try {
      if (payload && typeof payload === 'object') {
        payload.deploy = payload.deploy || {};
        payload.deploy.bundle = {
          prepared: true,
          contentFiles: Number(bundleState.contentFiles) || 0,
          failed: Boolean(bundleState.error),
        };
      }
    } catch (_) {
      /* 附加診斷失敗不該影響主回應 */
    }
    return origJson(payload);
  };
  return handler(req, res);
};
