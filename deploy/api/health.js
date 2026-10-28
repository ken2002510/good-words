'use strict';

/**
 * GET /api/health — 部署自檢端點（唯讀）
 *
 * ★ 契約對齊：本機 app/server.js 的 /api/health 回傳
 *     { ok, app, time, engines:{ollama,cloud,rules}, content:{dir,source,emotions,goodwordSets,warnings}, recentErrors }
 *   部署版**必須回同一組欄位**，否則：
 *     - 前端若依賴 health 顯示引擎狀態 → 雲端壞掉
 *     - 驗收腳本用同一套判讀邏輯 → 得到假結果
 *   所以這裡以 app/server.js 的形狀為主，再**額外附加**部署診斷欄位（deploy*），
 *   附加欄位不影響既有消費者（向後相容）。
 */

const { loadLib, loadContent, appLibDir, contentDir } = require('../lib/resolve.js');

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch (err) {
    return fallback;
  }
}

module.exports = (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  const started = Date.now();

  // ── 取得內容層（優先用 app/lib/data.js，這樣 cloud 與本機判讀完全一致）──
  let content = null;
  let contentError = null;
  const dataLoad = safe(() => loadLib('data'));
  if (dataLoad && dataLoad.mod && typeof dataLoad.mod.getContent === 'function') {
    try {
      content = dataLoad.mod.getContent();
    } catch (err) {
      contentError = String((err && err.message) || err);
    }
  } else {
    contentError = 'loadLib("data") 失敗或缺少 getContent()';
  }

  // 內容層警告（與本機同格式）
  let warnings = [];
  if (content && Array.isArray(content.warnings)) {
    warnings = content.warnings.map((w) => ({ file: w.file, status: w.status, detail: w.detail, action: w.action }));
  } else {
    // 內容層完全載不到 → 至少告訴呼叫者每個檔在不在
    for (const f of ['emotions.json', 'goodwords.json', 'crisis.json', 'share_templates.json']) {
      const d = safe(() => loadContent(f));
      warnings.push({ file: f, status: d ? 'ok' : 'missing' });
    }
  }

  // ── 額外的部署診斷（不影響上面的契約欄位）──
  const libDiag = {};
  for (const name of ['rules', 'safety', 'ai', 'data']) {
    libDiag[name] = safe(() => {
      const r = loadLib(name);
      return { source: String(r.source).replace(process.cwd(), '.'), snapshot: r.snapshot, exports: Object.keys(r.mod || {}) };
    }, { error: '載入失敗' });
  }

  const payload = {
    // ═══ 與 app/server.js 相同的契約 ═══
    ok: true,
    app: '好好說話',
    time: new Date().toISOString(),
    engines: {
      // 部署環境**沒有**本機 Ollama：這裡誠實回報 alive:false，不假裝
      ollama: {
        url: process.env.OLLAMA_URL || 'http://127.0.0.1:11434',
        model: process.env.OLLAMA_MODEL || 'qwen3:4b-instruct',
        alive: false,
        timeoutMs: Number(process.env.OLLAMA_TIMEOUT_MS || 20000),
        note: 'Vercel serverless 無法連到本機 Ollama（BRIEF §10）→ 使用規則式引擎',
      },
      cloud: {
        enabled: Boolean(process.env.CLOUD_LLM_API_KEY || process.env.OPENAI_API_KEY),
      },
      rules: { enabled: true },
    },
    content: {
      dir: (content && content.contentDir) || contentDir(),
      source: content && content.usingFallback ? 'builtin-fallback' : 'content-dir',
      emotions: content && content.emotions ? content.emotions.length : 0,
      goodwordSets: content && content.goodwords ? Object.keys(content.goodwords).length : 0,
      warnings,
    },
    recentErrors: safe(() => (loadLib('ai').mod.recentErrors || []).slice(-10), []),

    // ═══ 部署診斷（附加，不影響上面的契約）═══
    deploy: {
      runtime: process.version,
      elapsedMs: Date.now() - started,
      appLibDir: appLibDir(),
      contentDir: contentDir(),
      contentError,
      lib: libDiag,
      forcedEngine: (process.env.DEPLOY_AI_ENGINE || (process.env.DEPLOY_TRY_OLLAMA === '1' ? 'auto' : 'rules')),
      note: '部署版走規則式引擎；不依賴任何雲端 LLM，保證永遠有回應',
    },
  };

  res.status(200).json(payload);
};
