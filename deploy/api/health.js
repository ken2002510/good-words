'use strict';

/**
 * GET /api/health — 部署自檢端點（唯讀）
 *
 * ★ P1-3 修正（2026-11 評審）：先前這個端點會公開
 *     - app/lib/*.js 的相對路徑（部署內部結構）
 *     - 每個模組的完整 export 清單（等於把關鍵字黑名單的「名稱」送給攻擊者：
 *       safety.BUILTIN_PATTERNS / PII_PATTERNS / ATTACK_WORDS …）
 *   這對一個匿名公開服務是白送的攻擊地圖。現在只回四個欄位：
 *
 *     { ok:boolean, engine:string, degraded:boolean, counts:{ 純數字 } }
 *
 *   契約（刻意極簡、刻意不含任何名稱）：
 *     ok       永遠 true（函式有回應本身就代表服務活著）
 *     engine   目前實際生效的 AI 軌：'rules' | 'nvidia' | 'cloud' | 'ollama' | 'auto'
 *     degraded true = 有出廠保證的元件正在降級運作（見下方定義）
 *     counts   只有數字：內容語料數量、牆上篇數、最近錯誤數
 *
 *   degraded 的定義（誠實揭露，不美化）：
 *     engine === 'rules'（沒有雲端 LLM key，走內建規則式）
 *     || KV 未設定（好話牆停用 → 前端退回本機紀錄）
 *     || 內容層載入失敗
 *   任何一項成立就是 true。要判斷「哪一項」請看 engine（AI）與 counts.wallItems
 *   （牆）；刻意不再回傳檔案路徑、模組名、export 名、pattern 名。
 *
 *   注意：本機 app/server.js 有自己的 /api/health（欄位較多，含絕對路徑），
 *   不在本次修改範圍；Vercel 上的 /api/health 走的是這一支。
 */

const { loadLib } = require('../lib/resolve.js');

function safe(fn, fallback = null) {
  try {
    return fn();
  } catch (_) {
    return fallback;
  }
}

/** 任何非有限數字一律歸 0，保證 counts 只含數字（不外洩錯誤訊息） */
function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  // ── 引擎（單一事實來源：與 /api/respond、wallcore 用同一個判斷）──
  const engine = safe(() => require('../lib/wallcore.js').deployForce(), 'rules');

  // ── KV / 牆 ──
  let kvOn = false;
  let wallItems = 0;
  kvOn = safe(() => loadLib('kv').mod.enabled(), false) === true;
  if (kvOn) {
    try {
      const kv = loadLib('kv').mod;
      const max = num(safe(() => loadLib('screen').mod.LIMITS.WALL_ITEMS, 60)) || 60;
      const ids = await kv.lrange('wall:ids', 0, max - 1);
      wallItems = Array.isArray(ids) ? ids.length : 0;
    } catch (_) {
      // KV 有設定但讀不到 → 牆視為降級（不洩漏錯誤內容）
      wallItems = 0;
    }
  }

  // ── 內容層（只取數量）──
  let contentFailed = false;
  let emotions = 0;
  let goodwordSets = 0;
  let warnings = 0;
  const dataLoad = safe(() => loadLib('data'));
  if (dataLoad && dataLoad.mod && typeof dataLoad.mod.getContent === 'function') {
    const content = safe(() => dataLoad.mod.getContent(), null);
    if (!content) {
      contentFailed = true;
    } else {
      emotions = num(content.emotions && content.emotions.length);
      goodwordSets = num(content.goodwords && Object.keys(content.goodwords).length);
      warnings = num(content.warnings && content.warnings.length);
    }
  } else {
    contentFailed = true;
  }

  const recentErrors = num(safe(() => (loadLib('ai').mod.recentErrors || []).length, 0));
  if (!kvOn) contentFailed = contentFailed; // 保留可讀性：wall 降級由 engine/degraded 表達
  const degraded = engine === 'rules' || !kvOn || contentFailed;

  return res.status(200).json({
    ok: true,
    engine: String(engine || 'rules'),
    degraded: Boolean(degraded),
    counts: {
      wallItems: num(wallItems),
      contentEmotions: emotions,
      contentGoodwords: goodwordSets,
      contentWarnings: warnings,
      recentErrors,
    },
  });
};
