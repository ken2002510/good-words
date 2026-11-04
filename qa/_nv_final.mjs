// Verify: reasoning_effort=none + structured prompt, consistency over several runs
const key = process.env.NVKEY;
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const M = 'deepseek-ai/deepseek-v4.1-flash';

const SYSTEM = `你是一位溫暖、誠懇的陪伴者。先接住對方的情緒，再給一句具體真誠的好話，最後給一個今晚就能做的極小行動。

【輸出格式】只輸出三行，不要任何其他文字：
承接：（用你自己的話重述對方處境，一句話，不超過 40 字）
好話：（一句真誠、具體、不空洞的話，1～2 句，不超過 60 字）
小步：（一個今晚就能做到的極小行動，一句話，不超過 50 字）

【絕對禁止】加油、你可以的、別想太多、想開一點、一切都會好的、說教、評價、醫療語言
【語言】一律使用繁體中文與台灣用語`;

async function run(text) {
  const t0 = Date.now();
  const r = await fetch(URL, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: M,
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: text },
      ],
      max_tokens: 500,
      temperature: 0.7,
      reasoning_effort: 'none',
    }),
    signal: AbortSignal.timeout(60000),
  });
  const j = await r.json();
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  const c = j.choices?.[0]?.message?.content || '';
  return { secs, c, usage: j.usage };
}

const CASES = [
  '我覺得自己很沒用，什麼都做不好',
  '工作壓力好大，每天都加班到很晚',
  '跟交往三年的人分手了，不知道怎麼辦',
  '爸媽一直拿我跟哥哥比較，我很累',
  '最近常常覺得很孤單，明明身邊有人',
];

const BANNED = ['加油', '你可以的', '別想太多', '想開一點', '一切都會好的'];

(async () => {
  let pass = 0, fail = 0;
  const times = [];
  for (const t of CASES) {
    const { secs, c, usage } = await run(t);
    times.push(Number(secs));
    const has3 = /承接/.test(c) && /好話/.test(c) && /小步/.test(c);
    const banned = BANNED.filter((b) => c.includes(b));
    const clean = banned.length === 0;
    const ok = has3 && clean;
    if (ok) pass++; else fail++;
    console.log(`--- "${t.slice(0, 16)}"  ${secs}s  tokens=${usage?.completion_tokens}  ${ok ? 'PASS' : 'FAIL'} ---`);
    if (!has3) console.log('   !! 三段不齊');
    if (!clean) console.log('   !! 含禁語: ' + banned.join('/'));
    console.log(c.split('\n').filter(Boolean).map((l) => '   ' + l).join('\n'));
    console.log();
  }
  console.log(`=== ${pass} pass / ${fail} fail ===`);
  console.log(`latency: avg ${(times.reduce((a, b) => a + b, 0) / times.length).toFixed(1)}s  min ${Math.min(...times)}s  max ${Math.max(...times)}s`);
})();
