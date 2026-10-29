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
 * 包一層：在原本的 health 回應上附加 bundle 診斷。
 * 這樣部署後只要打 /api/health，就能知道「雲端打包有沒有把資源帶上來」，
 * 不必去翻 Vercel log。
 */
module.exports = (req, res) => {
  const origJson = res.json.bind(res);
  res.json = (payload) => {
    try {
      if (payload && typeof payload === 'object') {
        payload.deploy = payload.deploy || {};
        payload.deploy.bundle = {
          prepared: true,
          contentDir: bundleState.contentDir ? 'set (tmp)' : null,
          contentFiles: bundleState.contentFiles,
          libLoaded: bundleState.libLoaded,
          error: bundleState.error,
        };
      }
    } catch (_) {
      /* 附加診斷失敗不該影響主回應 */
    }
    return origJson(payload);
  };
  return handler(req, res);
};
