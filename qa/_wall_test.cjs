// _wall_test.cjs — 好話牆端到端測試（mock Vercel KV + 本機 server）
// 不需要任何真實 key：KV 用本機 mock，AI 走 rules 軌（無 NVIDIA key 時）
const http = require('http');
const { spawn } = require('child_process');

// ── mock Vercel KV（Upstash REST 風格：POST body = JSON command array）──
function makeMockKV() {
  const store = new Map(); // key -> {type:'str'|'list'|'hash', val}
  return http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      let out = { result: null };
      try {
        const cmd = JSON.parse(body || '[]');
        const op = String(cmd[0] || '').toUpperCase();
        const k = cmd[1];
        if (op === 'SET') { store.set(k, { type: 'str', val: cmd[2] }); out.result = 'OK'; }
        else if (op === 'GET') { const e = store.get(k); out.result = e && e.type === 'str' ? e.val : null; }
        else if (op === 'INCR') { const e = store.get(k); const n = (e && e.type === 'num' ? e.val : 0) + 1; store.set(k, { type: 'num', val: n }); out.result = n; }
        else if (op === 'EXPIRE') { out.result = 1; }
        else if (op === 'LPUSH') { let e = store.get(k); if (!e || e.type !== 'list') e = { type: 'list', val: [] }; e.val.unshift(cmd[2]); store.set(k, e); out.result = e.val.length; }
        else if (op === 'LTRIM') { const e = store.get(k); if (e && e.type === 'list') e.val = e.val.slice(Number(cmd[2]), Number(cmd[3]) + 1); out.result = 'OK'; }
        else if (op === 'LRANGE') { const e = store.get(k); const a = Number(cmd[2]), b = Number(cmd[3]); out.result = e && e.type === 'list' ? e.val.slice(a, b + 1) : []; }
        else if (op === 'MGET') { out.result = cmd.slice(1).map((kk) => { const e = store.get(kk); return e && e.type === 'str' ? e.val : null; }); }
        else if (op === 'HINCRBY') { let e = store.get(k); if (!e || e.type !== 'hash') e = { type: 'hash', val: {} }; e.val[cmd[2]] = (e.val[cmd[2]] || 0) + Number(cmd[3]); store.set(k, e); out.result = e.val[cmd[2]]; }
        else if (op === 'HGETALL') { const e = store.get(k); const flat = []; if (e && e.type === 'hash') for (const [f, v] of Object.entries(e.val)) flat.push(f, String(v)); out.result = flat; }
        else out = { error: 'unsupported ' + op };
      } catch (e) { out = { error: e.message }; }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(out));
    });
  });
}

const NODE = process.execPath;
const APP = 'C:\\prodcut\\app\\server.js';

async function waitUp(url) {
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(url); if (r.ok) return; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error('server did not start: ' + url);
}

(async () => {
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };

  // mock KV on 59997
  const kv = makeMockKV();
  await new Promise((r) => kv.listen(59997, '127.0.0.1', r));

  // 主測試伺服器：有 KV（牆啟用）、無 NVIDIA key（AI 走 rules）
  const env1 = {
    ...process.env,
    PORT: '3212',
    OLLAMA_URL: 'http://127.0.0.1:59999',
    KV_REST_API_URL: 'http://127.0.0.1:59997',
    KV_REST_API_TOKEN: 'test-token',
  };
  delete env1.NVIDIA_API_KEY; delete env1.NVKEY;
  const s1 = spawn(NODE, [APP], { env: env1, stdio: ['ignore', 'ignore', 'pipe'] });
  s1.stderr.on('data', (d) => process.stderr.write('[srv] ' + d));
  await waitUp('http://127.0.0.1:3212/api/health');
  const B = 'http://127.0.0.1:3212';

  // 本機-only 伺服器：無 KV（牆降級）
  const env2 = { ...process.env, PORT: '3213', OLLAMA_URL: 'http://127.0.0.1:59999' };
  delete env2.NVIDIA_API_KEY; delete env2.NVKEY; delete env2.KV_REST_API_URL; delete env2.KV_REST_API_TOKEN;
  const s2 = spawn(NODE, [APP], { env: env2, stdio: ['ignore', 'ignore', 'pipe'] });
  await waitUp('http://127.0.0.1:3213/api/health');
  const B2 = 'http://127.0.0.1:3213';

  const post = (base, path, body) => fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, j: await r.json() }));
  const get = (base, path) => fetch(base + path).then(async (r) => ({ status: r.status, j: await r.json() }));

  // ── health 报牆狀態 ──
  let h = await get(B, '/api/health');
  ok('health.wall.enabled=true（有 KV）', h.j.engines && h.j.engines.wall && h.j.engines.wall.enabled === true, JSON.stringify(h.j.engines && h.j.engines.wall));
  h = await get(B2, '/api/health');
  ok('health.wall.enabled=false（無 KV 也不炸）', h.j.engines && h.j.engines.wall && h.j.engines.wall.enabled === false);

  // ── 空牆 ──
  let w = await get(B, '/api/wall');
  ok('GET /api/wall → wallEnabled, items=[]', w.j.wallEnabled === true && Array.isArray(w.j.items) && w.j.items.length === 0, JSON.stringify(w.j).slice(0, 120));

  // ── 發一篇具體貼文（應拿高分）──
  const post1 = await post(B, '/api/wall', {
    anon: 'test-anon-1234abcd',
    text: '昨天下午 3 點開會，主管當眾罵我「做事沒腦」，我回家一直哭，覺得自己很沒用。',
    ai: { accept: '被當眾罵一定很難受。', goodword: '罵的是那件事，不是你整個人。', smallstep: '今晚洗個熱水澡。', engine: 'rules', model: null },
  });
  ok('POST /api/wall 具體貼文 → ok 且分數高（>15）', post1.status === 200 && post1.j.ok && post1.j.points > 15, JSON.stringify({ s: post1.status, pts: post1.j.points, why: post1.j.scoreWhy }));
  ok('回傳 item 有 AI 三段', post1.j.item && post1.j.item.goodword && post1.j.item.accept && post1.j.item.smallstep);
  const itemId = post1.j.item && post1.j.item.id;

  // ── 牆上出現 ──
  w = await get(B, '/api/wall');
  ok('牆上有 1 篇', w.j.items.length === 1 && w.j.items[0].id === itemId);

  // ── 危機貼文：不進牆，回轉介 ──
  const cr = await post(B, '/api/wall', { anon: 'test-anon-1234abcd', text: '我不想活了' });
  ok('危機貼文 → crisis:true, 有 resources', cr.j.crisis === true && Array.isArray(cr.j.resources) && /1925/.test(JSON.stringify(cr.j.resources)));
  w = await get(B, '/api/wall');
  ok('危機內容沒有進牆（仍 1 篇）', w.j.items.length === 1);

  // ── 個資 /謾罵 拒絕 ──
  let r2 = await post(B, '/api/wall', { anon: 'test-anon-1234abcd', text: '加我 line: abc123 mail: a@b.com' });
  ok('含個資 → 422', r2.status === 422 && r2.j.ok === false, r2.status + ' ' + JSON.stringify(r2.j).slice(0, 80));
  r2 = await post(B, '/api/wall', { anon: 'test-anon-1234abcd', text: '他就是個白癡' });
  ok('含謾罵 → 422', r2.status === 422);
  r2 = await post(B, '/api/wall', { anon: 'bad anon!!', text: '正常內容' });
  ok('非法 anon → 400', r2.status === 400);

  // ── 鼓勵流程 ──
  const enc1 = await post(B, '/api/encourage', { anon: 'enc-anon-9999zz', itemId, text: '昨天被當眾這樣罵，心裡一定很委屈，你願意說出來已經很勇敢了。' });
  ok('鼓勵通過 → ok, delta>0, posterDelta=5', enc1.status === 200 && enc1.j.ok && enc1.j.delta > 0 && enc1.j.posterDelta === 5, JSON.stringify(enc1.j).slice(0, 160));
  w = await get(B, '/api/wall');
  ok('牆上貼文有 1 句鼓勵', w.j.items[0].encs.length === 1 && w.j.items[0].encs[0].handle.startsWith('牆友#'), JSON.stringify(w.j.items[0].encs).slice(0, 120));

  const encBad = await post(B, '/api/encourage', { anon: 'enc-anon-9999zz', itemId, text: '加油！你可以的！' });
  ok('禁語鼓勵 → 422 且不回傳禁語原文', encBad.status === 422 && !/加油/.test(JSON.stringify(encBad.j)), JSON.stringify(encBad.j).slice(0, 100));
  const encCr = await post(B, '/api/encourage', { anon: 'enc-anon-9999zz', itemId, text: '你去死啦' });
  ok('危機鼓勵 → crisis:true 不儲存', encCr.j.crisis === true);
  w = await get(B, '/api/wall');
  ok('違規鼓勵沒進牆（仍 1 句）', w.j.items[0].encs.length === 1);
  const enc404 = await post(B, '/api/encourage', { anon: 'enc-anon-9999zz', itemId: 'nonexistent-id-123456', text: '謝謝你' });
  ok('不存在的貼文 → 404', enc404.status === 404);

  // ── 排行榜 ──
  const lb = await get(B, '/api/leaderboard?anon=test-anon-1234abcd');
  ok('排行榜 me.rank=1、title=好話燈塔、allPts>0', lb.j.me && lb.j.me.rank === 1 && lb.j.me.title === '好話燈塔' && lb.j.me.allPts > 0, JSON.stringify(lb.j.me));
  ok('top 有 2 人（發文者+鼓勵者）', Array.isArray(lb.j.top) && lb.j.top.length === 2, JSON.stringify(lb.j.top));
  ok('排行榜只露 handle 不露原始 anon', JSON.stringify(lb.j.top).indexOf('test-anon-1234abcd') === -1);

  // ── 速率限制：每週 5 篇，第 6 篇 429 ──
  let last = null;
  for (let i = 0; i < 5; i++) last = await post(B, '/api/wall', { anon: 'rate-anon-777', text: '第 ' + (i + 1) + ' 件有點煩的事，昨天晚上睡不好。' });
  ok('連發 5 篇都過', last.status === 200 && last.j.ok === true, last.status + ' ' + JSON.stringify(last.j).slice(0, 80));
  // rate-anon-777 已發 5 篇，第 6 篇應被擋
  const over = await post(B, '/api/wall', { anon: 'rate-anon-777', text: '第六篇測試內容' });
  ok('超過每週上限 → 429', over.status === 429, over.status + ' ' + JSON.stringify(over.j).slice(0, 80));

  // ── 方法錯誤 ──
  const m = await fetch(B + '/api/wall', { method: 'DELETE' });
  ok('DELETE /api/wall → 405', m.status === 405);

  // ── 無 KV → 降級本機牆，網站照常 ──
  let w2 = await get(B2, '/api/wall');
  ok('無 KV：GET 牆 → wallEnabled:false 不炸', w2.status === 200 && w2.j.wallEnabled === false);
  const lp = await post(B2, '/api/wall', { anon: 'local-anon-1', text: '本機牆測試：今天有點累。', ai: { goodword: '累是真的。' } });
  ok('無 KV：POST 牆 → localOnly:true 且仍給分', lp.status === 200 && lp.j.localOnly === true && lp.j.points > 0, JSON.stringify(lp.j).slice(0, 140));
  const lb2 = await get(B2, '/api/leaderboard?anon=local-anon-1');
  ok('無 KV：排行榜 → wallEnabled:false', lb2.status === 200 && lb2.j.wallEnabled === false);

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  s1.kill(); s2.kill(); kv.close();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
