'use strict';

/**
 * wallcore.js — 好話牆 / 鼓勵 / 排行榜的核心邏輯（單一事實來源）
 *
 * 被 deploy/api/wall.js、encourage.js、leaderboard.js（Vercel）與
 * app/server.js（本機）共用。
 *
 * 安全設計（不可鬆動）：
 *   - 危機內容：detectCrisis 命中 → 直接回轉介資源，**永不寫入 KV**，也不回牆上
 *   - 個資 /謾罵：screen.js 拒絕
 *   - 鼓勵話：必須過 rules.lint（反毒雞湯），失敗只回通用訊息（不回禁語原文）
 *   - KV 未設定 → 回 wallEnabled:false，前端降級為「本機牆」，網站照常運作
 *   - 速率限制：每人每週最多 5 篇貼文、每天最多 20 句鼓勵（防濫用，保連結可用）
 *   - AI 背書一律由**伺服器**產生：客戶端傳來的 ai 欄位只當作「有人試圖指定」的訊號，
 *     內容完全不採用（P1-1a），回應附 serverGenerated:true
 *   - 鼓勵反刷分：同句（正規化後）拒絕、同人同篇只給一次分、每日得分篇數上限（P1-1b）
 *   - 管理者 DELETE：?id= / ?purge=test|all（token 驗證在 deploy/api/wall.js）
 */

const crypto = require('crypto');
const { loadLib } = require('./resolve.js');

function libs() {
  return {
    ai: loadLib('ai').mod,
    rules: loadLib('rules').mod,
    safety: loadLib('safety').mod,
    screen: loadLib('screen').mod,
    kv: loadLib('kv').mod,
  };
}

/** 部署版 AI 要走哪一軌（與 respond.js 相同邏輯） */
function deployForce() {
  const explicit = (process.env.DEPLOY_AI_ENGINE || '').toLowerCase();
  if (['auto', 'rules', 'ollama', 'nvidia', 'cloud'].includes(explicit)) return explicit;
  if (process.env.NVIDIA_API_KEY || process.env.NVKEY) return 'nvidia';
  if (process.env.DEPLOY_TRY_OLLAMA === '1') return 'auto';
  return 'rules';
}

const WALL_IDS_KEY = 'wall:ids';

/**
 * 每個匿名身分「每天最多能有幾篇鼓勵拿到分數」。
 * screen.LIMITS.ENC_PER_DAY 是「每天最多送幾句」的粗上限（20），
 * 這裡是更嚴的「得分」上限：同一人一天最多靠 5 篇鼓勵得分，避免排行榜被洗。
 * （screen.js 由 Lead 維護，不在本檔寫入範圍 → 若 screen.LIMITS.ENC_SCORE_PER_DAY
 *   未來新增就自動採用；沒有就用此預設 5。）
 */
const ENC_SCORE_PER_DAY_DEFAULT = 5;

/** 測試／評審資料的 anon 前綴（?purge=test 用；大小寫不拘，需接 - 或 _） */
const TEST_ANON_RE = /^(?:test|tests|qa|probe|review|reviewer|judge|eval|pentest|blackbox|attack|abuse|demo)[-_]/i;

// ─────────────────────────────────────────────────────────────
// 反刷分（P1-1b）
//
// 三層防線：
//   ① 同一篇貼文出現「正規化後相同」的鼓勵 → 409 拒絕（跨匿名身分也擋）
//   ② 同一 anon 對同一篇貼文只給一次分 → 之後重送 delta=0（alreadyEncouraged）
//   ③ 每日得分篇數上限（見上）＋ 既有 LIMITS.ENC_PER_DAY / POST_PER_WEEK
//
// 正規化只用於「比對」，原文照舊顯示：NFKC 全形轉半形 + 去不可見字元 + 小寫 +
// 去空白與標點 →「加油！！！ 你真的 很努力」與「加油你真的好努力」視為同一句。
//
// KV 不可用時的退路（重要：不可整個壞掉）：
//   沒有 KV（enabled()===false）或 KV 讀取失敗時，①改用「本行程記憶體」擋同一篇
//   貼文的同句重複；②③需要跨行程狀態，沒有 KV 就無法可靠實作 → 該路徑只回
//   localOnly（前端自己記在本機），網站照常運作。
// ─────────────────────────────────────────────────────────────
const MEM_DUP = new Map(); // itemId -> Set(正規化字串)
const MEM_DUP_MAX_ITEMS = 500;
const MEM_DUP_MAX_PER_ITEM = 40;

function memHas(itemId, norm) {
  const s = MEM_DUP.get(String(itemId));
  return Boolean(s && s.has(norm));
}

function memAdd(itemId, norm) {
  const k = String(itemId);
  let s = MEM_DUP.get(k);
  if (!s) {
    if (MEM_DUP.size >= MEM_DUP_MAX_ITEMS) {
      const oldest = MEM_DUP.keys().next().value;
      if (oldest !== undefined) MEM_DUP.delete(oldest);
    }
    s = new Set();
    MEM_DUP.set(k, s);
  }
  if (s.size >= MEM_DUP_MAX_PER_ITEM) s.clear();
  s.add(norm);
}

/** 比對用的正規化：優先用 screen.js 的 screenCompact（單一事實來源），失敗才用本地版 */
function normalizeForCompare(L, text) {
  const s = String(text || '');
  try {
    if (L && L.screen && typeof L.screen.screenCompact === 'function') {
      const out = L.screen.screenCompact(s);
      if (typeof out === 'string') return out;
    }
  } catch (_) {
    /* 落回本地實作 */
  }
  return s
    .normalize('NFKC')
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '')
    .toLowerCase()
    .replace(/[\s\u3000\-_—–~～.。·•,，、;；:：/\\|()（）\[\]【】{}<>《》「」『』"'`+!！?？]/g, '');
}

/** 讀一篇貼文的既有鼓勵（失敗回 null，呼叫端據此決定要不要靠記憶體層） */
async function readEncs(L, itemId) {
  try {
    const raw = await L.kv.lrange('wall:item:' + itemId + ':encs', 0, L.screen.LIMITS.ENC_PER_ITEM - 1);
    const out = [];
    for (const s of raw || []) {
      try {
        const e = JSON.parse(s);
        if (e && typeof e.text === 'string') out.push(e);
      } catch (_) {
        /* 壞資料跳過 */
      }
    }
    return out;
  } catch (err) {
    console.error('[wall] 讀鼓勵清單失敗（改用記憶體層）：', String(err && err.message));
    return null;
  }
}

/** 刪一個 Redis key；不支援 DEL 的 KV（罕見）只記 log，不留例外 */
async function kvDel(L, key) {
  try {
    await L.kv.cmd('DEL', key);
  } catch (err) {
    console.error('[wall] DEL 失敗或不受支援：', String(err && err.message));
  }
}

/** 把 id 從牆的清單移除：優先 LREM，不支援就重建清單 */
async function kvRemoveId(L, id) {
  try {
    await L.kv.cmd('LREM', WALL_IDS_KEY, '0', id);
    return;
  } catch (err) {
    console.error('[wall] LREM 失敗，改用重建清單：', String(err && err.message));
  }
  try {
    const rest = (await L.kv.lrange(WALL_IDS_KEY, 0, -1)).filter((x) => x !== id);
    await kvDel(L, WALL_IDS_KEY);
    for (let i = rest.length - 1; i >= 0; i--) await L.kv.lpush(WALL_IDS_KEY, rest[i]);
  } catch (err) {
    console.error('[wall] 重建牆清單失敗：', String(err && err.message));
  }
}

/**
 * 對外的鼓勵物件：只保留顯示需要的欄位。
 * 特別注意 anonHash 是伺服器端身分比對用的追蹤鍵，**絕對不可外洩**（複測 v2 抓到）。
 */
function publicEnc(e) {
  return {
    id: e.id,
    text: e.text,
    handle: e.handle,
    score: e.score,
    createdAt: e.createdAt,
  };
}

function publicItem(L, item, encs) {
  return {
    id: item.id,
    text: item.text,
    topic: item.topic || 'other',
    topicName: L.screen.topicName(item.topic || 'other'),
    accept: item.accept,
    goodword: item.goodword,
    smallstep: item.smallstep,
    engine: item.engine,
    model: item.model || null,
    createdAt: item.createdAt,
    encs: (encs || []).map((e) => ({
      id: e.id, text: e.text, handle: e.handle, score: e.score, createdAt: e.createdAt,
    })),
  };
}

async function withBudget(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), ms)),
  ]);
}

// ─────────────────────────────────────────────
// GET /api/wall — 牆列表
// ─────────────────────────────────────────────
async function listWall(L, query) {
  const week = L.screen.weekKey(Date.now());
  const q = query || {};
  const topic = q.topic && q.topic !== 'all' ? L.screen.sanitizeTopic(q.topic) : null;
  const mineAnon = q.mine === '1' || q.mine === 'true' ? L.screen.sanitizeAnon(q.anon) : null;
  if (!L.kv.enabled()) {
    return { status: 200, body: { ok: true, wallEnabled: false, week, items: [] } };
  }
  try {
    const ids = await L.kv.lrange(WALL_IDS_KEY, 0, L.screen.LIMITS.WALL_ITEMS - 1);
    const rawItems = ids.length ? await L.kv.mget(ids.map((id) => 'wall:item:' + id)) : [];
    const items = [];
    for (let i = 0; i < ids.length; i++) {
      let item = null;
      try { item = rawItems[i] ? JSON.parse(rawItems[i]) : null; } catch (_) { item = null; }
      if (!item || !item.id) continue;
      if (topic && (item.topic || 'other') !== topic) continue;
      if (mineAnon && item.anon !== mineAnon) continue;
      const encRaw = await L.kv.lrange('wall:item:' + item.id + ':encs', 0, L.screen.LIMITS.ENC_PER_ITEM - 1);
      const encs = encRaw.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean);
      items.push(publicItem(L, item, encs));
    }
    return { status: 200, body: { ok: true, wallEnabled: true, week, items, topics: L.screen.TOPICS } };
  } catch (err) {
    console.error('[wall] list 失敗：', String(err && err.message));
    return { status: 200, body: { ok: true, wallEnabled: false, week, items: [], error: '牆暫時不可用' } };
  }
}

// ─────────────────────────────────────────────
// POST /api/wall — 發一篇貼文（AI 先回應，才掛牆）
//   body: { anon, text, ai?: { accept, goodword, smallstep, engine, model } }
// ─────────────────────────────────────────────
async function createPost(L, payload) {
  const week = L.screen.weekKey(Date.now());
  const anon = L.screen.sanitizeAnon(payload && payload.anon);
  if (!anon) return { status: 400, body: { ok: false, error: '缺少匿名識別（請重新整理頁面再試）。' } };

  const v = L.screen.validatePost(payload && payload.text);
  if (v.crisis) {
    // 危機內容：回轉介，絕不儲存
    const c = L.safety.crisisResponse();
    return { status: 200, body: { ok: false, crisis: true, resources: c.resources, accept: c.accept, week } };
  }
  if (!v.ok) return { status: 422, body: { ok: false, error: v.reason, week } };

  const text = v.text;
  const topic = L.screen.sanitizeTopic(payload && payload.topic);

  // ── AI 回應：一律由伺服器產生（P1-1a 修正）──
  // 舊行為：payload.ai 帶了 goodword/accept 就直接採用 → 任何人 POST 一段假文字
  // 就能讓牆上出現「AI 背書」。現在客戶端 ai 欄位完全不採用（連 lint 後採用都不行），
  // 只留下「客戶端有送」的事實供稽核；引擎名稱／模型也一律以伺服器實際跑的為準。
  const clientAiOffered = Boolean(payload && payload.ai && typeof payload.ai === 'object');

  let accept = '', goodword = '', smallstep = '', engine = 'rules', model = null;
  try {
    const r = await withBudget(L.ai.generate(text, { force: deployForce(), mode: 'chat' }), 8000);
    accept = r.accept; goodword = r.goodword; smallstep = r.smallstep;
    engine = (r.meta && r.meta.engine) || 'rules';
    model = (r.meta && r.meta.model) || null;
  } catch (_) {
    try {
      const r = await withBudget(L.ai.generate(text, { force: 'rules', mode: 'chat' }), 3000);
      if (r) { accept = r.accept; goodword = r.goodword; smallstep = r.smallstep; }
    } catch (_e) {
      /* 連規則軌都掛 → 用下面的內建句，永不白畫面 */
    }
    engine = 'rules'; model = null;
  }
  if (!goodword) {
    goodword = '你願意把這件事說出來，本身就不容易。';
    accept = accept || '我聽到了。';
    smallstep = smallstep || '今晚先做一件小事：喝一杯水。';
  }

  const aiOk = engine !== 'rules';
  const score = L.screen.scorePost(text, aiOk);

  // KV 未設定 → 只回分數，由前端存在本機牆（網站照常可用）
  if (!L.kv.enabled()) {
    return {
      status: 200,
      body: {
        ok: true, wallEnabled: false, localOnly: true, week,
        serverGenerated: true, clientAiOffered,
        item: { id: crypto.randomUUID(), text, topic, accept, goodword, smallstep, engine, model, createdAt: Date.now(), encs: [] },
        points: score.total, scoreWhy: [...score.specWhy, ...(score.aiBonus ? ['AI 有接住 +' + score.aiBonus] : [])],
        base: score.base, spec: score.spec,
      },
    };
  }

  // 速率限制：每週最多 5 篇
  try {
    const rk = 'rate:post:' + anon + ':' + week;
    const n = await L.kv.incr(rk);
    await L.kv.expire(rk, 8 * 86400);
    if (n > L.screen.LIMITS.POST_PER_WEEK) {
      return { status: 429, body: { ok: false, error: '本週公開上限 ' + L.screen.LIMITS.POST_PER_WEEK + ' 篇，留點空間給別人，下週再來！', week } };
    }

    const id = crypto.randomUUID();
    const item = {
      id, text, topic, accept, goodword, smallstep, engine, model,
      createdAt: Date.now(), anon, // 伺服器端記錄發文者（只用於鼓勵分數回饋），對外只顯示 handle
    };
    await L.kv.set('wall:item:' + id, JSON.stringify(item));
    await L.kv.lpush(WALL_IDS_KEY, id);
    await L.kv.ltrim(WALL_IDS_KEY, 0, L.screen.LIMITS.WALL_ITEMS - 1);
    await L.kv.hincrby('pts:' + week, anon, score.total);
    await L.kv.hincrby('pts:all', anon, score.total);

    return {
      status: 200,
      body: {
        ok: true, wallEnabled: true, week,
        serverGenerated: true, clientAiOffered,
        item: publicItem(L, item, []),
        points: score.total,
        scoreWhy: [...score.specWhy, ...(score.aiBonus ? ['AI 有接住 +' + score.aiBonus] : [])],
        base: score.base, spec: score.spec,
      },
    };
  } catch (err) {
    console.error('[wall] create 失敗：', String(err && err.message));
    return { status: 200, body: { ok: true, wallEnabled: false, localOnly: true, week, item: { id: crypto.randomUUID(), text, topic, accept, goodword, smallstep, engine, model, createdAt: Date.now(), encs: [] }, points: score.total, scoreWhy: score.specWhy, base: score.base, spec: score.spec } };
  }
}

// ─────────────────────────────────────────────
// POST /api/encourage — 對一篇貼文留一句鼓勵（AI 審核通過才顯示）
//   body: { anon, itemId, text }
// ─────────────────────────────────────────────
async function addEncourage(L, payload) {
  const week = L.screen.weekKey(Date.now());
  const anon = L.screen.sanitizeAnon(payload && payload.anon);
  const itemId = L.screen.sanitizeItemId(payload && payload.itemId);
  if (!anon || !itemId) return { status: 400, body: { ok: false, error: '請求格式錯誤。', week } };

  // 有 KV 時先把貼文抓出來（確認存在 + 拿原文來審鼓勵是否真的有回應到）
  let item = null;
  if (L.kv.enabled()) {
    try {
      const raw = await L.kv.get('wall:item:' + itemId);
      if (!raw) return { status: 404, body: { ok: false, error: '這篇貼文已經不在牆上了。', week } };
      item = JSON.parse(raw);
    } catch (err) {
      console.error('[wall] encourage 取貼文失敗：', String(err && err.message));
      return { status: 200, body: { ok: true, wallEnabled: false, localOnly: true, week } };
    }
  }

  const v = L.screen.validateEncourage(payload && payload.text, item ? item.text : '');
  if (v.crisis) {
    const c = L.safety.crisisResponse();
    return { status: 200, body: { ok: false, crisis: true, resources: c.resources, accept: c.accept, week } };
  }
  if (!v.ok) return { status: 422, body: { ok: false, error: v.reason, week } };

  if (!L.kv.enabled() || !item) {
    // 本機牆模式：前端自己記，這裡只回分數
    const score = L.screen.scoreEncourage(v.text, item ? item.text : '');
    return { status: 200, body: { ok: true, wallEnabled: false, localOnly: true, week, delta: score.total, posterDelta: 0, scoreWhy: score.why, enc: { id: crypto.randomUUID(), text: v.text, handle: L.screen.anonHandle(anon), score: score.total, createdAt: Date.now() } } };
  }

  try {

    // ── 防刷分 ①：同一篇貼文「正規化後相同」的鼓勵 → 拒絕（跨匿名身分也擋）──
    //    評審實測：完整複製牆上既有的罐頭句可以一直送、每次都 +7 分。
    const norm = normalizeForCompare(L, v.text);
    const existing = await readEncs(L, itemId);
    if (existing && existing.some((e) => normalizeForCompare(L, e.text) === norm)) {
      return { status: 409, body: { ok: false, error: '這句話牆上已經有了，換句話說。', week } };
    }
    if (existing === null && memHas(itemId, norm)) {
      // KV 讀不到時，至少用本行程記憶體擋同句重複
      return { status: 409, body: { ok: false, error: '這句話牆上已經有了，換句話說。', week } };
    }

    // 每日「送幾句」粗上限（既有行為）
    const dayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    const rk = 'rate:enc:' + anon + ':' + dayKey;
    const n = await L.kv.incr(rk);
    await L.kv.expire(rk, 2 * 86400);
    if (n > L.screen.LIMITS.ENC_PER_DAY) {
      return { status: 429, body: { ok: false, error: '今天鼓勵夠多了（每日上限 ' + L.screen.LIMITS.ENC_PER_DAY + ' 句），明天再來！', week } };
    }

    const score = L.screen.scoreEncourage(v.text, item.text);

    // ── 防刷分 ②：同一 anon 對同一篇貼文只給一次分 ──
    //    以 anonHash（伺服器端 sha256 前 16 碼）比對身分，**不用對外的 handle**：
    //    handle 在沒設 HANDLE_SECRET 時只取 anon 後 4 碼，會碰撞（實測所有測試 anon
    //    都以 abcd 結尾 → 被誤判成同一人而全部不給分）。anonHash 不對外顯示。
    const myHandle = L.screen.anonHandle(anon);
    const myHash = crypto.createHash('sha256').update(String(anon)).digest('hex').slice(0, 16);
    const alreadyEncouraged = Boolean(existing && existing.some((e) => (
      e.anonHash ? e.anonHash === myHash : e.handle === myHandle
    )));

    // ── 防刷分 ③：同一個人「同一句話」在同一天內只用一次（跨貼文也算）──
    //    複測 v2：去重只做了 per-item，換一篇貼文送同一句罐頭仍每次 +7。
    const textKey = crypto.createHash('sha1').update(norm).digest('hex').slice(0, 16);
    const seenKey = 'enc:seen:' + myHash + ':' + dayKey;
    let textSeen = false;
    try {
      const seenN = await L.kv.hincrby(seenKey, textKey, 1);
      await L.kv.expire(seenKey, 2 * 86400);
      textSeen = Number(seenN) > 1;
    } catch (_) {
      textSeen = false; // KV 不支援就不擋（服務可用性優先）
    }

    // ── 防刷分 ④：每日「能得分的鼓勵篇數」上限（預設 5）──
    const scoreCap = Number(L.screen.LIMITS.ENC_SCORE_PER_DAY) || ENC_SCORE_PER_DAY_DEFAULT;
    const sk = 'rate:encscore:' + anon + ':' + dayKey;
    let scored = 0;
    if (!alreadyEncouraged && !textSeen) {
      const k = await L.kv.incr(sk);
      await L.kv.expire(sk, 2 * 86400);
      scored = k <= scoreCap ? score.total : 0;
    }

    // 2026-11 複測 v2：anonHash 被回在 API 回應裡 → 等於給出一個穩定、完整的跨發文追蹤鍵
    // （比舊版 4 碼 handle 更適合追蹤）。anonHash 只存內部、**永不出現在任何回應**。
    const enc = {
      id: crypto.randomUUID(), text: v.text, handle: myHandle,
      anonHash: myHash,      // 內部比對用；下面的 publicEnc() 不會輸出
      score: scored, createdAt: Date.now(),
    };
    await L.kv.lpush('wall:item:' + itemId + ':encs', JSON.stringify(enc));
    await L.kv.ltrim('wall:item:' + itemId + ':encs', 0, L.screen.LIMITS.ENC_PER_ITEM - 1);
    if (normalizeForCompare(L, v.text)) memAdd(itemId, normalizeForCompare(L, v.text));

    // 雙方得分：只在「這篇還沒被同一人鼓勵過」且未達每日得分上限時才加分
    let posterDelta = 0;
    if (scored > 0) {
      await L.kv.hincrby('pts:' + week, anon, scored);
      await L.kv.hincrby('pts:all', anon, scored);
      posterDelta = L.screen.SCORE.POSTER_REWARD_PER_ENC;
      await L.kv.hincrby('pts:' + week, item.anon, posterDelta);
      await L.kv.hincrby('pts:all', item.anon, posterDelta);
    }

    return {
      status: 200,
      body: {
        ok: true, wallEnabled: true, week,
        delta: scored, alreadyEncouraged: alreadyEncouraged || undefined,
        posterDelta, scoreWhy: score.why, enc: publicEnc(enc),
      },
    };
  } catch (err) {
    console.error('[wall] encourage 失敗：', String(err && err.message));
    return { status: 200, body: { ok: true, wallEnabled: false, localOnly: true, week, delta: L.screen.scoreEncourage(v.text, '').total, posterDelta: 0, enc: { id: crypto.randomUUID(), text: v.text, handle: L.screen.anonHandle(anon), score: 0, createdAt: Date.now() } } };
  }
}

// ─────────────────────────────────────────────
// GET /api/leaderboard?anon=xxx — 本週公開排行榜
// ─────────────────────────────────────────────
async function leaderboard(L, query) {
  const week = (query && query.week) || L.screen.weekKey(Date.now());
  if (!L.kv.enabled()) {
    return { status: 200, body: { ok: true, wallEnabled: false, week, top: [] } };
  }
  try {
    const pts = await L.kv.hgetall('pts:' + week);
    const entries = Object.entries(pts)
      .map(([anon, p]) => ({ handle: L.screen.anonHandle(anon), pts: p, anon }))
      .sort((a, b) => b.pts - a.pts)
      .slice(0, 12)
      .map((e, i) => ({ rank: i + 1, handle: e.handle, pts: e.pts, title: L.screen.rankTitle(i + 1, e.pts) }));

    const body = { ok: true, wallEnabled: true, week, top: entries.map(({ rank, handle, pts, title }) => ({ rank, handle, pts, title })) };

    const meAnon = L.screen.sanitizeAnon(query && query.anon);
    if (meAnon) {
      const all = await L.kv.hgetall('pts:' + week);
      const sorted = Object.entries(all).sort((a, b) => b[1] - a[1]);
      const idx = sorted.findIndex(([a]) => a === meAnon);
      const myPts = Number(all[meAnon]) || 0;
      body.me = {
        handle: L.screen.anonHandle(meAnon),
        pts: myPts,
        rank: idx >= 0 ? idx + 1 : null,
        title: L.screen.rankTitle(idx >= 0 ? idx + 1 : 0, myPts),
      };
      const allPts = await L.kv.hgetall('pts:all');
      body.me.allPts = Number(allPts[meAnon]) || 0;
    }
    return { status: 200, body };
  } catch (err) {
    console.error('[wall] leaderboard 失敗：', String(err && err.message));
    return { status: 200, body: { ok: true, wallEnabled: false, week, top: [] } };
  }
}

// ─────────────────────────────────────────────
// DELETE /api/wall — 管理者回收資料（P1-2）
//
// 背景：評審對正式站送出的 31 筆測試資料（含 PII 樣本）原本**無法回收** ——
// 站上沒有任何刪除路徑（DELETE 一律 405）。這裡補上刪除，供維運清理。
//
// 權杖驗證在 deploy/api/wall.js（x-admin-token == env WALL_ADMIN_TOKEN）——
// 本函式只負責「刪什麼、怎麼刪」，不碰權杖。
//
// 選擇目標（opts）：
//   id     刪單篇（含其鼓勵）
//   ids    'a,b,c' 批次刪
//   purge  'test' = 清測試資料（anon 符合 TEST_ANON_RE，或字串裡含
//                  test/probe/review/judge/qa/demo/attack/abuse → 涵蓋評審用的
//                  rate-test-0001 / wall-prober 這類命名）
//          'all'  = 清空整面牆（慎用）
//   anon   明示某個 anon 的貼文全刪
//   before 只刪 createdAt < before（毫秒；可搭配 purge=all 做時間切分）
//   dry    true = 只列出會刪什麼，不動資料
//
// 刪除時一併：移除牆清單中的 id、刪掉該篇的鼓勵清單、把作者的匿名身分
// 從 pts:<week> 與 pts:all 兩個排行榜 hash 移除（否則測試帳號會留在榜上，
// 評審實測的 rate-test-0001 就佔了第 4 名）。
// ─────────────────────────────────────────────
function looksLikeTestAnon(anon) {
  const s = String(anon || '');
  if (!s) return false;
  if (TEST_ANON_RE.test(s)) return true;
  return /(?:test|probe|review|judge|pentest|blackbox|attack|abuse|demo|qa)[-_]?\d*/i.test(s);
}

async function deleteWall(L, opts) {
  const o = opts || {};
  const week = L.screen.weekKey(Date.now());
  if (!L.kv.enabled()) {
    return { status: 503, body: { ok: false, error: 'KV 未啟用，沒有可刪除的雲端資料。', week } };
  }

  const wantIds = [];
  if (o.id) wantIds.push(String(o.id).trim());
  if (o.ids) {
    for (const x of String(o.ids).split(',')) {
      const s = x.trim();
      if (s) wantIds.push(s);
    }
  }

  const beforeMs = o.before ? Number(o.before) : null;
  const wantAnon = o.anon ? L.screen.sanitizeAnon(o.anon) : null;

  try {
    const ids = await L.kv.lrange(WALL_IDS_KEY, 0, L.screen.LIMITS.WALL_ITEMS - 1);
    const raw = ids.length ? await L.kv.mget(ids.map((id) => 'wall:item:' + id)) : [];
    const scanned = [];
    for (let i = 0; i < ids.length; i++) {
      let item = null;
      try { item = raw[i] ? JSON.parse(raw[i]) : null; } catch (_) { item = null; }
      if (item && item.id) scanned.push(item);
    }

    let targets;
    if (wantIds.length) {
      const set = new Set(wantIds);
      targets = scanned.filter((it) => set.has(it.id));
    } else if (o.purge === 'all') {
      targets = scanned;
    } else if (wantAnon) {
      targets = scanned.filter((it) => it.anon === wantAnon);
    } else if (o.purge === 'test') {
      targets = scanned.filter((it) => looksLikeTestAnon(it.anon));
    } else {
      return { status: 400, body: { ok: false, error: '請指定 ?id= 或 ?ids= 或 ?purge=test|all 或 ?anon=。', week } };
    }

    if (beforeMs) targets = targets.filter((it) => Number(it.createdAt || 0) < beforeMs);

    const listing = targets.map((it) => ({
      id: it.id,
      handle: L.screen.anonHandle(it.anon || ''),
      createdAt: it.createdAt || null,
      preview: String(it.text || '').slice(0, 40),
    }));

    if (o.dry) {
      return { status: 200, body: { ok: true, dryRun: true, matched: listing.length, listing, week } };
    }

    const anons = new Set();
    for (const it of targets) {
      if (it.anon) anons.add(it.anon);
      await kvDel(L, 'wall:item:' + it.id + ':encs');
      await kvDel(L, 'wall:item:' + it.id);
      await kvRemoveId(L, it.id);
    }
    // 測試帳號從排行榜移除（含本週與累計）
    for (const a of anons) {
      await L.kv.cmd('HDEL', 'pts:' + week, a).catch(() => {});
      await L.kv.cmd('HDEL', 'pts:all', a).catch(() => {});
    }

    return {
      status: 200,
      body: { ok: true, deleted: targets.length, anonsCleared: anons.size, listing: listing.slice(0, 50), week },
    };
  } catch (err) {
    console.error('[wall] delete 失敗：', String(err && err.message));
    return { status: 500, body: { ok: false, error: '刪除失敗：' + String(err && err.message), week } };
  }
}

module.exports = { libs, listWall, createPost, addEncourage, leaderboard, deleteWall, deployForce };
