'use strict';

/**
 * /api/wall — 好話牆
 *   GET  → { ok, wallEnabled, week, items[] }（最新在前；KV 未設 → wallEnabled:false）
 *   POST { anon, text, ai? } → 發一篇：先過危機/個資/謾罵審核，AI 回應後掛牆，回分數
 * 真正邏輯在 deploy/lib/wallcore.js（本機 server.js 也共用同一份）。
 */

const { cors, readBody, methodGuard } = require('./_http.js');
const core = require('../lib/wallcore.js');

module.exports = async (req, res) => {
  cors(res);
  if (methodGuard(req, res, ['GET', 'POST'])) return;

  try {
    if (req.method === 'GET') {
      const u = new URL(req.url, 'http://x');
      const out = await core.listWall(core.libs(), {
        topic: u.searchParams.get('topic') || undefined,
        mine: u.searchParams.get('mine') || undefined,
        anon: u.searchParams.get('anon') || undefined,
      });
      return res.status(out.status).json(out.body);
    }
    // POST
    let payload;
    try {
      payload = await readBody(req);
    } catch (err) {
      return res.status(err && err.code === 413 ? 413 : 400).json({ ok: false, error: err && err.code === 413 ? '內容太長了' : '格式錯誤，請重新送出' });
    }
    const out = await core.createPost(core.libs(), payload);
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('[wall] handler 例外：', String(err && err.message));
    return res.status(200).json({ ok: true, wallEnabled: false, items: [], error: '牆暫時不可用' });
  }
};
