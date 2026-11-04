// Probe: can we reduce deepseek-v4.1-flash latency? (it is a reasoning model)
const key = process.env.NVKEY;
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';

async function probe(name, body) {
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(110000),
    });
    const j = await r.json();
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const rt = j.usage?.completion_tokens_details?.reasoning_tokens;
    const c = j.choices?.[0]?.message?.content;
    const shown = c ? c.slice(0, 46).replace(/\n/g, ' ') : 'NULL';
    console.log(`${name.padEnd(28)}${String(secs).padStart(6)}s  reasoning=${String(rt).padStart(4)}  ${shown}`);
    return { secs: Number(secs), ok: !!c };
  } catch (e) {
    console.log(`${name.padEnd(28)}   FAIL ${e.message}`);
    return { secs: -1, ok: false };
  }
}

const M = 'deepseek-ai/deepseek-v4.1-flash';
const base = (extra) => ({
  model: M,
  messages: [{ role: 'user', content: '一句話安慰：好累' }],
  max_tokens: 700,
  temperature: 0.6,
  ...extra,
});

(async () => {
  console.log('=== 嘗試降低 reasoning 開銷 ===');
  await probe('baseline', base({}));
  await probe('reasoning_effort=low', base({ reasoning_effort: 'low' }));
  await probe('reasoning_effort=none', base({ reasoning_effort: 'none' }));
  await probe('chat_template_kwargs', base({ chat_template_kwargs: { thinking: false } }));
  await probe('system: 直接回答不要思考', {
    model: M,
    messages: [
      { role: 'system', content: '直接給答案，不要思考過程。' },
      { role: 'user', content: '一句話安慰：好累' },
    ],
    max_tokens: 700,
    temperature: 0.6,
  });
})();
