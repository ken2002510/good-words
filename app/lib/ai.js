'use strict';

/**
 * ai.js — AI 可插拔 provider 介面（BRIEF §4 / §10）
 *
 * 三軌，順序不可變，逐軌降級：
 *   ① ollama  本機 qwen3:4b-instruct @ 127.0.0.1:11434   ← 平常最強、免費、離線、不上傳
 *   ② cloud   有環境變數 key 才啟用（OpenAI 相容端點），逾時 8s
 *   ③ rules   規則式，保證一定有回應，永不白畫面
 *
 * 每一軌都遵守同一份契約：
 *   respond(text, ctx) -> { 承接, 好話, 小步 } | null   （null = 無法產出，交給下一軌）
 * 而 output 必須通過 rules.lint()（反毒雞湯），不過就降級。
 *
 * ⚠️ 已踩過的坑：不要用檔案傳 JSON body（PowerShell 會寫入 BOM，Ollama 回
 *    `invalid character 'ï'`）。這裡一律用 Node 內建 fetch 直接送物件。
 */

const { lint, classifyEmotion, respond: rulesRespond, buildShare, toCopyText, BANNED } = require('./rules');
const { detectCrisis, crisisResponse } = require('./safety');

const OLLAMA_URL = process.env.OLLAMA_URL || 'http://127.0.0.1:11434';
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || 'qwen3:4b-instruct';
const OLLAMA_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS || 20000); // 實測 3.8s，留足餘裕

const CLOUD_URL = process.env.CLOUD_LLM_URL || 'https://api.openai.com/v1/chat/completions';
const CLOUD_MODEL = process.env.CLOUD_LLM_MODEL || 'gpt-4o-mini';
const CLOUD_TIMEOUT_MS = Number(process.env.CLOUD_TIMEOUT_MS || 8000);

// ─────────────────────────────────────────────────────────────
// ②b NVIDIA NIM（integrate.api.nvidia.com，OpenAI 相容格式）
//   key 一律從環境變數讀，絕不寫進程式碼或任何檔案。
//   本機實測用 NVKEY / NVIDIA_API_KEY；Vercel 上在後台設 NVIDIA_API_KEY。
// ─────────────────────────────────────────────────────────────
const NVIDIA_URL = process.env.NVIDIA_API_URL || 'https://integrate.api.nvidia.com/v1/chat/completions';
// 預設模型：實測選定（qa/_nv_bench.mjs v2，2026-11-04：bolt-e4b 4/4 PASS、avg 1.2s，
// 遠低於 Vercel 6.5s 預算）；可用 NVIDIA_MODEL 覆寫
const NVIDIA_MODEL = process.env.NVIDIA_MODEL || 'nvidia/nemotron-3.5-bolt-e4b';
// Vercel Hobby function 上限 10s（vercel.json maxDuration），預算內要留餘裕給降級。
// 2026-11 評審 P1-3：原本 6500ms。實測 NVIDIA 軌 P95 約 1.6s、8 併發 1.65s，
// 6.5 秒只是讓「真的壞掉時」的使用者多空等 5 秒 → 降到 2500ms（可用 env 覆寫）。
const NVIDIA_TIMEOUT_MS = Number(process.env.NVIDIA_TIMEOUT_MS || 2500);

/** 允許強制指定引擎（測試用）：AI_ENGINE=rules|ollama|nvidia|cloud|auto */
const FORCED = (process.env.AI_ENGINE || 'auto').toLowerCase();

const ENGINE_WHITELIST = ['auto', 'rules', 'ollama', 'nvidia', 'cloud'];

// ─────────────────────────────────────────────────────────────
// 共用：system prompt（BRIEF §5 的硬約束直接寫進去）
// ─────────────────────────────────────────────────────────────

/** 模式：chat=傾訴陪伴（預設）| rewrite=把一句重話改寫成好話 */
function sanitizeMode(mode) {
  return mode === 'rewrite' ? 'rewrite' : 'chat';
}

/**
 * 對話歷史消毒：最多 6 輪、每輪 300 字、role 只留 user/assistant。
 * 前端存在 localStorage，送出時帶上來；後端只原樣拼進 messages，
 * 不儲存、不記錄（BRIEF 隱私原則）。
 */
function sanitizeHistory(h) {
  if (!Array.isArray(h)) return [];
  return h
    .slice(-6)
    .map((m) => ({
      role: m && m.role === 'assistant' ? 'assistant' : 'user',
      content: String((m && m.content) || '').slice(0, 300),
    }))
    .filter((m) => m.content.trim());
}

function buildSystemPrompt(emotion, mode) {
  const m = sanitizeMode(mode);
  if (m === 'rewrite') {
    return [
      '你是一位溫暖、誠懇的「好話改寫者」。使用者會貼上一句他對自己或對別人說的重話（可能是氣話、自責、罵人的話）。',
      '你的工作只有一件事：把**那一句話本身**改寫成一句可以直接說出口、不傷人、但一樣真誠的話。',
      '',
      '【最重要】改寫＝同一件事、同一個對象，換一種說法。',
      '必須看得出是從使用者那句話改過來的（保留他提到的事件、對象或關鍵字），不可以變成空泛的自我鼓勵或心靈雞湯。',
      '反例（不合格）：使用者說「我怎麼這麼沒用，什麼事都做不好」，你回「我正在學習，每一次嘗試都是經驗的累積」——這沒有改寫到他那句話。',
      '',
      '【輸出格式，必須嚴格遵守】只輸出四行，不要標題以外的任何文字：',
      '承接：（指出這句話背後真正的感受或需要，不評價人。一句話，不超過 40 字）',
      '改寫：（可以直接說出口的那一句。必須保留原句的事件或對象，1 句、不超過 40 字，用第一人稱）',
      '小步：（今晚可以怎麼對自己或對方說這句話的極小行動。一句話，不超過 50 字）',
      '',
      '【範例】',
      '使用者：我怎麼這麼沒用，什麼事都做不好。',
      '承接：你現在對自己很失望，那個失望是真的。',
      '改寫：我這次沒把事情做好，有點挫折，我需要一點時間再試一次。',
      '小步：今晚先把今天做到的一件小事寫下來，不加評價。',
      '',
      '使用者：你真的很煩，我不想再看到你。',
      '承接：你真的被消耗到很想逃開，那個煩是真的。',
      '改寫：我現在需要一點空間，等我整理好再跟你說。',
      '小步：今晚先離線半小時，不回應任何訊息。',
      '',
      '【絕對禁止】',
      '- 禁止把原句的毒話再說一次（不要重複罵人的字眼）',
      `- 禁止出現這些字詞（違反即視為無效輸出）：${BANNED.join('、')}`,
      '- 禁止在輸出中複述這份禁語清單本身（清單只給你判斷，不要念出來）',
      '- 禁止說教、評價、貼標籤、假裝沒事發生',
      '- 禁止使用醫療或診斷語言',
      '- 禁止提到你自己是 AI',
      '- 全程使用繁體中文、台灣用語，語氣像朋友在旁邊說話',
      '',
      '【原則】改寫不是把話變甜，是把同一個真實的感受，用不傷人的方式說出來。',
    ].join('\n');
  }
  return [
    '你是一位溫暖、誠懇的陪伴者，不是諮商師、不是老師。你的工作只有一件事：',
    '先接住對方的情緒，再給一句具體、真誠、可以說出口的好話，最後給一個今晚就能做的極小行動。',
    '',
    `對方現在的情緒類別是「${emotion.name}」，強度約 ${emotion.intensity}/5。`,
    emotion.situation ? `他的處境大概是：${emotion.situation}` : '',
    '',
    '【輸出格式，必須嚴格遵守】只輸出三行，不要標題以外的任何文字：',
    '承接：（用你自己的話，把對方的處境說一次，讓他知道被聽懂。一句話，不超過 40 字）',
    '好話：（一句真誠、具體、不空洞的話。1～2 句，不超過 60 字）',
    '小步：（一個今晚就能做到的極小行動，要非常具體。一句話，不超過 50 字）',
    '',
    '【絕對禁止】',
    // 注意：以下禁語清單是「告訴模型不要說」，不是本作品會輸出的話。
    // 為了讓機械式 lint 掃描不會把它誤報成違規，統一改由 lib/rules.js 的 BANNED 常數帶入，
    // 並在句首明確標示「禁止」語境。
    `- 禁止出現這些字詞（違反即視為無效輸出）：${BANNED.join('、')}`,
    '- 禁止在輸出中複述這份禁語清單本身（清單只給你判斷，不要念出來）',
    '- 禁止說教、評價、貼標籤、給一串建議清單',
    '- 禁止假裝問題不存在',
    '- 禁止使用醫療或診斷語言（憂鬱症、確診、症狀…）',
    '- 禁止提到你自己是 AI、禁止說「根據分析」',
    '- 不要用「親愛的」「寶貝」這類稱呼',
    '- 全程使用繁體中文、台灣用語，語氣像朋友在旁邊說話',
    '',
    '【最重要的原則】承認他的困難是真的，同時讓他知道他還沒有看見的力量。短，比長好。',
  ].filter(Boolean).join('\n');
}

/** 把 history + 本次輸入組成 messages 陣列（所有雲端/本機軌共用） */
function buildMessages(systemPrompt, text, history) {
  return [
    { role: 'system', content: systemPrompt },
    ...sanitizeHistory(history),
    { role: 'user', content: String(text) },
  ];
}

// ─────────────────────────────────────────────────────────────
// 解析：把模型輸出切成三段（Lead 實測：模型會照「承接：/好話：/小步：」走）
// ─────────────────────────────────────────────────────────────

/** 剝除 qwen3 的  thinking...</think>（有時會吐、有時不會，一定要防） */
function stripThink(raw) {
  return String(raw || '')
    .replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, '')
    .replace(/<think(?:ing)?>[\s\S]*$/i, '') // 沒收尾的
    .trim();
}

/** 移除 markdown 裝飾與編號前綴 */
function cleanLine(s) {
  return String(s || '')
    .replace(/^[\s>*\-•]+/, '')
    .replace(/^\*\*(.+?)\*\*$/, '$1')
    .replace(/^#+\s*/, '')
    .trim();
}

/**
 * 解析三段。支援三種寫法，容錯：
 *   A) 承接：xxx\n好話：xxx\n小步：xxx   （主要）
 *   B) JSON {"承接":..,"好話":..,"小步":..}
 *   C) 縮寫 accept/goodword/smallstep、或 1. 2. 3.
 * 切不出三段 → 回 null（交給下一軌）。
 */
function parseThreeParts(raw) {
  if (!raw) return null;
  const text = stripThink(raw);
  if (!text) return null;

  // B) JSON
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const o = JSON.parse(jsonMatch[0]);
      const accept = o.承接 ?? o.accept;
      const goodword = o.好話 ?? o.goodword ?? o.改寫 ?? o.rewrite;
      const smallstep = o.小步 ?? o.smallstep;
      if (accept && goodword) {
        return { 承接: cleanLine(accept), 好話: cleanLine(goodword), 小步: cleanLine(smallstep || ''), 改寫: cleanLine(o.改寫 ?? o.rewrite ?? '') };
      }
    } catch { /* 繼續走文字解析 */ }
  }

  // A) 標籤式（全形／半形冒號都吃）
  const grab = (labels) => {
    const alt = labels.join('|');
    const re = new RegExp(`(?:^|\\n)\\s*(?:[*#\\-•\\d.、\\s]*)(?:${alt})\\s*[:：]\\s*([\\s\\S]*?)(?=\\n\\s*(?:[*#\\-•\\d.、\\s]*)(?:承接|accept|好話|goodword|小步|smallstep|行動|下一步)\\s*[:：]|$)`, 'i');
    const m = text.match(re);
    return m ? cleanLine(m[1].replace(/\s*\n\s*/g, ' ')) : '';
  };

  const accept = grab(['承接', 'accept', '聽懂', '接住']);
  // 改寫模式會用「改寫：」這個標籤；兩種都收（舊版模型輸出「好話：」也相容）
  const rewriteLine = grab(['改寫', 'rewrite', '可以這樣說', '換句話說']);
  const goodword = rewriteLine || grab(['好話', 'goodword', '好話一句']);
  const smallstep = grab(['小步', 'smallstep', '小行動', '行動', '下一步']);

  if (accept && goodword) {
    return {
      承接: accept,
      好話: goodword,
      改寫: rewriteLine || '',
      小步: smallstep || '今晚先做一件小事：喝一杯水，然後在十一點前躺下。',
    };
  }

  // C) 三段沒有標籤：抓非空行，前三行當三段
  const lines = text.split('\n').map(cleanLine).filter(Boolean);
  if (lines.length >= 3) {
    return { 承接: lines[0], 好話: lines[1], 小步: lines.slice(2).join(' ') };
  }
  return null;
}

// ─────────────────────────────────────────────────────────────
// ① Ollama
// ─────────────────────────────────────────────────────────────

/** 先問 /api/tags 確認服務活著（快，失敗就立刻降級，不浪費 20 秒） */
async function ollamaAlive(timeoutMs = 1500) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(`${OLLAMA_URL}/api/tags`, { signal: ctrl.signal });
    if (!r.ok) return false;
    const j = await r.json();
    const names = (j.models || []).map((m) => m.name || m.model || '');
    return { alive: true, hasModel: names.some((n) => n.startsWith(OLLAMA_MODEL.split(':')[0])) };
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

async function ollamaRespond(text, emotion, opts, log) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OLLAMA_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }, // fetch 直接送物件，不繞檔案 → 不會有 BOM
      signal: ctrl.signal,
      body: JSON.stringify({
        model: OLLAMA_MODEL,
        messages: buildMessages(buildSystemPrompt(emotion, opts.mode), text, opts.history),
        stream: false,
        options: { temperature: 0.7, num_predict: 300 },
      }),
    });
    if (!r.ok) {
      log(`ollama HTTP ${r.status}`);
      return null;
    }
    const j = await r.json();
    const parts = parseThreeParts(j?.message?.content);
    if (!parts) {
      log('ollama 輸出切不出三段');
      return null;
    }
    const check = lint(parts);
    if (!check.ok) {
      log(`ollama 輸出違反規則：${check.reasons.join('、')}`);
      return null;
    }
    return { parts, elapsedMs: Date.now() - t0, model: OLLAMA_MODEL, engine: 'ollama' };
  } catch (err) {
    log(`ollama 失敗：${err && err.name === 'AbortError' ? '逾時' : String(err && err.message)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// ② 雲端（只有真的有 key 才啟用；BRIEF 已註明本機 key 不可用，所以這軌平常是關的）
// ─────────────────────────────────────────────────────────────

function cloudKey() {
  return process.env.CLOUD_LLM_API_KEY || process.env.OPENAI_API_KEY || '';
}

async function cloudRespond(text, emotion, opts, log) {
  const key = cloudKey();
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), CLOUD_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(CLOUD_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: CLOUD_MODEL,
        temperature: 0.7,
        max_tokens: 400,
        messages: buildMessages(buildSystemPrompt(emotion, opts.mode), text, opts.history),
      }),
    });
    if (!r.ok) {
      log(`cloud HTTP ${r.status}`);
      return null;
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content;
    const parts = parseThreeParts(raw);
    if (!parts) return null;
    const check = lint(parts);
    if (!check.ok) {
      log(`cloud 輸出違反規則：${check.reasons.join('、')}`);
      return null;
    }
    return { parts, elapsedMs: Date.now() - t0, model: CLOUD_MODEL, engine: 'cloud' };
  } catch (err) {
    log(`cloud 失敗：${err && err.name === 'AbortError' ? '逾時' : String(err && err.message)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// ②b NVIDIA NIM（integrate.api.nvidia.com）—— OpenAI 相容 chat completions
//    ★ 上架版（Vercel）的主要 AI 軌：有 key 就走這裡，逾時/失敗自動降級規則式
// ─────────────────────────────────────────────────────────────

function nvidiaKey() {
  return process.env.NVIDIA_API_KEY || process.env.NVKEY || '';
}

/** reasoning 類模型（deepseek / nemotron omni 等）加 reasoning_effort=none 可大幅降延遲 */
function nvidiaExtraBody() {
  const m = (NVIDIA_MODEL || '').toLowerCase();
  if (/deepseek|reasoning|omni/.test(m)) return { reasoning_effort: 'none' };
  return {};
}

async function nvidiaRespond(text, emotion, opts, log) {
  const key = nvidiaKey();
  if (!key) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), NVIDIA_TIMEOUT_MS);
  const t0 = Date.now();
  try {
    const r = await fetch(NVIDIA_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: ctrl.signal,
      body: JSON.stringify({
        model: NVIDIA_MODEL,
        temperature: 0.7,
        max_tokens: 400,
        messages: buildMessages(buildSystemPrompt(emotion, opts.mode), text, opts.history),
        ...nvidiaExtraBody(),
      }),
    });
    if (!r.ok) {
      // 把錯誤 body 讀出來但只留前綴，避免把 key 之類的東西印進 log（key 在 header，不會在 body）
      let detail = '';
      try { detail = JSON.stringify(await r.json()).slice(0, 160); } catch { /* ignore */ }
      log(`nvidia HTTP ${r.status}${detail ? ' ' + detail : ''}`);
      return null;
    }
    const j = await r.json();
    const raw = j?.choices?.[0]?.message?.content;
    const parts = parseThreeParts(raw);
    if (!parts) {
      log('nvidia 輸出切不出三段');
      return null;
    }
    const check = lint(parts);
    if (!check.ok) {
      log(`nvidia 輸出違反規則：${check.reasons.join('、')}`);
      return null;
    }
    return { parts, elapsedMs: Date.now() - t0, model: NVIDIA_MODEL, engine: 'nvidia' };
  } catch (err) {
    log(`nvidia 失敗：${err && err.name === 'AbortError' ? '逾時' : String(err && err.message)}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ─────────────────────────────────────────────────────────────
// 主流程（三軌自動降級）
// ─────────────────────────────────────────────────────────────

const recentErrors = [];
function pushLog(msg) {
  recentErrors.push({ at: new Date().toISOString(), msg: String(msg) });
  if (recentErrors.length > 50) recentErrors.shift();
}

/**
 * @param {string} text 使用者輸入
 * @param {{force?: 'auto'|'rules'|'ollama'|'nvidia'|'cloud',
 *          mode?: 'chat'|'rewrite',
 *          history?: Array<{role: 'user'|'assistant', content: string}>}} opts
 */
async function generate(text, opts = {}) {
  const t0 = Date.now();
  const force = (opts.force || FORCED || 'auto').toLowerCase();
  const mode = sanitizeMode(opts.mode);
  const callOpts = { mode, history: opts.history };

  // ── 第 0 步：危機護欄。永遠優先，且不經過任何模型（BRIEF §6）──
  //   chat / rewrite 兩種模式都一樣：危機訊號絕不進模型。
  const { crisis } = detectCrisis(text);
  if (crisis) {
    const res = crisisResponse();
    res.meta.elapsedMs = Date.now() - t0;
    res.meta.mode = mode;
    return res;
  }

  const emotionRule = classifyEmotion(text);

  // ── 最後一軌先算好：它同時是最終保險，也是 fallback 基準 ──
  const ruleResult = () => {
    const r = rulesRespond(text, { mode });
    r.meta.elapsedMs = Date.now() - t0;
    r.meta.mode = mode;
    // 改寫模式：規則引擎也要回「原句 / 改寫句」，行為才與模型軌一致
    if (mode === 'rewrite') {
      r.original = String(text || '').trim().slice(0, 200);
      r.rewrite = r.goodword;
      r.meta.rewriteChecked = true;
      r.meta.rewriteFallback = true;
    }
    return r;
  };

  if (force === 'rules') {
    const r = ruleResult();
    r.meta.degradedReason = '指定使用規則式引擎';
    return r;
  }

  // ── ① Ollama（本機，免費離線）──
  let used = null;
  if (force === 'auto' || force === 'ollama') {
    const alive = await ollamaAlive();
    if (!alive) {
      pushLog('ollama 未啟動或無回應，降級');
    } else {
      used = await ollamaRespond(text, emotionRule, callOpts, pushLog);
    }
  }

  // ── ② NVIDIA NIM（上架版主力：有 key 才打，逾時即降）──
  if (!used && (force === 'auto' || force === 'nvidia')) {
    if (nvidiaKey()) used = await nvidiaRespond(text, emotionRule, callOpts, pushLog);
    else if (force === 'nvidia') pushLog('nvidia 未設定 API key（NVIDIA_API_KEY / NVKEY）');
  }

  // ── ③ 其他雲端（OpenAI 相容端點，有 key 才啟用）──
  if (!used && (force === 'auto' || force === 'cloud')) {
    if (cloudKey()) used = await cloudRespond(text, emotionRule, callOpts, pushLog);
    else if (force === 'cloud') pushLog('cloud 未設定 API key');
  }

  // ── ④ 規則式 ──
  if (!used) {
    const r = ruleResult();
    r.emotion = { ...emotionRule }; // 規則引擎自己的分類較完整
    return r;
  }

  // ── 改寫模式：驗證「這到底有沒有改寫」──
  //   2026-11 使用者反映「改寫一句重話，AI 回的不太對、沒有改寫」。
  //   實測：模型常常回成空泛的自我鼓勵（例：原句「我怎麼這麼沒用」→
  //   「我正在學習，每一次嘗試都是經驗的累積」），完全沒有改寫到那句話。
  //   這裡做兩件事：① 檢查改寫句是否真的與原句有關（共用內容字）② 不合格就用
  //   rules.respondRewrite()（人工寫好的改寫表 + 絕對化軟化）當確定性退路。
  let rewriteInfo = null;
  if (mode === 'rewrite') {
    const candidate = used.parts.改寫 || used.parts.好話 || '';
    const check = isRealRewrite(text, candidate);
    if (check.ok) {
      rewriteInfo = { text: candidate, fallback: false, overlap: check.overlap };
    } else {
      const fb = rulesRespond(text, { mode: 'rewrite' });
      pushLog(`rewrite 驗證未通過（${check.reason}）→ 改用規則式改寫`);
      rewriteInfo = { text: fb.goodword, fallback: true, reason: check.reason, overlap: check.overlap };
      used.parts = { 承接: fb.accept, 好話: fb.goodword, 小步: fb.smallstep };
      used.engine = 'rules';
      used.model = null;
      used.rewriteFallback = true;
    }
  }

  // 用模型的三段 + 規則引擎的情緒標籤（標籤是確定性的，不讓模型自己編）
  const result = {
    crisis: false,
    emotion: {
      id: emotionRule.id,
      name: emotionRule.name,
      intensity: emotionRule.intensity,
      situation: emotionRule.situation,
      alternatives: emotionRule.alternatives,
      unlabeled: emotionRule.unlabeled,
    },
    accept: used.parts.承接,
    goodword: used.parts.好話,
    smallstep: used.parts.小步,
    resources: null,
    meta: {
      engine: used.engine || 'ollama',
      model: used.model,
      mode,
      degraded: Boolean(used.rewriteFallback),
      degradedReason: used.rewriteFallback ? '改寫驗證未通過，改用規則式改寫' : null,
      elapsedMs: Date.now() - t0,
      rewriteChecked: mode === 'rewrite' ? true : undefined,
      rewriteFallback: mode === 'rewrite' ? Boolean(used.rewriteFallback) : undefined,
    },
  };
  // 改寫模式：明確回一個「改寫後的句子」欄位，前端才能把它跟原句並排顯示
  if (mode === 'rewrite' && rewriteInfo) {
    result.original = String(text || '').trim().slice(0, 200);
    result.rewrite = rewriteInfo.text;
    result.goodword = rewriteInfo.text;   // 相容：牆／分享文字仍用 goodword
    result.meta.rewriteOverlap = rewriteInfo.overlap;
  }
  return result;
}

/**
 * 「這句到底有沒有改寫到原句？」的檢查（改寫模式專用）。
 *
 * 判準（寬鬆但足以擋掉空泛雞湯）：
 *   1. 長度 6–70 字
 *   2. 與原句共用 ≥2 個「內容字」（去掉我／你／是／的…這類停用字），
 *      或共用 1 個內容字且句中出現明確的需要語彙（我需要／我想要／我希望／我覺得）
 *   3. 不是純粹的空泛鼓勵（「你很棒」「一切都會好」這類）
 *
 * 回 { ok, overlap, reason }
 */
function isRealRewrite(original, candidate) {
  const cand = String(candidate || '').trim();
  if (!cand) return { ok: false, overlap: 0, reason: '沒有改寫句' };
  if (cand.length < 6) return { ok: false, overlap: 0, reason: '太短' };
  if (cand.length > 70) return { ok: false, overlap: 0, reason: '太長' };
  if (/^(你很棒|你好棒|一切都會好|加油|相信自己|你可以的)[！。！\s]*$/.test(cand)) {
    return { ok: false, overlap: 0, reason: '空泛鼓勵' };
  }
  const STOP = new Set('我你他她牠它是不了的嗎呢啊吧就都很也還在有和與跟把被這那會要個一二三四五六七八九十');
  const chars = (s) => new Set(Array.from(String(s)).filter((c) => /[\u4e00-\u9fff]/.test(c) && !STOP.has(c)));
  const A = chars(original);
  const B = chars(cand);
  let overlap = 0;
  for (const c of A) if (B.has(c)) overlap++;
  // 「我需要一點空間」這種把需求說出來的句子，即使只共用 1 個內容字也算真改寫；
  // 但「今天/這次」太泛，不能單獨當作關聯證據（實測會誤收不相干的句子）。
  const hasNeed = /我(現在|真的|其實)?(需要|想要|希望|覺得|會試|想)/.test(cand);
  if (overlap >= 2) return { ok: true, overlap, reason: '' };
  if (overlap >= 1 && hasNeed) return { ok: true, overlap, reason: '' };
  return { ok: false, overlap, reason: `與原句關聯不足（共用內容字 ${overlap} 個）` };
}

/** 雲端第八軌的輸出也用同一套模板轉送（避免兩條路徑行為不一致） */
function buildShareWithTone(result, audience, toneId) {
  return buildShare(result, audience, toneId);
}

module.exports = {
  generate,
  buildShare: buildShareWithTone,
  toCopyText,
  parseThreeParts,
  isRealRewrite,
  stripThink,
  buildSystemPrompt,
  ollamaAlive,
  recentErrors,
  OLLAMA_URL,
  OLLAMA_MODEL,
  OLLAMA_TIMEOUT_MS,
  cloudKey,
  nvidiaKey,
  NVIDIA_URL,
  NVIDIA_MODEL,
  NVIDIA_TIMEOUT_MS,
  ENGINE_WHITELIST,
  sanitizeMode,
  sanitizeHistory,
};
