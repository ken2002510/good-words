'use strict';

/**
 * mobile-check.js — 手機版不破版檢查（375px）
 *
 * 用 headless Chrome 的 CDP 直接量測：任何元素是否超出視窗寬度。
 * 不需要 puppeteer（零依賴），只用 Node 內建 http/ws 與 Chrome 的 --remote-debugging-port。
 *
 * 執行：node test/mobile-check.js
 * 需要：系統已安裝 Chrome（會自動找常見路徑）
 */

const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 3222);
const CDP_PORT = 9333;
const WIDTHS = [320, 375, 414, 768];

function findChrome() {
  const cands = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  return cands.find((c) => { try { return fs.existsSync(c); } catch { return false; } });
}

function getJson(url, method = 'GET') {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search, method,
    }, (res) => {
      let d = '';
      res.on('data', (c) => { d += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(d)); }
        catch (e) { reject(new Error(`非 JSON 回應（HTTP ${res.statusCode}）：${d.slice(0, 80)}`)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

/** 新版 Chrome 的 /json/new 需要 PUT */
function newTarget(cdpPort) {
  return getJson(`http://127.0.0.1:${cdpPort}/json/new?about:blank`, 'PUT');
}

/** 極簡 WebSocket 客戶端（只用來送 CDP 指令，不依賴 ws 套件） */
function wsConnect(wsUrl) {
  return new Promise((resolve, reject) => {
    const u = new URL(wsUrl);
    const key = crypto.randomBytes(16).toString('base64');
    const req = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      headers: {
        Connection: 'Upgrade', Upgrade: 'websocket',
        'Sec-WebSocket-Key': key, 'Sec-WebSocket-Version': '13',
      },
    });
    req.on('upgrade', (res, socket) => {
      let buf = Buffer.alloc(0);
      const pending = new Map();
      let id = 0;

      socket.on('data', (chunk) => {
        buf = Buffer.concat([buf, chunk]);
        // 解析 frame（只處理 server→client，無 mask）
        for (;;) {
          if (buf.length < 2) break;
          const len0 = buf[1] & 0x7f;
          let offset = 2, len = len0;
          if (len0 === 126) { if (buf.length < 4) break; len = buf.readUInt16BE(2); offset = 4; }
          else if (len0 === 127) { if (buf.length < 10) break; len = Number(buf.readBigUInt64BE(2)); offset = 10; }
          if (buf.length < offset + len) break;
          const payload = buf.slice(offset, offset + len).toString('utf8');
          buf = buf.slice(offset + len);
          try {
            const msg = JSON.parse(payload);
            if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
          } catch { /* 忽略非 JSON */ }
        }
      });

      function send(method, params) {
        return new Promise((res) => {
          const myId = ++id;
          pending.set(myId, res);
          const body = Buffer.from(JSON.stringify({ id: myId, method, params: params || {} }), 'utf8');
          const mask = crypto.randomBytes(4);
          let header;
          if (body.length < 126) {
            header = Buffer.alloc(2); header[1] = 0x80 | body.length;
          } else if (body.length < 65536) {
            header = Buffer.alloc(4); header[1] = 0x80 | 126; header.writeUInt16BE(body.length, 2);
          } else {
            header = Buffer.alloc(10); header[1] = 0x80 | 127;
            header.writeBigUInt64BE(BigInt(body.length), 2);
          }
          header[0] = 0x81;
          const masked = Buffer.alloc(body.length);
          for (let i = 0; i < body.length; i++) masked[i] = body[i] ^ mask[i % 4];
          socket.write(Buffer.concat([header, mask, masked]));
        });
      }

      resolve({ send, close: () => socket.destroy() });
    });
    req.on('error', reject);
    req.end();
  });
}

async function waitFor(fn, timeoutMs = 20000, label = '') {
  const t0 = Date.now();
  for (;;) {
    try { const v = await fn(); if (v) return v; } catch { /* retry */ }
    if (Date.now() - t0 > timeoutMs) throw new Error('timeout waiting for ' + label);
    await new Promise((r) => setTimeout(r, 200));
  }
}

// 在頁面裡量測：是否任何元素超出視窗、是否有橫向捲軸
/**
 * 量測橫向溢出。
 *
 * 關鍵：真正的破版訊號是 `documentElement.scrollWidth > clientWidth`（出現橫向捲軸）。
 * 另外用 getBoundingClientRect 找出「部分露出畫面」的元素。
 * 但要排除**刻意移出畫面**的元素（例如 .skip 無障礙跳轉連結，left:-9999px），
 * 那是正確做法，不是破版。判斷方式：該元素完全在畫面左側之外（right < 0）。
 */
const MEASURE = `(() => {
  const vw = document.documentElement.clientWidth;
  const out = { vw, scrollW: document.documentElement.scrollWidth, offenders: [] };
  for (const el of document.querySelectorAll('body *')) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    const st = getComputedStyle(el);

    // 刻意移出畫面（螢幕閱讀器用）→ 不算破版
    if (r.right <= 0 || r.left >= vw) continue;
    // 螢幕閱讀器視覺隱藏法（clip）→ 不算破版
    if (st.clip && st.clip !== 'auto' && /rect\\(0/.test(st.clip)) continue;
    if (st.position === 'fixed' && r.width <= vw + 1) continue;

    // 允許 1px 次像素誤差
    if (r.right > vw + 1 || r.left < -1) {
      out.offenders.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className && el.className.toString().slice(0, 40)) || '',
        id: el.id || '',
        left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width)
      });
    }
  }
  out.offenders = out.offenders.slice(0, 12);
  return out;
})()`;

/**
 * 檢查「sticky 頁首把文字切一半」。
 * 這是純像素溢出量測抓不到的破版類型（實測截圖才發現：滾到結果卡時
 * 「我聽到的是」被頁首切一半）。
 *
 * 判準要小心：頁面捲動時，元素「已經滑到頁首上方」是正常現象，不算破版。
 * 真正的破版是**元素橫跨頁首的下緣**——一部分還在頁首下面、一部分被頁首蓋住，
 * 造成一行字只露出半截（就是 Lead 看到的那個症狀）。
 * 因此只檢查「元素頂端被頁首蓋住，但底端仍露在頁首之下」的元素。
 */
const MEASURE_OCCLUSION = `(() => {
  const header = document.querySelector('.top');
  if (!header) return { ok: true, overlaps: [], note: 'no sticky header' };
  const hr = header.getBoundingClientRect();
  const overlaps = [];
  for (const el of document.querySelectorAll('main *')) {
    if (header.contains(el)) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    // 元素整體已在頁首上方（r.bottom <= hr.bottom 且 r.top < hr.top）→ 只是捲過去了，正常
    if (r.bottom <= hr.bottom) continue;
    // 元素整體在頁首下方 → 正常
    if (r.top >= hr.bottom) continue;
    // 到這裡代表：頂端被頁首蓋住、底端還露出來 = 真的被切一半
    const hasText = Array.from(el.childNodes).some(n => n.nodeType === 3 && n.textContent.trim());
    if (!hasText) continue;
    overlaps.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className || '').toString().slice(0, 40),
      id: el.id || '',
      top: Math.round(r.top), bottom: Math.round(r.bottom),
      text: (el.textContent || '').trim().slice(0, 20)
    });
  }
  return { ok: overlaps.length === 0, overlaps: overlaps.slice(0, 8), headerBottom: Math.round(hr.bottom) };
})()`;

async function main() {
  const chrome = findChrome();
  if (!chrome) { console.log('找不到 Chrome，跳過手機版檢查'); process.exit(0); }

  // 起 server
  // 用真實引擎（不強制規則軌），這樣截圖才會反映評審看到的畫面
  const srv = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore',
  });
  await waitFor(async () => (await fetch(`http://127.0.0.1:${PORT}/api/health`)).ok, 15000, 'server');

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'hsh-chrome-'));
  const ch = spawn(chrome, [
    '--headless=new', `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--hide-scrollbars', 'about:blank',
  ], { stdio: 'ignore' });

  let pass = 0, fail = 0;
  try {
    await waitFor(async () => (await getJson(`http://127.0.0.1:${CDP_PORT}/json/version`)).webSocketDebuggerUrl, 20000, 'chrome');

    for (const width of WIDTHS) {
      // 每個寬度用一個新 target
      const tgt = await newTarget(CDP_PORT);
      const ws = await wsConnect(tgt.webSocketDebuggerUrl);
      const targetId = tgt.id;

      await ws.send('Emulation.setDeviceMetricsOverride', {
        width, height: 800, deviceScaleFactor: 2, mobile: true,
      });
      await ws.send('Page.enable');
      await ws.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?w=${width}` });
      await new Promise((r) => setTimeout(r, 1400));

      // 量測「初始畫面」
      const res1 = await ws.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      const m1 = res1.result && res1.result.result && res1.result.result.value;

      // 填入內容並觸發結果畫面，再量一次（結果卡片才是內容最多的區塊）
      await ws.send('Runtime.evaluate', {
        expression: `
          document.getElementById('input').value='今天被主管當著大家的面罵，我覺得自己很沒用，回家路上一直在想這件事，覺得自己什麼都做不好';
          document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
          'ok'`,
        returnByValue: true,
      });

      // 等真正的結果出現（走 Ollama 時要幾秒；輪詢而非固定等待）
      const waited = await waitFor(async () => {
        const r = await ws.send('Runtime.evaluate', {
          expression: `!document.getElementById('result-body').hidden && document.getElementById('seg-good').textContent.trim().length > 0`,
          returnByValue: true,
        });
        return r.result && r.result.result && r.result.result.value;
      }, 40000, '好話結果').then(() => true).catch(() => false);

      // 記錄這張畫面實際由哪個引擎產生（截圖證據的一部分）
      if (width === 375) {
        const eng = await ws.send('Runtime.evaluate', {
          expression: `document.getElementById('engine-note').textContent`, returnByValue: true,
        });
        const engineText = (eng.result && eng.result.result && eng.result.result.value) || '';
        console.log(`  ℹ️  引擎註記：${engineText.slice(0, 70)}`);
        if (!waited) console.log('  ⚠️  等待結果逾時，畫面可能仍為載入中');
      }

      const res2 = await ws.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      const m2 = res2.result && res2.result.result && res2.result.result.value;

      // 展開轉送面板再量
      await ws.send('Runtime.evaluate', {
        expression: `document.querySelector('[data-act="share"]').click(); 'ok'`, returnByValue: true,
      });
      await new Promise((r) => setTimeout(r, 1200));
      const res3 = await ws.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      const m3 = res3.result && res3.result.result && res3.result.result.value;

      // 危機畫面也量（最多內容、最長文字）
      const tgtC = await newTarget(CDP_PORT);
      const wsC = await wsConnect(tgtC.webSocketDebuggerUrl);
      await wsC.send('Emulation.setDeviceMetricsOverride', { width, height: 800, deviceScaleFactor: 2, mobile: true });
      await wsC.send('Page.enable');
      await wsC.send('Page.navigate', { url: `http://127.0.0.1:${PORT}/?c=${width}` });
      await new Promise((r) => setTimeout(r, 1300));
      await wsC.send('Runtime.evaluate', {
        expression: `
          document.getElementById('input').value='我不想活了';
          document.getElementById('form').dispatchEvent(new Event('submit',{cancelable:true,bubbles:true}));
          'ok'`,
        returnByValue: true,
      });
      await new Promise((r) => setTimeout(r, 1200));
      const res4 = await wsC.send('Runtime.evaluate', { expression: MEASURE, returnByValue: true });
      const m4 = res4.result && res4.result.result && res4.result.result.value;

      const stages = [
        ['初始畫面', m1], ['好話結果卡', m2], ['轉送面板', m3], ['危機轉介畫面', m4],
      ];

      console.log(`\n── ${width}px ${'─'.repeat(30)}`);
      for (const [name, m] of stages) {
        if (!m) { console.log(`  ❌ ${name}：量測失敗`); fail++; continue; }
        const okW = m.scrollW <= m.vw + 1;   // 沒有橫向捲軸 = 不破版（主要判準）
        const okE = m.offenders.length === 0; // 沒有元素被切掉（次要判準）
        if (okW && okE) {
          pass++;
          console.log(`  ✅ ${name}：無橫向溢出（viewport ${m.vw}，scrollWidth ${m.scrollW}）`);
        } else {
          fail++;
          console.log(`  ❌ ${name}：viewport ${m.vw}, scrollWidth ${m.scrollW}, 溢出元素 ${m.offenders.length}`);
          m.offenders.forEach((o) => console.log(`       <${o.tag}${o.id ? '#' + o.id : ''}${o.cls ? '.' + o.cls.split(' ').join('.') : ''}> left=${o.left} right=${o.right} w=${o.w}`));
        }
      }

      // ── sticky 頁首遮擋檢查（像素溢出量測抓不到的破版類型）──
      // 把畫面捲到結果卡，確認沒有文字被 sticky 頁首切到
      await ws.send('Runtime.evaluate', {
        expression: `document.getElementById('result').scrollIntoView(); 'ok'`, returnByValue: true,
      });
      // 等平滑捲動結束再量。中途量到的是「捲動中的瞬間」，
      // 那時任何元素都可能短暫經過頁首下方，不是破版。
      await waitFor(async () => {
        const r = await ws.send('Runtime.evaluate', {
          expression: `(() => { const y = window.scrollY; if (window.__lastY === y) return true; window.__lastY = y; return false; })()`,
          returnByValue: true,
        });
        return r.result && r.result.result && r.result.result.value === true;
      }, 5000, '捲動停止').catch(() => {});
      await new Promise((r) => setTimeout(r, 400));

      const occ = await ws.send('Runtime.evaluate', { expression: MEASURE_OCCLUSION, returnByValue: true });
      const o = occ.result && occ.result.result && occ.result.result.value;
      if (o && o.ok) {
        pass++;
        console.log(`  ✅ 捲到結果卡時，sticky 頁首未遮住任何文字（頁首下緣 ${o.headerBottom}px）`);
      } else if (o) {
        fail++;
        console.log(`  ❌ sticky 頁首遮住 ${o.overlaps.length} 個文字元素（頁首下緣 ${o.headerBottom}px）：`);
        o.overlaps.forEach((x) => console.log(`       <${x.tag}${x.id ? '#' + x.id : ''}${x.cls ? '.' + x.cls.split(' ').join('.') : ''}> top=${x.top} bottom=${x.bottom} "${x.text}"`));
      }

      // 存一張 375px 的截圖當人工複核證據
      if (width === 375) {
        const shot = await ws.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        const b64 = shot.result && shot.result.data;
        if (b64) {
          const dir = path.join(ROOT, 'test', 'screenshots');
          fs.mkdirSync(dir, { recursive: true });
          const f = path.join(dir, 'mobile-375-result.png');
          fs.writeFileSync(f, Buffer.from(b64, 'base64'));
          console.log(`  📷 已存截圖：${path.relative(ROOT, f)}`);
        }
      }

      ws.close();
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${targetId}`).catch(() => {});
      wsC.close();
      await fetch(`http://127.0.0.1:${CDP_PORT}/json/close/${tgtC.id}`).catch(() => {});
    }
  } finally {
    ch.kill();
    srv.kill();
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* ignore */ }
  }

  console.log('\n' + '═'.repeat(56));
  console.log(`  手機版檢查：${pass} 通過 / ${fail} 失敗（寬度 ${WIDTHS.join(', ')}px）`);
  console.log('═'.repeat(56) + '\n');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error('檢查腳本出錯：', e.message); process.exit(1); });
