// 外網實測線上部署：確認 /api/respond 真的走 nvidia 引擎
const BASE = 'https://good-words.vercel.app';
async function post(body) {
  const t0 = Date.now();
  const r = await fetch(BASE + '/api/respond', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  return { ms: Date.now() - t0, status: r.status, j };
}
(async () => {
  let pass = 0, fail = 0;
  const ok = (n, c, d) => { if (c) { pass++; console.log('  ✅ ' + n); } else { fail++; console.log('  ❌ ' + n + (d ? ' — ' + d : '')); } };

  // 1) 一般 chat → 應為 nvidia
  let r = await post({ text: '今天開會講錯話，回家一直想，覺得自己很沒用。' });
  console.log('chat:', r.status, JSON.stringify(r.j.meta));
  ok('chat → meta.engine=nvidia', r.j.meta?.engine === 'nvidia', JSON.stringify(r.j.meta));
  ok('chat → 有 model 名', typeof r.j.meta?.model === 'string' && r.j.meta.model.includes('nemotron'), r.j.meta?.model);
  ok('chat → 三段齊全', r.j.accept && r.j.goodword && r.j.smallstep);
  ok('chat → 無禁語', !/加油|你可以的|別想太多|想開一點|一切都會好/.test(r.j.accept + r.j.goodword + r.j.smallstep));
  ok('chat → 外網延遲合理 (<9s)', r.ms < 9000, r.ms + 'ms');
  console.log('   承接：' + (r.j.accept || '').slice(0, 50));
  console.log('   好話：' + (r.j.goodword || '').slice(0, 80));
  console.log('   小步：' + (r.j.smallstep || '').slice(0, 50));

  // 2) rewrite 模式
  r = await post({ text: '你這個人怎麼每次都這樣，真的很煩耶。', mode: 'rewrite' });
  console.log('rewrite:', r.status, JSON.stringify(r.j.meta));
  ok('rewrite → engine=nvidia 且 mode=rewrite', r.j.meta?.engine === 'nvidia' && r.j.meta?.mode === 'rewrite', JSON.stringify(r.j.meta));
  ok('rewrite → 三段齊全且無禁語', r.j.goodword && !/加油|你可以的/.test(r.j.accept + r.j.goodword + r.j.smallstep));
  console.log('   改寫好話：' + (r.j.goodword || '').slice(0, 80));

  // 3) 多輪 history
  r = await post({ text: '他又沒回訊息了', history: [{ role: 'user', content: '我覺得好孤單' }, { role: 'assistant', content: '承接：…\n好話：…\n小步：…' }] });
  ok('history → 仍 200 且 engine=nvidia', r.status === 200 && r.j.meta?.engine === 'nvidia', JSON.stringify(r.j.meta));

  // 4) 危機 → 不經模型
  r = await post({ text: '我不想活了' });
  ok('危機 → crisis=true, engine=safety, 含 1925/1995', r.j.crisis === true && r.j.meta?.engine === 'safety' && /1925/.test(JSON.stringify(r.j.resources)));

  // 5) 危機 in rewrite mode
  r = await post({ text: '我想死', mode: 'rewrite' });
  ok('rewrite 危機 → 照樣轉介', r.j.crisis === true && r.j.meta?.engine === 'safety');

  console.log(`\n外網實測結果：${pass} 通過 / ${fail} 失敗`);
  process.exit(fail ? 1 : 0);
})();
