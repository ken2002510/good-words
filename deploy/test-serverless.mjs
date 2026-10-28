/**
 * test-serverless.mjs — 在**本機**模擬 Vercel serverless 環境測試 api/respond.js
 *
 * 為什麼要有這支：
 *   部署後才發現錯，代價是「來回一次 Vercel build + 無法 debug」。
 *   這支模擬 Vercel 的 req/res 形狀，把 deploy/api/respond.js 當成 handler 直接呼叫，
 *   在 push 之前就把 API 契約、危機護欄、降級路徑全部驗過一遍。
 *
 * 用法：
 *   node deploy/test-serverless.mjs
 *   node deploy/test-serverless.mjs --ollama-down    # 模擬雲端環境（強制規則軌）
 *
 * 退出碼：0 = 全過，1 = 有測試失敗（可直接接進 CI）
 */

import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

// ── 模擬 Vercel 環境 ──
// Vercel 上 cwd 是專案根；本機測試時把 cwd 設到 C:\prodcut 以符合 resolve.js 的假設
process.chdir(path.join(__dirname, '..'));
if (process.argv.includes('--ollama-down')) {
  process.env.DEPLOY_AI_ENGINE = 'rules';
  // 就算有人手殘去連，也連不到（模擬雲端）
  process.env.OLLAMA_URL = 'http://127.0.0.1:1';
  delete process.env.CLOUD_LLM_API_KEY;
  delete process.env.OPENAI_API_KEY;
}

const handler = require('./api/respond.js');

/** 極簡 Vercel-like res */
function makeRes() {
  const res = {
    statusCode: 200,
    headers: {},
    body: undefined,
    setHeader(k, v) { this.headers[k.toLowerCase()] = v; return this; },
    status(c) { this.statusCode = c; return this; },
    json(o) { this.body = o; this.ended = true; return this; },
    end() { this.ended = true; return this; },
  };
  return res;
}

/** 極簡 Vercel-like req（body 已 parse，和 Vercel 預設行為一致） */
function makeReq(method, body) {
  const req = { method, body, headers: { 'content-type': 'application/json' } };
  // 讓 readBody 的 for-await 分支也能運作
  req[Symbol.asyncIterator] = async function* () {};
  return req;
}

async function call(method, body) {
  const req = makeReq(method, body);
  const res = makeRes();
  await handler(req, res);
  return res;
}

// ─────────────────────────────────────────────────────────────
const BANNED = ['加油', '你可以的', '別想太多', '想開一點', '看開一點', '一切都會好的', '要堅強', '不要難過'];

const results = [];
function check(name, cond, detail = '') {
  results.push({ name, ok: !!cond, detail });
  const mark = cond ? 'PASS' : 'FAIL';
  console.log(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}`);
}

console.log('\n=== 1. 基本契約（POST /api/respond）===');
for (const input of [
  '我最近工作壓力好大，每天都做不完',
  '我覺得自己很沒用，什麼都做不好',
  '跟他分手之後，我每天回家都覺得很空',
]) {
  const res = await call('POST', { text: input });
  const ok = res.statusCode === 200
    && res.body && typeof res.body.accept === 'string' && res.body.accept.length > 0
    && typeof res.body.goodword === 'string' && res.body.goodword.length > 0
    && typeof res.body.smallstep === 'string' && res.body.smallstep.length > 0
    && res.body.emotion && res.body.emotion.name;
  check(`三段齊全：${input.slice(0, 12)}…`, ok,
    ok ? `情緒=${res.body.emotion.name} 引擎=${res.body.meta.engine}` : JSON.stringify(res.body).slice(0, 200));

  if (ok) {
    const all = res.body.accept + res.body.goodword + res.body.smallstep;
    const hit = BANNED.filter((w) => all.includes(w));
    check(`  反毒雞湯（無禁語）`, hit.length === 0, hit.length ? `命中：${hit.join('、')}` : '');
  }
}

console.log('\n=== 2. 危機護欄（BRIEF §6，最高優先）===');
for (const c of ['我不想活了', '我想死', '活著沒意義', '我 不 想 活 了', '想自殺']) {
  const res = await call('POST', { text: c });
  const b = res.body;
  const ok = b.crisis === true
    && Array.isArray(b.resources) && b.resources.length >= 3
    && b.resources.some((r) => String(r.tel) === '1925')
    && b.resources.some((r) => String(r.tel) === '1995')
    && b.resources.some((r) => String(r.tel) === '1980');
  check(`危機轉介：${c}`, ok,
    ok ? `資源 ${b.resources.map((r) => r.tel).join('/')}` : JSON.stringify(b).slice(0, 200));
}

console.log('\n=== 3. 邊界與錯誤處理 ===');
{
  const r1 = await call('POST', { text: '' });
  check('空輸入 → 400 且有中文提示', r1.statusCode === 400 && r1.body.error, `HTTP ${r1.statusCode}`);

  const r2 = await call('GET', {});
  check('GET → 405', r2.statusCode === 405, `HTTP ${r2.statusCode}`);

  const r3 = await call('OPTIONS', {});
  check('OPTIONS → 204（CORS preflight）', r3.statusCode === 204, `HTTP ${r3.statusCode}`);

  const r4 = await call('POST', { text: '壓力很大' });
  check('CORS 標頭存在', r4.headers['access-control-allow-origin'] === '*',
    String(r4.headers['access-control-allow-origin']));

  const r5 = await call('POST', { text: '一樣的輸入' });
  const r6 = await call('POST', { text: '一樣的輸入' });
  check('同樣輸入 → 穩定輸出不亂跳（決定性 seed）',
    r5.body.goodword === r6.body.goodword, `${r5.body.goodword?.slice(0, 20)}…`);

  const long = await call('POST', { text: '我'.repeat(10000) });
  check('超長輸入不炸（截斷處理）', long.statusCode === 200, `HTTP ${long.statusCode}`);
}

console.log('\n=== 4. 永不白畫面 ===');
{
  const weird = await call('POST', { text: '😀🎉 亂七八糟 asdf 123 !!!' });
  const ok = weird.statusCode === 200 && weird.body.goodword && weird.body.goodword.length > 0;
  check('無意義輸入仍給出好話', ok, weird.body.emotion?.name || '');
}

// ─────────────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${'='.repeat(56)}`);
console.log(`總計 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
if (failed.length) {
  console.log('\n失敗項目：');
  for (const f of failed) console.log(`  ✗ ${f.name} ${f.detail}`);
}
console.log(`${'='.repeat(56)}\n`);
process.exit(failed.length ? 1 : 0);
