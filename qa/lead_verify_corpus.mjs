/**
 * lead_verify_corpus.mjs — 驗證「回傳的好話真的來自 content 語料庫」
 *
 * ★ 修正版（v2）：v1 用「情緒名稱」當輸入（例如送「自我否定」三個字），
 *   那不是真實使用者會說的話，當然比對不到關鍵字 → 得到誤導性的 0/14。
 *   v2 改用每類情緒的第一個 keywords 當輸入，並在 Ollama 關閉下測（測規則軌）。
 *
 * 用法：node lead_verify_corpus.mjs [baseUrl]
 * 前提：Ollama 必須關閉（否則走模型生成，不會命中語料庫）
 */
import fs from 'node:fs';

const BASE = process.argv[2] || 'http://127.0.0.1:3000';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
const gwRaw = readJson('C:\\prodcut\\content\\goodwords.json');
const emoRaw = readJson('C:\\prodcut\\content\\emotions.json');

const corpus = new Map(); // 好話 -> emotionId
for (const [id, arr] of Object.entries(gwRaw.goodwords)) {
  for (const it of arr) if (it.好話) corpus.set(it.好話, id);
}
console.log(`語料庫：${Object.keys(gwRaw.goodwords).length} 類，${corpus.size} 句好話\n`);

// 用真實使用者語句當輸入：每類取 2 個 keyword 串成一句
const probes = emoRaw.emotions.map((e) => {
  const kw = (e.keywords || []).slice(0, 2);
  return { id: e.id, name: e.name, text: kw.join('，') || e.name };
});

let hit = 0, miss = 0;
const misses = [];

console.log('對 14 類情緒各送一筆（Ollama 應為關閉狀態）：\n');
for (const p of probes) {
  try {
    const r = await fetch(`${BASE}/api/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: p.text }),
      signal: AbortSignal.timeout(60000),
    });
    const d = await r.json();
    const good = d.goodword || '';
    const engine = d.meta?.engine ?? '?';
    const classified = d.emotion?.id ?? '?';
    const fromContent = d.meta?.fromContent;
    const matchId = corpus.get(good);
    const isCorpus = !!matchId;

    if (isCorpus) hit++; else { miss++; misses.push({ ...p, good, engine, classified, fromContent }); }

    const flag = isCorpus ? `CORPUS(${matchId})` : 'NOT-IN-CORPUS';
    console.log(`  ${p.id.padEnd(18)} engine=${String(engine).padEnd(7)} class=${String(classified).padEnd(18)} ${flag}`);
    console.log(`      in : ${p.text.slice(0, 40)}`);
    console.log(`      out: ${good.slice(0, 55)}`);
  } catch (e) {
    miss++;
    console.log(`  ${p.id.padEnd(18)} ERROR ${e.message}`);
  }
}

console.log(`\n${'='.repeat(62)}`);
console.log(`命中 content 語料庫：${hit} / ${probes.length}`);
console.log(`未命中：${miss}`);
console.log('='.repeat(62));

if (misses.length) {
  console.log('\n未命中明細（可能是分類錯誤或走 fallback）：');
  misses.forEach((m) => console.log(`  - ${m.id}: class=${m.classified} engine=${m.engine} fromContent=${m.fromContent}\n    "${m.good.slice(0, 50)}"`));
}

process.exit(hit === probes.length ? 0 : 1);
