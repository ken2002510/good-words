'use strict';

/**
 * safety.js — 危機護欄（BRIEF §6）
 *
 * 鐵則：
 *  1. 偵測到自傷／自殺／危機訊號 → 立即停止一般回應流程，直接回求助資源。
 *  2. 不由 AI 扮演諮商師，不給危機處理建議，不分析、不評價。
 *  3. 語氣不恐慌、不說教；以「你願意說出來，這件事很重要」開場。
 *  4. 這裡是規則式的、確定性的判斷 —— 不經過任何模型。
 *     誤判的容忍方向是「寧可多接住」，但**明顯的口語誇飾要擋掉**（見 NEGATIVE_GUARD）。
 *
 * 詞庫來源：
 *  - 主要：C:\prodcut\content\crisis.json（內容組維護的完整詞庫，含 severity 分級）
 *  - 加上本檔內建的硬編碼保底 pattern，即使 content/ 不見了護欄也不會消失
 */

const fs = require('fs');
const path = require('path');

/** 求助資源（台灣）。真實、可撥打。content/crisis.json 有提供時以其為準。 */
const DEFAULT_RESOURCES = [
  {
    name: '1925 安心專線',
    tel: '1925',
    note: '24 小時，免付費。心情困住、想找人說話都可以打。',
  },
  {
    name: '1995 生命線',
    tel: '1995',
    note: '24 小時。想結束生命、覺得撐不下去的時候，有人會聽。',
  },
  {
    name: '1980 張老師',
    tel: '1980',
    note: '週一至週六 09:00–21:00、週日 09:00–17:00。談心事、談家裡的事。',
  },
  {
    name: '119 / 110',
    tel: '119',
    note: '如果你或身邊的人正在發生立即的危險，請直接打 119 或 110。',
  },
];
let RESOURCES = DEFAULT_RESOURCES.map((r) => ({ ...r }));

// ─────────────────────────────────────────────────────────────
// 內建保底 pattern（content/ 不存在時護欄仍然成立）
// ─────────────────────────────────────────────────────────────

const BUILTIN_PATTERNS = [
  // 直接的自殺意念
  /不想活/, /不要活/, /活不下去/, /撐不下去/, /撐不住/, /不想撐/,
  /想死/, /去死算了/, /死了算了/, /死一死/, /乾脆死/, /不如死/, /寧願死/,
  /自殺/, /自殘/, /自傷/, /割腕/, /割手/, /跳樓/, /上吊/, /燒炭/, /輕生/, /尋短/,
  /結束(自己的)?生命/, /結束自己/, /了結自己/, /自我了斷/, /結束這一切/, /一了百了/,
  /想不開/, /傷害自己/, /拿刀對著自己/, /跳下去/, /吞藥/, /服藥過量/,
  /遺書/, /最後一封/, /交代後事/,
  // 工具／手段語境（不一定講出「死」字，但意圖明確）
  /拿刀/, /想割/, /割自己/, /刀割/, /利器/, /美工刀/, /想從(樓頂|頂樓|高處)/,
  // 想消失／不想存在（★ 實務上最常被用來規避「自殺」這個詞）
  /想消失/, /消失算了/, /從世界上消失/, /消失在這個世界/, /希望我不存在/, /不存在的話/,
  /如果沒有我/, /如果我消失/, /沒有我這個人/, /想被忘記/,
  /想睡著不要醒/, /睡一覺不要醒來/, /一覺不醒/, /永遠睡著/,
  // 絕望／無望感
  /活著沒意義/, /活著沒有意義/, /人生沒意義/, /沒有活下去的理由/, /找不到活著的理由/,
  /生無可戀/, /沒有希望/, /沒希望了/, /沒有未來/, /看不到未來/, /為什麼要活著/, /活著幹嘛/,
  /再也撐不住/, /沒辦法再撐/, /到極限了/, /快崩潰了/,
  // 自認負擔
  /我是負擔/, /我是拖累/, /拖累家人/, /拖累大家/, /沒有我大家會更好/, /我走了比較好/,
  /我是多餘的/, /沒有人需要我/, /我不配活著/, /我該死/, /我這種人活該/,
  // 告別訊號
  /再見了大家/, /這是最後/, /東西都整理好了/, /該交代的都交代了/,
  // 方法與計畫
  /怎麼死比較不痛/, /死法/, /買了炭/, /買木炭/, /繩子買好了/, /找到地方了/, /今晚就要/, /明天就/,
  // 諧音與規避寫法
  /想s$/, /想4$/, /s了算了/, /4了算了/, /去s/, /去4/, /自s/, /自4/,
  /登出人生/, /登出地球/, /登出這個世界/, /結束這回合/, /關掉自己/, /回天上/, /當小天使/, /去當天使/,
  // 口語與情緒爆發
  /不想撐了/, /撐不住了/, /就這樣吧算了/, /結束掉算了/, /一切結束/, /想解脫/, /想結束這一切/,
  // 極端自責
  /都是我害的該死/, /我不該被生下來/, /出生就是錯的/, /希望我沒被生下來/,
  // 他人危機（使用者可能是想幫別人）
  /朋友.*(想死|自殺|不想活)/, /家人.*(想死|自殺|不想活)/, /他.*說.*(想死|不想活)/,
  // 「睡死」——口語上可能是玩笑，也是真訊號。依 BRIEF「寧可多接住」，列入。
  /想睡死/, /睡死算了/, /睡死好/,
];

/** 英文（在原文上比對，保留字界） */
const BUILTIN_LATIN = [
  /\bsuicid/i, /\bkill\s*my\s*self\b/i, /\bkms\b/i, /\bend\s+my\s+life\b/i, /\bend\s+it\s+all\b/i,
  /\bself[\s-]*harm/i, /\bwant\s+to\s+die\b/i, /\bwanna\s+die\b/i,
  /\bno\s+reason\s+to\s+live\b/i, /\bbetter\s+off\s+dead\b/i, /\bcan'?t\s+go\s+on\b/i,
];

/**
 * 口語誇飾 guard：命中這些才**不算**危機（BRIEF 說寧可多接住，
 * 但「笑死」「想死你了」這種每天都會出現的用法若也轉介，整站會失去可信度）。
 */
const NEGATIVE_GUARD = [
  /笑死/, /嚇死/, /累死/, /無聊死/, /餓死/, /熱死/, /冷死/, /死會/, /死黨/, /死線/, /死板/, /死角/,
  /想死你了/, /想死你/, /好想死你/, /死相/,
];

/** guard 裡「幾乎不可能出現在真危機句中」的強訊號：一旦同時命中，就直接覆蓋 guard */
const STRONG_OVERRIDE = [
  /不想活/, /自殺/, /割腕/, /割手/, /跳樓/, /上吊/, /燒炭/, /輕生/, /尋短/, /遺書/,
  /我是負擔/, /我是拖累/, /我不配活著/, /我該死/, /想消失/, /一了百了/, /結束生命/, /結束自己/,
];

/** 正規化：對齊 content/crisis.json 的 normalize 規格 */
function normalize(text) {
  return String(text || '')
    .replace(/[\uFF01-\uFF5E]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0)) // 全形→半形
    .toLowerCase()
    .replace(/[\s\u3000]+/g, '')                        // 去空白
    .replace(/[，。！？、,.!?~～…\-—_*「」『』()（）\[\]【】"'`；;：:]/g, ''); // 去標點
}

// ─────────────────────────────────────────────────────────────
// 從 content/crisis.json 載入詞庫（失敗就純用內建，永不 throw）
// ─────────────────────────────────────────────────────────────

const CONTENT_DIR = process.env.CONTENT_DIR
  ? path.resolve(process.env.CONTENT_DIR)
  : path.resolve(__dirname, '..', '..', 'content');

let extraPatterns = [];   // 從 content 轉出來的 regex
let extraLatin = [];
let loadedInfo = { source: 'builtin-only', patterns: 0, levels: {} };

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function loadFromContent() {
  const file = path.join(CONTENT_DIR, 'crisis.json');
  try {
    if (!fs.existsSync(file)) {
      loadedInfo = { source: 'builtin-only', patterns: 0, levels: {}, note: 'content/crisis.json 不存在' };
      return;
    }
    let raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1); // 防 BOM
    const data = JSON.parse(raw);

    // 取出所有 variants（支援 patterns[] 與寬鬆的 words[]）
    const variants = [];
    const levels = {};
    if (Array.isArray(data.patterns)) {
      for (const p of data.patterns) {
        const level = String(p.level || 'unknown');
        levels[level] = (levels[level] || 0) + 1;
        if (Array.isArray(p.variants)) {
          for (const v of p.variants) {
            const s = String(v).trim();
            // 跳過詞庫裡自帶說明的條目（例如「我想畢業了（指死亡語境）」）
            if (s && s.length <= 20 && !/[（(]指/.test(s)) variants.push(s);
          }
        }
      }
    } else if (Array.isArray(data.words)) {
      for (const v of data.words) if (v) variants.push(String(v).trim());
    }

    const seen = new Set();
    for (const v of variants) {
      if (!v || seen.has(v)) continue;
      seen.add(v);
      if (/^[\x20-\x7E]+$/.test(v)) extraLatin.push(new RegExp(`\\b${escapeRe(v)}\\b`, 'i'));
      else extraPatterns.push(new RegExp(escapeRe(v)));
    }

    // 求助資源以 content 為準（若格式正確）
    const hl = data.response_template && data.response_template.hotlines;
    if (Array.isArray(hl) && hl.length >= 3) {
      RESOURCES = hl.map((h) => ({
        name: String(h.name || ''),
        tel: String(h.number || h.tel || ''),
        note: String(h.note || ''),
      })).filter((r) => r.name && r.tel);
    }

    loadedInfo = {
      source: 'content/crisis.json',
      patterns: extraPatterns.length + extraLatin.length,
      levels,
      resourcesFromContent: Array.isArray(hl) && hl.length >= 3,
    };
  } catch (err) {
    loadedInfo = { source: 'builtin-only', patterns: 0, levels: {}, note: `讀取失敗：${err.message}` };
    extraPatterns = [];
    extraLatin = [];
  }
}
loadFromContent();

/** 測試／運轉中重新載入（content 交件後可熱套用） */
function reload() {
  extraPatterns = [];
  extraLatin = [];
  RESOURCES = DEFAULT_RESOURCES.map((r) => ({ ...r }));
  loadFromContent();
  return loadedInfo;
}

// ─────────────────────────────────────────────────────────────
// 偵測
// ─────────────────────────────────────────────────────────────

/**
 * @param {string} text 使用者輸入
 * @returns {{crisis: boolean, matched: string[], guarded?: boolean, level?: string}}
 */
function detectCrisis(text) {
  const raw = String(text || '');
  const n = normalize(raw);
  const matched = [];

  // 1) 內建 + content 的中文 pattern
  for (const re of BUILTIN_PATTERNS) {
    const m = n.match(re);
    if (m) matched.push(m[0]);
  }
  for (const re of extraPatterns) {
    const m = n.match(re);
    if (m && !matched.includes(m[0])) matched.push(m[0]);
  }

  // 2) 英文 pattern（比對原文與小寫原文）
  const lowerRaw = raw.toLowerCase();
  for (const re of BUILTIN_LATIN) {
    const m = lowerRaw.match(re);
    if (m) matched.push(m[0]);
  }
  for (const re of extraLatin) {
    const m = lowerRaw.match(re);
    if (m && !matched.includes(m[0])) matched.push(m[0]);
  }

  if (!matched.length) return { crisis: false, matched: [] };

  // 3) 口語誇飾 guard：命中且沒有強訊號覆蓋 → 不轉介
  const strongHit = STRONG_OVERRIDE.some((re) => re.test(n)) || extraLatin.some((re) => re.test(lowerRaw));
  if (!strongHit) {
    const joke = NEGATIVE_GUARD.find((re) => re.test(n));
    if (joke) return { crisis: false, matched: [], guarded: true, guardHit: String(joke) };
  }

  return { crisis: true, matched };
}

/** 危機模式的固定回應（三段結構沿用，但內容是轉介，不是安慰話術） */
function crisisResponse() {
  return {
    crisis: true,
    level: 'high',
    emotion: { id: 'crisis', name: '需要有人陪你', intensity: 5 },
    // 三段結構保持一致，前端不必特判
    accept: '你願意把這句話說出來，這件事很重要。你現在承受的，不是「想太多」，是真的非常重。',
    goodword: '我不會假裝我懂你全部的感覺，也不會催你趕快好起來。但我希望現在有一個人，真的在你身邊聽你說話——那個人不必是我，也不必是你認識的人。',
    smallstep: '現在，只要做一件事：撥 1925（安心專線，24 小時、免付費），或 1995（生命線）。電話接通之後，你不需要整理好措辭，說「我不知道從哪說起」就可以了。',
    resources: RESOURCES.map((r) => ({ ...r })),
    meta: { engine: 'safety', model: null, degraded: false, elapsedMs: 0 },
  };
}

module.exports = {
  detectCrisis,
  crisisResponse,
  normalize,
  reload,
  get loadedInfo() { return loadedInfo; },
  get RESOURCES() { return RESOURCES; },
  BUILTIN_PATTERNS,
  NEGATIVE_GUARD,
};
