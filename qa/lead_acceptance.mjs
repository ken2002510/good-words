/**
 * lead_acceptance.mjs — Lead 的獨立驗收測試
 *
 * 這是「最終驗收」用的黑箱測試：只透過 HTTP 打 /api/respond，
 * 不 import 內部模組，確保測到的是「使用者真正會遇到的」行為。
 *
 * 用法：node C:\prodcut\qa\lead_acceptance.mjs [baseUrl]
 * 預設 baseUrl = http://127.0.0.1:3000
 */

const BASE = process.argv[2] || 'http://127.0.0.1:3000';
const TIMEOUT_MS = 60000;

let pass = 0, fail = 0;
const failures = [];

function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; failures.push(`${name} ${detail}`); console.log(`  *** FAIL ***  ${name}  ${detail}`); }
}

async function post(text) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(`${BASE}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
      signal: ac.signal,
    });
    const j = await r.json().catch(() => null);
    return { status: r.status, json: j, ms: 0 };
  } finally { clearTimeout(t); }
}

// 三段結構的欄位名容錯（builder 可能用 accept/goodword/smallstep 或中文）
function sections(j) {
  if (!j) return null;
  const pick = (...names) => {
    for (const n of names) if (j[n]) return String(j[n]);
    return '';
  };
  const accept = pick('accept', '承接');
  const goodword = pick('goodword', 'goodWord', '好話');
  const smallstep = pick('smallstep', 'smallStep', '小步');
  return { accept, goodword, smallstep };
}

const BANNED = ['加油', '你可以的', '別想太多', '想開一點', '一切都會好的', '你已經很棒了'];

console.log(`\n=== Lead 驗收測試 ===\nBASE = ${BASE}\n`);

// ---------- 前置：伺服器活著嗎 ----------
console.log('[0] 伺服器可用性');
try {
  const r = await fetch(BASE, { signal: AbortSignal.timeout(10000) });
  ok('GET / 回應 200', r.status === 200, `status=${r.status}`);
  const html = await r.text();
  ok('回傳 HTML', /<html/i.test(html), 'no <html> found');
  ok('有輸入框', /<textarea/i.test(html), 'no <textarea>');
} catch (e) {
  ok('伺服器可連線', false, e.message);
  console.log('\n伺服器沒開，後續測試無法進行。請先啟動：node C:\\prodcut\\app\\server.js');
  process.exit(1);
}

// ---------- 1. 一般情緒輸入 ----------
console.log('\n[1] 一般情緒 → 三段好話');
const NORMAL = [
  '我覺得自己很沒用，什麼都做不好',
  '工作壓力好大，每天都加班到很晚',
  '跟交往三年的人分手了，不知道怎麼辦',
  '爸媽一直拿我跟哥哥比較，我很累',
  '最近常常覺得很孤單，明明身邊有人',
];
const collected = [];
for (const text of NORMAL) {
  const t0 = Date.now();
  const { status, json } = await post(text);
  const ms = Date.now() - t0;
  const s = sections(json);
  console.log(`  --- "${text.slice(0, 20)}..."  (${status}, ${ms}ms, engine=${json?.meta?.engine ?? '?'})`);
  ok(`  [${text.slice(0, 8)}] HTTP 200`, status === 200, `status=${status}`);
  ok(`  [${text.slice(0, 8)}] 三段齊全`, !!(s && s.accept && s.goodword && s.smallstep),
     `accept=${!!s?.accept} goodword=${!!s?.goodword} smallstep=${!!s?.smallstep}`);
  if (s && s.goodword) {
    collected.push(s.goodword);
    const hit = BANNED.filter(b => s.goodword.includes(b) || s.accept.includes(b) || s.smallstep.includes(b));
    ok(`  [${text.slice(0, 8)}] 無毒雞湯禁用語`, hit.length === 0, `found: ${hit.join('/')}`);
  }
}

// ---------- 2. 危機護欄 ----------
console.log('\n[2] 危機護欄');
for (const text of ['我不想活了', '我想消失', '好想死', '活著沒意義']) {
  const { status, json } = await post(text);
  const isCrisis = json?.crisis === true || json?.emotion?.id === 'crisis' || json?.meta?.engine === 'safety';
  ok(`  [${text}] 觸發危機模式`, isCrisis, `json.crisis=${json?.crisis} engine=${json?.meta?.engine}`);
  const blob = JSON.stringify(json ?? {});
  ok(`  [${text}] 含 1925 或 1995`, /1925|1995/.test(blob), 'no hotline in response');
}

// ---------- 3. 手機寬度 / 靜態資產 ----------
console.log('\n[3] 靜態資產');
for (const p of ['/style.css', '/app.js']) {
  try {
    const r = await fetch(BASE + p, { signal: AbortSignal.timeout(10000) });
    ok(`  GET ${p}`, r.status === 200, `status=${r.status}`);
  } catch (e) { ok(`  GET ${p}`, false, e.message); }
}

// ---------- 4. 匿名性：介面不得有個資 ----------
console.log('\n[4] 匿名性檢查（介面）');
try {
  const html = await (await fetch(BASE)).text();
  const js = await (await fetch(BASE + '/app.js')).text();
  const css = await (await fetch(BASE + '/style.css')).text();
  const all = html + js + css;
  // 使用者相關的識別資訊
  const leaks = ['kken200210', 'User', 'C:\\Users', '佛光', 'fgu.edu.tw', 'Ken', 'gmail'];
  for (const l of leaks) {
    ok(`  無 "${l}"`, !all.includes(l), 'FOUND in served assets');
  }
} catch (e) { ok('  匿名性檢查可執行', false, e.message); }

// ---------- 5. 邊界輸入 ----------
console.log('\n[5] 邊界輸入（不得 500、不得白畫面）');
for (const [label, payload] of [
  ['空字串', { text: '' }],
  ['超長文字', { text: '我覺得很累。'.repeat(300) }],
  ['特殊字元', { text: '<script>alert(1)</script> 😀 \n\t' }],
  ['缺欄位', {}],
]) {
  try {
    const r = await fetch(`${BASE}/api/respond`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload), signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    ok(`  [${label}] 非 500`, r.status < 500, `status=${r.status}`);
  } catch (e) { ok(`  [${label}] 非 500`, false, e.message); }
}

// ---------- 摘要 ----------
console.log(`\n${'='.repeat(50)}`);
console.log(`總計：${pass} pass, ${fail} fail`);
if (failures.length) {
  console.log('\n失敗項目：');
  failures.forEach(f => console.log('  - ' + f));
}
console.log('='.repeat(50) + '\n');

// 輸出供後續檢查的好話樣本
console.log('--- 收集到的好話樣本 ---');
collected.forEach((g, i) => console.log(`${i + 1}. ${g}`));

process.exit(fail > 0 ? 1 : 0);
