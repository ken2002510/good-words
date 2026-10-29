/**
 * sync-content-inline.mjs — 把 content/ 的語料「內嵌」成 app/ 內的一個模組
 *
 * 【為什麼需要這支】
 * Vercel 認定的專案根目錄是 `app/`（實測證據：/index.html→200 但
 * /app/public/index.html→404、/package.json→404、/content/emotions.json→404）。
 * 在這個前提下，**repo 根的 `content/` 落在部署範圍之外**，
 * 任何 `app/` 內的程式碼都無法用相對路徑可靠地取到它。
 *
 * 之前嘗試 `require('../../content/emotions.json')` 的結果：
 *   在本機（content/ 存在）可行，但在 Vercel 上會 MODULE_NOT_FOUND → function 直接崩潰。
 *
 * 【解法】
 * 把 content/ 的 4 個 JSON 合成一個 **JS 模組**，產出到 `app/lib/content-inline.js`。
 *   · 它在 app/ 內部 → 一定在部署範圍內
 *   · 用 require() 載入 → 不依賴 fs、不依賴路徑推導
 *   · 由本腳本從 content/ 產生 → content/ 仍是唯一事實來源，不會漂移
 *
 * 產出檔**要進 git**（因為 Vercel 不會跑這支腳本）。
 *
 * 用法：
 *   node deploy/sync-content-inline.mjs          # 產生／更新
 *   node deploy/sync-content-inline.mjs --check  # 只檢查是否同步（CI 用，不同步則 exit 1）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CONTENT_DIR = path.join(ROOT, 'content');
const OUT_FILE = path.join(ROOT, 'app', 'lib', 'content-inline.js');

const FILES = ['emotions.json', 'goodwords.json', 'crisis.json', 'share_templates.json'];
const checkOnly = process.argv.includes('--check');

function readJson(file) {
  const p = path.join(CONTENT_DIR, file);
  if (!fs.existsSync(p)) {
    throw new Error(`缺少 content/${file} —— 內容層尚未就緒。`);
  }
  // 剝除 BOM（本專案已踩過的坑）
  const raw = fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

/** 產生穩定的 JS 模組內容 */
function buildModule() {
  const parts = [];
  parts.push("'use strict';");
  parts.push('');
  parts.push('/**');
  parts.push(' * content-inline.js — 自動產生，請勿手動編輯');
  parts.push(' *');
  parts.push(' * 由 deploy/sync-content-inline.mjs 從 content/*.json 產生。');
  parts.push(' *');
  parts.push(' * 為什麼要內嵌而不是讀檔：');
  parts.push(' *   Vercel 的專案根目錄是 app/，repo 根的 content/ 不在部署範圍內，');
  parts.push(' *   用相對路徑 require 會在雲端 MODULE_NOT_FOUND。');
  parts.push(' *   內嵌成 app/ 內的 JS 模組 → 一定進得了 bundle，且不依賴 fs 與路徑推導。');
  parts.push(' *');
  parts.push(' * 要更新內容：改 content/*.json，然後跑');
  parts.push(' *   node deploy/sync-content-inline.mjs');
  parts.push(' */');
  parts.push('');

  const names = {
    'emotions.json': 'emotions',
    'goodwords.json': 'goodwords',
    'crisis.json': 'crisis',
    'share_templates.json': 'shareTemplates',
  };

  parts.push('const CONTENT = {');
  for (const f of FILES) {
    const data = readJson(f);
    const json = JSON.stringify(data, null, 2);
    parts.push(`  // ── ${f} ──`);
    parts.push(`  ${names[f]}: ${json.replace(/\n/g, '\n  ')},`);
  }
  parts.push('};');
  parts.push('');
  parts.push('module.exports = CONTENT;');
  parts.push('');
  return parts.join('\n');
}

const next = buildModule();

if (checkOnly) {
  const cur = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : '';
  if (cur === next) {
    console.log('✅ app/lib/content-inline.js 與 content/ 同步');
    process.exit(0);
  }
  console.error('❌ app/lib/content-inline.js 與 content/ 不同步！');
  console.error('   請執行：node deploy/sync-content-inline.mjs');
  process.exit(1);
}

const prev = fs.existsSync(OUT_FILE) ? fs.readFileSync(OUT_FILE, 'utf8') : null;
if (prev === next) {
  console.log('✅ 已是最新，無需更新。');
} else {
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, next, 'utf8'); // UTF-8 無 BOM
  console.log(`✅ 已產生 ${path.relative(ROOT, OUT_FILE)}（${next.length} bytes）`);
}

// 驗證產出檔可被正確載入（本檔是 ESM，用 createRequire）
const { createRequire } = await import('node:module');
const loaded = createRequire(import.meta.url)(OUT_FILE);
const counts = {
  emotions: Array.isArray(loaded.emotions) ? loaded.emotions.length : Object.keys(loaded.emotions || {}).length,
  goodwordSets: Object.keys(loaded.goodwords || {}).length,
  crisis: loaded.crisis ? 'ok' : 'missing',
  shareTemplates: loaded.shareTemplates ? 'ok' : 'missing',
};
console.log('   驗證載入：', JSON.stringify(counts));
