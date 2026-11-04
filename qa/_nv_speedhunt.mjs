// Hunt for a FASTER path on the NVIDIA key.
// Strategies:
//  1) full model sweep with minimal prompt (find anything fast)
//  2) reasoning_effort variations on the winner
//  3) prompt-shortening (fewer reasoning tokens)
//  4) streaming (time-to-first-token vs total)
const key = process.env.NVKEY;
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const MODELS_URL = 'https://integrate.api.nvidia.com/v1/models';

async function timed(model, body, timeoutMs = 45000) {
  const t0 = Date.now();
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model, ...body }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await r.json();
    const s = (Date.now() - t0) / 1000;
    if (r.status !== 200) return { s, err: j?.detail || j?.title || ('HTTP ' + r.status) };
    const msg = j.choices?.[0]?.message || {};
    return {
      s,
      content: msg.content,
      reasoning: j.usage?.completion_tokens_details?.reasoning_tokens,
      completion: j.usage?.completion_tokens,
    };
  } catch (e) {
    return { s: (Date.now() - t0) / 1000, err: e.message };
  }
}

(async () => {
  // ---- 1. sweep ALL listed models with a trivial prompt ----
  const list = await (await fetch(MODELS_URL, { headers: { Authorization: 'Bearer ' + key } })).json();
  const ids = list.data.map((x) => x.id);
  console.log(`=== 全模型掃描（${ids.length} 個，微小 prompt）===`);
  const fast = [];
  for (const m of ids) {
    const r = await timed(m, { messages: [{ role: 'user', content: 'hi' }], max_tokens: 8 }, 20000);
    if (!r.err) {
      fast.push({ m, s: r.s });
      if (r.s < 15) console.log(`  ⚡ ${r.s.toFixed(1).padStart(5)}s  ${m}`);
    }
  }
  fast.sort((a, b) => a.s - b.s);
  console.log(`\n可呼叫模型 ${fast.length} 個。最快的 10 個：`);
  fast.slice(0, 10).forEach((x) => console.log(`  ${x.s.toFixed(1).padStart(5)}s  ${x.m}`));

  // ---- 2. latency of the winner with real workload ----
  const M = 'deepseek-ai/deepseek-v4.1-flash';
  console.log(`\n=== ${M}：reasoning_effort 對延遲的影響（真實任務）===`);
  for (const eff of ['none', 'low', 'medium']) {
    const r = await timed(
      M,
      {
        messages: [{ role: 'user', content: '承接：… 好話：… 小步：…（對象：覺得自己沒用的上班族）' }],
        max_tokens: 300,
        temperature: 0.6,
        ...(eff === 'none' ? { reasoning_effort: 'none' } : { reasoning_effort: eff }),
      },
      60000,
    );
    console.log(`  effort=${eff.padEnd(7)} ${r.s.toFixed(1)}s  reasoning=${r.reasoning}  content=${r.content ? 'YES' : 'NULL'}`);
  }

  // ---- 3. streaming: measure time-to-first-token ----
  console.log(`\n=== 串流：首字延遲（TTFT）vs 總時間 ===`);
  const t0 = Date.now();
  let ttft = null;
  try {
    const res = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: M,
        messages: [{ role: 'user', content: '一句話安慰：好累' }],
        max_tokens: 200,
        stream: true,
        reasoning_effort: 'none',
      }),
      signal: AbortSignal.timeout(60000),
    });
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      if (ttft === null && /"content"\s*:\s*"[^"]/.test(buf)) ttft = (Date.now() - t0) / 1000;
    }
  } catch (e) {
    console.log('  stream FAIL ' + e.message);
  }
  const total = (Date.now() - t0) / 1000;
  console.log(`  TTFT=${ttft ? ttft.toFixed(1) + 's' : 'n/a'}   total=${total.toFixed(1)}s`);
})();
