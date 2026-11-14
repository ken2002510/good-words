'use strict';

/**
 * /api/wall — 好話牆
 *   GET    → { ok, wallEnabled, week, items[] }（最新在前；KV 未設 → wallEnabled:false）
 *   POST   { anon, text, topic? } → 發一篇：先過危機/個資/謾罵審核，**AI 回應一律由伺服器產生**
 *                                  （P1-1a：客戶端帶來的 ai 欄位一律忽略，回應附 serverGenerated:true）
 *   DELETE → 管理者回收資料（P1-2）。需 header `x-admin-token` == env WALL_ADMIN_TOKEN
 *              ?id=<itemId>          刪單篇（含其所有鼓勵）
 *              ?ids=a,b,c            批次刪多篇
 *              ?purge=test           清測試資料（anon 符合測試前綴，或 ?anon= 明示名單，或 ?before=<ms>）
 *              ?purge=all            清空整面牆（慎用；同樣要 token）
 *              ?dry=1                只列「會被刪什麼」，不動資料
 *            錯 token → 401；PUT/PATCH 等其他動詞 → 405（不支援的方法不會變成 404）
 *
 * 真正邏輯在 deploy/lib/wallcore.js（本機 server.js 也共用同一份）。
 */

const crypto = require('crypto');
const { cors, readBody, methodGuard } = require('./_http.js');
const core = require('../lib/wallcore.js');

/** 管理權杖比對（constant-time；未設定 env → 「未啟用」而不是「全開」） */
function verifyAdmin(req) {
  const want = String(process.env.WALL_ADMIN_TOKEN || '');
  if (!want) return { ok: false, configured: false };
  const h = (req && req.headers) || {};
  const given = String(h['x-admin-token'] || h['X-Admin-Token'] || '');
  const a = Buffer.from(given, 'utf8');
  const b = Buffer.from(want, 'utf8');
  const same = a.length === b.length && a.length > 0 && crypto.timingSafeEqual(a, b);
  return { ok: same, configured: true };
}

module.exports = async (req, res) => {
  cors(res);
  // _http.js 的 cors() 只列 GET/POST：DELETE 與 x-admin-token 要在這裡補上，
  // 否則瀏覽器端的 preflight 會被擋（管理工具／清理腳本才打得動）。
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-admin-token');

  if (methodGuard(req, res, ['GET', 'POST', 'DELETE'])) return;

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

    if (req.method === 'DELETE') {
      const t = verifyAdmin(req);
      if (!t.configured) {
        return res.status(503).json({ ok: false, error: '管理端點未啟用：伺服器沒有設定 WALL_ADMIN_TOKEN。' });
      }
      if (!t.ok) return res.status(401).json({ ok: false, error: '管理權杖不正確。' });

      const u = new URL(req.url, 'http://x');
      const out = await core.deleteWall(core.libs(), {
        id: u.searchParams.get('id') || undefined,
        ids: u.searchParams.get('ids') || undefined,
        purge: u.searchParams.get('purge') || undefined,
        anon: u.searchParams.get('anon') || undefined,
        before: u.searchParams.get('before') || undefined,
        dry: u.searchParams.get('dry') === '1' || u.searchParams.get('dry') === 'true',
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
