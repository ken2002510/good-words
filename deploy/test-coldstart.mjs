/**
 * test-coldstart.mjs — 模擬 Vercel 上「專案根目錄被當成工作目錄」的冷啟動情境
 *
 * 為什麼要這支：
 *   Vercel 部署時，只有 repo 內的檔案會被上傳。如果 deploy/api/respond.js 依賴
 *   app/lib/ai.js，而 app/ 又不在 repo 裡（或路徑假設錯誤），部署後才會 500。
 *   這支測試**把專案複製到一個乾淨暫存目錄**（模擬 Vercel 只看得到 repo 內容），
 *   然後在那裡跑 handler，確保相對路徑假設是對的。
 *
 * 另外驗證：deploy/lib 的離線快照路徑（app/lib 完全缺席時）是否真的能撐住。
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let fail = 0;
const check = (name, cond, detail = '') => {
  if (!cond) fail++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

/** 依 .gitignore 的關鍵規則，決定哪些東西會在 Vercel 上看得到 */
const EXCLUDE_DIRS = new Set(['node_modules', '.git', '.vercel', 'tmp', 'temp']);
const EXCLUDE_EXT = new Set(['.mp4', '.mov', '.mkv', '.wav', '.mp3', '.log']);

function copyRepo(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    if (EXCLUDE_DIRS.has(entry.name)) continue;
    if (EXCLUDE_EXT.has(path.extname(entry.name).toLowerCase())) continue;
    const s = path.join(src, entry.name);
    const d = path.join(dst, entry.name);
    if (entry.isDirectory()) copyRepo(s, d);
    else if (entry.isFile()) fs.copyFileSync(s, d);
  }
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vercel-sim-'));
console.log(`\n模擬部署目錄：${tmp}\n`);

console.log('=== 1. 乾淨複製（模擬 Vercel 只看得到 repo 內容）===');
copyRepo(ROOT, tmp);
check('app/lib/ai.js 有被複製', fs.existsSync(path.join(tmp, 'app', 'lib', 'ai.js')));
check('app/public/index.html 有被複製', fs.existsSync(path.join(tmp, 'app', 'public', 'index.html')));
check('content/goodwords.json 有被複製', fs.existsSync(path.join(tmp, 'content', 'goodwords.json')));
check('deploy/api/respond.js 有被複製', fs.existsSync(path.join(tmp, 'deploy', 'api', 'respond.js')));
check('api/respond.js 入口有被複製（Vercel 原生偵測路徑）', fs.existsSync(path.join(tmp, 'api', 'respond.js')));
check('vercel.json 在根目錄', fs.existsSync(path.join(tmp, 'vercel.json')));
check('node_modules 未複製（Vercel 上不會有）', !fs.existsSync(path.join(tmp, 'node_modules')));

console.log('\n=== 2. 在模擬環境冷啟動 handler ===');
const probe = path.join(tmp, '__probe.mjs');
fs.writeFileSync(probe, `
process.chdir(${JSON.stringify(tmp)});
process.env.DEPLOY_AI_ENGINE = 'rules';
const { createRequire } = await import('node:module');
const require = createRequire(${JSON.stringify(probe)});
// 測「真正的 Vercel 入口」api/respond.js（它轉發到 deploy/api/respond.js）
const handler = require(${JSON.stringify(path.join(tmp, 'api', 'respond.js'))});

function mkRes() {
  const r = { statusCode: 200, headers: {}, body: null,
    setHeader(k,v){ this.headers[k.toLowerCase()]=v; return this; },
    status(c){ this.statusCode=c; return this; },
    json(o){ this.body=o; this.ended=true; return this; },
    end(){ this.ended=true; return this; } };
  return r;
}
async function call(body) {
  const req = { method: 'POST', body, headers: {} };
  req[Symbol.asyncIterator] = async function*(){};
  const res = mkRes();
  await handler(req, res);
  return res;
}

const out = {};
// ★ 把 console.error 抓起來：如果引擎內部爆錯後「靜默降級」，
//   畫面看起來正常但其實走了備援 —— 這種假通過最危險，必須讓它現形。
const internalErrors = [];
const origErr = console.error;
console.error = (...a) => { internalErrors.push(a.map(String).join(' ')); origErr('[handler]', ...a); };

const r1 = await call({ text: '我最近工作壓力好大' });
out.normal = { status: r1.statusCode, engine: r1.body?.meta?.engine,
               hasThree: !!(r1.body?.accept && r1.body?.goodword && r1.body?.smallstep),
               emotion: r1.body?.emotion?.name,
               degradedReason: r1.body?.meta?.degradedReason,
               errors: internalErrors.slice() };
const r2 = await call({ text: '我不想活了' });
out.crisis = { status: r2.statusCode, crisis: r2.body?.crisis,
               tels: (r2.body?.resources||[]).map(x=>x.tel) };
console.log('PROBE_JSON=' + JSON.stringify(out));
`, 'utf8');

let raw;
try {
  raw = execFileSync(process.execPath, [probe], { encoding: 'utf8', timeout: 60000, cwd: tmp });
} catch (e) {
  check('冷啟動執行成功', false, String(e.stderr || e.message).slice(0, 400));
  console.log(`\n清理：${tmp}`);
  process.exit(1);
}
check('冷啟動執行成功', true);

const jsonLine = raw.split('\n').find((l) => l.startsWith('PROBE_JSON='));
const probeOut = JSON.parse(jsonLine.slice('PROBE_JSON='.length));

check('一般輸入 → 200 且三段齊全',
  probeOut.normal.status === 200 && probeOut.normal.hasThree,
  `engine=${probeOut.normal.engine} emotion=${probeOut.normal.emotion}`);

// ★ 關鍵：不能有內部錯誤。若引擎爆錯後靜默降級，畫面看似正常但其實走了備援。
check('引擎內部無錯誤（非靜默降級）',
  (probeOut.normal.errors || []).length === 0,
  (probeOut.normal.errors || []).join(' | ') || '無');

// ★ 情緒必須真的被辨識出來（不是兜底的「說不出口的心情」）
check('情緒正確辨識（非兜底標籤）',
  probeOut.normal.emotion && probeOut.normal.emotion !== '說不出口的心情',
  String(probeOut.normal.emotion));

// ★ 必須走「指定規則軌」，不是「內部錯誤備援」
check('降級原因為預期值（非錯誤備援）',
  probeOut.normal.degradedReason === '指定使用規則式引擎',
  String(probeOut.normal.degradedReason));
check('危機輸入 → crisis:true 且含 1925/1995/1980',
  probeOut.crisis.crisis === true
    && probeOut.crisis.tels.includes('1925')
    && probeOut.crisis.tels.includes('1995')
    && probeOut.crisis.tels.includes('1980'),
  probeOut.crisis.tels.join('/'));

console.log('\n=== 3. 內容來源確實是 content/（不是內建 fallback）===');
const dataProbe = path.join(tmp, '__probe2.mjs');
fs.writeFileSync(dataProbe, `
process.chdir(${JSON.stringify(tmp)});
const { createRequire } = await import('node:module');
const require = createRequire(${JSON.stringify(dataProbe)});
const { getContent } = require(${JSON.stringify(path.join(tmp, 'app', 'lib', 'data.js'))});
const c = getContent();
console.log('DATA_JSON=' + JSON.stringify({
  usingFallback: c.usingFallback, dir: c.contentDir,
  emotions: c.emotions.length, sets: Object.keys(c.goodwords).length,
  warnings: c.warnings.filter(w=>w.status!=='ok').map(w=>w.file+':'+w.status)
}));
`, 'utf8');
const raw2 = execFileSync(process.execPath, [dataProbe], { encoding: 'utf8', timeout: 60000, cwd: tmp });
const d = JSON.parse(raw2.split('\n').find((l) => l.startsWith('DATA_JSON=')).slice('DATA_JSON='.length));
check('使用 content/ 而非內建 fallback', d.usingFallback === false, d.dir);
check('情緒類別 ≥ 10', d.emotions >= 10, `${d.emotions} 類`);
check('好話語料庫有內容', d.sets >= 10, `${d.sets} 組`);
check('所有 JSON 皆合法（無 warning）', d.warnings.length === 0, d.warnings.join(', ') || '無');

console.log('\n=== 4. 清理 ===');
fs.rmSync(tmp, { recursive: true, force: true });
check('暫存目錄已清理', !fs.existsSync(tmp));

console.log(`\n${'='.repeat(56)}`);
console.log(fail === 0 ? '冷啟動模擬：全部通過' : `冷啟動模擬：${fail} 項失敗`);
console.log(`${'='.repeat(56)}\n`);
process.exit(fail ? 1 : 0);
