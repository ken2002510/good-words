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

/** 可能的來源根目錄（Vercel 上 cwd 是專案根；本機跑也是專案根） */
const ROOTS = [
  path.join(__dirname, '..', '..'), // C:\prodcut  （或 Vercel 專案根）
  path.join(__dirname, '..'),
];

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

/** 找出 app/lib 目錄的真實位置 */
function appLibDir() {
  return firstExisting(ROOTS.map((r) => path.join(r, 'app', 'lib')));
}

/** 找出 content/ 的真實位置 */
function contentDir() {
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
  throw new Error(
    `[deploy] 找不到 lib/${name}.js —— 既不在 app/lib 也沒有本地快照。` +
      ` 請確認 task-1 (T1) 已完成，或補上 deploy/lib/${name}.js 快照。`,
  );
}

/**
 * 載入 content/*.json（UTF-8，容錯大檔）。
 * @param {string} file 例如 'goodwords.json'
 * @returns {object|null}
 */
function loadContent(file) {
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
