#!/usr/bin/env node
/**
 * qa/cleanup_test_posts.mjs — 回收測試／評審留在正式站好話牆上的資料
 *
 * 背景（2026-11 評審報告揭露）：
 *   評審對正式站送出 31 筆測試資料（含 PII 樣本、冒充測試），
 *   而站上原本**沒有任何刪除路徑**（DELETE 一律 405），所以只能留在 KV 裡。
 *   現在 /api/wall 支援 DELETE（需 `x-admin-token` == env `WALL_ADMIN_TOKEN`），
 *   本腳本就是用它來清理。
 *
 * 用法（預設 dry-run，只會列出「將被刪除什麼」，不會動資料）：
 *   $env:WALL_BASE_URL = 'https://good-words.vercel.app'
 *   $env:WALL_ADMIN_TOKEN = '<在 Vercel 設定的權杖>'
 *   node qa/cleanup_test_posts.mjs                 # 列出測試資料（dry-run）
 *   node qa/cleanup_test_posts.mjs --yes           # 真的刪（purge=test）
 *   node qa/cleanup_test_posts.mjs --yes --purge=all        # 清空整面牆（慎用）
 *   node qa/cleanup_test_posts.mjs --yes --id=<itemId>      # 只刪某一篇
 *   node qa/cleanup_test_posts.mjs --yes --ids=a,b,c        # 批次刪
 *
 * 退出碼：0 成功；2 環境變數缺失；3 伺服器回非 2xx。
 */

const argv = process.argv.slice(2);
const has = (f) => argv.some((a) => a === f || a.startsWith(f + '='));
const val = (f, d = '') => {
  const hit = argv.find((a) => a.startsWith(f + '='));
  return hit ? hit.slice(f.length + 1) : d;
};
const YES = has('--yes');
/** --list：不需要權杖，只讀牆列表看有幾篇（用來確認清理前後） */
const LIST_ONLY = has('--list');

const BASE = (val('--base') || process.env.WALL_BASE_URL || 'https://good-words.vercel.app')
  .replace(/\/+$/, '');
const TOKEN = val('--token') || process.env.WALL_ADMIN_TOKEN || '';

if (!TOKEN && !LIST_ONLY) {
  console.error('!! 沒有權杖。兩種給法（擇一）：');
  console.error('   1) 環境變數（PowerShell）：$env:WALL_ADMIN_TOKEN = "<真正的權杖>"');
  console.error('   2) 參數：node qa/cleanup_test_posts.mjs --token=<真正的權杖>');
  console.error('');
  console.error('   權杖必須與 Vercel 專案 → Settings → Environment Variables 的');
  console.error('   WALL_ADMIN_TOKEN 完全相同，而且設定後要「重新部署」才會生效。');
  console.error('   沒有權杖時可以先看牆上現況：node qa/cleanup_test_posts.mjs --list');
  process.exit(2);
}
if (TOKEN === '<你設的權杖>' || TOKEN === '<token>' || /^<.*>$/.test(TOKEN)) {
  console.error('!! 你填的是說明文字裡的佔位字串（例如 <你設的權杖>），不是真正的權杖。');
  console.error('   請自己產生一組並填進 Vercel，例如 PowerShell：');
  console.error("   $tok = -join ((48..57)+(97..102) | Get-Random -Count 32 | ForEach-Object {[char]$_}); $tok");
  process.exit(2);
}

const purge = val('--purge', 'test');
const id = val('--id');
const ids = val('--ids');
const dry = YES ? '' : '1';

async function call(qs) {
  const url = BASE + '/api/wall?' + qs;
  const res = await fetch(url, { method: 'DELETE', headers: { 'x-admin-token': TOKEN } });
  let body = null;
  try { body = await res.json(); } catch (_) { body = { raw: await res.text().catch(() => '') }; }
  return { status: res.status, body };
}

/** --list：不需要權杖，只讀牆列表（清理前後對照用） */
async function listWall() {
  console.log('目標：' + BASE);
  console.log('模式：只讀列表（--list，不需要權杖）');
  const res = await fetch(BASE + '/api/wall', { headers: { 'User-Agent': 'cleanup-script' } });
  const body = await res.json().catch(() => null);
  if (!body || !body.ok) {
    console.error('!! 讀取失敗 HTTP ' + res.status);
    process.exit(3);
  }
  const items = body.items || [];
  console.log('牆上篇數：' + items.length + '（wallEnabled=' + body.wallEnabled + '）');
  items.slice(0, 40).forEach((it, i) => {
    const encs = (it.encs || []).length;
    console.log(`  ${String(i + 1).padStart(2)}. ${it.id.slice(0, 8)}…  ${encs} 句鼓勵  「${String(it.text || '').slice(0, 28)}」`);
  });
  console.log('\n（把測試資料清掉請用：node qa/cleanup_test_posts.mjs --token=<權杖> 先 dry-run，再加 --yes）');
}

async function main() {
  if (LIST_ONLY) return listWall();
  console.log('目標：' + BASE);
  console.log('模式：' + (YES ? '實際刪除' : 'DRY-RUN（只列出，不動資料）'));

  const qs = new URLSearchParams();
  if (id) qs.set('id', id);
  if (ids) qs.set('ids', ids);
  if (!id && !ids) qs.set('purge', purge);
  if (dry) qs.set('dry', dry);

  const out = await call(qs.toString());
  console.log('HTTP ' + out.status);
  console.log(JSON.stringify(out.body, null, 2));

  if (out.status === 401) {
    console.error('!! 權杖不正確（401）。請確認 WALL_ADMIN_TOKEN 與 Vercel 設定一致。');
    process.exit(3);
  }
  if (out.status === 503) {
    console.error('!! 伺服器沒有設定 WALL_ADMIN_TOKEN —— 管理端點未啟用（503）。');
    console.error('   請先在 Vercel 專案設定該環境變數並重新部署。');
    process.exit(3);
  }
  if (out.status < 200 || out.status >= 300) process.exit(3);

  if (!YES) {
    console.log('\n以上是 dry-run 結果。確認要刪除請加 --yes 重跑：');
    console.log('  node qa/cleanup_test_posts.mjs --yes' + (id ? ' --id=' + id : ids ? ' --ids=' + ids : ' --purge=' + purge));
  } else {
    console.log('\n已送出刪除。建議再跑一次 dry-run 確認目標已被清空。');
  }
}

main().catch((e) => { console.error('ERROR ' + e.message); process.exit(3); });
