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

for (const api of calledApis) {
  const name = api.replace(/^\/api\//, '').split('/')[0];
  const entry = path.join(ROOT, 'api', `${name}.js`);          // Vercel 原生入口
  const impl = path.join(ROOT, 'deploy', 'api', `${name}.js`); // 單一事實來源
  check(`${api} → api/${name}.js 入口存在`, fs.existsSync(entry), fs.existsSync(entry) ? '' : '缺少入口！');
  check(`  ${api} → deploy/api/${name}.js 實作存在`, fs.existsSync(impl), fs.existsSync(impl) ? '' : '缺少實作！');

  // 入口必須真的轉發到實作（避免入口是空殼）
  if (fs.existsSync(entry)) {
    const src = fs.readFileSync(entry, 'utf8');
    check(`  ${api} 入口有轉發到實作`, src.includes(`deploy/api/${name}.js`));
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
console.log('\n=== 所有 handler 都有 functions 設定 ===');
const apiDir = path.join(ROOT, 'api');
for (const f of fs.readdirSync(apiDir).filter((x) => x.endsWith('.js'))) {
  const key = `api/${f}`;
  check(`${key} 已設定 maxDuration`, !!v.functions[key], v.functions[key] ? `${v.functions[key].maxDuration}s` : '未設定');
}

console.log(`\n${'='.repeat(56)}`);
console.log(fail === 0 ? '路由檢查：全部通過' : `路由檢查：${fail} 項失敗`);
console.log(`${'='.repeat(56)}\n`);
process.exit(fail ? 1 : 0);
