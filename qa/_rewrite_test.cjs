#!/usr/bin/env node
'use strict';

/**
 * qa/_rewrite_test.cjs — 「改寫一句重話」模式回歸測試
 *
 * 來源：2026-11 使用者反映「改寫一句重話，AI 回的不太對、沒有改寫」。
 * 實測根因：模型常常回成空泛的自我鼓勵（例：原句「我怎麼這麼沒用」→
 * 「我正在學習，每一次嘗試都是經驗的累積」），完全沒有改寫到那句話；
 * 而且回應裡沒有「改寫後的句子」這個欄位，前端也無從呈現。
 *
 * 這個測試用**本地 mock 的 NVIDIA 端點**（NVIDIA_API_URL 可覆寫）餵兩種輸出：
 *   bad  = 空泛、與原句無關 → 必須自動退到規則式改寫（人工寫好的改寫表）
 *   good = 真的改寫到原句   → 必須採用模型輸出，並回 rewrite/original
 *
 * 跑法：node qa/_rewrite_test.cjs
 */

const http = require('http');
const path = require('path');
const APP = path.resolve(__dirname, '..', 'app', 'lib');

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

// ── 本地 mock NVIDIA（OpenAI 相容格式）──
let mockMode = 'bad';
const BAD = [
  '承接：你現在對自己很失望，那個失望是真的。',
  '好話：我正在學習，每一次嘗試都是經驗的累積，我會慢慢學會。',
  '小步：今晚早點休息。',
].join('\n');
const GOOD = [
  '承接：你現在對自己很失望，那個失望是真的。',
  '改寫：我這次沒把事情做好，有點挫折，我需要一點時間再試一次。',
  '小步：今晚先把今天做到的一件小事寫下來，不加評價。',
].join('\n');

const server = http.createServer((req, res) => {
  req.on('data', () => {});
  req.on('end', () => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ choices: [{ message: { content: mockMode === 'good' ? GOOD : BAD } }] }));
  });
});

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  process.env.NVIDIA_API_KEY = 'test-key-not-real';
  process.env.NVIDIA_API_URL = `http://127.0.0.1:${port}/v1/chat/completions`;
  process.env.AI_ENGINE = 'nvidia';

  const ai = require(path.join(APP, 'ai.js'));

  const ORIGINAL = '我怎麼這麼沒用，什麼事都做不好。';

  console.log('\n== isRealRewrite：這句到底有沒有改寫到原句 ==');
  const table = [
    ['空的（沒改寫）', ORIGINAL, '我正在學習，每一次嘗試都是經驗的累積，我會慢慢學會。', false],
    ['真的改寫（保留事件）', ORIGINAL, '我這次沒把事情做好，有點挫折，我需要一點時間再試一次。', true],
    ['真的改寫（對別人的重話）', '你真的很煩，我不想再看到你。', '我現在需要一點空間，等我整理好再跟你說。', true],
    ['空泛鼓勵', ORIGINAL, '你很棒，一切都會好', false],
    ['規則式改寫（人工表）', ORIGINAL, '但「沒用」這兩個字太重了——你只是今天這件事沒做好，那不等於你是誰。', true],
    ['不相干的句子（張冠李戴）', ORIGINAL, '今天的晚餐很好吃，我先去睡了。', false],
  ];
  for (const [label, orig, cand, want] of table) {
    const r = ai.isRealRewrite(orig, cand);
    ok('isRealRewrite ' + label, r.ok === want, `ok=${r.ok} overlap=${r.overlap} ${r.reason || ''}`);
  }

  console.log('\n== 系統提示（rewrite）必須要求「改寫」並附範例 ==');
  {
    const prompt = ai.buildSystemPrompt({ name: '自我否定', intensity: 4, situation: '' }, 'rewrite');
    ok('提示含「改寫：」輸出欄位', prompt.includes('改寫：'));
    ok('提示含反例說明（不要空泛鼓勵）', /反例|沒有改寫到/.test(prompt));
    ok('提示含範例', prompt.includes('【範例】'));
  }

  console.log('\n== 解析：模型用「改寫：」標籤也要吃得下 ==');
  {
    const parts = ai.parseThreeParts(GOOD);
    ok('抓到 改寫 欄位', parts && parts.改寫 === '我這次沒把事情做好，有點挫折，我需要一點時間再試一次。', JSON.stringify(parts));
    ok('好話 相容指向改寫句', parts && parts.好話 === parts.改寫);
    // 迴歸：承接欄位不可把「改寫：」那行一起吃進去（上線實測抓到）
    ok('承接沒有吞掉改寫那行', parts && !/改寫/.test(parts.承接) && parts.承接 === '你現在對自己很失望，那個失望是真的。',
      JSON.stringify(parts && parts.承接));
    const jsonParts = ai.parseThreeParts('{"承接":"a","改寫":"我這次沒做好，需要時間","小步":"b"}');
    ok('JSON 形式的 改寫 也支援', jsonParts && jsonParts.好話 === '我這次沒做好，需要時間', JSON.stringify(jsonParts));
  }

  console.log('\n== 端到端：模型回空泛內容 → 必須自動退到規則式改寫 ==');
  mockMode = 'bad';
  {
    const r = await ai.generate(ORIGINAL, { force: 'nvidia', mode: 'rewrite' });
    ok('有回 original（使用者原句）', r.original === ORIGINAL, JSON.stringify(r.original));
    ok('有回 rewrite（改寫後的句子）', typeof r.rewrite === 'string' && r.rewrite.length > 0, JSON.stringify(r.rewrite));
    ok('已切換為規則式引擎', r.meta.engine === 'rules', 'engine=' + r.meta.engine);
    ok('標記 rewriteFallback=true', r.meta.rewriteFallback === true, JSON.stringify(r.meta));
    ok('退路內容確實與原句有關', ai.isRealRewrite(ORIGINAL, r.rewrite).ok === true, r.rewrite);
    ok('degraded=true（誠實揭露非模型輸出）', r.meta.degraded === true);
    console.log('        → 改寫句：' + r.rewrite);
  }

  console.log('\n== 端到端：模型真的改寫 → 採用模型輸出 ==');
  mockMode = 'good';
  {
    const r = await ai.generate(ORIGINAL, { force: 'nvidia', mode: 'rewrite' });
    ok('採用模型的改寫句', r.rewrite === '我這次沒把事情做好，有點挫折，我需要一點時間再試一次。', JSON.stringify(r.rewrite));
    ok('engine=nvidia', r.meta.engine === 'nvidia', 'engine=' + r.meta.engine);
    ok('沒有標記 fallback', !r.meta.rewriteFallback, JSON.stringify(r.meta));
    ok('goodword 與 rewrite 一致（牆／分享沿用）', r.goodword === r.rewrite);
    ok('original 有帶回來', r.original === ORIGINAL);
  }

  console.log('\n== 規則軌（force=rules）行為一致 ==');
  {
    const r = await ai.generate(ORIGINAL, { force: 'rules', mode: 'rewrite' });
    ok('規則軌也回 original/rewrite', r.original === ORIGINAL && typeof r.rewrite === 'string' && r.rewrite.length > 0,
      JSON.stringify({ o: r.original, w: r.rewrite }));
    ok('規則軌 rewriteChecked=true', r.meta.rewriteChecked === true);
  }

  console.log('\n== chat 模式不受影響 ==');
  {
    const r = await ai.generate('今天開會我講錯話，覺得自己很沒用。', { force: 'rules', mode: 'chat' });
    ok('chat 不會多出 rewrite 欄位', r.rewrite === undefined && r.original === undefined, JSON.stringify(Object.keys(r)));
    ok('chat 三段齊全', Boolean(r.accept && r.goodword && r.smallstep));
  }

  server.close();
  console.log('\n================ 改寫模式回歸測試 ================');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  if (fail) { console.log('\n失敗清單：'); for (const f of failures) console.log('  - ' + f); }
  process.exit(fail ? 1 : 0);
});
