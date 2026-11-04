/* ============================================================
   好好說話 — app.js
   零依賴、零追蹤。所有狀態只留在這個瀏覽器裡（localStorage）。
   沒有任何欄位會蒐集個資。
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };

  var el = {
    form: $('form'),
    input: $('input'),
    counter: $('counter'),
    submit: $('btn-submit'),
    result: $('result'),
    loading: $('loading'),
    loadingText: $('loading-text'),
    body: $('result-body'),
    crisis: $('crisis'),
    crisisLead: $('crisis-lead'),
    hotlines: $('hotlines'),
    tag: $('emotion-tag'),
    intensity: $('emotion-intensity'),
    situation: $('emotion-situation'),
    alts: $('emotion-alts'),
    accept: $('seg-accept'),
    good: $('seg-good'),
    step: $('seg-step'),
    engineNote: $('engine-note'),
    sharePanel: $('share-panel'),
    shareText: $('share-text'),
    favPanel: $('fav-panel'),
    favList: $('fav-list'),
    favEmpty: $('fav-empty'),
    favCount: $('fav-count'),
    favBtnLabel: $('fav-btn-label'),
    btnFav: $('btn-favorites'),
    toast: $('toast'),
    btnClearHistory: $('btn-clear-history'),
    meHandle: $('me-handle'),
    mePts: $('me-pts'),
    meWeekPts: $('me-week-pts'),
    meWeekLabel: $('me-week-label'),
    meTitle: $('me-title'),
    meRank: $('me-rank'),
    meHistory: $('me-history'),
    meEmpty: $('me-empty'),
    wallStatus: $('wall-status'),
    wallFilters: $('wall-filters'),
    wallList: $('wall-list'),
    wallEmpty: $('wall-empty'),
    publishTopic: $('publish-topic'),
    meWall: $('me-wall'),
    meWallEmpty: $('me-wall-empty'),
    boardWeek: $('board-week'),
    boardList: $('board-list'),
    boardEmpty: $('board-empty'),
  };

  var MAXLEN = 2000;
  var FAV_KEY = 'hsh.favorites.v1';
  var HIST_KEY = 'hsh.history.v1';
  var ANON_KEY = 'hsh.anon.v1';
  var PROFILE_KEY = 'hsh.profile.v1';
  var WALLMINE_KEY = 'hsh.wallmine.v1';
  var current = null;      // 目前顯示的回應
  var audience = 'friend'; // 轉送對象
  var busy = false;
  var mode = 'chat';       // 'chat' 傾訴 | 'rewrite' 改寫重話
  var lastText = '';       // 最近一次送出的原文（掛牆用）
  var published = false;   // 目前這張卡是否已掛牆

  // ── 對話歷史（只存在本機 localStorage，送出時帶給後端，後端不儲存）──

  function loadHistory() {
    try {
      var raw = localStorage.getItem(HIST_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveHistory(arr) {
    try {
      localStorage.setItem(HIST_KEY, JSON.stringify(arr.slice(-8))); // 最多 4 輪
    } catch (e) { /* 瀏覽器不允許就算了 */ }
  }

  function pushHistory(userText, assistantText) {
    var h = loadHistory();
    h.push({ role: 'user', content: String(userText).slice(0, 300) });
    if (assistantText) h.push({ role: 'assistant', content: String(assistantText).slice(0, 300) });
    saveHistory(h);
    refreshClearBtn();
  }

  function refreshClearBtn() {
    el.btnClearHistory.hidden = loadHistory().length === 0;
  }

  // ── 小工具 ────────────────────────────────────────

  var toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.toast.hidden = true; }, 2200);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }
    // http:// 或舊瀏覽器的退路
    return new Promise(function (resolve, reject) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'fixed';
        ta.style.top = '-1000px';
        document.body.appendChild(ta);
        ta.select();
        ta.setSelectionRange(0, ta.value.length);
        var ok = document.execCommand('copy');
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error('copy failed'));
      } catch (e) { reject(e); }
    });
  }

  function intensityDots(n) {
    var v = Math.max(1, Math.min(5, Number(n) || 3));
    return '●●●●●'.slice(0, v) + '○○○○○'.slice(0, 5 - v);
  }

  var INTENSITY_WORD = { 1: '輕輕的', 2: '有點', 3: '明顯', 4: '很重', 5: '非常重' };

  // ── 收藏（localStorage，純本機）────────────────────

  function loadFavs() {
    try {
      var raw = localStorage.getItem(FAV_KEY);
      var arr = raw ? JSON.parse(raw) : [];
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveFavs(arr) {
    try {
      localStorage.setItem(FAV_KEY, JSON.stringify(arr.slice(0, 100)));
    } catch (e) {
      toast('這個瀏覽器不允許儲存，收藏沒有存下來');
    }
  }

  function renderFavs() {
    var favs = loadFavs();
    el.favList.innerHTML = '';

    el.favCount.hidden = favs.length === 0;
    el.favCount.textContent = String(favs.length);

    if (!favs.length) {
      el.favEmpty.hidden = false;
      el.favList.hidden = true;
      return;
    }
    el.favEmpty.hidden = true;
    el.favList.hidden = false;

    favs.forEach(function (f, i) {
      var li = document.createElement('li');
      li.className = 'fav-item';

      var emo = document.createElement('span');
      emo.className = 'fav-emotion';
      emo.textContent = f.emotion || '好話';

      var p = document.createElement('p');
      p.textContent = f.goodword || '';

      li.appendChild(emo);
      li.appendChild(p);

      if (f.smallstep) {
        var s = document.createElement('p');
        s.className = 'fav-step';
        s.textContent = '小步：' + f.smallstep;
        li.appendChild(s);
      }

      var tools = document.createElement('div');
      tools.className = 'fav-tools';

      var cp = document.createElement('button');
      cp.type = 'button';
      cp.textContent = '複製';
      cp.addEventListener('click', function () {
        copyText(twoLine(f)).then(function () { toast('已複製'); })
          .catch(function () { toast('複製失敗，請長按選取'); });
      });

      var del = document.createElement('button');
      del.type = 'button';
      del.textContent = '刪除';
      del.addEventListener('click', function () {
        var now = loadFavs();
        now.splice(i, 1);
        saveFavs(now);
        renderFavs();
        refreshFavButton();
        toast('已刪除');
      });

      tools.appendChild(cp);
      tools.appendChild(del);
      li.appendChild(tools);

      el.favList.appendChild(li);
    });
  }

  function twoLine(r) {
    var out = [];
    if (r.accept) out.push('承接：' + r.accept);
    if (r.goodword) out.push('好話：' + r.goodword);
    if (r.smallstep) out.push('小步：' + r.smallstep);
    return out.join('\n');
  }

  function isCurrentFaved() {
    if (!current) return false;
    return loadFavs().some(function (f) { return f.goodword === current.goodword; });
  }

  function refreshFavButton() {
    var on = isCurrentFaved();
    el.favBtnLabel.textContent = on ? '已收藏' : '收藏';
    var btn = document.querySelector('[data-act="fav"]');
    if (btn) {
      btn.classList.toggle('is-on', on);
      btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
  }

  // ── 危機畫面 ──────────────────────────────────────

  function renderCrisis(data) {
    el.crisisLead.textContent = data.accept || '你願意說出來，這件事很重要。';

    el.hotlines.innerHTML = '';
    var list = data.resources && data.resources.length ? data.resources : [
      { name: '1925 安心專線', tel: '1925', note: '24 小時，免付費。' },
      { name: '1995 生命線', tel: '1995', note: '24 小時。' },
      { name: '1980 張老師', tel: '1980', note: '談心事、談家裡的事。' },
    ];

    list.forEach(function (r) {
      var li = document.createElement('li');
      var a = document.createElement('a');
      a.className = 'hotline';
      a.href = 'tel:' + String(r.tel).replace(/\D/g, '') || '#';

      var num = document.createElement('span');
      num.className = 'hotline-num';
      num.textContent = r.tel;

      var body = document.createElement('span');
      body.className = 'hotline-body';
      var nm = document.createElement('span');
      nm.className = 'hotline-name';
      nm.textContent = r.name;
      var nt = document.createElement('span');
      nt.className = 'hotline-note';
      nt.textContent = r.note || '';
      body.appendChild(nm);
      body.appendChild(nt);

      a.appendChild(num);
      a.appendChild(body);
      li.appendChild(a);
      el.hotlines.appendChild(li);
    });

    el.result.hidden = true;
    el.crisis.hidden = false;
    el.crisis.focus({ preventScroll: true });
    el.crisis.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── 一般結果 ──────────────────────────────────────

  function engineLabel(meta) {
    if (!meta) return '';
    var src;
    if (meta.engine === 'ollama') src = '本機 AI 模型（' + (meta.model || '') + '）';
    else if (meta.engine === 'nvidia') src = '雲端 AI 模型（NVIDIA NIM · ' + (meta.model || '') + '）';
    else if (meta.engine === 'cloud') src = '雲端 AI 模型（' + (meta.model || '') + '）';
    else src = '規則式引擎';
    var t = meta.elapsedMs ? (meta.elapsedMs / 1000).toFixed(1) + ' 秒' : '';
    var note = '這句由「' + src + '」產生' + (t ? '，用了 ' + t : '') + '。';
    if (meta.degraded && meta.engine !== 'safety') {
      note += '目前走的是備援路徑 —— 回應一樣是完整的。';
    }
    note += ' 它只是一句陪你說話的話，不構成建議或診斷。';
    return note;
  }

  function renderResult(data) {
    current = data;
    audience = 'friend';

    var e = data.emotion || {};
    el.tag.textContent = e.name || '說不出口的心情';

    if (e.intensity) {
      el.intensity.textContent = intensityDots(e.intensity);
      el.intensity.title = '情緒強度：' + intensityDots(e.intensity) +
        '（' + (INTENSITY_WORD[Math.min(5, Math.max(1, e.intensity))] || '') + '）';
    } else {
      el.intensity.textContent = '';
    }

    el.situation.textContent = e.situation || '';

    if (e.alternatives && e.alternatives.length) {
      el.alts.hidden = false;
      el.alts.textContent = '可能也有一點：' + e.alternatives.join('、');
    } else {
      el.alts.hidden = true;
      el.alts.textContent = '';
    }

    el.accept.textContent = data.accept || '';
    el.good.textContent = data.goodword || '';
    el.step.textContent = data.smallstep || '';
    el.engineNote.textContent = engineLabel(data.meta);

    el.sharePanel.hidden = true;
    el.crisis.hidden = true;
    el.result.hidden = false;
    el.body.hidden = false;
    el.loading.hidden = true;

    published = false;
    var pb = $('btn-publish');
    if (pb) pb.disabled = false;
    if (el.publishTopic) el.publishTopic.value = topicOfEmotion(current && current.emotion);

    refreshFavButton();
    setTab('friend');

    el.result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  // ── 送出 ──────────────────────────────────────────

  var LOADING_MSGS = [
    '正在聽你說話…',
    '正在把你的處境讀懂…',
    '正在想一句不空洞的話…',
  ];

  function setBusy(on) {
    busy = on;
    el.submit.disabled = on;
    el.submit.querySelector('.btn-text').textContent =
      on ? '正在想…' : '說出來，讓它被接住';
    el.submit.querySelector('.spinner').hidden = !on;
  }

  function submit() {
    var text = el.input.value.trim();
    if (!text) {
      toast('先寫下一點什麼，一個字也可以');
      el.input.focus();
      return;
    }
    if (busy) return;
    lastText = text;
    published = false;

    setBusy(true);
    el.crisis.hidden = true;
    el.result.hidden = false;
    el.body.hidden = true;
    el.loading.hidden = false;
    el.result.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    var mi = 0;
    el.loadingText.textContent = LOADING_MSGS[0];
    var tick = setInterval(function () {
      mi = (mi + 1) % LOADING_MSGS.length;
      el.loadingText.textContent = LOADING_MSGS[mi];
    }, 2600);

    fetch('/api/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: text, mode: mode, history: loadHistory() }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || '伺服器回應異常'); });
        return r.json();
      })
      .then(function (data) {
        clearInterval(tick);
        setBusy(false);
        if (data.crisis) {
          renderCrisis(data);
          // 危機內容不寫進歷史（隱私：不拿去給模型看）
        } else {
          renderResult(data);
          pushHistory(text, [data.accept, data.goodword, data.smallstep].filter(Boolean).join('\n'));
        }
      })
      .catch(function (err) {
        clearInterval(tick);
        setBusy(false);
        // 連線失敗也要有畫面，不讓使用者看著空白
        renderResult({
          emotion: { name: '連線不穩', situation: '' },
          accept: '你的話我這邊沒有收到完整的內容。',
          goodword: '你願意打出來的那份心意，本身已經算數了。',
          smallstep: '檢查一下網路，然後按一次「說出來」，或先把這句話複製起來留著。',
          meta: { engine: 'rules', degraded: true, degradedReason: String(err.message || err) },
        });
        toast('連線出了點問題，先給你一句備援的話');
      });
  }

  // ── 轉送 ──────────────────────────────────────────

  function setTab(a) {
    audience = a;
    Array.prototype.forEach.call(document.querySelectorAll('.seg-tab'), function (b) {
      var on = b.getAttribute('data-audience') === a;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function openShare() {
    if (!current) return;
    el.sharePanel.hidden = false;
    fetchShare(audience);
  }

  function fetchShare(a) {
    if (!current) return;
    var payload = {
      accept: current.accept,
      goodword: current.goodword,
      smallstep: current.smallstep,
      audience: a,
    };
    fetch('/api/share', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
      .then(function (r) { return r.json(); })
      .then(function (d) { el.shareText.textContent = d.text || ''; })
      .catch(function () {
        // 後端掛掉也要能轉送：在前端自己組
        var open = { friend: '嗨，我在想你可能也辛苦了。', family: '我知道我們平常不太講這些。', colleague: '知道你最近也很忙。' };
        var close = { friend: '不用回我，看完就好。', family: '只是想到你。', colleague: '有空再說就好。' };
        el.shareText.textContent = open[a] + '\n\n「' + (current.goodword || '') + '」\n\n' +
          (current.accept || '') + '\n\n' + close[a];
      });
  }

  // ── 事件綁定 ──────────────────────────────────────

  el.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    submit();
  });

  // Ctrl/Cmd + Enter 送出
  el.input.addEventListener('keydown', function (ev) {
    if ((ev.ctrlKey || ev.metaKey) && ev.key === 'Enter') {
      ev.preventDefault();
      submit();
    }
  });

  el.input.addEventListener('input', function () {
    var n = el.input.value.length;
    el.counter.textContent = n + ' / ' + MAXLEN;
    el.counter.style.color = n > MAXLEN * 0.9 ? 'var(--accent)' : '';
  });

  // ── 模式切換：傾訴心事 / 改寫重話 ──────────────────

  var PLACEHOLDER = {
    chat: '例如：今天開會我講錯話，回家路上一直想，覺得自己很沒用。',
    rewrite: '貼上一句你對自己或別人說過的重話，例如：我怎麼這麼沒用。',
  };
  var HINT = {
    chat: '不用寫完整，一句話也可以',
    rewrite: '把那句話原樣貼上，AI 會幫你改成說得出口的版本',
  };

  function setMode(m) {
    mode = m === 'rewrite' ? 'rewrite' : 'chat';
    Array.prototype.forEach.call(document.querySelectorAll('.mode-btn'), function (b) {
      var on = b.getAttribute('data-mode') === mode;
      b.classList.toggle('is-on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    el.input.setAttribute('placeholder', PLACEHOLDER[mode]);
    $('input-hint').textContent = HINT[mode];
  }

  Array.prototype.forEach.call(document.querySelectorAll('.mode-btn'), function (b) {
    b.addEventListener('click', function () { setMode(b.getAttribute('data-mode')); });
  });

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.addEventListener('click', function () {
      el.input.value = c.getAttribute('data-fill-' + mode) || c.getAttribute('data-fill-chat') || '';
      el.input.dispatchEvent(new Event('input'));
      el.input.focus();
    });
  });

  // ── 清除對話紀錄（本機） ────────────────────────────

  el.btnClearHistory.addEventListener('click', function () {
    saveHistory([]);
    refreshClearBtn();
    toast('對話紀錄已清除（只清這台裝置）');
  });

  el.result.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-act]') : null;
    if (!btn) return;
    var act = btn.getAttribute('data-act');

    if (act === 'copy') {
      copyText(twoLine(current || {}))
        .then(function () { toast('已複製，可以貼到任何地方'); })
        .catch(function () { toast('複製失敗，請長按選取文字'); });
    }

    if (act === 'fav') {
      if (!current) return;
      var favs = loadFavs();
      var idx = -1;
      for (var i = 0; i < favs.length; i++) if (favs[i].goodword === current.goodword) { idx = i; break; }
      if (idx >= 0) {
        favs.splice(idx, 1);
        toast('已取消收藏');
      } else {
        favs.unshift({
          goodword: current.goodword,
          accept: current.accept,
          smallstep: current.smallstep,
          emotion: (current.emotion && current.emotion.name) || '',
          at: Date.now(),
        });
        toast('已收藏，只存在這台裝置');
      }
      saveFavs(favs);
      renderFavs();
      refreshFavButton();
    }

    if (act === 'share') {
      if (el.sharePanel.hidden) openShare();
      else el.sharePanel.hidden = true;
    }

    if (act === 'copy-share') {
      copyText(el.shareText.textContent || '')
        .then(function () { toast('已複製轉送版'); })
        .catch(function () { toast('複製失敗，請長按選取'); });
    }

    if (act === 'close-share') el.sharePanel.hidden = true;

    if (act === 'publish') publish();

    if (act === 'clear-fav') {
      if (!loadFavs().length) { toast('本來就是空的'); return; }
      if (confirm('清空所有收藏？')) {
        saveFavs([]);
        renderFavs();
        refreshFavButton();
        toast('已清空');
      }
    }
  });

  el.sharePanel.addEventListener('click', function (ev) {
    var tab = ev.target.closest ? ev.target.closest('.seg-tab') : null;
    if (!tab) return;
    setTab(tab.getAttribute('data-audience'));
    fetchShare(audience);
  });

  el.btnFav.addEventListener('click', function () {
    var open = el.favPanel.hidden;
    el.favPanel.hidden = !open;
    el.btnFav.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) el.favPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });

  el.favPanel.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('[data-act="clear-fav"]') : null;
    if (btn) {
      if (!loadFavs().length) { toast('本來就是空的'); return; }
      if (confirm('清空所有收藏？')) {
        saveFavs([]); renderFavs(); refreshFavButton(); toast('已清空');
      }
    }
  });

  // ── 好話牆 / 分數 / 排行榜（個人紀錄只存在本機 localStorage）─────

  function getAnon() {
    try {
      var a = localStorage.getItem(ANON_KEY);
      if (a && /^[A-Za-z0-9_-]{8,64}$/.test(a)) return a;
      a = (window.crypto && crypto.randomUUID)
        ? crypto.randomUUID()
        : 'anon-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      localStorage.setItem(ANON_KEY, a);
      return a;
    } catch (e) { return 'anon-local'; }
  }

  function weekKeyNow() {
    try {
      var d = new Date();
      var tw = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Taipei' }));
      var date = new Date(Date.UTC(tw.getFullYear(), tw.getMonth(), tw.getDate()));
      var dayNum = (date.getUTCDay() + 6) % 7;
      date.setUTCDate(date.getUTCDate() - dayNum + 3);
      var ft = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
      var fd = (ft.getUTCDay() + 6) % 7;
      ft.setUTCDate(ft.getUTCDate() - fd + 3);
      var w = 1 + Math.round((date - ft) / (7 * 86400000));
      return tw.getFullYear() + '-W' + ('0' + w).slice(-2);
    } catch (e) { return '----'; }
  }

  function loadProfile() {
    try {
      var p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      if (p && typeof p === 'object') {
        p.history = Array.isArray(p.history) ? p.history : [];
        return p;
      }
    } catch (e) { /* ignore */ }
    return { week: weekKeyNow(), weekPts: 0, allPts: 0, history: [] };
  }

  function saveProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch (e) { /* ignore */ }
  }

  function addProfileEvent(type, delta, note) {
    var p = loadProfile();
    var wk = weekKeyNow();
    if (p.week !== wk) { p.week = wk; p.weekPts = 0; }
    p.allPts = (p.allPts || 0) + delta;
    p.weekPts = (p.weekPts || 0) + delta;
    p.history.unshift({ ts: Date.now(), type: type, delta: delta, note: note || '' });
    p.history = p.history.slice(0, 30);
    saveProfile(p);
    renderMe();
  }

  var lastBoardMe = null; // 伺服器回來的本週排名/稱號

  function renderMe() {
    var p = loadProfile();
    var wk = weekKeyNow();
    el.meHandle.textContent = '匿名識別：牆友#' + getAnon().slice(-4).toUpperCase();
    el.meWeekLabel.textContent = '本週分數（' + wk + '）';
    el.mePts.textContent = String(lastBoardMe && lastBoardMe.allPts != null ? lastBoardMe.allPts : (p.allPts || 0));
    var weekPts = p.week === wk ? p.weekPts : 0;
    if (lastBoardMe && lastBoardMe.pts != null) weekPts = lastBoardMe.pts;
    el.meWeekPts.textContent = String(weekPts);
    var title = '初來報到', rankTxt = '尚未上榜';
    if (lastBoardMe) {
      title = lastBoardMe.title || title;
      rankTxt = lastBoardMe.rank ? ('本週第 ' + lastBoardMe.rank + ' 名') : '尚未上榜';
    }
    el.meTitle.textContent = title;
    el.meRank.textContent = lastBoardMe && lastBoardMe.rank ? ('第 ' + lastBoardMe.rank + ' 名') : '—';
    // 記錄列表
    el.meHistory.innerHTML = '';
    if (!p.history.length) { el.meEmpty.hidden = false; }
    else {
      el.meEmpty.hidden = true;
      p.history.slice(0, 10).forEach(function (h) {
        var li = document.createElement('li');
        li.className = 'fav-item';
        var label = { post: '發一篇貼文', enc: '鼓勵了別人', encRecv: '收到一句鼓勵' }[h.type] || h.type;
        var d = document.createElement('p');
        d.textContent = label + (h.note ? ' — ' + h.note : '');
        var pts = document.createElement('span');
        pts.className = 'fav-emotion';
        pts.textContent = (h.delta >= 0 ? '+' : '') + h.delta + ' 分';
        li.appendChild(d);
        li.appendChild(pts);
        el.meHistory.appendChild(li);
      });
    }
  }

  function fmtTime(ts) {
    try {
      var d = new Date(ts);
      return d.getMonth() + 1 + '/' + d.getDate() + ' ' + ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2);
    } catch (e) { return ''; }
  }

  function loadWallMine() {
    try {
      var arr = JSON.parse(localStorage.getItem(WALLMINE_KEY) || '[]');
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }

  function saveWallMine(arr) {
    try { localStorage.setItem(WALLMINE_KEY, JSON.stringify(arr.slice(0, 60))); } catch (e) { /* ignore */ }
  }

  function esc(s) { var d = document.createElement('div'); d.textContent = String(s == null ? '' : s); return d.innerHTML; }

  function topicOfEmotion(em) {
    var n = (em && em.name) || '';
    if (/工作|職場|主管|老闆|同事|加班/.test(n)) return 'work';
    if (/感情|分手|男友|女友|曖昧|戀愛/.test(n)) return 'love';
    if (/家庭|父母|爸|媽|家人/.test(n)) return 'family';
    if (/自我|價值|沒用|否定|自責/.test(n)) return 'self';
    if (/孤單|孤獨|沒人/.test(n)) return 'lonely';
    if (/憤怒|生氣|火大/.test(n)) return 'anger';
    if (/焦慮|緊張|害怕|恐懼/.test(n)) return 'anxiety';
    return 'other';
  }

  function wallItemHtml(item) {
    var encs = (item.encs || []).map(function (e) {
      return '<li class="enc-item"><span class="enc-handle">' + esc(e.handle) + '</span>：' + esc(e.text) +
        ' <span class="hint">+' + esc(e.score) + '分</span></li>';
    }).join('');
    var tag = item.topicName
      ? '<span class="topic-tag">' + esc(item.topicName) + '</span>'
      : '';
    var encCount = (item.encs || []).length
      ? '<span class="hint">' + (item.encs || []).length + ' 句鼓勵</span>'
      : '';
    return '' +
      '<div class="wall-meta">' + tag + encCount + '</div>' +
      '<p class="wall-text">' + esc(item.text) + '</p>' +
      '<div class="wall-ai">' +
        '<p><strong>承接：</strong>' + esc(item.accept) + '</p>' +
        '<p class="quote"><strong>好話：</strong>' + esc(item.goodword) + '</p>' +
        '<p><strong>小步：</strong>' + esc(item.smallstep) + '</p>' +
        '<span class="hint">由 ' + esc(item.engine === 'rules' ? '規則式引擎' : 'AI 模型 ' + (item.model || item.engine)) + ' 回應 · ' + fmtTime(item.createdAt) + '</span>' +
      '</div>' +
      (encs ? '<ul class="enc-list">' + encs + '</ul>' : '') +
      '<div class="enc-form">' +
        '<input class="enc-input" maxlength="120" placeholder="留一句鼓勵的話（送出前會先經 AI 审核）…" aria-label="鼓勵的話">' +
        '<button type="button" class="act enc-send" data-id="' + esc(item.id) + '">鼓勵她</button>' +
      '</div>';
  }

  var wallTopic = 'all';
  var lastWallData = null;

  function renderFilters(topics) {
    var list = [{ id: 'all', name: '全部' }].concat(topics || [
      { id: 'work', name: '工作' }, { id: 'love', name: '感情' }, { id: 'family', name: '家庭' },
      { id: 'self', name: '自我價值' }, { id: 'lonely', name: '孤單' }, { id: 'anger', name: '憤怒' },
      { id: 'anxiety', name: '焦慮' }, { id: 'other', name: '其他' },
    ]);
    el.wallFilters.innerHTML = '';
    list.forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'filter-chip' + (wallTopic === t.id ? ' is-on' : '');
      b.textContent = t.name;
      b.setAttribute('data-topic', t.id);
      el.wallFilters.appendChild(b);
    });
  }

  el.wallFilters.addEventListener('click', function (ev) {
    var b = ev.target.closest ? ev.target.closest('.filter-chip') : null;
    if (!b) return;
    wallTopic = b.getAttribute('data-topic') || 'all';
    renderFilters(lastWallData && lastWallData.topics);
    renderWall(lastWallData);
  });

  function renderWall(data) {
    lastWallData = data;
    var items = (data && data.items) || [];
    if (data && data.wallEnabled === false) {
      // 降級：只顯示本機牆
      var mine = loadWallMine();
      el.wallStatus.textContent = '雲端好話牆尚未啟用 —— 下面只顯示你這個瀏覽器裡自己掛過的分享（分數一樣會記在你的紀錄裡）。';
      items = mine;
    } else {
      el.wallStatus.textContent = '牆上共 ' + items.length + ' 篇（最新在前，保留最近 60 篇）。';
    }
    if (!data || data.wallEnabled !== false) renderFilters(data && data.topics);
    var shown = wallTopic === 'all' ? items : items.filter(function (it) { return (it.topic || 'other') === wallTopic; });
    el.wallList.innerHTML = '';
    el.wallEmpty.hidden = shown.length > 0;
    if (!shown.length && items.length) el.wallEmpty.textContent = '這個主題還沒有人分享。';
    else el.wallEmpty.textContent = '牆上還沒有東西。在上面寫下你的事，拿到回應後按「📌 匿名掛上好話牆」。';
    shown.forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'wall-item';
      li.innerHTML = wallItemHtml(item);
      el.wallList.appendChild(li);
    });
  }

  function loadWall() {
    fetch('/api/wall').then(function (r) { return r.json(); }).then(renderWall).catch(function () {
      renderWall({ wallEnabled: false, items: loadWallMine() });
    });
  }

  // 我的牆上貼文（含別人留的鼓勵）—— 有 KV 走 server 篩選，沒有就看本機鏡
  function loadMeWall() {
    fetch('/api/wall?mine=1&anon=' + encodeURIComponent(getAnon()))
      .then(function (r) { return r.json(); })
      .then(function (data) {
        var items = (data && data.items) || [];
        if (!data || data.wallEnabled === false) items = loadWallMine();
        renderMeWall(items);
      })
      .catch(function () { renderMeWall(loadWallMine()); });
  }

  function renderMeWall(items) {
    el.meWall.innerHTML = '';
    el.meWallEmpty.hidden = items.length > 0;
    items.slice(0, 10).forEach(function (item) {
      var li = document.createElement('li');
      li.className = 'wall-item';
      var encs = (item.encs || []);
      var encHtml = encs.length
        ? '<ul class="enc-list">' + encs.map(function (e) {
            return '<li class="enc-item"><span class="enc-handle">' + esc(e.handle) + '</span>：' + esc(e.text) + ' <span class="hint">+' + esc(e.score) + '分</span></li>';
          }).join('') + '</ul>'
        : '<p class="hint">還沒有人鼓勵這篇 —— 把它分享給朋友，或等牆上有緣人看到。</p>';
      li.innerHTML = '<div class="wall-meta">' +
        (item.topicName ? '<span class="topic-tag">' + esc(item.topicName) + '</span>' : '') +
        '<span class="hint">' + fmtTime(item.createdAt) + '</span></div>' +
        '<p class="wall-text">' + esc(item.text) + '</p>' +
        '<div class="wall-ai"><p class="quote"><strong>AI 的好話：</strong>' + esc(item.goodword) + '</p></div>' +
        encHtml;
      el.meWall.appendChild(li);
    });
  }

  function renderBoard(data) {
    var top = (data && data.top) || [];
    el.boardWeek.textContent = data && data.week ? ('第 ' + data.week + ' 週 · 每週一重新計 · 前 10 名有稱號') : '';
    el.boardList.innerHTML = '';
    el.boardEmpty.hidden = top.length > 0;
    top.forEach(function (t) {
      var li = document.createElement('li');
      li.className = 'board-item' + (data.me && t.handle === data.me.handle ? ' is-me' : '');
      var rank = document.createElement('span');
      rank.className = 'board-rank';
      rank.textContent = t.rank;
      var name = document.createElement('span');
      name.className = 'board-name';
      name.textContent = t.handle;
      var title = document.createElement('span');
      title.className = 'board-title';
      title.textContent = t.title;
      var pts = document.createElement('span');
      pts.className = 'board-pts';
      pts.textContent = t.pts + ' 分';
      li.appendChild(rank); li.appendChild(name); li.appendChild(title); li.appendChild(pts);
      el.boardList.appendChild(li);
    });
    if (data && data.me) lastBoardMe = data.me;
    renderMe();
  }

  function loadBoard() {
    fetch('/api/leaderboard?anon=' + encodeURIComponent(getAnon()))
      .then(function (r) { return r.json(); })
      .then(renderBoard)
      .catch(function () { renderBoard({ wallEnabled: false, top: [] }); });
  }

  function publish() {
    if (!current || published) return;
    if (!lastText) { toast('先送出一次對話，再掛牆'); return; }
    var btn = $('btn-publish');
    if (btn) btn.disabled = true;
    fetch('/api/wall', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        anon: getAnon(),
        text: lastText,
        topic: el.publishTopic ? el.publishTopic.value : 'other',
        ai: {
          accept: current.accept, goodword: current.goodword, smallstep: current.smallstep,
          engine: current.meta && current.meta.engine, model: current.meta && current.meta.model,
        },
      }),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        var j = res.j;
        if (j.crisis) { renderCrisis({ accept: j.accept, resources: j.resources }); return; }
        if (!j.ok) { toast(j.error || '掛牆失敗，請稍後再試'); if (btn) btn.disabled = false; return; }
        published = true;
        addProfileEvent('post', j.points || 0, (j.scoreWhy || []).join('、'));
        if (j.localOnly && j.item) {
          var mine = loadWallMine();
          mine.unshift(j.item);
          saveWallMine(mine);
        }
        toast('已匿名掛上好話牆 +' + (j.points || 0) + ' 分' + (j.scoreWhy && j.scoreWhy.length ? '（' + j.scoreWhy.join('、') + '）' : ''));
        loadWall();
        loadBoard();
        loadMeWall();
      })
      .catch(function () { toast('連線出了點問題，牆沒掛上'); if (btn) btn.disabled = false; });
  }

  function sendEncourage(itemId, inputEl, btnEl) {
    var text = inputEl.value.trim();
    if (!text) { toast('先寫一句鼓勵的話'); return; }
    btnEl.disabled = true;
    fetch('/api/encourage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ anon: getAnon(), itemId: itemId, text: text }),
    })
      .then(function (r) { return r.json().then(function (j) { return { status: r.status, j: j }; }); })
      .then(function (res) {
        var j = res.j;
        btnEl.disabled = false;
        if (j.crisis) { renderCrisis({ accept: j.accept, resources: j.resources }); return; }
        if (!j.ok) { toast(j.error || '鼓勵沒送出'); return; }
        inputEl.value = '';
        addProfileEvent('enc', j.delta || 0, (j.scoreWhy || []).join('、'));
        if (j.posterDelta) addProfileEvent('encRecv', j.posterDelta, '你的貼文收到鼓勵');
        toast('鼓勵已掛上 +' + (j.delta || 0) + ' 分' + (j.posterDelta ? '，對方也獲得 +' + j.posterDelta + ' 分' : ''));
        loadWall();
        loadBoard();
        loadMeWall();
      })
      .catch(function () { btnEl.disabled = false; toast('連線出了點問題'); });
  }

  // 牆上的鼓勵按鈕（事件委派）
  el.wallList.addEventListener('click', function (ev) {
    var btn = ev.target.closest ? ev.target.closest('.enc-send') : null;
    if (!btn) return;
    var form = btn.parentElement;
    var input = form ? form.querySelector('.enc-input') : null;
    if (input) sendEncourage(btn.getAttribute('data-id'), input, btn);
  });

  el.wallList.addEventListener('keydown', function (ev) {
    if (ev.key !== 'Enter') return;
    var input = ev.target.closest ? ev.target.closest('.enc-input') : null;
    if (!input) return;
    ev.preventDefault();
    var btn = input.parentElement ? input.parentElement.querySelector('.enc-send') : null;
    if (btn) sendEncourage(btn.getAttribute('data-id'), input, btn);
  });

  // ── 啟動 ──────────────────────────────────────────

  el.counter.textContent = '0 / ' + MAXLEN;
  renderFavs();
  refreshClearBtn();
  renderMe();
  loadWall();
  loadBoard();
  loadMeWall();

  // 顯示引擎狀態（讓評審看到 AI 真的在跑；不揭露任何個資）
  fetch('/api/health').then(function (r) { return r.json(); }).then(function (h) {
    var eng = (h.engines) || {};
    var o = eng.ollama;
    var n = eng.nvidia;
    if (o && o.alive) {
      el.input.setAttribute('placeholder',
        '把心裡的話寫下來，不用修飾。（本機 AI 已就緒：' + (o.model || '') + '）');
    } else if (n && n.enabled) {
      el.input.setAttribute('placeholder',
        '把心裡的話寫下來，不用修飾。（雲端 AI 已就緒：' + (n.model || 'NVIDIA NIM') + '）');
    }
  }).catch(function () { /* 不重要，失敗就算了 */ });
})();
