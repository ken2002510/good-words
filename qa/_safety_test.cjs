#!/usr/bin/env node
'use strict';

/**
 * qa/_safety_test.cjs — 評審 P0-1（個資）與 P0-2（危機分級）的回歸測試
 *
 * 來源：2026-11 評審報告《好好說話_評審報告.md》
 *   P0-1：9 項 PII 只有 1 項被擋；8 種繞過變體（全形／插空白／插橫線／諧音／
 *         全形身分證／空白身分證／全形 LINE ID／地址省略市名）全部上牆。
 *   P0-2：「我已經想好方法了，也知道時間」被判 crisis:false（最危險的漏網）。
 *   另外兩項誤判：含 email 的貼文被當危機；「你去死」辱罵句被當危機。
 *
 * 跑法：node qa/_safety_test.cjs
 */

const path = require('path');
const APP = path.resolve(__dirname, '..', 'app', 'lib');
const screen = require(path.join(APP, 'screen.js'));
const safety = require(path.join(APP, 'safety.js'));

let pass = 0;
let fail = 0;
const failures = [];

function ok(name, cond, detail) {
  if (cond) {
    pass++;
    console.log('  PASS  ' + name);
  } else {
    fail++;
    failures.push(name + (detail ? '  → ' + detail : ''));
    console.log('  FAIL  ' + name + (detail ? '  → ' + detail : ''));
  }
}

// ───────────────────────────────────────── P0-1 個資
console.log('\n== P0-1 個資：評審原始 9 項（只有手機被擋，其餘全上牆）==');

// 這些是評審實測「實際公開上牆」的原文（評審報告 §P0-1 表格與繞過清單）
const MUST_BLOCK_PII = [
  ['手機（原本唯一會擋）', '我的電話是 0912345678，怕漏接'],
  ['市話', '家裡電話 02-2732-1234 打來我都裝睡'],
  ['身分證', '我的身分證字號 A123456789 一直被拿去做人頭'],
  ['地址（含市名）', '我住台北市大安區復興南路二段 123 號 5 樓'],
  ['LINE ID', '我的 line id: abcd1234 想加的可以加'],
  ['學校班級', '我是台灣大學三年二班的學生，覺得很丟臉'],
  ['真實姓名', '我叫王小明，今天又被老師罵了'],
  // 8 種繞過變體
  ['繞過：全形數字', '我的手機是 ０９１２３４５６７８'],
  ['繞過：插空白', '電話 0912 345 678 打了都沒人接'],
  ['繞過：插橫線', '電話 0912-345-678 我都不敢接'],
  ['繞過：諧音', '我的號碼是零九一二三四五六七八'],
  ['繞過：全形身分證', '身分證 Ａ１２３４５６７８９'],
  ['繞過：空白身分證', '身分證 A123 456 789 被冒用'],
  ['繞過：全形 LINE ID', '我的 ＬＩＮＥ ＩＤ：ａｂｃｄ１２３４'],
  ['繞過：地址省略市名', '我住大安區復興南路二段 123 號，鄰居很吵'],
  // 2026-11 複測 v2 新發現：emoji／任意符號夾雜（前一代只列舉已知分隔符，擋不住）
  ['繞過：emoji 夾雜手機', '心情很差，我的號碼是 0912😢345😢678'],
  ['繞過：emoji＋全形', '我的電話 ０９１２😢３４５😢６７８ 可以打給我'],
  ['繞過：點號夾雜身分證', '身分證是 A123·456·789，被冒用'],
  ['繞過：全角減號夾雜', '手機 0912－345－678 沒人接'],
  ['繞過：每碼間隔符號', '0 9 1 2 - 3 4 5 - 6 7 8'],
];

for (const [name, text] of MUST_BLOCK_PII) {
  const label = screen.findPII(text);
  ok('PII 必擋：' + name, !!label, label ? '' : '沒有偵測到任何個資');
}

console.log('\n== P0-1 反向：正常心情文字不可以被誤擋 ==');
const MUST_NOT_BLOCK_PII = [
  '今天開會被念，覺得自己很沒用。',
  '他說「你這樣不行」，我整晚都在想那句話。',
  '我們在一起九年了，他說想分開。',
  '我是說真的，這一年過得很累。',       // 「我是說真的」不可被當姓名
  '一個人的晚餐，配一齣老電影。',
  '這週第三次加班到十一點，好想消失一下。',
];
for (const text of MUST_NOT_BLOCK_PII) {
  const label = screen.findPII(text);
  ok('PII 不誤擋：' + text.slice(0, 14) + '…', !label, label ? '誤判為 ' + label : '');
}

// ───────────────────────────────────────── P0-2 危機分級
console.log('\n== P0-2 危機：評審實測的 4 句 ==');
const MUST_CRISIS = [
  ['★ 最高危險（評審漏網案例）', '我已經想好方法了，也知道時間'],
  ['我買了炭', '我買了炭'],
  ['朋友說他想死', '我朋友說他想死'],
  ['英文', 'I want to kill myself'],
  // 組合式變體
  ['方法＋時間（另一種寫法）', '方法想好了，時間也定了'],
  ['手段＋時間', '繩子已經準備好，今晚就要'],
  ['計畫＋方法＋低落', '我計畫好了方法，反正活著沒意義'],
];
for (const [name, text] of MUST_CRISIS) {
  const r = safety.detectCrisis(text);
  ok('危機必攔：' + name, r.crisis === true,
    r.crisis ? 'matched=' + JSON.stringify(r.matched) : 'crisis=false' + (r.guarded ? '（被 guard：' + r.guardHit + '）' : ''));
}

console.log('\n== P0-2 反向：口語與一般情緒不可被當危機 ==');
const MUST_NOT_CRISIS = [
  ['笑死', '這部片笑死我了'],
  ['想死你了', '好久不見，想死你了'],
  ['累死', '今天累死了，先睡'],
  ['一般低落', '今天心情不太好，被主管念了一頓'],
  ['一般規劃', '我終於想好方法了，工作有救了'],
];
for (const [name, text] of MUST_NOT_CRISIS) {
  const r = safety.detectCrisis(text);
  ok('危機不誤判：' + name, r.crisis === false, r.crisis ? '誤判為危機 matched=' + JSON.stringify(r.matched) : '');
}

// ───────────────────────────────────────── 兩項誤判修正
console.log('\n== 評審指出的兩項誤判 ==');
{
  // 真正的情境：email 位址「裡面」剛好含有會被英文 pattern 命中的字串。
  // 修好之前，這種貼文會被判 crisis:true（評審實測的誤判）。
  const emailPost = '我想找 suicide-prevention@example.com 這個單位的資料，不知道怎麼問';
  const r = safety.detectCrisis(emailPost);
  ok('email 位址內的英文字串不算危機（已遮罩）', r.crisis === false,
    r.crisis ? 'matched=' + JSON.stringify(r.matched) : '');
  const piiLabel = screen.findPII(emailPost);
  ok('同一句仍會被個資規則擋下（email）', piiLabel === 'email', 'label=' + piiLabel);
}
{
  const insult = '你去死一死啦';
  const r = safety.detectCrisis(insult);
  ok('「你去死」是辱罵不是危機（應走攻擊字）', r.crisis === false && r.directedAttack === true,
    'crisis=' + r.crisis + ' directedAttack=' + r.directedAttack);
  const attack = screen.findAttack(insult);
  ok('「你去死」會被攻擊字規則擋下', !!attack, attack ? '' : '沒擋到');
}
{
  const selfHarm = '我想死一死算了';
  const r = safety.detectCrisis(selfHarm);
  ok('第一人稱的「死一死」仍然是危機', r.crisis === true, 'crisis=' + r.crisis);
}
// 2026-11 複測 v2：罵人的氣話不該被當危機（危機判定原本搶先於攻擊判定）
{
  const insult = '你他媽的是個白痴廢物，去死一死算了';
  const v = screen.validatePost(insult);
  ok('罵人氣話 → 不是 crisis（走攻擊字）', v.ok === false && v.crisis !== true,
    JSON.stringify(v));
  ok('罵人氣話 → 訊息是「不要人身攻擊」', /人身攻擊/.test(v.reason || ''), JSON.stringify(v.reason));
  const v2 = screen.validatePost('你去死啦，我不想再跟你說話');
  ok('「你去死啦」也不會被當危機', v2.ok === false && v2.crisis !== true, JSON.stringify(v2));
  const enc = screen.validateEncourage(insult, '今天開會被念');
  ok('鼓勵含罵人氣話 → 不是 crisis', enc.ok === false && enc.crisis !== true, JSON.stringify(enc));
  const self = screen.validatePost('我真的好想死一死，撐不住了');
  ok('第一人稱自傷 → 仍然是 crisis', self.ok === false && self.crisis === true, JSON.stringify(self));
}
// 2026-11 複測 v2：含 email 的正常句不該被 crisis 攔走（email 已在正規化時遮掉）
{
  const withEmail = '我的 email 是 help.me@example.com，想問有沒有相關資源可以看。';
  const r = safety.detectCrisis(withEmail);
  ok('含 email 的正常句不是 crisis', r.crisis === false, JSON.stringify(r.matched));
  const v = screen.validatePost(withEmail);
  ok('含 email 的正常句 → 422 個資（不是 crisis）', v.ok === false && v.crisis !== true && /email/.test(v.reason || ''),
    JSON.stringify(v));
}

// ───────────────────────────────────────── 走完整審核流程
console.log('\n== validatePost 端到端（危機 > 個資 > 攻擊 的順序）==');
{
  const r1 = screen.validatePost('我已經想好方法了，也知道時間');
  ok('validatePost：最高危險句回 crisis:true', r1.ok === false && r1.crisis === true, JSON.stringify(r1));

  const r2 = screen.validatePost('我的身分證 A123456789 一直被冒用');
  ok('validatePost：身分證被擋（且不是 crisis）',
    r2.ok === false && !r2.crisis && /身分證/.test(r2.reason || ''), JSON.stringify(r2));

  const r3 = screen.validatePost('今天開會被念，覺得自己很沒用，整晚都在想那句話。');
  ok('validatePost：一般心情可通過', r3.ok === true, JSON.stringify(r3));

  const r4 = screen.validateEncourage('我的 line id: abcd1234 加油', '今天開會被念');
  ok('validateEncourage：鼓勵含個資被擋', r4.ok === false, JSON.stringify(r4));
}

// ───────────────────────────────────────── 反向：數字但不含個資
console.log('\n== PII 反向：一般數字不可以被誤擋 ==');
const NUMBER_BUT_FINE = [
  '我今年 35 歲，還是覺得自己很沒用。',
  '薪水 3 萬 5，房租就去掉一半。',
  '大概 10 分鐘後又要進會議室。',
  '第 12 次了，每次都被同一句話刺到。',
  '2026 年開始，我想試著對自己好一點。',
  // 複測 v2：寬鬆數字比對不可把「日期＋年齡」這類正常數字串成電話
  '2026 年 11 月，我 35 歲，覺得時間過得好快。',
  '今天 12 點 30 分開會，我被念了 10 分鐘。',
];
for (const text of NUMBER_BUT_FINE) {
  const label = screen.findPII(text);
  ok('一般數字不誤擋：' + text.slice(0, 12) + '…', !label, label ? '誤判為 ' + label : '');
}

// ───────────────────────────────────────── 匿名 handle 不可預測（評審 P1）
console.log('\n== 匿名 handle：不可由 anon 反推／不可冒充 ==');
{
  process.env.HANDLE_SECRET = 'test-secret-for-regression';
  const me = screen.anonHandle('spoof-xxxx-I-A1');
  ok('handle 不再等於 anon 後 4 碼', !me.endsWith('I-A1'), 'handle=' + me);
  // 複測 v2：4 碼 hex（65,536）比舊版 base36 小 → 碰撞率升高，改成 8 碼
  ok('handle 格式為 牆友#8 碼 hex', /^牆友#[0-9A-F]{8}$/.test(me), 'handle=' + me);
  ok('同一 anon → 穩定同一個 handle', screen.anonHandle('abc') === screen.anonHandle('abc'));
  ok('不同 anon → 不同 handle', screen.anonHandle('abc') !== screen.anonHandle('abd'));
  const many = new Set();
  for (let i = 0; i < 500; i++) many.add(screen.anonHandle('anon-' + i));
  ok('500 個 anon 的碰撞 < 5 個（16^4 空間）', 500 - many.size < 5, '碰撞=' + (500 - many.size));
  delete process.env.HANDLE_SECRET;
  const noSecret = screen.anonHandle('spoof-xxxx-I-A1');
  ok('沒設 HANDLE_SECRET 時仍用雜湊（不再等於 anon 後 4 碼）',
    !noSecret.endsWith('I-A1') && /^牆友#[0-9A-F]{8}$/.test(noSecret), 'handle=' + noSecret);
  ok('沒有密鑰時同一 anon 仍然穩定', screen.anonHandle('abc') === screen.anonHandle('abc'));
  ok('沒有密鑰時不同 anon 不碰撞', screen.anonHandle('abc') !== screen.anonHandle('abd'));
}

console.log('\n================ 個資/危機回歸測試 ================');
console.log('PASS ' + pass + ' / FAIL ' + fail);
if (fail) {
  console.log('\n失敗清單：');
  for (const f of failures) console.log('  - ' + f);
}
process.exit(fail ? 1 : 0);
