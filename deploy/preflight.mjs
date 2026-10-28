/**
 * preflight.mjs — 部署前一鍵把所有檢查跑完（deploy 前的 go/no-go）
 *
 * 用法：node deploy/preflight.mjs
 *
 * 為什麼要這支：
 *   部署前的檢查有 4~5 支，各自跑容易漏。這支依序全部跑完，
 *   任何一支失敗就整體 FAIL，並明確告訴你「現在能不能部署」。
 *
 * 這是部署前的最後一道閘門：全 PASS 才 push。
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const SUITES = [
  {
    name: '路由一致性',
    file: 'test-routing.mjs',
    why: 'vercel.json 是否與前端實際呼叫相符',
  },
  {
    name: 'Serverless API 契約',
    file: 'test-serverless.mjs',
    args: ['--ollama-down'],
    why: '模擬雲端（無 Ollama）下的 API 行為、危機護欄、反毒雞湯',
  },
  {
    name: '冷啟動模擬',
    file: 'test-coldstart.mjs',
    why: '複製到乾淨目錄，模擬 Vercel 只看得到 repo 內容',
  },
  {
    name: 'repo 內容檢查',
    file: 'test-repo-contents.mjs',
    why: '.gitignore 是否誤排除部署必需檔、大檔、個資、BOM',
  },
];

console.log('\n' + '█'.repeat(60));
console.log('  部署前檢查（preflight）');
console.log('█'.repeat(60) + '\n');

const summary = [];

for (const s of SUITES) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`▶ ${s.name}  —  ${s.why}`);
  console.log('─'.repeat(60));
  let ok = false;
  try {
    // ★ 用 stdio:'inherit' 讓子行程直接輸出到本主控台。
    //   不用 stdio:'pipe'：Windows 沙箱下擷取子行程輸出會走 named pipe 而被擋（EPERM）。
    //   inherit 不需擷取，子行程的輸出照樣看得到，且不受此限制。
    execFileSync(
      process.execPath,
      [path.join(__dirname, s.file), ...(s.args || [])],
      { cwd: ROOT, stdio: 'inherit' },
    );
    ok = true;
  } catch {
    // 子行程的錯誤訊息已由 inherit 直接印出，這裡只需記錄成敗
    ok = false;
  }
  summary.push({ name: s.name, ok });
  console.log(`  → ${s.name}：${ok ? 'PASS' : 'FAIL'}`);
}

const failed = summary.filter((x) => !x.ok);

console.log('\n' + '█'.repeat(60));
console.log('  總結');
console.log('█'.repeat(60));
for (const s of summary) console.log(`  ${s.ok ? '✅' : '❌'}  ${s.name}`);

if (failed.length === 0) {
  console.log('\n  ✅ 全部通過 —— 可以部署。');
  console.log('     下一步：git add/commit → 請使用者登入 → vercel --prod');
  console.log('     部署後跑：node deploy/verify-public.mjs <公開網址>\n');
  process.exit(0);
} else {
  console.log(`\n  ❌ ${failed.length} 支失敗 —— 先修好再部署：`);
  for (const f of failed) console.log(`     ✗ ${f.name}`);
  console.log('');
  process.exit(1);
}
