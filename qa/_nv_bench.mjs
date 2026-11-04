// _nv_bench.mjs v2 — 用「production 同款 prompt + parser + lint」實測 NVIDIA NIM 模型
// 重點：Vercel Hobby function 上限 10s，我們預算 6.5s → 只有「≤6.5s 且過關」才算 PASS。
//
// 用法（key 只放在環境變數，腳本絕不印 key）：
//   $env:NVIDIA_API_KEY = 'nvapi-...'
//   node C:\prodcut\qa\_nv_bench.mjs            # 全部候選
//   node C:\prodcut\qa\_nv_bench.mjs glm nemotron # 只跑名稱含這些字的模型
//
// 輸出：每案例一行（秒數 / parse結果 / lint結果 / 是否過6.5s預算），並印原始內容診斷。

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const ai = require('../app/lib/ai.js');
const { lint } = require('../app/lib/rules.js');

const KEY = process.env.NVIDIA_API_KEY || process.env.NVKEY;
if (!KEY) {
  console.error('缺少環境變數 NVIDIA_API_KEY（或 NVKEY）。');
  process.exit(2);
}
const URL = 'https://integrate.api.nvidia.com/v1/chat/completions';
const BUDGET_S = 6.5;      // Vercel 內預算（NVIDIA_TIMEOUT_MS 預設）
const CALL_TIMEOUT_S = 9;  // 單次呼叫硬上限，超過就記逾時

const CANDIDATES = [
  'nvidia/nemotron-3.5-lightning-30b-a3b',
  'nvidia/nemotron-3.5-bolt-e4b',
  'openai/gpt-oss-20b',
  'z-ai/glm-5.3-flash',
  'aisingapore/sea-lion-7b-instruct',
  'meta/llama-3.2-11b-vision-instruct',
  'moonshotai/kimi-k2.6',
  'mistralai/mistral-7b-instruct-v0.3',
  'zyphra/zamba2-7b-instruct',
  'nv-mistralai/mistral-nemo-12b-instruct',
  'nvidia/mistral-nemo-minitron-8b-8k-instruct',
  'nvidia/llama-3.1-nemotron-70b-instruct',
];
const filterArgs = process.argv.slice(2).map((s) => s.toLowerCase());
const MODELS = filterArgs.length ? CANDIDATES.filter((m) => filterArgs.some((f) => m.toLowerCase().includes(f))) : CANDIDATES;

const EMOTION = { id: 'selfworth', name: '自我價值', intensity: 4, situation: '工作上一直出錯，覺得自己很沒用。' };
const CASES = [
  { mode: 'chat', label: 'chat-工作', text: '今天開會我講錯話，回家路上一直想，覺得自己很沒用。' },
  { mode: 'rewrite', label: 'rewrite-毒話', text: '我怎麼這麼沒用，什麼事都做不好。' },
  { mode: 'chat', label: 'chat-感情', text: '跟交往三年的對象分手了，晚上一個人在房間不知道怎麼辦。' },
  { mode: 'chat', label: 'chat-多輪', text: '他又沒回我訊息了', history: [{ role: 'user', content: '我覺得好孤單，身邊好像沒人懂我' }, { role: 'assistant', content: '承接：…\n好話：…\n小步：…' }] },
  { mode: 'chat', label: 'chat-家庭', text: '每次回家都要被問什麼時候結婚生小孩，我真的很累。' },
  { mode: 'chat', label: 'chat-憤怒', text: '我跟他說了八百遍了他還是不聽，氣死我了。' },
  { mode: 'rewrite', label: 'rewrite-罵人', text: '你這個人怎麼每次都這樣，真的很煩耶。' },
  { mode: 'chat', label: 'chat-焦慮', text: '明天要報告了我現在手一直在抖，晚上一定睡不著。' },
  { mode: 'chat', label: 'chat-邊緣', text: '今天好累' },
  { mode: 'rewrite', label: 'rewrite-道歉', text: '對不起我剛才對你很兇，我不是故意的。' },
];

async function ask(model, c) {
  const t0 = Date.now();
  const body = {
    model,
    messages: [
      { role: 'system', content: ai.buildSystemPrompt(EMOTION, c.mode) },
      ...(c.history || []),
      { role: 'user', content: c.text },
    ],
    max_tokens: 400,
    temperature: 0.7,
  };
  if (/deepseek|reasoning|omni/i.test(model)) body.reasoning_effort = 'none';
  try {
    const r = await fetch(URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(CALL_TIMEOUT_S * 1000),
    });
    const j = await r.json();
    const secs = (Date.now() - t0) / 1000;
    if (!r.ok) return { secs, err: (j?.detail || j?.message || ('HTTP ' + r.status)).toString().slice(0, 100) };
    const raw = j?.choices?.[0]?.message?.content ?? j?.choices?.[0]?.message?.reasoning_content ?? '';
    const parts = ai.parseThreeParts(raw);
    const check = parts ? lint(parts) : { ok: false, reasons: ['parse fail'] };
    return { secs, raw, parts, lintOk: check.ok, reasons: check.reasons };
  } catch (e) {
    return { secs: (Date.now() - t0) / 1000, err: (e.name === 'TimeoutError' || e.name === 'AbortError') ? 'TIMEOUT' : e.message.slice(0, 80) };
  }
}

(async () => {
  console.log(`預算門檻：≤${BUDGET_S}s 且 parse OK 且 lint 過 才算 PASS（Vercel function 10s 上限）\n`);
  const summary = [];
  for (const m of MODELS) {
    const rows = [];
    let allPass = true;
    for (const c of CASES) {
      const r = await ask(m, c);
      if (r.err) { rows.push({ c, r, pass: false }); allPass = false; console.log(`  ${m}  [${c.label}]  ERR ${r.err} (${r.secs.toFixed(1)}s)`); continue; }
      const pass = r.lintOk && r.secs <= BUDGET_S;
      if (!pass) allPass = false;
      rows.push({ c, r, pass });
      console.log(`  ${m}  [${c.label}]  ${r.secs.toFixed(1)}s  parse=${r.parts ? 'OK' : 'FAIL'} lint=${r.lintOk ? 'OK' : r.reasons.join(',')}  budget=${r.secs <= BUDGET_S ? 'OK' : 'OVER'}  => ${pass ? 'PASS' : 'fail'}`);
      if (!r.parts) console.log('      raw=' + JSON.stringify(r.raw).slice(0, 300));
      else if (!r.lintOk) console.log('      raw=' + JSON.stringify(r.raw).slice(0, 300));
    }
    const oks = rows.filter((x) => x.pass).length;
    const avg = rows.filter((x) => !x.r.err).reduce((a, x) => a + x.r.secs, 0) / Math.max(1, rows.filter((x) => !x.r.err).length);
    summary.push({ m, oks, total: CASES.length, avg });
    if (oks > 0) {
      const good = rows.find((x) => x.pass);
      console.log(`  → 好話範例 [${good.c.label}]：${good.r.parts.好話}`);
    }
    console.log(`  → ${m}: ${oks}/${CASES.length} PASS, avg ${avg.toFixed(1)}s\n`);
  }
  console.log('=== 排名（PASS 數優先，再來平均延遲）===');
  summary.sort((a, b) => b.oks - a.oks || a.avg - b.avg);
  for (const s of summary) console.log(`  ${s.oks}/${s.total}  avg ${s.avg.toFixed(1)}s  ${s.m}`);
  const win = summary.find((s) => s.oks === s.total && s.avg <= BUDGET_S) || summary.find((s) => s.oks === s.total);
  console.log(`\n建議預設模型：${win ? win.m + `（${win.oks}/${win.total} PASS, avg ${win.avg.toFixed(1)}s）` : '無全過模型，請挑 PASS 最多者或調整 prompt'}`);
})();
