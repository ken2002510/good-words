'use strict';

/**
 * api/_bundle.js — Vercel 專用的「靜態可追蹤」載入層
 *
 * 【為什麼需要這個檔案】—— 這是本專案部署時最關鍵的一環
 *
 * Vercel 的 serverless 打包器（@vercel/nft）是**靜態分析**：
 * 它只沿著 `require()` 的**字面路徑**去蒐集要放進 function bundle 的檔案。
 * 任何「執行期才拼出來」的路徑都追不到，檔案就不會被帶上雲端。
 *
 * 而 `deploy/lib/resolve.js` 正是這樣做的：
 *     const p = path.join(dir, name + '.js');  require(p);   // ← nft 追不到
 *     fs.readFileSync(path.join(dir, 'goodwords.json'))      // ← nft 追不到
 *
 * 在本機這樣寫沒問題（檔案就在旁邊）；但在 Vercel 上，
 * `app/lib/*.js` 與 `content/*.json` **不會**被放進 bundle → 執行期找不到檔案。
 *
 * 【解法】在這裡用**字面路徑**把它們全部 require 一次：
 *   · 對打包器：這是明確的靜態依賴 → 一定被納入 bundle
 *   · 對執行期：把結果註冊到 globalThis，讓 resolve.js 直接取用（不必碰 fs）
 *
 * 內容 JSON 另外「實體化」到 /tmp，因為 `app/lib/data.js` 是用
 * `fs.readFileSync()` 讀檔的（不是透過 resolve.js），它需要真實路徑。
 *
 * 【本機不受影響】本機執行 `app/server.js` 不會經過這裡；
 * 就算經過，resolve.js 的 fs.existsSync 會先命中，這層只是保險。
 */

const fs = require('fs');
const path = require('path');

// ── 1. 字面路徑 require：讓打包器看得見 app/lib 的四個模組 ──────────
const bundledLib = {
  ai: require('../app/lib/ai.js'),
  data: require('../app/lib/data.js'),
  rules: require('../app/lib/rules.js'),
  safety: require('../app/lib/safety.js'),
};

// ── 2. 字面路徑 require：讓打包器看得見 content/ 的四個 JSON ────────
const bundledContent = {
  'emotions.json': require('../content/emotions.json'),
  'goodwords.json': require('../content/goodwords.json'),
  'crisis.json': require('../content/crisis.json'),
  'share_templates.json': require('../content/share_templates.json'),
};

const CONTENT_FILES = ['emotions.json', 'goodwords.json', 'crisis.json', 'share_templates.json'];

// ── 3. 把內容實體化成檔案，讓 app/lib/data.js 的 readFileSync 讀得到 ──
let _contentDir = null;
let _prepareError = null;

function materializedContentDir() {
  if (_contentDir) return _contentDir;

  // Vercel 只有 /tmp 可寫；本機用專案內的暫存目錄
  const base = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', '.vercel-content');
  const dir = path.join(base, 'haohao-content');
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (const name of CONTENT_FILES) {
      const dst = path.join(dir, name);
      const body = JSON.stringify(bundledContent[name]);
      let same = false;
      try {
        same = fs.readFileSync(dst, 'utf8') === body;
      } catch (_) {
        same = false;
      }
      if (!same) fs.writeFileSync(dst, body, 'utf8');
    }
    _contentDir = dir;
  } catch (err) {
    // 寫不進去不能讓整個 function 掛掉 → 記下來，讓 health 能誠實回報
    _prepareError = String((err && err.message) || err);
    _contentDir = null;
  }
  return _contentDir;
}

/**
 * 必須在任何 require('../deploy/api/*.js') **之前**呼叫一次。
 * 註冊全域並設定 CONTENT_DIR，讓 resolve.js 與 app/lib/data.js 都能找到資源。
 */
function prepare() {
  globalThis.__HAOHAO_BUNDLED_LIB__ = bundledLib;
  const dir = materializedContentDir();
  if (dir) process.env.CONTENT_DIR = dir;
  return { contentDir: dir, error: _prepareError, files: CONTENT_FILES.length };
}

module.exports = { prepare, bundledLib, bundledContent, materializedContentDir };
