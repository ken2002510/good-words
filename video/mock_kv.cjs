// mock_kv.cjs — demo 錄影用的 mock Vercel KV（Upstash REST 風格）+ 內建 seed 虛構資料
//
// 用途：讓本機 server.js 走「雲端牆」模式（KV_REST_API_URL 指到這裡），
//      同時牆上/排行榜一開始就有虛構資料，錄影時不用真的發文才有內容。
//
//   啟動：node mock_kv.cjs            （監聽 127.0.0.1:59997）
//   協定：POST body = JSON command array，例如 ["SET","k","v"]，回 { "result": ... }
//         （與 app/lib/kv.js 的 cmd() 一致；程式碼沿用 qa/_wall_test.cjs 的 makeMockKV）
//
//   支援命令：SET / GET / INCR / EXPIRE / LPUSH / LTRIM / LRANGE / MGET / HINCRBY / HGETALL
//
//   ★ seed 資料全部是虛構的：
//     - 貼文內容為編造的心事，無個資、無禁語、無真人資訊
//     - anon key 都是 seed-anon-* 假字串，對外只露「牆友#XXXX」handle
//     - pts:<week> / pts:all 是虛構分數 hash
'use strict';

const http = require('http');

const HOST = '127.0.0.1';
const PORT = Number(process.env.MOCK_KV_PORT || 59997);

// ── 與 app/lib/screen.js 相同的週 key 演算法（Asia/Taipei ISO week，如 2026-W45）──
function weekKeyNow() {
  const d = new Date();
  const tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
  const date = new Date(Date.UTC(tw.getFullYear(), tw.getMonth(), tw.getDate()));
  const dayNum = (date.getUTCDay() + 6) % 7;          // 週一 = 0
  date.setUTCDate(date.getUTCDate() - dayNum + 3);     // 本週四
  const ft = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const fd = (ft.getUTCDay() + 6) % 7;
  ft.setUTCDate(ft.getUTCDate() - fd + 3);
  const w = 1 + Math.round((date - ft) / (7 * 86400000));
  return tw.getFullYear() + '-W' + String(w).padStart(2, '0');
}

// ── in-memory store：key -> { type: 'str'|'num'|'list'|'hash', val } ──
const store = new Map();

function exec(cmd) {
  const op = String(cmd[0] || '').toUpperCase();
  const k = cmd[1];
  switch (op) {
    case 'SET': store.set(k, { type: 'str', val: cmd[2] }); return 'OK';
    case 'GET': { const e = store.get(k); return e && e.type === 'str' ? e.val : null; }
    case 'INCR': {
      const e = store.get(k);
      const n = (e && e.type === 'num' ? e.val : 0) + 1;
      store.set(k, { type: 'num', val: n });
      return n;
    }
    case 'EXPIRE': return 1;
    case 'LPUSH': {
      let e = store.get(k);
      if (!e || e.type !== 'list') e = { type: 'list', val: [] };
      e.val.unshift(cmd[2]);
      store.set(k, e);
      return e.val.length;
    }
    case 'LTRIM': {
      const e = store.get(k);
      if (e && e.type === 'list') e.val = e.val.slice(Number(cmd[2]), Number(cmd[3]) + 1);
      return 'OK';
    }
    case 'LRANGE': {
      const e = store.get(k);
      const a = Number(cmd[2]), b = Number(cmd[3]);
      return e && e.type === 'list' ? e.val.slice(a, b + 1) : [];
    }
    case 'MGET': return cmd.slice(1).map((kk) => {
      const e = store.get(kk);
      return e && e.type === 'str' ? e.val : null;
    });
    case 'HINCRBY': {
      let e = store.get(k);
      if (!e || e.type !== 'hash') e = { type: 'hash', val: {} };
      e.val[cmd[2]] = (e.val[cmd[2]] || 0) + Number(cmd[3]);
      store.set(k, e);
      return e.val[cmd[2]];
    }
    case 'HGETALL': {
      const e = store.get(k);
      const flat = [];
      if (e && e.type === 'hash') {
        for (const [f, v] of Object.entries(e.val)) flat.push(f, String(v));
      }
      return flat;
    }
    default: throw new Error('unsupported ' + op);
  }
}

// ── seed 虛構資料 ─────────────────────────────────────────────
function seed() {
  const WEEK = weekKeyNow();
  const now = Date.now();
  const H = 3600 * 1000;

  // 三篇不同主題的牆貼文（虛構）。id/長度需符合 screen.sanitizeItemId，
  // anon 需符合 sanitizeAnon；對外 handle = '牆友#' + anon.slice(-4).toUpperCase()
  const posts = [
    {
      id: 'demo-seed-work-0001',
      anon: 'seed-anon-work-9f2a',          // → 牆友#9F2A
      topic: 'work',
      text: '昨天開會被主管念，晚上睡不著。',
      accept: '昨天在會議上被念的那一刻，一定很難受。',
      goodword: '被念的是那一件事，不是你這個人。',
      smallstep: '今晚洗個熱水澡，早點上床休息。',
      engine: 'rules', model: null,
      createdAt: now - 5 * H,
      encs: [
        {
          id: 'demo-seed-enc-000001',
          text: '聽起來昨天被念一定很難受，願意說出來已經很不容易了。',
          handle: '牆友#A7C3',
          score: 10,
          createdAt: now - 4 * H,
        },
      ],
    },
    {
      id: 'demo-seed-love-0002',
      anon: 'seed-anon-love-3b7d',          // → 牆友#3B7D
      topic: 'love',
      text: '他已經三天沒回我訊息了，不知道是不是我做錯了什麼。',
      accept: '三天沒有回音，心裡七上八下的感覺是真的。',
      goodword: '沒回訊息不代表你做錯了什麼，有時候只是對方正忙。',
      smallstep: '今晚先做一件讓自己開心的小事，明天再看訊息。',
      engine: 'rules', model: null,
      createdAt: now - 8 * H,
      encs: [],
    },
    {
      id: 'demo-seed-fam-0003',
      anon: 'seed-anon-fam-51c8',           // → 牆友#51C8
      topic: 'family',
      text: '每次回家吃飯都被問什麼時候結婚，壓力好大。',
      accept: '每次回家都被問同一個問題，那種壓力會慢慢累積。',
      goodword: '想問的是關心，但被問的你需要被體諒，你的感受也算數。',
      smallstep: '今晚吃飯時先夾一口自己喜歡的菜，慢慢吃。',
      engine: 'rules', model: null,
      createdAt: now - 26 * H,
      encs: [],
    },
  ];

  // 牆列表（最新在前）＋ 每篇貼文（含伺服器端 anon，對外不露）＋ 鼓勵列表
  store.set('wall:ids', { type: 'list', val: posts.map((p) => p.id) });
  for (const p of posts) {
    const { encs, ...item } = p;
    store.set('wall:item:' + p.id, { type: 'str', val: JSON.stringify(item) });
    store.set('wall:item:' + p.id + ':encs', {
      type: 'list',
      val: (encs || []).map((e) => JSON.stringify(e)),
    });
  }

  // 分數 hash（欄位 = anon key，leaderboard 會轉成 牆友#XXXX handle）
  const weekPts = {
    'seed-anon-work-9f2a': 18,
    'seed-anon-fam-51c8': 15,
    'seed-anon-love-3b7d': 12,
    'seed-anon-enc-a7c3': 10,     // 鼓勵別人也得分 → 牆友#A7C3
    'seed-anon-extra-6e41': 8,
    'seed-anon-extra-c209': 6,
  };
  const allPts = {
    'seed-anon-work-9f2a': 42,
    'seed-anon-fam-51c8': 33,
    'seed-anon-love-3b7d': 27,
    'seed-anon-enc-a7c3': 21,
    'seed-anon-extra-6e41': 15,
    'seed-anon-extra-c209': 9,
  };
  store.set('pts:' + WEEK, { type: 'hash', val: { ...weekPts } });
  store.set('pts:all', { type: 'hash', val: { ...allPts } });

  console.log(`[mock_kv] seed 完成：3 篇貼文（work/love/family，work 篇已有 1 句鼓勵）`);
  console.log(`[mock_kv] week=${WEEK}  pts:${WEEK} 有 ${Object.keys(weekPts).length} 人，pts:all 有 ${Object.keys(allPts).length} 人`);
  return WEEK;
}

// ── HTTP server ───────────────────────────────────────────────
const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let out = { result: null };
    try {
      const cmd = JSON.parse(body || '[]');
      out = { result: exec(cmd) };
    } catch (e) {
      out = { error: String(e && e.message) };
    }
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(out));
  });
});

const WEEK = seed();
server.listen(PORT, HOST, () => {
  console.log(`[mock_kv] mock Vercel KV REST listening on http://${HOST}:${PORT}  (week=${WEEK})`);
});

process.on('SIGTERM', () => process.exit(0));
process.on('SIGINT', () => process.exit(0));
