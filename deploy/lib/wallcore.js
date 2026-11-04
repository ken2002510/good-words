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

function publicItem(item, encs) {
  return {
    id: item.id,
    text: item.text,
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
async function listWall(L) {
  const week = L.screen.weekKey(Date.now());
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
      const encRaw = await L.kv.lrange('wall:item:' + item.id + ':encs', 0, L.screen.LIMITS.ENC_PER_ITEM - 1);
      const encs = encRaw.map((s) => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean);
      items.push(publicItem(item, encs));
    }
    return { status: 200, body: { ok: true, wallEnabled: true, week, items } };
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

  // AI 回應：前端已從 /api/respond 拿到結果可直接帶上；沒帶就後端自己跑（預算內）
  let accept = '', goodword = '', smallstep = '', engine = 'rules', model = null;
  const aiIn = payload && payload.ai;
  if (aiIn && typeof aiIn === 'object' && (aiIn.goodword || aiIn.accept)) {
    accept = String(aiIn.accept || '').slice(0, 500);
    goodword = String(aiIn.goodword || '').slice(0, 500);
    smallstep = String(aiIn.smallstep || '').slice(0, 500);
    engine = ['rules', 'ollama', 'nvidia', 'cloud'].includes(aiIn.engine) ? aiIn.engine : 'rules';
    model = aiIn.model ? String(aiIn.model).slice(0, 80) : null;
    // 前端帶來的 AI 回應也要再過一次 lint，不合格就用規則軌重算
    const check = L.rules.lint({ 承接: accept, 好話: goodword, 小步: smallstep });
    if (!check.ok) {
      try {
        const r = await withBudget(L.ai.generate(text, { force: 'rules', mode: 'chat' }), 3000);
        accept = r.accept; goodword = r.goodword; smallstep = r.smallstep; engine = 'rules'; model = null;
      } catch (_) { /* spesific fallback below */ }
    }
  } else {
    try {
      const r = await withBudget(L.ai.generate(text, { force: deployForce(), mode: 'chat' }), 8000);
      accept = r.accept; goodword = r.goodword; smallstep = r.smallstep;
      engine = (r.meta && r.meta.engine) || 'rules';
      model = (r.meta && r.meta.model) || null;
    } catch (_) {
      const r = await withBudget(L.ai.generate(text, { force: 'rules', mode: 'chat' }), 3000).catch(() => null);
      if (r) { accept = r.accept; goodword = r.goodword; smallstep = r.smallstep; }
      engine = 'rules'; model = null;
    }
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
        item: { id: crypto.randomUUID(), text, accept, goodword, smallstep, engine, model, createdAt: Date.now(), encs: [] },
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
      id, text, accept, goodword, smallstep, engine, model,
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
        item: publicItem(item, []),
        points: score.total,
        scoreWhy: [...score.specWhy, ...(score.aiBonus ? ['AI 有接住 +' + score.aiBonus] : [])],
        base: score.base, spec: score.spec,
      },
    };
  } catch (err) {
    console.error('[wall] create 失敗：', String(err && err.message));
    return { status: 200, body: { ok: true, wallEnabled: false, localOnly: true, week, item: { id: crypto.randomUUID(), text, accept, goodword, smallstep, engine, model, createdAt: Date.now(), encs: [] }, points: score.total, scoreWhy: score.specWhy, base: score.base, spec: score.spec } };
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

  const v = L.screen.validateEncourage(payload && payload.text);
  if (v.crisis) {
    const c = L.safety.crisisResponse();
    return { status: 200, body: { ok: false, crisis: true, resources: c.resources, accept: c.accept, week } };
  }
  if (!v.ok) return { status: 422, body: { ok: false, error: v.reason, week } };

  if (!L.kv.enabled()) {
    // 本機牆模式：前端自己記，這裡只回分數
    const score = L.screen.scoreEncourage(v.text, '');
    return { status: 200, body: { ok: true, wallEnabled: false, localOnly: true, week, delta: score.total, posterDelta: 0, scoreWhy: score.why, enc: { id: crypto.randomUUID(), text: v.text, handle: L.screen.anonHandle(anon), score: score.total, createdAt: Date.now() } } };
  }

  try {
    const raw = await L.kv.get('wall:item:' + itemId);
    if (!raw) return { status: 404, body: { ok: false, error: '這篇貼文已經不在牆上了。', week } };
    const item = JSON.parse(raw);

    // 每日鼓勵上限
    const dayKey = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
    const rk = 'rate:enc:' + anon + ':' + dayKey;
    const n = await L.kv.incr(rk);
    await L.kv.expire(rk, 2 * 86400);
    if (n > L.screen.LIMITS.ENC_PER_DAY) {
      return { status: 429, body: { ok: false, error: '今天鼓勵夠多了（每日上限 ' + L.screen.LIMITS.ENC_PER_DAY + ' 句），明天再來！', week } };
    }

    const score = L.screen.scoreEncourage(v.text, item.text);
    const enc = {
      id: crypto.randomUUID(), text: v.text, handle: L.screen.anonHandle(anon),
      score: score.total, createdAt: Date.now(),
    };
    await L.kv.lpush('wall:item:' + itemId + ':encs', JSON.stringify(enc));
    await L.kv.ltrim('wall:item:' + itemId + ':encs', 0, L.screen.LIMITS.ENC_PER_ITEM - 1);

    // 雙方得分：鼓勵者 +score，發文者 +固定分
    await L.kv.hincrby('pts:' + week, anon, score.total);
    await L.kv.hincrby('pts:all', anon, score.total);
    await L.kv.hincrby('pts:' + week, item.anon, L.screen.SCORE.POSTER_REWARD_PER_ENC);
    await L.kv.hincrby('pts:all', item.anon, L.screen.SCORE.POSTER_REWARD_PER_ENC);

    return {
      status: 200,
      body: { ok: true, wallEnabled: true, week, delta: score.total, posterDelta: L.screen.SCORE.POSTER_REWARD_PER_ENC, scoreWhy: score.why, enc },
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

module.exports = { libs, listWall, createPost, addEncourage, leaderboard, deployForce };
