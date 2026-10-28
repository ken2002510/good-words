'use strict';

/**
 * server.js — 《好好說話》
 * Node.js 內建 http，零外部依賴（BRIEF §4）。
 *
 * 路由：
 *   GET  /                  → public/index.html
 *   GET  /<靜態檔>          → public/ 下的檔案（白名單式、防路徑穿越）
 *   POST /api/respond       → { text, force? } → 三段好話（或危機轉介）
 *   POST /api/share         → { text, audience } → 給他人的轉送版本
 *   GET  /api/health        → 引擎狀態、內容來源、是否降級
 *   GET  /api/content       → 目前載入的情緒類別（前端顯示用，無個資）
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const ai = require('./lib/ai');
const safety = require('./lib/safety');
const { getContent } = require('./lib/data');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
};

const MAX_BODY = 64 * 1024; // 64KB，足夠；同時防止有人丟巨型 body
const MAX_TEXT = 4000;      // 心事長度上限（字元）

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8'); // UTF-8 無 BOM
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('body too large'), { code: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** 靜態檔：解析後必須仍在 PUBLIC_DIR 內，否則 403（防 ../ 穿越） */
function serveStatic(req, res, urlPath) {
  let rel = decodeURIComponent(urlPath);
  if (rel === '/' || rel === '') rel = '/index.html';

  const target = path.resolve(PUBLIC_DIR, '.' + path.posix.normalize(rel));
  const rootWithSep = PUBLIC_DIR.endsWith(path.sep) ? PUBLIC_DIR : PUBLIC_DIR + path.sep;
  if (target !== PUBLIC_DIR && !target.startsWith(rootWithSep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('403 Forbidden');
    return;
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404 Not Found');
      return;
    }
    const ext = path.extname(target).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': st.size,
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    });
    fs.createReadStream(target).pipe(res);
  });
}

// ─────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    res.writeHead(400).end('400 Bad Request');
    return;
  }
  const p = url.pathname;

  // 免登入、零個資 → 不做 cookie / session / 記錄內容

  if (req.method === 'GET' && p === '/api/health') {
    const content = getContent();
    const alive = await ai.ollamaAlive();
    return sendJson(res, 200, {
      ok: true,
      app: '好好說話',
      time: new Date().toISOString(),
      engines: {
        ollama: { url: ai.OLLAMA_URL, model: ai.OLLAMA_MODEL, alive: !!alive, timeoutMs: ai.OLLAMA_TIMEOUT_MS },
        cloud: { enabled: !!ai.cloudKey() },
        rules: { enabled: true },
      },
      content: {
        dir: content.contentDir,
        source: content.usingFallback ? 'builtin-fallback' : 'content-dir',
        emotions: content.emotions.length,
        goodwordSets: Object.keys(content.goodwords).length,
        warnings: content.warnings,
      },
      recentErrors: ai.recentErrors.slice(-10),
    });
  }

  /**
   * 內容狀態一覽。給錄影／驗收前「一鍵確認有沒有接上語料庫」用：
   * 不必來回猜，打開這個端點就知道 14 類 id、每類幾句、有沒有走 fallback。
   */
  if (req.method === 'GET' && p === '/api/content') {
    const content = getContent();
    const emotionIds = content.emotions.map((e) => e.id);
    const perEmotion = {};
    for (const id of emotionIds) perEmotion[id] = (content.goodwords[id] || []).length;

    const fallbackIds = emotionIds.filter((id) => !(content.goodwords[id] || []).length);
    const totalLines = Object.entries(content.goodwords)
      .filter(([id]) => id !== '_any')
      .reduce((n, [, arr]) => n + arr.length, 0);

    return sendJson(res, 200, {
      source: content.usingFallback ? 'builtin-fallback' : 'content-dir',
      contentDir: content.contentDir,
      emotionCount: emotionIds.length,
      emotionIds,
      emotions: content.emotions.map((e) => ({
        id: e.id,
        name: e.name,
        situation: e.situation,
        goodwordCount: (content.goodwords[e.id] || []).length,
      })),
      perEmotion,
      totalGoodwordLines: totalLines,
      genericLines: (content.goodwords._any || []).length,
      shareTones: Object.fromEntries(
        Object.entries((content.shareTemplates && content.shareTemplates.tones) || {})
          .map(([k, v]) => [k, (v || []).map((t) => t.name)])
      ),
      warnings: content.warnings,
      // 一句話結論：錄影／驗收前看這個欄位就好
      ready: !content.usingFallback && fallbackIds.length === 0 && emotionIds.length >= 8,
      _note: fallbackIds.length
        ? `以下情緒類別沒有語料、會用內建補：${fallbackIds.join(', ')}`
        : '所有情緒類別都有語料，未使用內建 fallback',
    });
  }

  if (req.method === 'POST' && p === '/api/respond') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch (err) {
      return sendJson(res, err && err.code === 413 ? 413 : 400, {
        error: err && err.code === 413 ? '內容太長了' : '格式錯誤，請重新送出',
      });
    }

    const text = String(payload.text ?? '').slice(0, MAX_TEXT).trim();
    if (!text) {
      return sendJson(res, 400, { error: '請先寫下一點什麼，一個字也可以。' });
    }

    const force = ['auto', 'rules', 'ollama', 'cloud'].includes(payload.force) ? payload.force : undefined;

    try {
      const result = await ai.generate(text, { force });
      return sendJson(res, 200, result);
    } catch (err) {
      // 連規則引擎都掛 → 仍然要回一個能看的畫面（永不白畫面）
      const fallback = {
        crisis: false,
        emotion: { id: '_any', name: '說不出口的心情', intensity: 3, situation: '' },
        accept: '你願意把這件事寫下來，本身就不容易。',
        goodword: '你現在的感覺是真的，它不需要先被誰同意。',
        smallstep: '今晚先做一件小事：喝一杯水，然後在十一點前躺下。',
        resources: safety.RESOURCES,
        meta: { engine: 'rules', degraded: true, degradedReason: '伺服器內部錯誤，使用安全備援句', elapsedMs: 0 },
        _error: String(err && err.message),
      };
      return sendJson(res, 200, fallback);
    }
  }

  if (req.method === 'POST' && p === '/api/share') {
    let payload;
    try {
      const raw = await readBody(req);
      payload = raw ? JSON.parse(raw) : {};
    } catch {
      return sendJson(res, 400, { error: '格式錯誤' });
    }
    const audience = ['friend', 'family', 'colleague'].includes(payload.audience) ? payload.audience : 'friend';
    const toneId = typeof payload.toneId === 'string' ? payload.toneId : undefined;
    const base = {
      accept: String(payload.accept || ''),
      goodword: String(payload.goodword || ''),
      smallstep: String(payload.smallstep || ''),
    };
    const share = ai.buildShare(base, audience, toneId);
    return sendJson(res, 200, { ...share, copyText: ai.toCopyText(base) });
  }

  // 已知的 API 路徑用錯誤的方法呼叫 → 405（不要掉到靜態檔變成 404）
  if (p.startsWith('/api/')) {
    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8', Allow: 'GET, POST' });
    return res.end(JSON.stringify({ error: '這個路徑不支援此方法' }));
  }

  if (req.method === 'GET' || req.method === 'HEAD') {
    return serveStatic(req, res, p);
  }

  res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('405 Method Not Allowed');
});

server.listen(PORT, HOST, () => {
  const content = getContent();
  const url = `http://127.0.0.1:${PORT}`;
  console.log('');
  console.log('  《好好說話》已啟動');
  console.log(`  → ${url}`);
  console.log('');
  console.log(`  AI 引擎：${ai.OLLAMA_MODEL} @ ${ai.OLLAMA_URL}（逾時 ${ai.OLLAMA_TIMEOUT_MS / 1000}s）`);
  console.log(`  內容來源：${content.usingFallback ? '內建 fallback（content/ 尚未就緒）' : content.contentDir}`);
  console.log(`  情緒類別：${content.emotions.length} 類`);
  if (content.warnings.length) {
    const bad = content.warnings.filter((w) => w.status !== 'ok');
    for (const w of bad) console.log(`  ⚠️  ${w.file}: ${w.status}${w.detail ? ' — ' + w.detail : ''} → ${w.action || ''}`);
  }
  console.log('  規則式降級：已啟用（Ollama 關閉時自動接手）');
  console.log('');
});

module.exports = server;
