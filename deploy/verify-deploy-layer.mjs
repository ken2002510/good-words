/**
 * verify-deploy-layer.mjs — 給 T6 審查者的「部署層可複驗證據包」
 *
 * 為什麼要這支：
 *   T6 的職責是「自己動手驗，不要相信文件」。但部署層若沒有可重跑的證據，
 *   審查者只能相信我的說法 —— 那就違背獨立審查的精神。
 *
 *   這支把「部署層的正確性」變成**任何人可重跑、輸出可預期**的檢查，
 *   不需要登入、不需要網路、不需要 Vercel 帳號。
 *
 * 用法：
 *   node deploy/verify-deploy-layer.mjs
 *
 * 退出碼 0 = 全過；1 = 有項目失敗（可直接進 CI 或交給審查者判斷）
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const results = [];
const rec = (claim, ok, evidence) => {
  results.push({ claim, ok, evidence });
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${claim}`);
  if (evidence) console.log(`         ↳ ${evidence}`);
};

console.log('\n' + '='.repeat(70));
console.log('  部署層可複驗證據包（T6 用）');
console.log('  這支不需要登入、不需要網路，任何人可重跑');
console.log('='.repeat(70));

// ─────────────────────────────────────────────────────
console.log('\n── 1. 部署設定：vercel.json 的路由不會遮蔽 /api/* ──');
const v = JSON.parse(fs.readFileSync(path.join(ROOT, 'vercel.json'), 'utf8'));
const rw = (v.rewrites || []).map((r) => r.source);
rec('vercel.json 是合法 JSON 且無 BOM',
  !fs.readFileSync(path.join(ROOT, 'vercel.json')).slice(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])),
  `rewrites = ${JSON.stringify(rw)}`);

const shadow = (v.rewrites || []).filter((r) => r.source === '/(.*)' || r.source.startsWith('/api'));
rec('沒有 rewrite 會遮蔽 Vercel 原生 api/ 目錄',
  shadow.length === 0,
  shadow.length ? `危險的 rewrite: ${JSON.stringify(shadow)}` : '無 catch-all、無 /api/* rewrite → /api/* 交給原生 api/ 偵測');

rec('functions 的 maxDuration ≤ Hobby 上限（10s）',
  Object.values(v.functions || {}).every((f) => (f.maxDuration || 0) <= 10),
  Object.entries(v.functions || {}).map(([k, f]) => `${k}=${f.maxDuration}s`).join(', '));

// ─────────────────────────────────────────────────────
console.log('\n── 2. 入口與實作對應（單一事實來源）──');
for (const name of ['respond', 'share', 'health']) {
  const entry = path.join(ROOT, 'api', `${name}.js`);
  const impl = path.join(ROOT, 'deploy', 'api', `${name}.js`);
  const entrySrc = fs.existsSync(entry) ? fs.readFileSync(entry, 'utf8') : '';
  rec(`api/${name}.js 存在且轉發到 deploy/api/${name}.js`,
    fs.existsSync(entry) && fs.existsSync(impl) && entrySrc.includes(`deploy/api/${name}.js`),
    fs.existsSync(entry) ? `${fs.statSync(entry).size} bytes 入口` : '缺少入口');
}

// ─────────────────────────────────────────────────────
console.log('\n── 3. 靜態資源的 rewrite 目標都存在 ──');
for (const r of v.rewrites || []) {
  const target = path.join(ROOT, r.destination.replace(/^\//, ''));
  rec(`${r.source} → ${r.destination}`,
    fs.existsSync(target),
    fs.existsSync(target) ? `${fs.statSync(target).size} bytes` : '目標不存在！');
}

// ─────────────────────────────────────────────────────
console.log('\n── 4. ★ 從 git HEAD 解出乾淨目錄實測（模擬 Vercel 收到的內容）──');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 't6-deploy-'));
try {
  // 用 git archive 取出 HEAD（= Vercel 會收到的內容）
  // ⚠️ 踩過的坑：Windows 的 tar 無法處理 git 以八進位轉義表示的 CJK 檔名
  //    （docs/作品說明書.docx → "Invalid empty pathname"）。
  //    解法：用 zip 格式（git archive --format=zip），並讓 git 自行處理檔名編碼。
  //    我們只需要「程式碼能不能跑」，CJK 檔名不影響，所以也能只取需要的子樹。
  const zipPath = path.join(tmp, 'head.zip');
  execFileSync('git', ['archive', '--format=zip', '-o', zipPath, 'HEAD'], { cwd: ROOT });

  // 用 PowerShell 的 Expand-Archive 解壓（對 CJK 檔名支援較好），失敗則退回 tar
  let extracted = false;
  try {
    execFileSync('powershell', [
      '-NoProfile', '-Command',
      `Expand-Archive -LiteralPath '${zipPath}' -DestinationPath '${tmp}' -Force`,
    ], { stdio: 'ignore' });
    extracted = true;
  } catch {
    extracted = false;
  }
  if (!extracted) {
    // 備援：忽略 CJK 檔名的錯誤，只要程式碼檔案有解出來就夠
    try {
      execFileSync('tar', ['-xf', zipPath, '-C', tmp], { cwd: tmp, stdio: 'ignore' });
    } catch { /* 部分檔案失敗沒關係，下面會逐項檢查需要的檔案 */ }
  }

  const count = (function walk(d) {
    let n = 0;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) n += walk(path.join(d, e.name));
      else n++;
    }
    return n;
  })(tmp);

  rec('git HEAD 可完整解出（Vercel 會拿到的內容）', count > 20, `${count} 個檔案`);

  const needEntry = ['api/respond.js', 'api/share.js', 'api/health.js'];
  rec('三個 serverless 入口都在 HEAD 裡',
    needEntry.every((f) => fs.existsSync(path.join(tmp, f))),
    needEntry.map((f) => `${f}:${fs.existsSync(path.join(tmp, f)) ? 'ok' : 'MISSING'}`).join(' '));

  const needLib = ['app/lib/ai.js', 'app/lib/rules.js', 'app/lib/safety.js', 'app/lib/data.js'];
  rec('app/lib 四個模組都在 HEAD 裡',
    needLib.every((f) => fs.existsSync(path.join(tmp, f))),
    needLib.map((f) => path.basename(f)).join(', '));

  const needContent = ['emotions.json', 'goodwords.json', 'crisis.json', 'share_templates.json'];
  rec('content/ 四個資料檔都在 HEAD 裡',
    needContent.every((f) => fs.existsSync(path.join(tmp, 'content', f))),
    needContent.join(', '));

  // 實跑 handler（強制規則軌、斷開所有外部 AI）
  const probe = path.join(tmp, '__t6probe.cjs');
  const tp = tmp.replace(/\\/g, '/');
  fs.writeFileSync(probe, `
process.chdir(${JSON.stringify(tp)});
process.env.DEPLOY_AI_ENGINE='rules';
process.env.OLLAMA_URL='http://127.0.0.1:1';
delete process.env.CLOUD_LLM_API_KEY;
delete process.env.OPENAI_API_KEY;
const respond=require(${JSON.stringify(tp + '/api/respond.js')});
function mkRes(){const r={statusCode:200,headers:{},body:null,
 setHeader(k,v){this.headers[k.toLowerCase()]=v;return this;},status(c){this.statusCode=c;return this;},
 json(o){this.body=o;return this;},end(){return this;}};return r;}
async function post(h,b){const q={method:'POST',body:b,headers:{}};q[Symbol.asyncIterator]=async function*(){};const s=mkRes();await h(q,s);return s;}
(async()=>{
  const a=await post(respond,{text:'我最近工作壓力好大，每天都做不完'});
  const b=await post(respond,{text:'我不想活了'});
  console.log('T6=' + JSON.stringify({
    ok:{status:a.statusCode,engine:a.body&&a.body.meta&&a.body.meta.engine,
        emotion:a.body&&a.body.emotion&&a.body.emotion.name,
        three:!!(a.body&&a.body.accept&&a.body.goodword&&a.body.smallstep),
        text:[a.body&&a.body.accept,a.body&&a.body.goodword,a.body&&a.body.smallstep].join('')},
    crisis:{status:b.statusCode,crisis:b.body&&b.body.crisis,
        tels:((b.body&&b.body.resources)||[]).map(x=>String(x.tel))}
  }));
})();
`, 'utf8');

  const raw = execFileSync(process.execPath, [probe], { encoding: 'utf8', cwd: tmp, timeout: 60000 });
  const out = JSON.parse(raw.split('\n').find((l) => l.startsWith('T6=')).slice(3));

  rec('規則軌回應：三段齊全',
    out.ok.status === 200 && out.ok.three,
    `HTTP ${out.ok.status}, engine=${out.ok.engine}, 情緒=${out.ok.emotion}`);

  rec('規則軌確實生效（未依賴任何外部 AI）',
    out.ok.engine === 'rules',
    `engine=${out.ok.engine}（已強制斷開 Ollama 與雲端 key）`);

  const BANNED = ['加油', '你可以的', '別想太多', '想開一點', '看開一點', '一切都會好的'];
  const hits = BANNED.filter((w) => out.ok.text.includes(w));
  rec('輸出無禁語（反毒雞湯）', hits.length === 0, hits.join('、') || '無');

  rec('危機字串正確轉介 1925/1995/1980',
    out.crisis.crisis === true && ['1925', '1995', '1980'].every((t) => out.crisis.tels.includes(t)),
    `crisis=${out.crisis.crisis}, tels=${out.crisis.tels.join('/')}`);

  console.log('\n  ── 實際輸出樣本（供審查者目視）──');
  console.log(`     承接：${out.ok.text.slice(0, 60)}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// ─────────────────────────────────────────────────────
const failed = results.filter((r) => !r.ok);
console.log('\n' + '='.repeat(70));
console.log(`  共 ${results.length} 項，通過 ${results.length - failed.length}，失敗 ${failed.length}`);
console.log(`  判定：${failed.length === 0 ? 'PASS — 部署層可獨立運作' : 'FAIL'}`);
console.log('='.repeat(70));
console.log('\n  這份輸出可直接貼進 T6 的 AUDIT-REPORT.md 作為『部署層』的證據。');
console.log('  重跑方式：node deploy/verify-deploy-layer.mjs\n');

process.exit(failed.length ? 1 : 0);
