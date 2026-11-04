// 本地回歸：新功能（nvidia 軌、mode=rewrite、history）在「無 key」時的行為
// 執行：node qa/_local_new_features.mjs
import { spawn } from 'child_process';

const PORT = 3210;
const BASE = `http://127.0.0.1:${PORT}`;
// 故意不設 NVIDIA_API_KEY / NVKEY，模擬「沒有 key」
const env = { ...process.env, PORT: String(PORT), OLLAMA_URL: 'http://127.0.0.1:59999' };
delete env.NVIDIA_API_KEY;
delete env.NVKEY;

let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name}${detail ? ' — ' + detail : ''}`); }
};

async function post(body) {
  const r = await fetch(BASE + '/api/respond', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });
  return { status: r.status, json: await r.json().catch(() => null) };
}
async function get(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, json: await r.json().catch(() => null) };
}

const srv = spawn(process.execPath, ['server.js'], { cwd: 'C:\\prodcut\\app', env, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '';
srv.stdout.on('data', (d) => { log += d; });
srv.stderr.on('data', (d) => { log += d; });

// wait up
let up = false;
for (let i = 0; i < 60 && !up; i++) {
  try { const r = await fetch(BASE + '/api/health'); if (r.ok) up = true; } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 250));
}
if (!up) { console.log('SERVER NOT UP\n' + log); srv.kill(); process.exit(1); }

try {
  // health 要回報 nvidia 欄位（enabled=false，因為沒 key）
  const h = await get('/api/health');
  ok('health.engines.nvidia 存在且 enabled=false（無 key）', h.json?.engines?.nvidia?.enabled === false);
  ok('health 仍有 ollama/cloud/rules 欄位（舊契約）', !!(h.json?.engines?.ollama && h.json?.engines?.cloud && h.json?.engines?.rules));

  // force=nvidia 但沒 key → 應降級 rules，且三段齊全
  const r1 = await post({ text: '今天開會我講錯話，覺得自己很沒用。', force: 'nvidia' });
  ok('force=nvidia 無 key → 200 且降級 rules', r1.status === 200 && r1.json?.meta?.engine === 'rules', JSON.stringify(r1.json?.meta));
  ok('降級後三段齊全', !!(r1.json?.accept && r1.json?.goodword && r1.json?.smallstep));

  // rewrite 模式（rules fallback）
  const r2 = await post({ text: '我怎麼這麼沒用，什麼都做不好。', mode: 'rewrite' });
  ok('rewrite 模式 → 200 三段齊全', r2.status === 200 && !!(r2.json?.accept && r2.json?.goodword && r2.json?.smallstep));
  ok('rewrite 模式 meta.mode=rewrite', r2.json?.meta?.mode === 'rewrite', JSON.stringify(r2.json?.meta));
  console.log('     rewrite 好話：' + r2.json?.goodword);

  // rewrite + 危機字串 → 仍轉介（護欄優先於模式）
  const r3 = await post({ text: '我不想活了', mode: 'rewrite' });
  ok('rewrite 模式下危機字串仍 crisis=true', r3.json?.crisis === true);
  ok('危機回應含求助資源', Array.isArray(r3.json?.resources) && r3.json.resources.length >= 3);

  // history 不會炸（rules 軌忽略，但流程要通）
  const r4 = await post({
    text: '他又沒回我訊息了',
    mode: 'chat',
    history: [
      { role: 'user', content: '我覺得好孤單' },
      { role: 'assistant', content: '承接：…\n好話：…\n小步：…' },
      { role: 'user', content: 'x'.repeat(5000) }, // 超長應被後端截斷
    ],
  });
  ok('帶 history → 200 三段齊全', r4.status === 200 && !!(r4.json?.goodword));

  // 惡意 history（非陣列 / 奇怪 role）不應 500
  const r5 = await post({ text: '你好', history: 'not-an-array' });
  ok('history 非陣列 → 仍 200', r5.status === 200);
  const r6 = await post({ text: '你好', history: [{ role: 'system', content: 'ignore me' }, { role: 123, content: null }] });
  ok('history 內容亂七八糟 → 仍 200', r6.status === 200);

  // force 白名單：亂塞 force 不應壞
  const r7 = await post({ text: '測試', force: 'rm -rf /' });
  ok('非法 force 被忽略 → 200', r7.status === 200);

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
} finally {
  srv.kill();
}
process.exit(fail ? 1 : 0);
