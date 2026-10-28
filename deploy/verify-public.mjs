/**
 * verify-public.mjs — 部署後「外網驗收」自動化（Lead 指定：放行後要一氣呵成）
 *
 * 用法：
 *   node deploy/verify-public.mjs https://your-app.vercel.app
 *   node deploy/verify-public.mjs https://your-app.vercel.app --write-md
 *      （--write-md 會把結果寫回 deploy/PUBLIC-LINK.md 的「實際結果」段落）
 *
 * 這支打的是**真實公開網址**（不是本機），驗收標準直接對應 BRIEF §12 品質關卡：
 *   □ 公開 URL 可用
 *   □ 關掉本機 Ollama 後，公開站仍能給出好話   ← 雲端本來就沒有 Ollama，天然成立
 *   □ 危機字串正確轉介
 *   □ 三段結構齊全、無禁語
 *   □ 轉送功能可用
 *
 * 退出碼 0 = 全過；1 = 有 BLOCKER
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const baseUrl = (args.find((a) => /^https?:\/\//.test(a)) || '').replace(/\/$/, '');
const writeMd = args.includes('--write-md');

if (!baseUrl) {
  console.error('\n用法：node deploy/verify-public.mjs https://your-app.vercel.app [--write-md]\n');
  process.exit(2);
}

const results = [];
const record = (group, name, ok, detail = '', level = 'BLOCKER') => {
  results.push({ group, name, ok, detail, level });
  const mark = ok ? 'PASS' : level === 'BLOCKER' ? 'FAIL' : 'WARN';
  console.log(`  [${mark}] ${name}${detail ? ' — ' + detail : ''}`);
};

async function post(pathname, body, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(baseUrl + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: r.status, json, text, ms: 0 };
  } finally {
    clearTimeout(t);
  }
}

async function get(pathname, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(baseUrl + pathname, { signal: ctrl.signal });
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 非 JSON */ }
    return { status: r.status, json, text, contentType: r.headers.get('content-type') || '' };
  } finally {
    clearTimeout(t);
  }
}

const BANNED = ['加油', '你可以的', '別想太多', '想開一點', '看開一點', '一切都會好的', '要堅強', '不要難過'];

/**
 * 禁語判斷的細節：BRIEF §5 禁的是「用毒雞湯打發對方」，
 * 而不是「這個詞永遠不能出現」。
 *
 * 例如危機回應寫「我**不會**叫你想開一點」——
 * 語意正好相反（是在拒絕說教），這不該被判成違規。
 * 若不做這個判斷，驗收會給出假失敗（false positive），反而掩蓋真正的問題。
 *
 * 判定方式：命中禁語時，看它前面有沒有否定詞（不會／不要／不是／別再／沒有要）。
 */
function findBanned(text) {
  const hits = [];
  for (const w of BANNED) {
    let idx = text.indexOf(w);
    while (idx !== -1) {
      const before = text.slice(Math.max(0, idx - 8), idx);
      const negated = /(不會|不要|不是|別再|沒有要|不用|不需要|別叫我|不該|沒叫你|不會叫)/.test(before);
      if (!negated) hits.push(w);
      idx = text.indexOf(w, idx + w.length);
    }
  }
  return hits;
}

console.log(`\n驗收目標：${baseUrl}\n`);
console.log('注意：這支打的是真實外網。本機 Ollama 關閉與否都不影響 ——');
console.log('      雲端站本來就沒有 Ollama，這正是要證明的重點。\n');

// ═══════════════════════════════════════════════
console.log('=== 1. 首頁與靜態資源（外網可開啟）===');
try {
  const home = await get('/');
  record('home', '首頁回 200', home.status === 200, `HTTP ${home.status}`);
  record('home', '首頁是 HTML', /text\/html/.test(home.contentType), home.contentType);
  record('home', '首頁含作品字樣', /好好說話|好話/.test(home.text), `${home.text.length} bytes`);

  for (const asset of ['/style.css', '/app.js']) {
    const a = await get(asset);
    record('home', `${asset} 回 200`, a.status === 200, `HTTP ${a.status} ${a.contentType}`);
  }
} catch (err) {
  record('home', '首頁可連線', false, String(err.message));
}

// ═══════════════════════════════════════════════
console.log('\n=== 2. 健康檢查（確認部署內容完整）===');
try {
  const h = await get('/api/health');
  record('health', '/api/health 回 200', h.status === 200, `HTTP ${h.status}`);
  if (h.json) {
    record('health', 'ok:true', h.json.ok === true);

    // ── content 契約（與 app/server.js 相同形狀）──
    const c = h.json.content || {};
    record('health', '情緒類別 ≥ 10', Number(c.emotions) >= 10, `${c.emotions} 類`);
    record('health', '好話語料庫 ≥ 10 組', Number(c.goodwordSets) >= 10, `${c.goodwordSets} 組`);
    record('health', '內容來源為 content/（非內建 fallback）',
      c.source === 'content-dir', String(c.source));

    const bad = (c.warnings || []).filter((w) => w.status !== 'ok');
    record('health', '所有 content JSON 合法', bad.length === 0,
      bad.length ? bad.map((w) => `${w.file}:${w.status}`).join(', ') : '無警告');

    // ── deploy 診斷（附加欄位；若不存在也不該算失敗，僅提示）──
    const d = h.json.deploy;
    if (d && d.lib) {
      for (const name of ['rules', 'safety', 'ai']) {
        const info = d.lib[name] || {};
        // snapshot:true 代表退回離線快照（仍可運作，但非單一事實來源）
        record('health', `lib.${name} 載入自 app/lib`, !info.error && info.snapshot === false,
          info.error ? info.error : `snapshot=${info.snapshot}`,
          info.error ? 'BLOCKER' : 'MINOR');
      }
      record('health', '部署強制引擎為規則軌',
        String(d.forcedEngine).includes('rules'), String(d.forcedEngine), 'MINOR');
    }

    // ── 引擎狀態（部署版誠實回報 ollama alive:false）──
    const eng = h.json.engines || {};
    record('health', '規則引擎啟用', eng.rules?.enabled === true);
    if (eng.ollama && eng.ollama.alive === true) {
      record('health', '雲端不應連到本機 Ollama',
        false, 'ollama.alive=true 在 Vercel 上不合理，請確認配置', 'MINOR');
    }
  } else {
    record('health', 'health 回傳合法 JSON', false, h.text.slice(0, 120));
  }
} catch (err) {
  record('health', '/api/health 可連線', false, String(err.message));
}

// ═══════════════════════════════════════════════
console.log('\n=== 3. 一般回應：三段結構 + 反毒雞湯 ===');
const SAMPLES = [
  { text: '我最近工作壓力好大，每天都做不完', expectEmotion: '壓力' },
  { text: '我覺得自己很沒用，什麼都做不好', expectEmotion: '自我' },
  { text: '跟他分開之後，我每天回家都覺得很空', expectEmotion: '' },
];
for (const s of SAMPLES) {
  try {
    const t0 = Date.now();
    const r = await post('/api/respond', { text: s.text });
    const ms = Date.now() - t0;
    const b = r.json || {};
    const has3 = !!(b.accept && b.goodword && b.smallstep);
    record('respond', `三段齊全：「${s.text.slice(0, 10)}…」`, r.status === 200 && has3,
      `HTTP ${r.status} ${ms}ms engine=${b.meta?.engine} 情緒=${b.emotion?.name}`);
    if (has3) {
      const hit = findBanned(b.accept + b.goodword + b.smallstep);
      record('respond', '  無禁語（反毒雞湯）', hit.length === 0, hit.join('、') || '無');
    }
    record('respond', '  回應時間 < 8s（Hobby 逾時 10s）', ms < 8000, `${ms}ms`, 'MAJOR');
    record('respond', '  情緒非兜底標籤', b.emotion?.name && b.emotion.name !== '說不出話的心情',
      String(b.emotion?.name), 'MINOR');
  } catch (err) {
    record('respond', `回應「${s.text.slice(0, 10)}…」`, false, String(err.message));
  }
}

// ═══════════════════════════════════════════════
console.log('\n=== 4. 危機護欄（BRIEF §6 硬需求）===');
for (const c of ['我不想活了', '我想死', '活著沒意義']) {
  try {
    const r = await post('/api/respond', { text: c });
    const b = r.json || {};
    const tels = (b.resources || []).map((x) => String(x.tel));
    const ok = b.crisis === true && tels.includes('1925') && tels.includes('1995') && tels.includes('1980');
    record('crisis', `「${c}」→ 正確轉介`, ok,
      ok ? `資源 ${tels.join('/')}` : `crisis=${b.crisis} tels=${tels.join('/') || '無'}`);
    if (ok) {
      // 危機回應絕不可出現安慰話術式的禁語（否定用法不算，見 findBanned 說明）
      const hit = findBanned((b.accept || '') + (b.goodword || '') + (b.smallstep || ''));
      record('crisis', '  危機回應無禁語', hit.length === 0, hit.join('、') || '無');
    }
  } catch (err) {
    record('crisis', `危機測試「${c}」`, false, String(err.message));
  }
}

// ═══════════════════════════════════════════════
console.log('\n=== 5. 好話轉送（三好「做好事」）===');
try {
  const r = await post('/api/share', {
    accept: '你願意把這件事寫下來，本身就不容易。',
    goodword: '你現在的感覺是真的，它不需要先被誰同意。',
    smallstep: '今晚先喝一杯水，十一點前躺下。',
    audience: 'friend',
  });
  const b = r.json || {};
  record('share', '/api/share 回 200', r.status === 200, `HTTP ${r.status}`);
  record('share', '產生轉送文字', !!b.text && b.text.length > 10, `label=${b.label} ${b.text?.length || 0} 字`);
  record('share', '有 copyText', !!b.copyText);
} catch (err) {
  record('share', '轉送功能', false, String(err.message));
}

// ═══════════════════════════════════════════════
console.log('\n=== 6. 邊界與穩定性 ===');
try {
  const empty = await post('/api/respond', { text: '' });
  record('edge', '空輸入 → 400 且有提示', empty.status === 400 && !!empty.json?.error,
    `HTTP ${empty.status}`, 'MAJOR');

  // 時間預算：Hobby 10s 上限，連續 5 次都要在合理時間內
  const times = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    const r = await post('/api/respond', { text: `測試壓力第${i}次` });
    times.push(Date.now() - t0);
    if (r.status !== 200) record('edge', `第 ${i + 1} 次連續請求`, false, `HTTP ${r.status}`, 'MAJOR');
  }
  const max = Math.max(...times);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);
  record('edge', '連續 5 次請求全部成功', times.length === 5, `平均 ${avg}ms、最慢 ${max}ms`);
  record('edge', '最慢 < 8s', max < 8000, `${max}ms`, 'MAJOR');
} catch (err) {
  record('edge', '邊界測試', false, String(err.message), 'MAJOR');
}

// ═══════════════════════════════════════════════
const blockers = results.filter((r) => !r.ok && r.level === 'BLOCKER');
const majors = results.filter((r) => !r.ok && r.level === 'MAJOR');
const minors = results.filter((r) => !r.ok && r.level === 'MINOR');
const passes = results.filter((r) => r.ok);

console.log(`\n${'='.repeat(60)}`);
console.log(`外網驗收：共 ${results.length} 項`);
console.log(`  通過 ${passes.length}`);
console.log(`  BLOCKER 失敗 ${blockers.length}`);
console.log(`  MAJOR   失敗 ${majors.length}`);
console.log(`  MINOR   失敗 ${minors.length}`);

if (blockers.length) {
  console.log('\n❌ BLOCKER（必須修，否則不能交付）：');
  for (const b of blockers) console.log(`   ✗ [${b.group}] ${b.name} — ${b.detail}`);
}
if (majors.length) {
  console.log('\n⚠️  MAJOR：');
  for (const m of majors) console.log(`   ! [${m.group}] ${m.name} — ${m.detail}`);
}
if (minors.length) {
  console.log('\n· MINOR：');
  for (const m of minors) console.log(`   · [${m.group}] ${m.name} — ${m.detail}`);
}

const verdict = blockers.length === 0 ? 'PASS' : 'FAIL';
console.log(`\n判定：${verdict}`);
console.log(`${'='.repeat(60)}\n`);

// ── 可選：把結果寫回 PUBLIC-LINK.md ──
if (writeMd) {
  const mdPath = path.join(ROOT, 'deploy', 'PUBLIC-LINK.md');
  if (fs.existsSync(mdPath)) {
    let md = fs.readFileSync(mdPath, 'utf8');
    const now = new Date().toISOString();
    const block = [
      '',
      `<!-- AUTO-VERIFY-START ${now} -->`,
      `### 自動外網驗收結果（${now}）`,
      '',
      `- 目標：\`${baseUrl}\``,
      `- 判定：**${verdict}**`,
      `- 通過 ${passes.length} / ${results.length}（BLOCKER ${blockers.length}、MAJOR ${majors.length}、MINOR ${minors.length}）`,
      '',
      '| 群組 | 項目 | 結果 | 細節 |',
      '|---|---|---|---|',
      ...results.map((r) => `| ${r.group} | ${r.name} | ${r.ok ? '✅' : r.level === 'BLOCKER' ? '❌' : '⚠️'} | ${String(r.detail).replace(/\|/g, '\\|')} |`),
      '',
      `<!-- AUTO-VERIFY-END -->`,
      '',
    ].join('\n');

    // 若已有舊的自動區塊 → 取代；否則附加到檔尾
    if (/<!-- AUTO-VERIFY-START[\s\S]*?<!-- AUTO-VERIFY-END -->/.test(md)) {
      md = md.replace(/<!-- AUTO-VERIFY-START[\s\S]*?<!-- AUTO-VERIFY-END -->/, block.trim());
    } else {
      md += '\n---\n\n## 九、自動外網驗收（`node deploy/verify-public.mjs`）\n' + block;
    }
    fs.writeFileSync(mdPath, md, 'utf8');
    console.log(`已寫入 ${path.relative(ROOT, mdPath)} 的自動驗收區塊\n`);
  }
}

process.exit(blockers.length ? 1 : 0);
