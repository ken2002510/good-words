'use strict';

/**
 * POST /api/share — serverless 版（Vercel）
 *
 * 與本機 app/server.js 的 /api/share 同契約：
 *   Request : { accept, goodword, smallstep, audience: 'friend'|'family'|'colleague' }
 *   Response: { audience, label, text, copyText }
 *
 * BRIEF §3「做好事」＝好話轉送。這條路徑是評分項「三好四給」的直接體現，
 * 前端「轉送給別人」按鈕打的就是這裡，所以部署版**必須**有這支，
 * 否則公開站會少一個功能（評審會按）。
 */

const { loadLib } = require('../lib/resolve.js');

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  let payload = req.body;
  if (typeof payload === 'string') {
    try { payload = payload ? JSON.parse(payload) : {}; } catch { payload = {}; }
  }
  if (!payload || typeof payload !== 'object') payload = {};

  const audience = ['friend', 'family', 'colleague'].includes(payload.audience)
    ? payload.audience
    : 'friend';

  const base = {
    accept: String(payload.accept || ''),
    goodword: String(payload.goodword || ''),
    smallstep: String(payload.smallstep || ''),
  };

  // ── 主路徑：復用 app/lib/ai.js 的 buildShare（單一事實來源）──
  try {
    const ai = loadLib('ai').mod;
    const share = ai.buildShare(base, audience);
    return res.status(200).json({ ...share, copyText: ai.toCopyText(base) });
  } catch (err) {
    console.error('[share] 載入 AI 模組失敗：', String((err && err.message) || err));
  }

  // ── 硬備援：模板內建，確保「轉送」功能永遠可用（不白畫面）──
  const TPL = {
    friend: { label: '給朋友', opening: '嗨，我在想你可能也辛苦了。', closing: '不用回我，看完就好。' },
    family: { label: '給家人', opening: '有些話我當面說不出口，但我一直放在心裡。', closing: '你看看就好，不用回我。' },
    colleague: { label: '給同事', opening: '最近一起撐著，我知道你也不輕鬆。', closing: '不用回我，先把今天的自己顧好。' },
  };
  const a = TPL[audience];
  const core = base.goodword || '你現在的感覺是真的，它不需要先被誰同意。';
  const carry = base.accept || '你願意把這件事寫下來，本身就不容易。';
  const text = [a.opening, '', `「${core}」`, '', carry, '', a.closing].join('\n');

  return res.status(200).json({
    audience,
    label: a.label,
    text,
    copyText: `承接：${base.accept}\n好話：${base.goodword}\n小步：${base.smallstep}`,
    meta: { degraded: true, degradedReason: '引擎載入失敗，使用內建轉送模板' },
  });
};
