// Test the FAST callable models for real quality on our three-section task.
const key = process.env.NVKEY;
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

const SYSTEM = `你是一位溫暖、誠懇的陪伴者。先接住對方的情緒，再給一句具體真誠的好話，最後給一個今晚就能做的極小行動。

【輸出格式】只輸出三行，不要任何其他文字：
承接：（重述對方處境，一句話，不超過 40 字）
好話：（一句真誠、具體、不空洞的話，1～2 句，不超過 60 字）
小步：（一個今晚就能做到的極小行動，一句話，不超過 50 字）

【絕對禁止】加油、你可以的、別想太多、想開一點、一切都會好的、說教、評價、醫療語言
【語言】一律使用繁體中文與台灣用語`;

const CANDIDATES = [
  'nvidia/nemotron-3-nano-omni-30b-a3b-reasoning',
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3-ultra-550b-a55b',
  'meta/muse-glimmer-30b',
  'mistralai/mistral-large-4-1t-a52b',
  'google/diffusiongemma-26b-a4b-it',
  'z-ai/glm-5.3-flash',
  'poolside/laguna-xs-2.1',
];

const CASES = [
  '我覺得自己很沒用，什麼都做不好',
  '爸媽一直拿我跟哥哥比較，我很累',
];
const BANNED = ['加油', '你可以的', '別想太多', '想開一點', '一切都會好的'];

async function ask(model, text) {
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: text }],
        max_tokens: 400,
        temperature: 0.7,
        reasoning_effort: 'none',
      }),
      signal: AbortSignal.timeout(70000),
    });
    const j = await r.json();
    const s = (Date.now() - t0) / 1000;
    if (r.status !== 200) return { s, err: (j?.detail || 'HTTP ' + r.status).toString().slice(0, 60) };
    return { s, c: j.choices?.[0]?.message?.content || '' };
  } catch (e) {
    return { s: (Date.now() - t0) / 1000, err: e.message };
  }
}

(async () => {
  for (const m of CANDIDATES) {
    console.log('='.repeat(70));
    console.log(m);
    console.log('='.repeat(70));
    for (const t of CASES) {
      const r = await ask(m, t);
      if (r.err) {
        console.log(`  [${r.s.toFixed(1)}s] ERR ${r.err}`);
        continue;
      }
      const c = r.c;
      const has3 = /承接/.test(c) && /好話/.test(c) && /小步/.test(c);
      const banned = BANNED.filter((b) => c.includes(b));
      console.log(`  [${r.s.toFixed(1)}s] ${has3 ? '3段OK' : '3段缺'} ${banned.length ? '禁語:' + banned.join(',') : '無禁語'}  "${t.slice(0, 12)}"`);
      console.log('    ' + c.split('\n').filter(Boolean).join('\n    ').slice(0, 420));
    }
    console.log();
  }
})();
