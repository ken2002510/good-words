'use strict';

/**
 * app/api/_bundle.js — Vercel 專用的「靜態可追蹤」載入層
 *
 * 【為什麼需要這個檔案】
 * Vercel 的 serverless 打包器（@vercel/nft）是**靜態分析**：只沿著 require() 的
 * **字面路徑**蒐集要帶上雲端的檔案。任何「執行期才拼出來」的路徑都追不到。
 * `deploy/lib/resolve.js` 正是動態拼路徑（path.join + require / readFileSync），
 * 所以 `app/lib/*.js` 與語料 JSON 不會被自動納入 bundle。
 *
 * 【本檔的關鍵設計】
 *  1. 用**字面路徑** require `app/lib` 四模組 → 打包器一定看得見。
 *  2. 語料改用 `app/lib/content-inline.js`（由 deploy/sync-content-inline.mjs 產生）。
 *     ★ 它位於 **app/ 內部** → 一定在部署範圍內。
 *     之前用 `require('../../content/emotions.json')` 是錯的：
 *     Vercel 的專案根是 app/，content/ 在範圍外，雲端會 MODULE_NOT_FOUND → function 崩潰。
 *     （本機測不出這個問題，因為本機 content/ 就在旁邊 —— 這正是「本機全綠 ≠ 雲端可用」。）
 *
 * 【順序很重要】
 * `app/lib/data.js` 在 module load 當下就鎖定 `CONTENT_DIR`，之後改 env 無效。
 * 所以先設好環境，再 require handler。
 */

const fs = require('fs');
const path = require('path');

/** app/lib 四模組：字面路徑（打包器靜態可見） */
const LIB_SOURCES = {
  ai: '../lib/ai.js',
  data: '../lib/data.js',
  rules: '../lib/rules.js',
  safety: '../lib/safety.js',
};

/** 內嵌語料（字面路徑；位於 app/lib 內，一定在部署範圍） */
const INLINE_CONTENT_PATH = '../lib/content-inline.js';

const CONTENT_FILES = ['emotions.json', 'goodwords.json', 'crisis.json', 'share_templates.json'];

let _state = null;

/**
 * 必須在任何 handler 被 require 之前呼叫一次。
 */
function prepare() {
  if (_state) return _state;

  const errors = [];

  // ── 1. 載入內嵌語料（字面路徑 → 打包器會帶上）──
  let inline = null;
  try {
    // eslint-disable-next-line global-require
    inline = require(INLINE_CONTENT_PATH);
  } catch (err) {
    errors.push(`content-inline 載入失敗: ${(err && err.message) || err}`);
  }

  // ── 2. 把語料實體化成檔案 ──
  //    app/lib/data.js 是用 fs.readFileSync() 讀檔（不是透過 resolve.js），
  //    它需要真實路徑 → 所以把 JSON 寫成實體檔，並用 CONTENT_DIR 指過去。
  //    Vercel 只有 /tmp 可寫。
  let contentDir = null;
  if (inline) {
    const base = process.env.VERCEL ? '/tmp' : path.join(__dirname, '..', '..', '.vercel-content');
    const dir = path.join(base, 'haohao-content');
    try {
      fs.mkdirSync(dir, { recursive: true });
      const map = {
        'emotions.json': inline.emotions,
        'goodwords.json': inline.goodwords,
        'crisis.json': inline.crisis,
        'share_templates.json': inline.shareTemplates,
      };
      for (const name of CONTENT_FILES) {
        if (map[name] === undefined) continue;
        const dst = path.join(dir, name);
        const body = JSON.stringify(map[name]);
        let same = false;
        try {
          same = fs.readFileSync(dst, 'utf8') === body;
        } catch (_) {
          same = false;
        }
        if (!same) fs.writeFileSync(dst, body, 'utf8');
      }
      contentDir = dir;
    } catch (err) {
      errors.push(`content 實體化失敗: ${(err && err.message) || err}`);
    }
  }

  // ── 3. ★ 先設 CONTENT_DIR，再 require data.js（順序不可顛倒）──
  if (contentDir) process.env.CONTENT_DIR = contentDir;

  // ── 4. 以字面路徑 require app/lib（打包器已靜態納入）──
  const bundledLib = {};
  for (const [name, rel] of Object.entries(LIB_SOURCES)) {
    try {
      // eslint-disable-next-line global-require
      bundledLib[name] = require(rel);
    } catch (err) {
      errors.push(`lib/${name} 載入失敗: ${(err && err.message) || err}`);
    }
  }
  globalThis.__HAOHAO_BUNDLED_LIB__ = bundledLib;

  // ── 5. 若 data.js 的內容快取是在 CONTENT_DIR 設定前建立的，強制重讀 ──
  try {
    if (bundledLib.data && typeof bundledLib.data.getContent === 'function') {
      bundledLib.data.getContent({ reload: true });
    }
  } catch (err) {
    errors.push(`data.getContent(reload) 失敗: ${(err && err.message) || err}`);
  }

  _state = {
    contentDir,
    error: errors.length ? errors.join(' | ') : null,
    errors,
    libLoaded: Object.keys(bundledLib),
    inlineLoaded: !!inline,
    contentFiles: CONTENT_FILES.length,
  };
  return _state;
}

/** 讓 health 端點可以回報 bundle 狀態 */
function status() {
  return _state || { prepared: false };
}

module.exports = { prepare, status, CONTENT_FILES, LIB_SOURCES };
