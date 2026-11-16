#!/usr/bin/env node
'use strict';

/**
 * qa/_wall_api_verify.cjs — 直接對 deploy/lib/wallcore.js 做端到端行為驗證
 * （用記憶體 mock KV，不需要真的 Upstash；不需要啟動 server）
 *
 * 驗的是評審報告的 P1-1a（偽造 AI 背書）、P1-1b（刷分）、P1-2（刪除路徑）。
 * 跑法：node qa/_wall_api_verify.cjs
 */

const path = require('path');
const crypto = require('crypto');
const APP = path.resolve(__dirname, '..', 'app', 'lib');
const core = require(path.resolve(__dirname, '..', 'deploy', 'lib', 'wallcore.js'));

let pass = 0;
let fail = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; failures.push(name + (detail ? '  → ' + detail : '')); console.log('  FAIL  ' + name + (detail ? '  → ' + detail : '')); }
}

// ── 記憶體 mock KV（介面與 app/lib/kv.js 相同）──
function mockKv() {
  const kv = new Map();
  const lists = new Map();
  const hashes = new Map();
  const getL = (k) => { if (!lists.has(k)) lists.set(k, []); return lists.get(k); };
  const getH = (k) => { if (!hashes.has(k)) hashes.set(k, new Map()); return hashes.get(k); };
  return {
    enabled: () => true,
    get: async (k) => (kv.has(k) ? kv.get(k) : null),
    set: async (k, v) => { kv.set(k, String(v)); return 'OK'; },
    incr: async (k) => { const n = Number(kv.get(k) || 0) + 1; kv.set(k, String(n)); return n; },
    expire: async () => 1,
    lpush: async (k, v) => { getL(k).unshift(String(v)); return getL(k).length; },
    ltrim: async (k, a, b) => { const l = getL(k); lists.set(k, l.slice(a, b + 1)); return 'OK'; },
    lrange: async (k, a, b) => { const l = getL(k); return l.slice(a, b === -1 ? l.length : b + 1); },
    mget: async (keys) => keys.map((k) => (kv.has(k) ? kv.get(k) : null)),
    hincrby: async (k, f, d) => { const h = getH(k); const n = Number(h.get(f) || 0) + Number(d); h.set(f, n); return n; },
    hgetall: async (k) => Object.fromEntries(getH(k)),
    cmd: async (cmd, ...args) => {
      const c = String(cmd).toUpperCase();
      if (c === 'DEL') { kv.delete(args[0]); lists.delete(args[0]); hashes.delete(args[0]); return 1; }
      if (c === 'LREM') { const l = getL(args[0]).filter((x) => x !== args[2]); lists.set(args[0], l); return 1; }
      if (c === 'HDEL') { const h = getH(args[0]); const had = h.delete(args[1]); return had ? 1 : 0; }
      throw new Error('mock KV 未支援的指令：' + c);
    },
  };
}

function makeLibs(kv) {
  return {
    kv,
    screen: require(path.join(APP, 'screen.js')),
    safety: require(path.join(APP, 'safety.js')),
    rules: require(path.join(APP, 'rules.js')),
    // AI 用假的：回固定三段，engine 標成 nvidia（模擬伺服器產生的回應）
    ai: {
      generate: async () => ({
        accept: '我聽到了。',
        goodword: '伺服器產生的好話。',
        smallstep: '今晚喝一杯水。',
        meta: { engine: 'nvidia', model: 'fake-model' },
      }),
    },
  };
}

const GOOD_POST = '今天開會我講錯話，回家路上一直想，覺得自己很沒用。';
const GOOD_ENC = '被這樣念一整晚，心裡一定很委屈，你願意說出來已經很勇敢了。';

(async () => {
  const kv = mockKv();
  const L = makeLibs(kv);

  console.log('\n== P1-1a 偽造 AI 背書 ==');
  const post = await core.createPost(L, {
    anon: 'lead-anon-0001abcd',
    text: GOOD_POST,
    ai: { accept: '假', goodword: '我是客戶端偽造的 AI 背書', smallstep: '假' },
  });
  ok('貼文成功', post.status === 200 && post.body.ok === true, JSON.stringify(post.body).slice(0, 120));
  ok('回應標示 serverGenerated:true', post.body.serverGenerated === true);
  ok('客戶端 ai 有被記錄但未採用（clientAiOffered）', post.body.clientAiOffered === true);
  ok('牆上不是客戶端的假文字', !JSON.stringify(post.body.item).includes('偽造的 AI 背書'),
    JSON.stringify(post.body.item.goodword));
  ok('goodword 來自伺服器 AI', post.body.item.goodword === '伺服器產生的好話。', post.body.item.goodword);
  const itemId = post.body.item.id;

  console.log('\n== P1-1b 刷分：同一句連送 ==');
  const e1 = await core.addEncourage(L, { anon: 'enc-a-0001abcd', itemId, text: GOOD_ENC });
  ok('第一句鼓勵通過且給分', e1.status === 200 && e1.body.delta > 0, JSON.stringify(e1.body).slice(0, 120));
  const e2 = await core.addEncourage(L, { anon: 'enc-b-0002abcd', itemId, text: '加油！！！ 你真的 很努力' });
  ok('不同句的第二句可以送（但可能因內容審核被擋）', e2.status === 200 || e2.status === 422,
    'status=' + e2.status + ' ' + JSON.stringify(e2.body).slice(0, 80));
  // 完全相同的句子（連標點都一樣）→ 409
  const dup = await core.addEncourage(L, { anon: 'enc-c-0003abcd', itemId, text: GOOD_ENC });
  ok('同一句（連標點相同）→ 409 拒絕', dup.status === 409, 'status=' + dup.status + ' ' + JSON.stringify(dup.body).slice(0, 80));
  // 只改標點與空白：正規化後相同 → 也要擋
  const dup2 = await core.addEncourage(L, { anon: 'enc-d-0004abcd', itemId, text: '被這樣念一整晚，心裡一定很委屈，你願意說出來已經很勇敢了！！！' });
  ok('只加標點（正規化後相同）→ 409 拒絕', dup2.status === 409, 'status=' + dup2.status + ' ' + JSON.stringify(dup2.body).slice(0, 80));

  console.log('\n== P1-1b 刷分：同一人同一篇不重複給分 ==');
  const same1 = await core.addEncourage(L, { anon: 'enc-x-0009wxyz', itemId, text: '你願意把這段說出來，我讀著都覺得心疼，這件事真的不容易。' });
  ok('同一人第一句給分', same1.status === 200 && same1.body.delta > 0, JSON.stringify(same1.body).slice(0, 120));
  const same2 = await core.addEncourage(L, { anon: 'enc-x-0009wxyz', itemId, text: '被念的那個當下很難受，但那一句話不等於你這個人沒有價值。' });
  ok('同一人第二句（不同內容）不再給分', same2.status === 200 && same2.body.delta === 0 && same2.body.alreadyEncouraged === true,
    JSON.stringify(same2.body).slice(0, 140));

  console.log('\n== P1-1b 刷分：同一句話換貼文也不能重複得分（複測 v2 新發現）==');
  {
    const other = await core.createPost(L, { anon: 'lead-anon-0002efgh', text: '今天被客戶罵了一頓，覺得很沒價值。' });
    const canned = '我看到你在努力撐著，這件事真的不容易，你願意說出來很勇敢。';
    const a1 = await core.addEncourage(L, { anon: 'enc-y-0007mnop', itemId, text: canned });
    const a2 = await core.addEncourage(L, { anon: 'enc-y-0007mnop', itemId: other.body.item.id, text: canned });
    ok('第一則貼文同句給分', a1.status === 200 && a1.body.delta > 0, JSON.stringify(a1.body).slice(0, 110));
    ok('換一則貼文送同一句 → 不再給分（跨貼文去重）',
      a2.status === 200 && a2.body.delta === 0, JSON.stringify(a2.body).slice(0, 140));
  }

  console.log('\n== 隱私：回應不可外洩 anonHash（複測 v2 新發現）==');
  {
    const e = await core.addEncourage(L, {
      anon: 'enc-z-0042qrst', itemId,
      text: '被念的那個當下很難受，但那一句話不等於你這個人沒有價值。',
    });
    const txt = JSON.stringify(e.body || {});
    ok('鼓勵回應不含 anonHash', !/anonHash/.test(txt), txt.slice(0, 200));
    const wall = await core.listWall(L, {});
    ok('牆列表不含 anonHash', !/anonHash/.test(JSON.stringify(wall.body)), '');
    ok('牆列表的鼓勵只含顯示欄位',
      (wall.body.items[0].encs || []).every((x) => Object.keys(x).every((k) => ['id', 'text', 'handle', 'score', 'createdAt'].includes(k))),
      JSON.stringify((wall.body.items[0].encs || [])[0] || {}));
  }

  console.log('\n== 排行榜：刷分不再累積 ==');
  const board = await core.leaderboard(L, { anon: 'enc-x-0009abcd' });
  const me = board.body.me;
  ok('同一人重複鼓勵沒有把分數灌上去（delta=0）', me && me.pts <= 12, 'me=' + JSON.stringify(me));

  console.log('\n== P1-2 刪除路徑 ==');
  // 造兩篇測試資料 + 一篇正常資料
  const t1 = await core.createPost(L, { anon: 'rate-test-0001', text: '這是評審用的測試貼文，請忽略。' });
  const t2 = await core.createPost(L, { anon: 'wall-prober-9', text: '另一筆測試資料，內含樣本。' });
  const normal = await core.createPost(L, { anon: 'real-user-7777', text: '我今天被主管念了一頓，覺得很沒用。' });
  await core.addEncourage(L, { anon: 'enc-z-0001abcd', itemId: t1.body.item.id, text: '我看到你在測試，也理解這件事需要被清理。' });

  const wallBefore = await core.listWall(L, {});
  const dry = await core.deleteWall(L, { purge: 'test', dry: true });
  ok('dry-run 只列出、不動資料', dry.status === 200 && dry.body.dryRun === true && dry.body.matched >= 2,
    'matched=' + (dry.body && dry.body.matched));
  ok('dry-run 有列出測試 anon 的 handle', Array.isArray(dry.body.listing) && dry.body.listing.length >= 2);
  const wallAfterDry = await core.listWall(L, {});
  ok('dry-run 後牆上篇數不變', wallAfterDry.body.items.length === wallBefore.body.items.length,
    wallBefore.body.items.length + ' → ' + wallAfterDry.body.items.length);

  const del = await core.deleteWall(L, { purge: 'test' });
  ok('實際刪除回報刪了 2 篇', del.status === 200 && del.body.deleted === 2, JSON.stringify(del.body).slice(0, 140));
  const wallAfter = await core.listWall(L, {});
  const idsLeft = wallAfter.body.items.map((i) => i.id);
  ok('測試貼文已被移除', !idsLeft.includes(t1.body.item.id) && !idsLeft.includes(t2.body.item.id));
  ok('正常使用者的貼文沒被誤刪', idsLeft.includes(normal.body.item.id) && idsLeft.includes(itemId),
    'left=' + idsLeft.length);
  const boardAfter = await core.leaderboard(L, {});
  ok('測試帳號已從排行榜移除', !JSON.stringify(boardAfter.body.top).includes('rate-test-0001')
    && boardAfter.body.top.every((t) => t.pts !== undefined), JSON.stringify(boardAfter.body.top).slice(0, 120));

  console.log('\n== 刪單篇（?id=） ==');
  const one = await core.deleteWall(L, { id: normal.body.item.id });
  ok('指定 id 刪除 1 篇', one.status === 200 && one.body.deleted === 1, JSON.stringify(one.body).slice(0, 120));
  const wallLast = await core.listWall(L, {});
  ok('該篇確實消失', !wallLast.body.items.map((i) => i.id).includes(normal.body.item.id));

  console.log('\n== health 不洩漏（實際呼叫 handler，檢查回應內容）==');
  {
    const handler = require(path.resolve(__dirname, '..', 'deploy', 'api', 'health.js'));
    const res = {
      statusCode: 0, body: null, headers: {},
      setHeader(k, v) { this.headers[k] = v; },
      status(c) { this.statusCode = c; return this; },
      json(o) { this.body = o; return this; },
      end() { return this; },
    };
    await handler({ method: 'GET', url: '/api/health', headers: {} }, res);
    const txt = JSON.stringify(res.body || {});
    ok('health 有回應', res.statusCode === 200 && res.body && typeof res.body === 'object',
      'status=' + res.statusCode);
    ok('回應不含任何 pattern / 模組名稱',
      !/BUILTIN_PATTERNS|PII_PATTERNS|ATTACK_WORDS|NEGATIVE_GUARD|pii|pattern/i.test(txt), txt.slice(0, 200));
    ok('回應不含檔案路徑（.js / app\/lib）', !/\.js|app\/lib|app\\lib/.test(txt), txt.slice(0, 200));
    ok('回應不含 export 清單欄位（exports/modules）', !/exports|modules\s*:/i.test(txt), txt.slice(0, 200));
    ok('回應含 ok 與 engine', 'ok' in (res.body || {}) && 'engine' in (res.body || {}), txt.slice(0, 200));
  }

  console.log('\n== DELETE 路由的權杖與方法行為（呼叫 deploy/api/wall.js）==');
  {
    const wallHandler = require(path.resolve(__dirname, '..', 'deploy', 'api', 'wall.js'));
    function mkRes() {
      return {
        statusCode: 0, body: null, headers: {},
        setHeader(k, v) { this.headers[k] = v; },
        status(c) { this.statusCode = c; return this; },
        json(o) { this.body = o; return this; },
        end() { return this; },
      };
    }
    delete process.env.WALL_ADMIN_TOKEN;
    let r = mkRes();
    await wallHandler({ method: 'DELETE', url: '/api/wall?purge=test', headers: {} }, r);
    ok('未設定 WALL_ADMIN_TOKEN → 503（不是「全開」）', r.statusCode === 503, 'status=' + r.statusCode);

    process.env.WALL_ADMIN_TOKEN = 'unit-test-token-1234';
    r = mkRes();
    await wallHandler({ method: 'DELETE', url: '/api/wall?purge=test', headers: { 'x-admin-token': 'wrong' } }, r);
    ok('權杖錯誤 → 401', r.statusCode === 401, 'status=' + r.statusCode);

    r = mkRes();
    await wallHandler({ method: 'PUT', url: '/api/wall', headers: { 'x-admin-token': 'unit-test-token-1234' } }, r);
    ok('未支援的方法（PUT）→ 405', r.statusCode === 405, 'status=' + r.statusCode);

    r = mkRes();
    await wallHandler({
      method: 'DELETE', url: '/api/wall?purge=test',
      headers: { 'x-admin-token': 'unit-test-token-1234' },
    }, r);
    // 本機沒有真的 KV → core.deleteWall 回 503（KV 未啟用），重點是「權杖正確時不會被 401 擋」
    ok('權杖正確 → 通過權杖檢查（本機無 KV 故為 503，不是 401/500）',
      r.statusCode === 503 || r.statusCode === 200, 'status=' + r.statusCode + ' ' + JSON.stringify(r.body).slice(0, 80));
    delete process.env.WALL_ADMIN_TOKEN;
  }

  console.log('\n================ 牆 API 行為驗證 ================');
  console.log('PASS ' + pass + ' / FAIL ' + fail);
  if (fail) { console.log('\n失敗清單：'); for (const f of failures) console.log('  - ' + f); }
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('ERROR', e); process.exit(1); });
