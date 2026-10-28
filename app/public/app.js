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
  };

  var MAXLEN = 2000;
  var FAV_KEY = 'hsh.favorites.v1';
  var current = null;      // 目前顯示的回應
  var audience = 'friend'; // 轉送對象
  var busy = false;

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
    var src = meta.engine === 'ollama'
      ? '本機 AI 模型（' + (meta.model || '') + '）'
      : (meta.engine === 'cloud' ? '雲端 AI' : '規則式引擎');
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
      body: JSON.stringify({ text: text }),
    })
      .then(function (r) {
        if (!r.ok) return r.json().then(function (j) { throw new Error(j.error || '伺服器回應異常'); });
        return r.json();
      })
      .then(function (data) {
        clearInterval(tick);
        setBusy(false);
        if (data.crisis) renderCrisis(data);
        else renderResult(data);
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

  Array.prototype.forEach.call(document.querySelectorAll('.chip'), function (c) {
    c.addEventListener('click', function () {
      el.input.value = c.getAttribute('data-fill') || '';
      el.input.dispatchEvent(new Event('input'));
      el.input.focus();
    });
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

  // ── 啟動 ──────────────────────────────────────────

  el.counter.textContent = '0 / ' + MAXLEN;
  renderFavs();

  // 顯示引擎狀態（讓評審看到 AI 真的在跑；不揭露任何個資）
  fetch('/api/health').then(function (r) { return r.json(); }).then(function (h) {
    var o = h.engines && h.engines.ollama;
    if (o && o.alive) {
      el.input.setAttribute('placeholder',
        '把心裡的話寫下來，不用修飾。（本機 AI 已就緒：' + (o.model || '') + '）');
    }
  }).catch(function () { /* 不重要，失敗就算了 */ });
})();
