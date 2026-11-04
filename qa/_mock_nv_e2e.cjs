// 端到端：mock NVIDIA server + app/server.js，驗證 force=nvidia 整條鏈路
// （真的 NVIDIA 連線由使用者跑 qa/_nv_bench.mjs 測）
const http = require('http');
const { spawn } = require('child_process');

// 1) mock NVIDIA NIM：回一個合法三段 + 故意第二個案例含禁語（應被 lint 擋下 → 降級 rules）
const mock = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const j = JSON.parse(body || '{}');
    const userText = (j.messages || []).filter((m) => m.role === 'user').map((m) => m.content).join('\n');
    const isRewrite = (j.messages || []).some((m) => m.role === 'system' && m.content.includes('改寫者'));
    let content;
    if (userText.includes('毒')) {
      content = '承接：你氣到想罵人，那股火是真的。\n好話：加油！你可以的！\n小步：深呼吸三次。'; // 含禁語 → 應被擋
    } else if (isRewrite) {
      content = '承接：這句話背後是委屈，委屈是真的。\n好話：可以改成：「我現在有點生氣，因為這件事對我很重要。」\n小步：今晚把改寫後的話寫下來，明天再說。';
    } else {
      const hasHistory = (j.messages || []).filter((m) => m.role !== 'system').length > 1;
      content = `承接：我聽到你在說工作上的累${hasHistory ? '，而且這不是第一次了' : ''}。\n好話：累不代表你做不好，只代表你撐了很久。\n小步：今晚十一點前關掉工作訊息。`;
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({
      id: 'mock', object: 'chat.completion', created: 0, model: j.model,
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 },
    }));
  });
});

(async () => {
  await new Promise((r) => mock.listen(59998, '127.0.0.1', r));
  const env = {
    ...process.env,
    PORT: '3211',
    OLLAMA_URL: 'http://127.0.0.1:59999', // 關掉 ollama → 不會走 ①
    NVIDIA_API_KEY: 'nvapi-MOCK-not-real',
    NVIDIA_API_URL: 'http://127.0.0.1:59998/v1/chat/completions',
    NVIDIA_MODEL: 'mock-model-x',
    NVIDIA_TIMEOUT_MS: '5000',
  };
  delete env.NVKEY;
  const srv = spawn(process.execPath, ['server.js'], { cwd: 'C:\\prodcut\\app', env, stdio: ['ignore', 'pipe', 'pipe'] });
  srv.stderr.on('data', (d) => process.stderr.write(d));
  const BASE = 'http://127.0.0.1:3211';
  for (let i = 0; i < 60; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) break; } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }

  let pass = 0, fail = 0;
  const ok = (n, c, d) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };

  // health 應回報 nvidia enabled
  const h = await (await fetch(BASE + '/api/health')).json();
  ok('health.engines.nvidia.enabled=true, model=mock-model-x', h.engines.nvidia.enabled === true && h.engines.nvidia.model === 'mock-model-x');

  // chat 模式走 nvidia
  let r = await fetch(BASE + '/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '今天開會又搞砸了，好累' }) });
  let j = await r.json();
  ok('chat → engine=nvidia, model=mock-model-x', j.meta.engine === 'nvidia' && j.meta.model === 'mock-model-x', JSON.stringify(j.meta));
  ok('chat 三段來自 mock 內容（含 history 判斷）', j.goodword.includes('累不代表你做不好'), j.goodword);
  console.log('     好話：' + j.goodword);

  // 带 history → mock應看到多輪
  r = await fetch(BASE + '/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '又來了', history: [{ role: 'user', content: '我好累' }, { role: 'assistant', content: '承接…\n好話…\n小步…' }] }) });
  j = await r.json();
  ok('history 有被帶進 model（mock 回應含「不是第一次」）', j.meta.engine === 'nvidia' && j.accept.includes('不是第一次'), j.accept);

  // rewrite 模式
  r = await fetch(BASE + '/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '你這個白癡', mode: 'rewrite' }) });
  j = await r.json();
  ok('rewrite → engine=nvidia, meta.mode=rewrite', j.meta.engine === 'nvidia' && j.meta.mode === 'rewrite', JSON.stringify(j.meta));
  ok('rewrite 好話是改寫版', j.goodword.includes('我現在有點生氣'), j.goodword);
  console.log('     rewrite 好話：' + j.goodword);

  // 含禁語的模型輸出 → lint 擋下 → 降級 rules，仍 200 三段
  r = await fetch(BASE + '/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '毒話測試毒', mode: 'rewrite' }) });
  j = await r.json();
  ok('模型輸出含禁語 → 降級 rules 且無禁語', j.meta.engine === 'rules' && !/加油|你可以的/.test(j.goodword + j.accept + j.smallstep), JSON.stringify(j.meta));

  // 危機優先於 nvidia
  r = await fetch(BASE + '/api/respond', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '我不想活了' }) });
  j = await r.json();
  ok('危機 → 不經模型直接轉介', j.crisis === true && j.meta.engine === 'safety');

  console.log(`\n結果：${pass} 通過 / ${fail} 失敗`);
  srv.kill(); mock.close();
  process.exit(fail ? 1 : 0);
})();
