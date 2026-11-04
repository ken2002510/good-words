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

// ── 個資 pattern（貼文與鼓勵都用）──
const PII_PATTERNS = [
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, label: 'email' },
  { re: /(?<![\d.])(?:09\d{8}|0\d{1,2}-?\d{6,8}|\+886\s?\d{9})(?![\d.])/, label: '電話' },
  { re: /https?:\/\/|www\.|\.(com|tw|net|org|io|me|shop|club)\b/i, label: '網址' },
  { re: /@[A-Za-z0-9._]{3,30}\b/, label: '@帳號' },
];

// ── 攻擊性謾罵（貼文描述「自己遭受的對待」，不應反過來罵人）──
const ATTACK_WORDS = [
  '白癡', '白痴', '腦殘', '智障', '去死', '死吧', '王八', '婊子', '操你',
  '靠北', '他媽的', '機車', '垃圾', '醜八怪', '肥宅', '神經病', '有病',
];

const POST_MAX_LEN = 200;
const ENC_MAX_LEN = 120;

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

/** 公開顯示的匿名稱呼（只取後 4 碼，不還原原始 ID） */
function anonHandle(anon) {
  const s = String(anon || '');
  return '牆友#' + s.slice(-4).toUpperCase();
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

function findPII(text) {
  for (const p of PII_PATTERNS) {
    const m = String(text || '').match(p.re);
    if (m) return p.label;
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
function validatePost(text) {
  const t = String(text || '').trim().slice(0, POST_MAX_LEN);
  if (!t) return { ok: false, reason: '請先寫下一點什麼，一個字也可以。' };
  if (safety.detectCrisis(t).crisis) return { ok: false, crisis: true };
  const pii = findPII(t);
  if (pii) return { ok: false, reason: '為了保護你，請拿掉' + pii + '（姓名、學校、聯絡方式都不要留）。' };
  if (findAttack(t)) return { ok: false, reason: '請描述事件本身就好，這裡不掛人身攻擊的內容。' };
  return { ok: true, text: t };
}

/**
 * 鼓勵話審核：危機 / 個資 /謾罵 / 反毒雞湯 lint 全過才行。
 * 注意：lint 失敗時只回通用訊息，不把禁語原文回給前端。
 */
function validateEncourage(text) {
  const t = String(text || '').trim().slice(0, ENC_MAX_LEN);
  if (t.length < 3) return { ok: false, reason: '鼓勵的話至少 3 個字。' };
  if (safety.detectCrisis(t).crisis) return { ok: false, crisis: true };
  const pii = findPII(t);
  if (pii) return { ok: false, reason: '鼓勵裡不要留' + pii + '。' };
  if (findAttack(t)) return { ok: false, reason: '請用溫柔的話鼓勵，不要罵人。' };
  const check = rules.lint({ 承接: '', 好話: t, 小步: '' });
  if (!check.ok) return { ok: false, reason: '這句話聽起來有點空洞或刺刺的，換個說法再試試。' };
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
  const grams = new Set();
  const p = String(postText || '');
  for (let i = 0; i < p.length - 1; i++) grams.add(p.slice(i, i + 2));
  let overlap = 0;
  for (let i = 0; i < t.length - 1; i++) if (grams.has(t.slice(i, i + 2))) overlap++;
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
  sanitizeAnon,
  sanitizeItemId,
  anonHandle,
  weekKey,
  rankTitle,
  findPII,
  findAttack,
  validatePost,
  validateEncourage,
  scoreSpecificity,
  scorePost,
  scoreEncourage,
};
