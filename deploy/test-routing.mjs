/**
 * test-routing.mjs — 驗證 vercel.json 的路由/設定與前端實際需求是否一致
 *
 * 這支檢查的是「部署後才會爆、但本機就能先抓」的三類錯：
 *   1. 前端呼叫的每一條 /api/* 是否都有 rewrite + handler 檔
 *   2. 前端引用的每一個靜態檔是否都存在且被 rewrite 指到
 *   3. vercel.json 本身是否符合 schema 基本要求（JSON 合法、無重複 source）
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let fail = 0;
const check = (name, cond, detail = '') => {
  if (!cond) fail++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

// ── 讀 vercel.json ──
const vjsonRaw = fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8');
let v;
try {
  v = JSON.parse(vjsonRaw);
  check('vercel.json 是合法 JSON', true);
} catch (e) {
  check('vercel.json 是合法 JSON', false, e.message);
  process.exit(1);
}

// 檢查 UTF-8 BOM（本專案已踩過的坑）
check('vercel.json 無 UTF-8 BOM', !vjsonRaw.startsWith('\uFEFF'));

const rewrites = v.rewrites || [];
const sources = rewrites.map((r) => r.source);
check('rewrite source 無重複', new Set(sources).size === sources.length);

// ── 1. 前端呼叫的 API 是否都有 handler ──
//    ★ 設計決策：API 走 Vercel **原生** root api/ 目錄，不用 rewrite。
//      理由：rewrite 指向非 api/ 目錄的 .js 能否被當成 function，文件不明確；
//      root api/ 是 Vercel 零設定 100% 保證會偵測的位置，風險為零。
//      以下同時檢查「轉發入口存在」與「實際實作存在」。
console.log('\n=== 前端 API 呼叫 vs 實際 handler ===');
const appJs = fs.readFileSync(path.join(ROOT, 'app', 'public', 'app.js'), 'utf8');
const calledApis = [...new Set([...appJs.matchAll(/['"`](\/api\/[a-zA-Z0-9_\/-]+)['"`]/g)].map((m) => m[1]))];

/**
 * ★ 為什麼要有「兩套入口」
 *
 * 線上實測（2026-10-29）顯示 Vercel 認定的專案根目錄是 `app/`，不是 repo 根：
 *     GET /index.html              → 200
 *     GET /app/public/index.html   → 404   ← 若服務 repo 根，這應該 200
 *     GET /package.json            → 404
 *     GET /content/emotions.json   → 404
 * 在該前提下，放在 **repo 根** 的 `api/` 完全落在 Vercel 專案範圍之外 →
 * `/api/*` 全部 404。
 *
 * 因此我們在兩個可能的位置**都**放入口，讓 api/ 一定落在 Vercel 的視野內，
 * 不依賴任何偵測邏輯，也不需要使用者進後台改 Root Directory。
 * 兩邊都只是轉發，實作仍只有一份（deploy/api/）。
 */
for (const api of calledApis) {
  const name = api.replace(/^\/api\//, '').split('/')[0];
  const entries = [
    { label: 'api/', file: path.join(ROOT, 'api', `${name}.js`), implRel: 'deploy/api/' },
    { label: 'app/api/', file: path.join(ROOT, 'app', 'api', `${name}.js`), implRel: '../../deploy/api/' },
  ];
  const impl = path.join(ROOT, 'deploy', 'api', `${name}.js`); // 單一事實來源

  check(`  ${api} → deploy/api/${name}.js 實作存在`, fs.existsSync(impl), fs.existsSync(impl) ? '' : '缺少實作！');

  for (const e of entries) {
    check(`${api} → ${e.label}${name}.js 入口存在`, fs.existsSync(e.file),
      fs.existsSync(e.file) ? '' : '缺少入口！');
    if (fs.existsSync(e.file)) {
      const src = fs.readFileSync(e.file, 'utf8');
      check(`  ${e.label} 入口轉發到實作`, src.includes(`${e.implRel}${name}.js`));
    }
  }

  // 不該有 /api/* 的 rewrite（API 走原生 api/ 目錄，這條風險路徑要完全避開）
  // 注意：/app.js 這種「靜態資產 rewrite」是合法的，不算違規，所以只檢查 /api/ 開頭。
  check(`  ${api} 未依賴 rewrite 派發`, !rewrites.some((r) => r.source?.startsWith('/api')));
}

// ── 2. 前端引用的靜態檔 ──
console.log('\n=== 前端靜態資源 vs vercel.json ===');
const html = fs.readFileSync(path.join(ROOT, 'app', 'public', 'index.html'), 'utf8');
const assets = [...new Set([
  ...[...html.matchAll(/(?:src|href)="(\/[^"#?]+)"/g)].map((m) => m[1]),
])];

for (const a of assets) {
  const rw = rewrites.find((r) => r.source === a);
  const disk = path.join(ROOT, 'app', 'public', a.replace(/^\//, ''));
  check(`${a} 磁碟上存在`, fs.existsSync(disk), fs.existsSync(disk) ? '' : '檔案不存在！');
  check(`  ${a} 有 rewrite（非 /api）`, !!rw || a.startsWith('/api'), rw ? `→ ${rw.destination}` : '無 rewrite');
}

// ── 3. 首頁 ──
console.log('\n=== 首頁 ===');
const rootRw = rewrites.find((r) => r.source === '/');
check('/ 有 rewrite', !!rootRw, rootRw ? `→ ${rootRw.destination}` : '');
check('/app.js 有 rewrite（前端用絕對路徑）', !!rewrites.find((r) => r.source === '/app.js'));
check('/style.css 有 rewrite（前端用絕對路徑）', !!rewrites.find((r) => r.source === '/style.css'));

// ── 4. functions 設定 vs 實際檔案 ──
console.log('\n=== functions 設定 ===');
for (const fpath of Object.keys(v.functions || {})) {
  check(`functions["${fpath}"] 檔案存在`, fs.existsSync(path.join(ROOT, fpath)), fpath);
  const md = v.functions[fpath].maxDuration;
  check(`  maxDuration (${md}s) ≤ Hobby 上限 10s`, md <= 10, `${md}s`);
}

// ── 5. 每個 handler 都必須有 functions 設定（避免用預設慢設定）──
//    ★ 兩套入口（repo 根 api/ 與 app/api/）都要有，因為不知道 Vercel 會用哪個當專案根。
console.log('\n=== 所有 handler 都有 functions 設定 ===');
for (const dir of ['api', path.join('app', 'api')]) {
  const full = path.join(ROOT, dir);
  if (!fs.existsSync(full)) continue;
  for (const f of fs.readdirSync(full).filter((x) => x.endsWith('.js') && !x.startsWith('_'))) {
    const key = `${dir.replace(/\\/g, '/')}/${f}`;
    check(`${key} 已設定 maxDuration`, !!v.functions[key],
      v.functions[key] ? `${v.functions[key].maxDuration}s` : '未設定');
  }
}

// ── 6. content-inline 同步檢查（雲端語料的唯一可靠來源）──
console.log('\n=== content-inline 同步 ===');
const inlinePath = path.join(ROOT, 'app', 'lib', 'content-inline.js');
check('app/lib/content-inline.js 存在（雲端語料來源）', fs.existsSync(inlinePath),
  fs.existsSync(inlinePath) ? `${fs.statSync(inlinePath).size} bytes` : '缺少！雲端會拿不到語料');
if (fs.existsSync(inlinePath)) {
  const { createRequire } = await import('node:module');
  const inl = createRequire(import.meta.url)(inlinePath);
  check('  內嵌語料含 4 個檔案',
    !!inl.emotions && !!inl.goodwords && !!inl.crisis && !!inl.shareTemplates,
    `emotions=${Array.isArray(inl.emotions) ? inl.emotions.length : '?'} sets=${Object.keys(inl.goodwords || {}).length}`);
  // 與 content/ 是否同步
  try {
    const emotionsDisk = JSON.parse(fs.readFileSync(path.join(ROOT, 'content', 'emotions.json'), 'utf8').replace(/^\uFEFF/, ''));
    check('  內嵌語料與 content/ 同步',
      JSON.stringify(inl.emotions) === JSON.stringify(emotionsDisk),
      '若不同步請跑 node deploy/sync-content-inline.mjs');
  } catch (e) {
    check('  可讀取 content/emotions.json 以比對', false, String(e.message));
  }
}

console.log(`\n${'='.repeat(56)}`);
console.log(fail === 0 ? '路由檢查：全部通過' : `路由檢查：${fail} 項失敗`);
console.log(`${'='.repeat(56)}\n`);
process.exit(fail ? 1 : 0);
