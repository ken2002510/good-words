'use strict';

/**
 * /api/leaderboard — 本週好話排行榜（公開）
 *   GET ?anon=xxx&week=2026-W45
 *   → { ok, wallEnabled, week, top:[{rank,handle,pts,title}], me?{rank,pts,title,allPts} }
 *   只顯示匿名稱呼（牆友#XXXX），不顯示原始 ID。
 */

const { cors, methodGuard } = require('./_http.js');
const core = require('../lib/wallcore.js');

module.exports = async (req, res) => {
  cors(res);
  if (methodGuard(req, res, ['GET'])) return;

  try {
    const u = new URL(req.url, 'http://x');
    const out = await core.leaderboard(core.libs(), {
      week: u.searchParams.get('week') || undefined,
      anon: u.searchParams.get('anon') || undefined,
    });
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('[leaderboard] handler 例外：', String(err && err.message));
    return res.status(200).json({ ok: true, wallEnabled: false, top: [] });
  }
};
