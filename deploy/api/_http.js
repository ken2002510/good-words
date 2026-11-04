'use strict';

/**
 * _http.js — serverless handler 共用的 HTTP 小工具（_ 開頭不會被 Vercel 編成 function）
 */

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return req.body ? JSON.parse(req.body) : {}; } catch { return {}; }
  }
  const chunks = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > 64 * 1024) throw Object.assign(new Error('body too large'), { code: 413 });
    chunks.push(c);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  return raw ? JSON.parse(raw) : {};
}

/** OPTIONS → 204；方法不符 → 405。回 true 表示已處理完畢。 */
function methodGuard(req, res, allowed) {
  if (req.method === 'OPTIONS') { res.status(204).end(); return true; }
  if (!allowed.includes(req.method)) {
    res.setHeader('Allow', allowed.join(', ') + ', OPTIONS');
    res.status(405).json({ error: 'Method Not Allowed' });
    return true;
  }
  return false;
}

module.exports = { cors, readBody, methodGuard };
