'use strict';

/**
 * /api/encourage — 對牆上一篇貼文留一句鼓勵
 *   POST { anon, itemId, text }
 *   →審核（危機/個資/謾罵/反毒雞湯 lint）通過才掛上去，雙方得分
 *   → { ok, delta, posterDelta, enc, ... }；危機內容永不儲存
 */

const { cors, readBody, methodGuard } = require('./_http.js');
const core = require('../lib/wallcore.js');

module.exports = async (req, res) => {
  cors(res);
  if (methodGuard(req, res, ['POST'])) return;

  try {
    let payload;
    try {
      payload = await readBody(req);
    } catch (err) {
      return res.status(err && err.code === 413 ? 413 : 400).json({ ok: false, error: err && err.code === 413 ? '內容太長了' : '格式錯誤，請重新送出' });
    }
    const out = await core.addEncourage(core.libs(), payload);
    return res.status(out.status).json(out.body);
  } catch (err) {
    console.error('[encourage] handler 例外：', String(err && err.message));
    return res.status(200).json({ ok: false, error: '鼓勵暫時送不出，請稍後再試' });
  }
};
