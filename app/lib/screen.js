'use strict';

/**
 * screen.js — 好話牆（匿名公開牆）的「過濾 + 計分」層
 *
 * 安全優先順序（不可鬆動）：
 *   1. 危機內容 → 永遠不進牆、不進 KV，直接回轉介資源（safety.detectCrisis）
 *   2. 個資（email /電話 / 網址 / @帳號）→ 拒絕
 *   3. 攻擊性謾罵 → 拒絕（這裡是互相取暖，不是吵架牆）
 *   4. 鼓勵話 → 另過 rules.lint（反毒雞湯），違規給通用訊息、不回傳禁語原文
 *
 * 計分原則（回應「越具體越多分」）：
 *   - 貼文：基礎分 + 具體度（篇幅層級 / 時間次數 / 引用原話 / 前後因果 / 情緒詞）
 *           + AI 有接住（非降級引擎）加分
 *   - 鼓勵：基礎分 + 長度層級 + 有回應到貼文內容（bigram 重疊）
 *   - 每收到一則通過審核的鼓勵，發文者 +5（雙方得分）
 */

const rules = require('./rules.js');
const safety = require('./safety.js');

// ─────────────────────────────────────────────────────────────
// 個資偵測（貼文與鼓勵共用）
//
// 2026-11 評審實測：9 項 PII 只有 1 項被擋，且 8 種變體全部繞過
// （全形數字 ０９１２…、插空白 0912 345 678、插橫線、諧音「零九一二…」、
//   全形身分證 Ａ１２３…、空白身分證、全形 LINE ID、地址省略市名）。
// 根因：沒有 Unicode NFKC 正規化、沒有去分隔符、沒有處理諧音，規則也只認手機。
//
// 修法：偵測前先把文字轉成三種「偵測視圖」，再跑各自適用的規則：
//   plain      = NFKC 全形轉半形 + 去不可見字元 + 小寫
//   compact    = plain 再去掉空白/橫線/標點等分隔符
//   homophone  = compact 再把中文數字諧音轉成阿拉伯數字（零九一二 → 0912）
// 顯示與儲存仍用使用者原文，只有偵測用視圖被正規化。
// ─────────────────────────────────────────────────────────────

const INVISIBLE_RE = /[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g;
// 注意：「！？」「!?」也要算分隔符 —— 否則「同一句話＋！！！？」會被視為不同句，
// 繞過「同句不得重複」的去重（實測 _wall_api_verify 抓到）。
const SEPARATOR_RE = /[\s\u3000\-_—–~～.。·•,，、;；:：/\\|()（）\[\]【】{}<>《》「」『』"'`+！？!?＊*#＃]/g;

const HOMOPHONE_DIGIT = {
  零: '0', 〇: '0', 洞: '0',
  一: '1', 么: '1', 壹: '1',
  二: '2', 兩: '2', 貳: '2',
  三: '3', 參: '3', 叁: '3',
  四: '4', 肆: '4',
  五: '5', 伍: '5',
  六: '6', 陸: '6',
  七: '7', 柒: '7', 拐: '7',
  八: '8', 捌: '8',
  九: '9', 玖: '9', 勾: '9',
};

/** 偵測視圖（NFKC + 去不可見字元 + 小寫） */
function screenPlain(text) {
  return String(text || '').normalize('NFKC').replace(INVISIBLE_RE, '').toLowerCase();
}

/**
 * 寬鬆數字比對用的 pattern 工廠（2026-11 複測 v2 新發現：emoji 夾雜可繞過）。
 * `0912😢345😢678` 這種在數字之間插**任何非數字字元**的寫法，前一代的正規化
 * （只列舉已知分隔符）擋不住。這裡改成「允許中間插入最多 2 個非數字字元」：
 *   09(?:[^0-9]{0,2}\d){8}      → 手機 09 + 8 碼
 *   0[2-8](?:[^0-9]{0,2}\d){7,8} → 市話
 * 為什麼限制「最多 2 個」：不限制的話，「2026 年 11 月，我 35 歲」這種正常句子
 * 會被串成一長串數字而誤判。實測「年/月/日」等中文字會中斷比對，不會誤擋。
 */
function looseDigits(head, tailMin, tailMax) {
  return new RegExp(`${head}(?:[^0-9]{0,2}\\d){${tailMin},${tailMax}}`);
}

/** 再去除分隔符（空白、橫線、標點…）——「0912 345 678」→「0912345678」 */
function screenCompact(text) {
  return screenPlain(text).replace(SEPARATOR_RE, '');
}

/** 再把中文數字諧音轉成阿拉伯數字——「零九一二…」→「0912…」 */
function screenHomophone(text) {
  return screenCompact(text).replace(/[零〇洞一么壹二兩貳三參叁四肆五伍六陸七柒拐八捌九玖勾]/g,
    (c) => HOMOPHONE_DIGIT[c] || c);
}

/** 「我是說真的」這類不是姓名的接續詞，避免姓名規則誤判 */
const NON_NAME_AFTER_INTRO = new Set([
  '說真', '說真', '想說', '覺得', '因為', '真的', '不是', '一個', '那種', '這樣', '有點',
  '想要', '需要', '現在', '今天', '昨天', '明天', '很累', '好累', '不好', '沒用', '誰', '你', '我', '他', '她',
]);

const PII_PATTERNS = [
  { label: 'email', on: 'plain', re: /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/ },
  // 手機（含 +886 9xxxxxxxx）與市話：在 compact 上比對，可擋插空白／橫線／全形
  { label: '電話', on: 'compact', re: /(?:^|[^0-9])(?:09\d{8}|\+?8869\d{8})(?![0-9])/ },
  { label: '市話', on: 'compact', re: /(?:^|[^0-9])0[2-8]\d{7,8}(?![0-9])/ },
  // 身分證：一個英文字母 + 1/2 + 8 位數字（全形已在 NFKC 轉掉、空白已去）
  { label: '身分證', on: 'compact', re: /(?:^|[^a-z0-9])[a-z][12]\d{8}(?![0-9])/ },
  // ── 寬鬆版：數字中間插 emoji／任意符號也算（複測 v2 的繞過）──
  { label: '電話', on: 'plain', re: looseDigits('(?:^|[^0-9])09', 8, 8) },
  { label: '市話', on: 'plain', re: looseDigits('(?:^|[^0-9])0[2-8]', 7, 8) },
  { label: '身分證', on: 'plain', re: looseDigits('[a-z][12]', 8, 8) },
  // 諧音數字（零九一二…／ㄧ二三四…）——只在 homophone 視圖上比對數字型規則
  { label: '電話（諧音）', on: 'homophone', re: /(?:^|[^0-9])(?:09\d{8})(?![0-9])/ },
  { label: '身分證（諧音）', on: 'homophone', re: /(?:^|[^a-z0-9])[a-z][12]\d{8}(?![0-9])/ },
  { label: '網址', on: 'plain', re: /https?:\/\/|www\.|\.(com|tw|net|org|io|me|shop|club)\b/ },
  { label: '@帳號', on: 'compact', re: /(?:^|[^a-z0-9._%+-])@[a-z0-9._-]{3,30}/ },
  { label: 'LINE ID', on: 'plain', re: /(?:line|賴|lineid|line_id)\s*(?:id)?\s*[:：=]?\s*[a-z0-9._-]{4,}/ },
  // 地址：縣市＋區＋路街（也涵蓋「省略市名」的大安區復興南路…）
  { label: '地址', on: 'compact', re: /[\u4e00-\u9fff]{2,4}(?:縣|市)[\u4e00-\u9fff]{1,4}(?:區|鄉|鎮|市)[\u4e00-\u9fff0-9]{0,18}(?:路|街|巷|弄|號|樓)/ },
  { label: '地址', on: 'compact', re: /[\u4e00-\u9fff]{1,4}(?:區|鄉|鎮)[\u4e00-\u9fff0-9]{0,10}(?:路|街|巷|弄)[\u4e00-\u9fff0-9]{0,12}(?:段|號|樓)/ },
  { label: '學校', on: 'compact', re: /[\u4e00-\u9fff]{2,10}(?:大學|學院|高中|高職|國中|國小|附中|專科)/ },
  { label: '班級', on: 'compact', re: /[\u4e00-\u9fff]{1,3}年[\d一二三四五六七八九十]{1,3}班/ },
  {
    label: '姓名',
    on: 'plain',
    re: /(?:我叫|我是|姓名[:：=]?|名字[:：=]?|本名[:：=]?|綽號[:：=]?|大家都叫我)\s*([\u4e00-\u9fff]{2,3})/,
    accept: (m) => !NON_NAME_AFTER_INTRO.has(String(m[1] || '').slice(0, 2)),
  },
];

// ── 攻擊性謾罵（貼文描述「自己遭受的對待」，不應反過來罵人）──
const ATTACK_WORDS = [
  '白癡', '白痴', '腦殘', '智障', '去死', '死吧', '王八', '婊子', '操你',
  '靠北', '他媽的', '機車', '垃圾', '醜八怪', '肥宅', '神經病', '有病',
];

const POST_MAX_LEN = 200;
const ENC_MAX_LEN = 120;
const ENC_MIN_LEN = 10;

/** 牆的主題（抒發心情的分類） */
const TOPICS = [
  { id: 'work', name: '工作' },
  { id: 'love', name: '感情' },
  { id: 'family', name: '家庭' },
  { id: 'self', name: '自我價值' },
  { id: 'lonely', name: '孤單' },
  { id: 'anger', name: '憤怒' },
  { id: 'anxiety', name: '焦慮' },
  { id: 'other', name: '其他' },
];

function sanitizeTopic(t) {
  const s = String(t || '');
  return TOPICS.some((x) => x.id === s) ? s : 'other';
}

function topicName(id) {
  const t = TOPICS.find((x) => x.id === id);
  return t ? t.name : '其他';
}

const LIMITS = {
  POST_PER_WEEK: 5,
  ENC_PER_DAY: 20,
  WALL_ITEMS: 60,
  ENC_PER_ITEM: 20,
};

const SCORE = {
  POST_BASE: 10,
  POST_SPEC_MAX: 12,
  AI_BONUS: 5,
  POSTER_REWARD_PER_ENC: 5,
  ENC_BASE: 5,
  ENC_SPEC_MAX: 4,
  ENC_ECHO: 3,
  ENC_MAX: 12,
};

/** 合法的匿名 ID（UUID 或自訂字串），防 KV key injection */
function sanitizeAnon(anon) {
  const s = String(anon || '');
  return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : null;
}

/** 合法的 item id */
function sanitizeItemId(id) {
  const s = String(id || '');
  return /^[A-Za-z0-9-]{16,64}$/.test(s) ? s : null;
}

/**
 * 公開顯示的匿名稱呼。
 *
 * 2026-11 評審 P1：原本直接取 anon 後 4 碼，**可預測、可冒充**
 * （anon="spoof-xxxx-I-A1" 就顯示成別人的「牆友#I-A1」，排行榜上「牆友#0001」出現三次）。
 * 改為 HMAC(anon) 取前 4 碼：對外不可由 anon 反推、不同 anon 幾乎不碰撞。
 * 需要 env `HANDLE_SECRET`（或 `WALL_ADMIN_TOKEN`）才會生效；
 * 沒設時退回舊行為，避免在未設定的環境直接壞掉。
 */
function anonHandle(anon) {
  const s = String(anon || '');
  if (!s) return '牆友#--------';
  try {
    const crypto = require('crypto');
    const secret = process.env.HANDLE_SECRET || process.env.WALL_ADMIN_TOKEN || '';
    // 2026-11 複測 v2 兩點：① 4 碼 hex（65,536）比舊版 base36 還小 → 碰撞率升高；
    // ② 沒設 HANDLE_SECRET 時退回「anon 後 4 碼」→ 可預測、可冒充。
    // 因此**一律用雜湊**：有密鑰用 HMAC，沒密鑰用 sha256＋固定鹽（仍然不可由 handle 反推
    // anon，也不會與他人碰撞），一律取 8 碼 hex。
    const h = secret
      ? crypto.createHmac('sha256', secret).update(s).digest('hex')
      : crypto.createHash('sha256').update('good-words|' + s).digest('hex');
    return '牆友#' + h.slice(0, 8).toUpperCase();
  } catch (e) {
    return '牆友#' + s.slice(-4).toUpperCase();
  }
}

/** Asia/Taipei 的 ISO 週 key，例如 2026-W45 */
function weekKey(ts) {
  const d = new Date(ts || Date.now());
  const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const date = new Date(Date.UTC(tw.getFullYear(), tw.getMonth(), tw.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7; // 週一 = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3); // 本週四
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fday = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - fday + 3);
  const week = 1 + Math.round((date - firstThursday) / (7 * 86400000));
  return tw.getFullYear() + '-W' + String(week).padStart(2, '0');
}

/** 依本週排名給稱號 */
function rankTitle(rank, pts) {
  if (!pts) return '初來報到';
  if (rank === 1) return '好話燈塔';
  if (rank === 2) return '溫暖推手';
  if (rank === 3) return '善意達人';
  if (rank > 0 && rank <= 10) return '好話夥伴';
  return '默默行善';
}

/**
 * 個資偵測：把輸入轉成三個偵測視圖後，各自跑對應規則。
 * 回傳命中的類別字串（例如 '電話'）或 null。
 * 注意：訊息只回類別，不回傳命中的原文（避免把個資再顯示一次）。
 */
function findPII(text) {
  const plain = screenPlain(text);
  const compact = screenCompact(text);
  const homophone = screenHomophone(text);
  const views = { plain, compact, homophone };
  for (const p of PII_PATTERNS) {
    const target = views[p.on] || plain;
    const m = target.match(p.re);
    if (!m) continue;
    if (typeof p.accept === 'function' && !p.accept(m)) continue;
    return p.label;
  }
  return null;
}

function findAttack(text) {
  const t = String(text || '');
  for (const w of ATTACK_WORDS) if (t.includes(w)) return w;
  return null;
}

/**
 * 貼文審核。回 { ok, reason?, crisis?, text? }
 * 危機內容回 crisis:true —— 呼叫端必須直接轉介、絕對不可寫入任何儲存。
 */
/**
 * 這句是「針對別人的辱罵」還是「自己怎麼了」？
 *
 * 2026-11 複測 v2：危機判定搶先於攻擊判定，導致罵人的氣話（例：「你他媽的是個白痴廢物，
 * 去死一死算了」）被當成危機 → 回熱線、還吞掉改寫結果；而同一句話拿掉「去死」就正常 422。
 * 判定：句中有第二人稱、且攻擊詞出現之前沒有第一人稱 → 視為針對他人的辱罵（走攻擊字）。
 * 回傳命中的攻擊詞，或 null。
 */
function findDirectedAttack(text) {
  const t = String(text || '');
  const w = findAttack(t);
  if (!w) return null;
  if (!/(你|妳|您|你們)/.test(t)) return null;
  const before = t.slice(0, Math.max(0, t.indexOf(w)));
  if (/(我|自己)/.test(before)) return null;   // 「我自己是白痴」→ 不是罵別人
  return w;
}

function validatePost(text) {
  const t = String(text || '').trim().slice(0, POST_MAX_LEN);
  if (!t) return { ok: false, reason: '請先寫下一點什麼，一個字也可以。' };
  // 針對他人的辱罵優先於危機判定（否則會錯誤地回熱線資源）
  const directed = findDirectedAttack(t);
  if (!directed && safety.detectCrisis(t).crisis) return { ok: false, crisis: true };
  const pii = findPII(t);
  if (pii) return { ok: false, reason: '為了保護你，請拿掉' + pii + '（姓名、學校、聯絡方式都不要留）。' };
  if (directed || findAttack(t)) return { ok: false, reason: '請描述事件本身就好，這裡不掛人身攻擊的內容。' };
  return { ok: true, text: t };
}

/** 空洞鼓勵（整句只有泛泛的好話） */
const GENERIC_PRAISE = /^(好棒|你好棒|好厲害|好可憐|棒棒|乖|摸摸|抱抱|加油|你可以|厲害|好強)[！!。。.\s…]*$/i;

/** 「真的有聽到對方」的詞（審核與計分共用） */
const ACK_WORDS = [
  '聽起來', '辛苦', '難受', '委屈', '心疼', '理解', '懂你', '陪你', '撐住',
  '抱抱', '摸摸', '在乎', '難過', '害怕', '生氣', '累了', '無助', '孤單',
  '沒關係', '我懂', '謝謝你說', '說出來', '好難', '好痛', '心酸', '不容易',
];

/** bigram 重疊數：鼓勵是否真的回應到貼文內容 */
function bigramOverlap(a, b) {
  const t = String(a || '');
  const p = String(b || '');
  if (!t || !p) return 0;
  const grams = new Set();
  for (let i = 0; i < p.length - 1; i++) grams.add(p.slice(i, i + 2));
  let n = 0;
  for (let i = 0; i < t.length - 1; i++) if (grams.has(t.slice(i, i + 2))) n++;
  return n;
}

/**
 * 鼓勵話審核（較嚴格）：危機 / 個資 /謾罵 / 反毒雞湯 lint 全過，且
 *   - 至少 10 字、不是純表情符號
 *   - 不是整句空洞好話（GENERIC_PRAISE）
 *   - 要真的回應到貼文（bigram 重疊 ≥2）或帶有「聽到感受」的詞
 * 注意：lint 失敗時只回通用訊息，不把禁語原文回給前端。
 */
function validateEncourage(text, postText) {
  const t = String(text || '').trim().slice(0, ENC_MAX_LEN);
  // 針對他人的辱罵優先於危機（同 validatePost 的理由）
  const directed = findDirectedAttack(t);
  // 危機偵測仍是高優先（連短文也要回轉介），但方向明確的辱罵不該被誤當危機
  if (!directed && safety.detectCrisis(t).crisis) return { ok: false, crisis: true };
  if (t.length < ENC_MIN_LEN) return { ok: false, reason: '鼓勵至少 ' + ENC_MIN_LEN + ' 個字，告訴對方你聽到了什麼。' };
  if (!/[一-鿿A-Za-z0-9]/.test(t)) return { ok: false, reason: '寫點文字吧，單靠表情符號撐不起一句鼓勵。' };
  const pii = findPII(t);
  if (pii) return { ok: false, reason: '鼓勵裡不要留' + pii + '。' };
  if (directed || findAttack(t)) return { ok: false, reason: '請用溫柔的話鼓勵，不要罵人。' };
  const check = rules.lint({ 承接: '', 好話: t, 小步: '' });
  if (!check.ok) return { ok: false, reason: '這句話聽起來有點空洞或刺刺的，換個說法再試試。' };
  if (GENERIC_PRAISE.test(t)) return { ok: false, reason: '這句太空洞了 —— 試試說出你聽到的具體感受。' };
  const overlap = bigramOverlap(t, postText || '');
  const ack = ACK_WORDS.some((w) => t.includes(w));
  if (overlap < 2 && !ack) {
    return { ok: false, reason: '鼓勵要回應到對方說的事，或說出你聽到的感受，別只說空話。' };
  }
  return { ok: true, text: t };
}

/** 貼文具體度：越具體分越高（封頂 12） */
function scoreSpecificity(text) {
  const t = String(text || '');
  let pts = 0;
  const why = [];
  const len = t.length;
  if (len >= 80) { pts += 6; why.push('篇幅具體（≥80字）'); }
  else if (len >= 40) { pts += 4; why.push('篇幅具體（≥40字）'); }
  else if (len >= 15) { pts += 2; why.push('有寫出內容（≥15字）'); }
  if (/(\d|昨天|今天|明天|後天|禮拜|星期|上週|這週|點|時|分|次|回|年|月|日)/.test(t)) { pts += 3; why.push('有時間/次數細節'); }
  if (/[「“"''][^」”"'']{2,}[」”"'']/.test(t)) { pts += 3; why.push('有引用原話'); }
  if (/(因為|所以|結果|後來|但是|可是|然後|而且|沒想到)/.test(t)) { pts += 3; why.push('有前後因果'); }
  if (/(累|難過|生氣|委屈|害怕|孤單|無助|焦慮|失望|沒用|煩|痛|哭|氣|傷心|害怕)/.test(t)) { pts += 3; why.push('有情緒詞'); }
  return { points: Math.min(SCORE.POST_SPEC_MAX, pts), why };
}

/** 貼文總分：基礎 10 + 具體度 + AI 接住獎勵 5（封頂 27） */
function scorePost(text, aiOk) {
  const spec = scoreSpecificity(text);
  const aiBonus = aiOk ? SCORE.AI_BONUS : 0;
  const total = Math.min(SCORE.POST_BASE + SCORE.POST_SPEC_MAX + SCORE.AI_BONUS, SCORE.POST_BASE + spec.points + aiBonus);
  return {
    base: SCORE.POST_BASE,
    spec: spec.points,
    specWhy: spec.why,
    aiBonus,
    total,
  };
}

/** 鼓勵話總分：基礎 5 + 長度層級 + 有回應貼文內容（封頂 12） */
function scoreEncourage(text, postText) {
  const t = String(text || '');
  let pts = SCORE.ENC_BASE;
  const why = ['通過 AI 審核'];
  if (t.length >= 40) { pts += 4; why.push('鼓勵具體（≥40字）'); }
  else if (t.length >= 15) { pts += 2; why.push('有寫出內容（≥15字）'); }
  // bigram 重疊：鼓勵是否真的回應到貼文
  const overlap = bigramOverlap(t, postText);
  if (overlap >= 2) { pts += SCORE.ENC_ECHO; why.push('有回應到貼文內容'); }
  return { total: Math.min(SCORE.ENC_MAX, pts), why };
}

module.exports = {
  PII_PATTERNS,
  ATTACK_WORDS,
  LIMITS,
  SCORE,
  POST_MAX_LEN,
  ENC_MAX_LEN,
  ENC_MIN_LEN,
  TOPICS,
  sanitizeTopic,
  topicName,
  GENERIC_PRAISE,
  ACK_WORDS,
  bigramOverlap,
  sanitizeAnon,
  sanitizeItemId,
  anonHandle,
  weekKey,
  rankTitle,
  findPII,
  screenPlain,
  screenCompact,
  screenHomophone,
  findAttack,
  findDirectedAttack,
  validatePost,
  validateEncourage,
  scoreSpecificity,
  scorePost,
  scoreEncourage,
};
