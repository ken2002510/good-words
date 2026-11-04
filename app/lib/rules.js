'use strict';

/**
 * rules.js — 規則式引擎（第三軌，保證一定有回應，永不白畫面）
 *
 * 也是 BRIEF §5「反毒雞湯」的執行者：
 *  - 產出的每一句話都要通過 lint()（禁止「加油」「你可以的」「別想太多」…）
 *  - lint 不過就換一句，換到沒有為止；真的都沒有才用安全備援句
 *
 * 情緒分類全部由 lib/data.js 載入的詞庫驅動（content/ 的 14 類，或內建 fallback 8 類）。
 */

const { getContent } = require('./data');

/** BRIEF §5 禁語（毒雞湯 / 說教 / 假裝問題不存在） */
const BANNED = [
  '加油', '你可以的', '別想太多', '想開一點', '看開一點', '要開心', '往好處想',
  '一切都會好的', '一切都會好起來', '明天會更好', '會過去的啦', '沒事的啦', '没事的啦',
  '開心一點', '樂觀一點', '正面一點', '知足', '至少你還有', '比上不足',
  '你應該', '你必須', '你要堅強', '堅強一點', '不要難過', '別難過', '不要哭',
  '這沒什麼', '沒那麼嚴重', '小題大作', '世界很美好', '感恩', '惜福',
];

/** 醫療／診斷語言（BRIEF §5 禁止） */
const CLINICAL = ['憂鬱症', '焦慮症', '確診', '診斷', '病識感', '症狀', '療程', '處方', '用藥'];

/** 自稱 AI／後設語言（BRIEF §5 禁止） */
const META = ['ai認為', '根據分析', '作為一個ai', '我是ai', '語言模型', '根據我的分析', '數據顯示'];

/**
 * 品質檢查。回傳 { ok, reasons[] }
 * @param {{承接:string, 好話:string, 小步:string}} parts
 */
/**
 * 同時吃兩種欄位命名：
 *   - 內部模板庫：{ 承接, 好話, 小步 }
 *   - API 回應：  { accept, goodword, smallstep }
 * 早期版本只吃前者，導致拿 API 結果去 lint 時會被誤判成「空白回應」，
 * 進而讓好句子被當成不合格丟掉。兩種都支援。
 */
function normalizeParts(parts) {
  const p = parts || {};
  return {
    承接: String(p.承接 ?? p.accept ?? ''),
    好話: String(p.好話 ?? p.goodword ?? p.good ?? ''),
    小步: String(p.小步 ?? p.smallstep ?? p.step ?? ''),
  };
}

function lint(parts) {
  const reasons = [];
  const p = normalizeParts(parts);
  const text = [p.承接, p.好話, p.小步].filter(Boolean).join('\n');
  if (!text.trim()) return { ok: false, reasons: ['空白回應'] };

  for (const w of BANNED) if (text.includes(w)) reasons.push(`禁語：${w}`);
  for (const w of CLINICAL) if (text.includes(w)) reasons.push(`醫療語言：${w}`);
  const lower = text.toLowerCase();
  for (const w of META) if (lower.includes(w)) reasons.push(`後設語言：${w}`);

  // 太長（BRIEF：超過 3 句像作文）
  const sentences = p.好話 ? p.好話.split(/[。！？!?]/).filter((s) => s.trim()).length : 0;
  if (sentences > 3) reasons.push('好話超過 3 句');

  return { ok: reasons.length === 0, reasons };
}

/**
 * 從模板庫挑一句通過 lint 的。用 seed 讓同一段輸入得到穩定的一句
 * （使用者重送不會每次跳不同句子）。
 */
function pick(list, seed) {
  if (!list || !list.length) return null;
  const n = list.length;
  const start = Math.abs(Number(seed) || 0) % n;
  for (let i = 0; i < n; i++) {
    const cand = list[(start + i) % n];
    if (!cand) continue;
    if (lint(cand).ok) return cand;
  }
  return null;
}

/** 最後的最後（連模板庫都掛掉時）——本身已通過 lint 檢查 */
const LAST_RESORT = {
  承接: '你願意把這件事寫下來，本身就不容易。',
  好話: '你現在的感覺是真的，它不需要先被誰同意。',
  小步: '今晚先做一件小事：喝一杯水，然後在十一點前躺下。',
};

/** 決定性 seed，讓同一段輸入得到穩定的一句 */
function hashSeed(s) {
  let h = 2166136261;
  const str = String(s || '');
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

// ─────────────────────────────────────────────────────────────
// 情緒分類（規則式：關鍵字計分 + 文字強度詞）
// ─────────────────────────────────────────────────────────────

const NEGATIONS = ['不', '沒', '別', '沒有'];

/**
 * 強度：content 的 intensity 欄位是**文字**（例如「有點」「常常覺得」「一直覺得」「真的覺得」），
 * 依指示不得假設它是數字。所以兩條路都做：
 *   ① 使用者句子裡出現的強度詞 → 直接對應分數（最準）
 *   ② 都沒有 → 用該類別 intensity 文字陣列的長度當基準
 */
const INTENSITY_WORDS = [
  { words: ['有點', '稍微', '還好', '一點點', '偶爾', '有時候'], score: 2 },
  { words: ['常常', '經常', '總是', '每天', '每次', '一直', '不斷', '好多'], score: 4 },
  { words: ['真的', '非常', '超', '極', '爆炸', '崩潰', '受不了', '極度', '完全', '快瘋'], score: 5 },
  { words: ['覺得', '感覺', '好像'], score: 3 },
];

function scoreIntensity(text, emotion) {
  for (let i = INTENSITY_WORDS.length - 1; i >= 0; i--) {
    const g = INTENSITY_WORDS[i];
    if (g.words.some((w) => text.includes(w))) return g.score;
  }
  // 使用者沒給線索 → 用該類別 intensity 描述詞的數量當基準（文字陣列越長＝光譜越廣）
  const words = (emotion && emotion.intensityWords) || [];
  if (words.length >= 8) return 4;
  if (words.length >= 4) return 3;
  const d = emotion && typeof emotion.intensity === 'number' ? emotion.intensity : 3;
  return Math.max(2, Math.min(5, d));
}

/**
 * 比對用的正規化：把標點與空白拿掉，讓「我什麼都做不好」也能對上詞庫的
 * 「我什麼都做不好」（使用者常在中間加逗號：「我沒用，什麼都做不好」）。
 * 只在比對時使用，不會影響回傳的原文。
 */
function matchNormalize(text) {
  return String(text || '')
    .replace(/[\s\u3000]+/g, '')
    .replace(/[，。！？、,.!?~～…\-—_*「」『』()（）\[\]【】"'`；;：:]/g, '');
}

/**
 * 詞庫裡的關鍵字（例如「我很沒用」）常與實際口語有落差（使用者寫「自己很沒用」）。
 * 因此除了完整字串比對，再用「關鍵字的核心片段」做一次寬鬆比對：
 * 取關鍵字去掉開頭自稱詞後剩下的部分當核心。
 */
function keywordCore(k) {
  return k.replace(/^(我|自己|我的|我自己)/, '');
}

function scoreEmotion(rawText, emotion, normalized) {
  let score = 0;
  const text = normalized;

  for (const kw of emotion.keywords) {
    const k0 = String(kw).trim();
    if (!k0) continue;
    const k = matchNormalize(k0);
    if (!k) continue;

    let hit = 0;
    let idx = text.indexOf(k);
    while (idx !== -1) {
      hit++;
      // 否定詞緊貼在關鍵字前面 → 分數減半（「我不生氣」不該算生氣）
      const before = text.slice(Math.max(0, idx - 2), idx);
      const penalty = NEGATIONS.some((n) => before.includes(n)) ? 1 : 0;
      score += (k.length >= 3 ? 3 : 2) - penalty;
      idx = text.indexOf(k, idx + k.length);
    }

    // 完整字串沒中 → 用核心片段再試（「我很沒用」→「很沒用」對上「自己很沒用」）
    if (!hit) {
      const core = keywordCore(k);
      if (core.length >= 2 && core !== k && text.includes(core)) score += 2;
    }
  }
  void rawText;
  return score;
}

/**
 * @param {string} text
 * @returns {{id, name, intensity, situation, score, alternatives, unlabeled}}
 */
function classifyEmotion(text) {
  const content = getContent();
  const t = String(text || '');
  const normalized = matchNormalize(t);
  const scored = content.emotions
    .map((e, i) => ({ e, i, score: scoreEmotion(t, e, normalized) }))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const top = scored[0];
  const alternatives = scored.slice(1, 4).filter((s) => s.score > 0).map((s) => s.e.name);

  if (!top || top.score === 0) {
    // 沒有任何關鍵字命中 → 不亂貼標籤，給一個中性、不評價的標籤
    return {
      id: '_any',
      name: '說不出口的心情',
      intensity: 3,
      situation: '你可能有話想說，但還不確定那是什麼。',
      score: 0,
      alternatives: [],
      unlabeled: true,
    };
  }

  return {
    id: top.e.id,
    name: top.e.name,
    intensity: scoreIntensity(t, top.e),
    situation: top.e.situation,
    score: top.score,
    alternatives,
    unlabeled: false,
  };
}

// ─────────────────────────────────────────────────────────────
// 主回應
// ─────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────
// 改寫模式（mode=rewrite）的規則式 fallback
//   LLM 不可用時，「重話 → 好話」仍要能運作。
//   策略：① 命中常見毒話 pattern → 給人工寫好的改寫
//         ② 都沒中 → 把絕對化字眼（永遠/總是/絕對…）軟化，再包成三段
// ─────────────────────────────────────────────────────────────

const REWRITE_PATTERNS = [
  {
    re: /沒用|廢物|很爛|一無是處|白痴|垃圾/,
    accept: '你現在對自己很失望，那個失望是真的。',
    goodword: '但「沒用」這兩個字太重了——你只是今天這件事沒做好，那不等於你是誰。',
    smallstep: '今晚試著對自己說一句：「今天的我確實需要休息。」',
  },
  {
    re: /去死|早死|死一死/,
    accept: '你現在氣到極點，那股火是真的。',
    goodword: '生氣沒有錯，但把火燒向自己或別人，只會讓明天更痛。',
    smallstep: '先深呼吸三次，等火小一點，再決定要說什麼。',
  },
  {
    re: /很煩|很賤|討厭|白目|智障|有病/,
    accept: '這個人或這件事真的讓你很不舒服。',
    goodword: '不舒服的感覺可以說，但罵人的話一旦出口，傷口就回不去了。',
    smallstep: '把想罵的話寫下來，改成「我覺得…所以我有點…」。',
  },
  {
    re: /為什麼(每次|總是|都).*我|都是我/,
    accept: '你覺得好像什麼事都壓在你身上，那種委屈是真的。',
    goodword: '但「都是我」太絕对了——有些事不是你一個人造成的。',
    smallstep: '今晚列出三件「不是只有你在扛」的事。',
  },
];

/** 軟化絕對化字眼的簡單改寫（規則式，當通用 fallback） */
function simpleRewrite(text) {
  let t = String(text || '');
  t = t.replace(/(永遠|總是|從來|絕對|每次都|都)/g, (m) => (m === '每次都' || m === '都' ? '有時候' : '有時候'));
  t = t.replace(/^我就是/, '我現在覺得好像');
  t = t.replace(/我覺得(我)?/, '我現在覺得');
  return t;
}

function respondRewrite(text, { seed } = {}) {
  const t0 = Date.now();
  const t = String(text || '');
  const s = seed === undefined ? hashSeed(t) : seed;

  for (const p of REWRITE_PATTERNS) {
    if (p.re.test(t)) {
      const parts = { 承接: p.accept, 好話: p.goodword, 小步: p.smallstep };
      if (lint(parts).ok) {
        return {
          crisis: false,
          emotion: { id: '_rewrite', name: '想改口的話', intensity: 3, situation: '你想把一句重話，說得不傷人。' },
          accept: parts.承接,
          goodword: parts.好話,
          smallstep: parts.小步,
          resources: null,
          meta: { engine: 'rules', model: null, degraded: true, mode: 'rewrite', elapsedMs: Date.now() - t0, contentSource: 'builtin-rewrite' },
        };
      }
    }
  }

  // 通用：軟化後包三段
  const soft = simpleRewrite(t).slice(0, 60);
  const parts = {
    承接: '這句話背後的感受是真的，只是說出來的方式太重了。',
    好話: soft ? `可以試試這樣說：「${soft}。」` : '同一個意思，換個不刺人的說法，對方才聽得進去。',
    小步: '今晚把這句話寫下來，明天換一個時間、用平靜的語氣說。',
  };
  void s;
  return {
    crisis: false,
    emotion: { id: '_rewrite', name: '想改口的話', intensity: 3, situation: '你想把一句重話，說得不傷人。' },
    accept: parts.承接,
    goodword: parts.好話,
    smallstep: parts.小步,
    resources: null,
    meta: { engine: 'rules', model: null, degraded: true, mode: 'rewrite', elapsedMs: Date.now() - t0, contentSource: 'builtin-rewrite-generic' },
  };
}

/**
 * 規則式主回應（最後一軌）
 * @param {string} text
 * @param {{seed?: number, mode?: 'chat'|'rewrite'}} opts
 * @returns 三段結構 + meta
 */
function respond(text, { seed, mode } = {}) {
  if (mode === 'rewrite') return respondRewrite(text, { seed });
  const t0 = Date.now();
  const content = getContent();
  const emotion = classifyEmotion(text);

  const s = seed === undefined ? hashSeed(text) : seed;

  // ★ 先只用該情緒類別的語料。命中類別時**不要混入 _any 通用句**，
  //   否則通用 fallback 句會蓋掉內容組寫的專屬好話（實測會發生）。
  let parts = pick(content.goodwords[emotion.id], s);

  // 該類別沒有可用語料（缺漏或被 lint 全擋）→ 才退到通用句
  if (!parts && emotion.id !== '_any') parts = pick(content.goodwords._any, s);

  if (!parts) parts = LAST_RESORT;

  // 最後一次防線：萬一被別人的內容庫污染，硬擋禁語
  if (!lint(parts).ok) {
    const safe = pick(content.goodwords._any || [], s + 1);
    parts = safe && lint(safe).ok ? safe : LAST_RESORT;
  }

  // 標記這句是不是真的來自內容組（給驗收用，也方便除錯）
  const fromContent = !!(content.goodwords[emotion.id] || []).some((x) => x.好話 === parts.好話);

  return {
    crisis: false,
    emotion: {
      id: emotion.id,
      name: emotion.name,
      intensity: emotion.intensity,
      situation: emotion.situation,
      alternatives: emotion.alternatives,
      unlabeled: emotion.unlabeled,
    },
    accept: parts.承接,
    goodword: parts.好話,
    smallstep: parts.小步,
    resources: null,
    meta: {
      engine: 'rules',
      model: null,
      mode: 'chat',
      degraded: true,
      degradedReason: '本機模型未啟用，使用規則式回應',
      elapsedMs: Date.now() - t0,
      contentSource: content.usingFallback ? 'builtin-fallback' : 'content-dir',
      templateFromContent: fromContent,
    },
  };
}

/**
 * 「好話轉送」（BRIEF §3 做好事）：把這句好話變成可以送給別人的版本。
 * @param {'friend'|'family'|'colleague'} audience
 */
function buildShare(result, audience = 'friend', toneId) {
  const content = getContent();
  const st = content.shareTemplates || {};
  const tpl = st.default || {};
  const a = tpl[audience] || tpl.friend || {
    label: '給朋友',
    opening: '嗨，我在想你可能也辛苦了。',
    closing: '不用回我，看完就好。',
  };

  const core = result.goodword || LAST_RESORT.好話;
  const carry = result.accept || LAST_RESORT.承接;

  // 若 content 有提供這個對象的語氣模板，優先用它。
  // 內容組的模板本來就是為「轉送給別人」寫的（已改好人稱與語境），比自己拼字更貼近情境。
  const tones = (st.tones && st.tones[audience]) || [];
  if (tones.length) {
    const t = (toneId && tones.find((x) => x.id === toneId)) || tones[0];
    if (t && (t.template || t.opening)) {
      // 模板已含開頭／承接／結尾時直接用；否則把好話織進去
      const text = t.template
        ? t.template
        : [t.opening, `「${core}」`, t.承接 || carry, t.closing].filter(Boolean).join('\n');
      return {
        audience,
        label: a.label || '給朋友',
        toneId: t.id,
        toneName: t.name,
        text,
        tones: tones.map((x) => ({ id: x.id, name: x.name })),
      };
    }
  }

  // 退路：用 opening / 好話 / 承接 / closing 拼
  const body = [a.opening, '', `「${core}」`, '', carry, '', a.closing].filter((x) => x !== undefined).join('\n');

  return {
    audience,
    label: a.label || '給朋友',
    toneId: null,
    toneName: null,
    text: body,
    tones: [],
  };
}

/** 把三段組成一句可複製的文字 */
function toCopyText(result) {
  return `承接：${result.accept}\n好話：${result.goodword}\n小步：${result.smallstep}`;
}

module.exports = {
  respond,
  respondRewrite,
  classifyEmotion,
  buildShare,
  toCopyText,
  lint,
  hashSeed,
  scoreIntensity,
  BANNED,
  LAST_RESORT,
};
