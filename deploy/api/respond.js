'use strict';

/**
 * POST /api/respond — serverless 版（Vercel）
 *
 * 與本機 app/server.js 的 /api/respond **完全同契約**：
 *   Request : { text: string, force?: 'auto'|'rules'|'ollama'|'cloud' }
 *   Response: { crisis, emotion:{id,name,intensity,situation,alternatives,unlabeled},
 *               accept, goodword, smallstep, resources, meta:{engine,model,degraded,...} }
 *
 * 部署環境的關鍵事實（BRIEF §10）：
 *   Vercel serverless **連不到本機 Ollama**（127.0.0.1 在雲端是他自己的容器）。
 *   所以部署版走的是 ai.generate() 的第 ③ 軌：**規則式引擎**。
 *   這不是妥協 —— 這正是 BRIEF 要求的「保證永遠有回應，永不白畫面」。
 *
 * 為什麼不重寫一份規則引擎：
 *   直接 require app/lib/ai.js。builder 修一次規則，本機與雲端同時生效（單一事實來源）。
 *   deploy/lib/resolve.js 負責在 app/lib 缺席時退回本地快照。
 *
 * 逾時預算：
 *   Vercel Hobby 的 serverless function 上限是 10 秒（已寫在 vercel.json 的 maxDuration）。
 *   我們把預算壓在 8 秒內，且**預設強制走規則軌**（毫秒級），
 *   避免任何 Ollama/雲端探測吃掉時間導致 504。
 */

const { loadLib } = require('../lib/resolve.js');

const MAX_TEXT = 4000;
const FUNCTION_BUDGET_MS = 8000; // 留 2 秒給 Vercel 收尾，避免 504

/**
 * 部署環境是否要嘗試 Ollama？
 * 預設「不要」——雲端打 127.0.0.1:11434 只是浪費 1.5 秒然後失敗。
 * 若使用者真的在 Vercel 上設了自架的 OLLAMA_URL（例如 tunnel），
 * 才把 DEPLOY_TRY_OLLAMA=1 打開。
 */
function deployForce() {
  const explicit = (process.env.DEPLOY_AI_ENGINE || '').toLowerCase();
  if (['auto', 'rules', 'ollama', 'cloud'].includes(explicit)) return explicit;
  if (process.env.DEPLOY_TRY_OLLAMA === '1') return 'auto';
  return 'rules'; // ← 部署預設：規則式，絕對不會逾時
}

/** 讀 body（Vercel 通常已 parse；保險起見自己處理字串/串流） */
async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return req.body ? JSON.parse(req.body) : {};
    } catch {
      return {};
    }
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

/** 保證回應的形狀永遠一致（前端不必特判任何情況） */
function shape(result) {
  return {
    crisis: Boolean(result.crisis),
    emotion: result.emotion || { id: '_any', name: '說不出口的心情', intensity: 3, situation: '' },
    accept: result.accept || '',
    goodword: result.goodword || '',
    smallstep: result.smallstep || '',
    resources: result.resources || null,
    meta: result.meta || { engine: 'rules', model: null, degraded: true, elapsedMs: 0 },
  };
}

module.exports = async (req, res) => {
  const t0 = Date.now();

  // CORS：公開站台，允許任何來源（免登入、無 cookie、無個資）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');

  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST, OPTIONS');
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  // ── 載入引擎（失敗也要有畫面：走最內圈的硬備援）──
  let ai = null;
  let safety = null;
  let loadError = null;
  try {
    ai = loadLib('ai').mod;
    safety = loadLib('safety').mod;
  } catch (err) {
    loadError = String((err && err.message) || err);
    console.error('[respond] 載入 AI 模組失敗：', loadError);
  }

  // ── 解析輸入 ──
  let payload;
  try {
    payload = await readBody(req);
  } catch (err) {
    return res.status(err && err.code === 413 ? 413 : 400).json({
      error: err && err.code === 413 ? '內容太長了' : '格式錯誤，請重新送出',
    });
  }

  const text = String((payload && payload.text) || '').slice(0, MAX_TEXT).trim();
  if (!text) return res.status(400).json({ error: '請先寫下一點什麼，一個字也可以。' });

  // 只允許白名單，避免有人用 force 強制走慢軌把 function 拖到逾時
  const force = ['auto', 'rules', 'ollama', 'cloud'].includes(payload && payload.force)
    ? payload.force
    : undefined;

  // ════════════════════════════════════════════════════════════
  // 主路徑
  // ════════════════════════════════════════════════════════════
  if (ai && typeof ai.generate === 'function') {
    try {
      const budget = FUNCTION_BUDGET_MS - (Date.now() - t0);
      const result = await Promise.race([
        ai.generate(text, { force: force || deployForce() }),
        new Promise((_, rej) =>
          setTimeout(() => rej(Object.assign(new Error('timeout'), { code: 'TIMEOUT' })), Math.max(500, budget)),
        ),
      ]);
      const out = shape(result);
      out.meta.deploy = {
        engine: out.meta.engine,
        forced: force || deployForce(),
        note: 'Vercel serverless：預設規則軌（連不到本機 Ollama）',
      };
      return res.status(200).json(out);
    } catch (err) {
      const isTimeout = err && err.code === 'TIMEOUT';
      console.error('[respond] generate 失敗：', isTimeout ? '逾時' : String(err && err.message));
      if (isTimeout) {
        // 逾時 → 直接改用規則軌（規則軌是同步的、毫秒級，一定回得來）
        try {
          const r = shape(ai.generate(text, { force: 'rules' }));
          r.meta.degradedReason = '部署環境逾時，改用規則式回應';
          return res.status(200).json(r);
        } catch (_) {
          /* 落到下面硬備援 */
        }
      }
    }
  }

  // ════════════════════════════════════════════════════════════
  // 硬備援：連 app/lib 都載不到時，仍然給一個能看的畫面（永不白畫面）
  //   這裡刻意「不」依賴任何外部檔案，是真正的最後一道防線。
  //   注意：危機偵測在此仍以關鍵字最低限度運作，安全護欄不能因為載入失敗而消失。
  // ════════════════════════════════════════════════════════════
  const CRISIS_MIN = /(不想活|想死|自殺|自殘|活不下去|撐不下去|結束生命|一了百了|想消失|活著沒意義)/;
  const RESOURCES_MIN = [
    { name: '1925 安心專線', tel: '1925', note: '24 小時，免付費。心情困住、想找人說話都可以打。' },
    { name: '1995 生命線', tel: '1995', note: '24 小時。想結束生命、覺得撐不下去的時候，有人會聽。' },
    { name: '1980 張老師', tel: '1980', note: '週一至週六 09:00–21:00、週日 09:00–17:00。談心事、談家裡的事。' },
    { name: '119 / 110', tel: '119', note: '如果你或身邊的人正在發生立即的危險，請直接打 119 或 110。' },
  ];

  if (CRISIS_MIN.test(String(text).replace(/[\s\u3000]+/g, ''))) {
    return res.status(200).json({
      crisis: true,
      emotion: { id: 'crisis', name: '需要有人陪你', intensity: 5 },
      accept: '你願意把這句話說出來，這件事很重要。你現在承受的，不是「想太多」，是真的非常重。',
      goodword: '我不會假裝我懂你全部的感覺，也不會叫你想開一點。但我希望現在有一個人，真的在你身邊聽你說話。',
      smallstep: '現在，只要做一件事：撥 1925（安心專線，24 小時、免付費），或 1995（生命線）。',
      resources: RESOURCES_MIN,
      meta: { engine: 'safety-min', model: null, degraded: true, degradedReason: '引擎載入失敗，使用內建安全備援' },
    });
  }

  return res.status(200).json({
    crisis: false,
    emotion: { id: '_any', name: '說不出口的心情', intensity: 3, situation: '' },
    accept: '你願意把這件事寫下來，本身就不容易。',
    goodword: '你現在的感覺是真的，它不需要先被誰同意。',
    smallstep: '今晚先做一件小事：喝一杯水，然後在十一點前躺下。',
    resources: null,
    meta: {
      engine: 'rules',
      model: null,
      degraded: true,
      degradedReason: loadError ? `引擎載入失敗（${loadError}），使用安全備援句` : '使用安全備援句',
    },
  });
};
