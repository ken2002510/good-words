'use strict';

/**
 * resolve.js — 部署版的「共用來源解析器」
 *
 * 為什麼需要這一層：
 *   T1（builder）擁有 C:\prodcut\app\lib\*。deployer 的寫入範圍**不得**改 app/。
 *   但 Vercel 打包時只能看到專案根目錄底下的檔案（app/ 與 content/ 都在根目錄內，
 *   所以**不需要複製**，直接 require 相對路徑即可）。
 *
 *   關鍵設計：部署版**優先載入 app/lib 的原始檔**（單一事實來源，builder 修一次兩邊都對），
 *   只有在該檔不存在時，才退回 deploy/lib 內的離線快照（snapshot）。
 *
 *   這樣做同時滿足兩個約束：
 *     1. 不重複實作規則（避免兩份規則漂移）
 *     2. repo 單獨 clone 也能跑（不依賴 app/ 一定存在）
 */

const fs = require('fs');
const path = require('path');

/**
 * 可能的來源根目錄（依可能性排序）
 *
 * 雲端的實況：Vercel 專案根 = `app/`，所以 `deploy/lib/resolve.js` 會位在
 * `/var/task/deploy/lib`，而 app/lib 實際在 `/var/task/lib`（不是 `/var/task/app/lib`）。
 * 因此候選清單必須同時涵蓋「repo 根佈局」與「app/ 為根的佈局」。
 */
const ROOTS = [
  path.join(__dirname, '..', '..'), // repo 根：      C:\prodcut  /  /var/task
  path.join(__dirname, '..', '..', 'app'), // app/ 為根： /var/task/app
  path.join(__dirname, '..'), // deploy/
];

/** app/lib 的可能位置（依可能性排序） */
const APP_LIB_CANDIDATES = [
  path.join(__dirname, '..', '..', 'app', 'lib'), // repo 根佈局： <root>/app/lib
  path.join(__dirname, '..', '..', 'lib'), // app/ 為專案根：<root>/lib
  path.join(__dirname, '..', '..', '..', 'app', 'lib'), // 保險：再往上一層
];

/** 目前解析到的 app/lib（供 inlineContent 使用） */
let ROOT_APP_LIB = APP_LIB_CANDIDATES[0];

function firstExisting(candidates) {
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) return c;
    } catch (_) {
      /* ignore */
    }
  }
  return null;
}

/**
 * 找出 app/lib 目錄的真實位置。
 * 找到後會更新 ROOT_APP_LIB，讓 inlineContent() 用同一個位置。
 */
function appLibDir() {
  const found = firstExisting(APP_LIB_CANDIDATES);
  if (found) ROOT_APP_LIB = found;
  return found;
}

/**
 * 找出 content/ 的真實位置。
 * 順序：環境變數（api/_bundle.js 在 Vercel 上會設）→ 專案根的 content/ → 本地 deploy/content。
 */
function contentDir() {
  const env = process.env.CONTENT_DIR;
  if (env && fs.existsSync(env)) return env;
  return firstExisting(
    ROOTS.map((r) => path.join(r, 'content')).concat([path.join(__dirname, '..', 'content')]),
  );
}

/**
 * 載入一個 app/lib 的模組。
 * @param {string} name 例如 'rules' / 'safety'
 * @param {string} fallback 本地快照檔名（可省略）
 */
function loadLib(name) {
  const dir = appLibDir();
  if (dir) {
    const p = path.join(dir, name + '.js');
    if (fs.existsSync(p)) {
      return { mod: require(p), source: p, snapshot: false };
    }
  }
  const snap = path.join(__dirname, name + '.js');
  if (fs.existsSync(snap)) {
    return { mod: require(snap), source: snap, snapshot: true };
  }
  // ★ Vercel 專用最後一線：靜態 require map。
  //   雲端打包器（@vercel/nft）追不到上面的動態 path.join+require，
  //   所以 api/_bundle.js 用「字面路徑」把 app/lib 全部 require 進來並註冊在此。
  //   本機執行時這條不會被用到（上面的 fs.existsSync 就會命中）。
  const bundled = globalThis.__HAOHAO_BUNDLED_LIB__;
  if (bundled && bundled[name]) {
    return { mod: bundled[name], source: 'bundled', snapshot: false };
  }
  throw new Error(
    `[deploy] 找不到 lib/${name}.js —— 既不在 app/lib 也沒有本地快照。` +
      ` 請確認 task-1 (T1) 已完成，或補上 deploy/lib/${name}.js 快照。`,
  );
}

/**
 * ★ 內嵌語料（雲端最可靠的路徑）
 *
 * 為什麼需要：Vercel 的專案根目錄是 `app/`（實測：/index.html→200 但
 * /app/public/index.html→404、/package.json→404），所以 **repo 根的 content/
 * 落在部署範圍之外** —— 從 app/ 內部用相對路徑 require 會在雲端 MODULE_NOT_FOUND。
 *
 * `app/lib/content-inline.js` 由 deploy/sync-content-inline.mjs 從 content/ 產生，
 * 位於 app/ 內部 → 一定進得了 bundle，且不需要 fs 或路徑推導。
 *
 * 優先順序：內嵌 > 實體檔案。這樣本機與雲端行為一致，且雲端不會因缺檔而崩潰。
 */
let _inlineCache;
let _inlineTried = false;
function inlineContent() {
  if (_inlineTried) return _inlineCache;
  _inlineTried = true;
  try {
    // 自己解析（不依賴 appLibDir 是否已被呼叫過）
    appLibDir();
    const p = path.join(ROOT_APP_LIB, 'content-inline.js');
    if (fs.existsSync(p)) _inlineCache = require(p);
  } catch (_) {
    /* 內嵌檔不存在或壞掉 → 退回檔案讀取 */
  }
  return _inlineCache || null;
}

/** content/ 四個 JSON 檔名 → 內嵌模組的鍵名 */
const INLINE_KEY = {
  'emotions.json': 'emotions',
  'goodwords.json': 'goodwords',
  'crisis.json': 'crisis',
  'share_templates.json': 'shareTemplates',
};

/**
 * 載入 content/*.json（UTF-8，容錯大檔）。
 * 內嵌語料優先；找不到才讀實體檔案（本機開發用）。
 * @param {string} file 例如 'goodwords.json'
 * @returns {object|null}
 */
function loadContent(file) {
  // ① 內嵌（雲端最可靠）
  const key = INLINE_KEY[file];
  if (key) {
    const inl = inlineContent();
    if (inl && inl[key] !== undefined) return inl[key];
  }

  // ② 實體檔案（本機／或 content/ 真的有進部署時）
  const dir = contentDir();
  if (!dir) return null;
  const p = path.join(dir, file);
  try {
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch (err) {
    console.error(`[deploy] 讀取 content/${file} 失敗:`, err.message);
    return null;
  }
}

module.exports = { appLibDir, contentDir, loadLib, loadContent, firstExisting, ROOTS };
