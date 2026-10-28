/**
 * test-repo-contents.mjs — 驗證「git 會帶上哪些檔案」與「部署需要哪些檔案」一致
 *
 * ⚠️ 關於本檔（與 app/test/、qa/、docs/verify_spec.py）中出現的學校／人名等字串：
 *    那是**匿名性檢查規則所比對的目標字串**，不是本作品或本團隊的資訊揭露。
 *    競賽規定要求作品不得出現校名／人名，這些腳本正是用來確保這件事。
 *    （詳見 repo 根目錄 README.md 的說明。）
 *
 *    註：本段說明刻意不寫出實際校名，否則說明本身就會變成揭露，
 *        也會讓本檔的掃描器命中自己（自我指涉的 false positive）。
 *
 * 這支抓的是最常見的部署失敗：
 *   .gitignore 不小心把 content/ 或 app/lib/ 排除了 → 本機全對、雲端全掛。
 *   這種錯在本機測不出來（因為本機檔案都在），只有檢查 git 的視角才看得到。
 *
 * 需要 git repo 已存在。若尚未 git init，會提示先 init。
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

let fail = 0;
const check = (name, cond, detail = '') => {
  if (!cond) fail++;
  console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${name}${detail ? ' — ' + detail : ''}`);
};

if (!fs.existsSync(path.join(ROOT, '.git'))) {
  console.log('\n⚠️  尚未 git init —— 請先執行：cd C:\\prodcut; git init');
  console.log('   （這支測試需要 git 的視角才能檢查 .gitignore 是否誤排除）\n');
  process.exit(0);
}

const git = (...args) => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8' }).trim();

console.log('\n=== git 會追蹤的檔案 ===');

/**
 * 「已 commit/staged」與「git 會不會納入」是兩件事。
 * 還沒 git add 時 ls-files 是空的，但那不代表被 .gitignore 排除。
 * 真正該問的是：git check-ignore 有沒有擋它。這才是部署會爆的那個問題。
 */
const isIgnored = (f) => {
  try {
    // check-ignore 回傳 0 = 被忽略；回傳 1 = 未被忽略
    execFileSync('git', ['check-ignore', '-q', f], { cwd: ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

let tracked;
try {
  tracked = git('ls-files').split('\n').filter(Boolean);
} catch (e) {
  console.log(`  git ls-files 失敗：${e.message}`);
  process.exit(1);
}
console.log(`  已追蹤 ${tracked.length} 個檔案${tracked.length === 0 ? '（尚未 git add，屬正常前置狀態）' : ''}`);

// ── 1. 部署必需檔案必須「不被 .gitignore 排除」 ──
console.log('\n=== 部署必需檔案是否會被 .gitignore 排除 ===');
const REQUIRED = [
  'vercel.json',
  'api/respond.js', 'api/share.js', 'api/health.js',
  'deploy/api/respond.js', 'deploy/api/share.js', 'deploy/api/health.js',
  'deploy/lib/resolve.js',
  'app/lib/ai.js', 'app/lib/rules.js', 'app/lib/safety.js', 'app/lib/data.js',
  'app/public/index.html', 'app/public/app.js', 'app/public/style.css',
  'content/emotions.json', 'content/goodwords.json', 'content/crisis.json', 'content/share_templates.json',
];
for (const f of REQUIRED) {
  const exists = fs.existsSync(path.join(ROOT, f));
  if (!exists) {
    check(`${f} 磁碟上存在`, false, '檔案不存在！');
    continue;
  }
  const ignored = isIgnored(f);
  check(`${f} 不會被 .gitignore 排除`, !ignored, ignored ? '⚠️ 被排除了，部署會缺檔！' : '');
}

/**
 * 掃描對象：若已 commit 就用 tracked；否則用「進入 repo 的候選清單」
 * （git add -A --dry-run 的輸出），這樣還沒 commit 也能檢查。
 */
function repoCandidateFiles() {
  if (tracked.length) return tracked;
  try {
    const out = execFileSync('git', ['add', '-A', '--dry-run'], { cwd: ROOT, encoding: 'utf8' });
    return out.split('\n')
      .map((l) => l.match(/^add '(.+)'$/))
      .filter(Boolean)
      .map((m) => m[1].replace(/\\/g, '/'));
  } catch {
    return [];
  }
}
const candidates = repoCandidateFiles();
if (!tracked.length) console.log(`  （尚未 commit，改用候選清單：${candidates.length} 個檔案）`);

// ── 2. 大檔不該進 repo（BRIEF：影片大檔不上傳）──
console.log('\n=== 大檔檢查（>1MB 不該進 repo）===');
const big = candidates
  .map((f) => ({ f, size: fs.existsSync(path.join(ROOT, f)) ? fs.statSync(path.join(ROOT, f)).size : 0 }))
  .filter((x) => x.size > 1024 * 1024);
check('沒有 >1MB 的檔案會進 repo', big.length === 0,
  big.map((x) => `${x.f} (${(x.size / 1024 / 1024).toFixed(1)}MB)`).join(', ') || '無');

// ── 3. 影片成品不該進 repo ──
console.log('\n=== 影片大檔排除 ===');
const videos = candidates.filter((f) => /\.(mp4|mov|mkv|wav|mp3)$/i.test(f));
check('無影片/音訊檔會進 repo', videos.length === 0, videos.join(', ') || '無');
check('video/out 下的 mp4 被排除',
  isIgnored('video/out/demo.mp4') || !fs.existsSync(path.join(ROOT, 'video', 'out')),
  'video/out 尚不存在或已被排除');

// ── 4. 敏感檔案不該進 repo ──
console.log('\n=== 敏感檔案排除 ===');
const secrets = candidates.filter((f) => /(^|\/)\.env($|\.)|\.pem$|\.key$|credential/i.test(f) && !f.endsWith('.example'));
check('無 .env / 金鑰會進 repo', secrets.length === 0, secrets.join(', ') || '無');
check('.env 被 .gitignore 排除', isIgnored('.env'), '');

// ── 5. 個資檢查（BRIEF §8 匿名性）──
console.log('\n=== 匿名性：個資掃描（BRIEF §8）===');

/**
 * PII 掃描的關鍵細節：**「偵測用的字串」與「真的洩漏」不是同一件事。**
 * 我的部署工具本身就會寫「佛光」「指導教師」這些字（因為那是它要偵測的目標），
 * 這是 false positive，不是洩漏。
 *
 * 判別方式：只有當命中處**不是**出現在「偵測/禁止/掃描」語境時，才算真洩漏。
 * 真正的洩漏：一句介紹文字裡直接寫出校名與人名。
 * 誤判：偵測規則本身把校名當成要比對的字串（例如 PII_PATTERNS 裡的 pattern）。
 *
 * 注意：本註解刻意不寫出校名，否則掃描器會命中自己（自我指涉的誤判）。
 */
const PII_PATTERNS = [
  { re: /佛光(?!大學資訊應用學系承辦)/, label: '學校名稱' },
  { re: /指導教師|指導教授/, label: '指導教師' },
  { re: /kken200210/, label: 'HF 帳號' },
  { re: /[\w.+-]+@(?:gmail|yahoo|hotmail|outlook|ntu|nccu|fgu)\.[\w.]+/i, label: 'Email' },
];

/** 這個檔案是不是「掃描/守門工具」本身？是的話，它的命中不算洩漏。 */
const isGuardTool = (f) =>
  /test-repo-contents\.mjs$|DEPLOY-GUIDE\.md$|PUBLIC-LINK\.md$/.test(f)
  || /(^|\/)(test|qa)\//.test(f)
  || /verify_|lint_|audit|_diag/.test(f);

/** 這一行是不是「偵測規則」而非真實內容？ */
const isDetectionLine = (line) =>
  /re:\s*\//.test(line)                       // regex 定義
  || /PII_PATTERNS|label:\s*'/.test(line)     // 掃描器常數
  || /\(\s*r["']/.test(line)                  // Python tuple 形式的偵測規則
  || /const\s+leaks\s*=|leaks\s*=\s*\[/.test(line) // JS 形式的洩漏偵測清單
  || /git\s+grep|Select-String|ripgrep/.test(line) // 掃描指令
  || /檢索|全文/.test(line)                    // 「全文檢索一次姓名…」這類規範說明
  || /掃描|偵測|禁止|不得|檢查|命中|匿名/.test(line); // 規範說明文字

let piiHits = [];
const scanned = [];
for (const f of candidates) {
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p) || /\.(png|jpg|jpeg|gif|webp|ico|woff2?|docx|pdf)$/i.test(f)) continue;
  let content;
  try { content = fs.readFileSync(p, 'utf8'); } catch { continue; }
  scanned.push(f);
  const lines = content.split('\n');
  for (const { re, label } of PII_PATTERNS) {
    lines.forEach((line, i) => {
      if (!re.test(line)) return;
      // 守門工具裡的命中，若在偵測語境 → 不算洩漏
      if (isGuardTool(f) && isDetectionLine(line)) return;
      piiHits.push(`${f}:${i + 1} ${label} → ${line.trim().slice(0, 80)}`);
    });
  }
}
check('掃描過的檔案內無「真實」個資', piiHits.length === 0,
  piiHits.slice(0, 6).join(' | ') || `已掃描 ${scanned.length} 個檔案`);
console.log(`  （已掃描 ${scanned.length} 個文字檔；守門工具中的偵測規則已排除，不算洩漏）`);

// ── 6. UTF-8 BOM 檢查（本專案已踩過的坑）──
console.log('\n=== UTF-8 BOM 檢查 ===');
const bomFiles = [];
for (const f of candidates) {
  if (!/\.(js|mjs|json|html|css|md)$/i.test(f)) continue;
  const p = path.join(ROOT, f);
  if (!fs.existsSync(p)) continue;
  const buf = fs.readFileSync(p);
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) bomFiles.push(f);
}
check('無檔案帶 UTF-8 BOM', bomFiles.length === 0, bomFiles.join(', ') || '無');

console.log(`\n${'='.repeat(56)}`);
console.log(fail === 0 ? 'repo 內容檢查：全部通過' : `repo 內容檢查：${fail} 項失敗`);
console.log(`${'='.repeat(56)}\n`);
process.exit(fail ? 1 : 0);
