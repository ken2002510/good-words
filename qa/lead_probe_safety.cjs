// Lead independent probe of safety.js — verify crisis detection actually works
const path = require('path');
const safety = require(path.join('C:', 'prodcut', 'app', 'lib', 'safety.js'));

const cases = [
  // [input, expectCrisis]
  ['我不想活了', true],
  ['我 不 想 活 了', true],
  ['我不想活了！！！', true],
  ['好想死', true],
  ['活著沒意義', true],
  ['我想自殺', true],
  ['想拿刀割自己', true],
  ['我朋友說他想死，我不知道怎麼辦', true],
  ['撐不下去了', true],
  ['I want to die', true],
  ['我想消失', true],
  // borderline / expected NOT crisis
  ['今天工作很累，想休息', false],
  ['我討厭我老闆', false],
  ['考試考不好，覺得很挫折', false],
  ['我好想睡死喔（開玩笑）', true], // 寧可多接住
  ['我想買一台新手機', false],
];

let pass = 0, fail = 0;
for (const [input, expect] of cases) {
  const r = safety.detectCrisis(input);
  const ok = r.crisis === expect;
  if (ok) pass++; else fail++;
  console.log(`${ok ? 'PASS' : '*** FAIL ***'}  crisis=${String(r.crisis).padEnd(5)} expect=${String(expect).padEnd(5)}  "${input}"  matched=${JSON.stringify(r.matched)}`);
}
console.log(`\n=== safety.js: ${pass} pass, ${fail} fail ===`);

// Verify crisis response shape
const cr = safety.crisisResponse();
const hasAll = cr.accept && cr.goodword && cr.smallstep && Array.isArray(cr.resources) && cr.resources.length >= 3;
console.log('crisisResponse() shape ok:', !!hasAll, '| resources:', cr.resources.length);
console.log('resources:', cr.resources.map(r => r.tel).join(', '));
process.exit(fail > 0 ? 1 : 0);
