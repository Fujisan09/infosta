/*
  理事のページ（試作）
  - ID・パスワードの確認（ブラウザの中だけで計算する簡易な入口。中身を守る仕組みではありません）
  - ホーム：目標と進み具合（KPI・成長戦略）、ニュースと議論の場への入口
  - ニュース：事業ごとのゾーンに分けて表示
  - 議論の場：議題ごとのスペースと、よく出ている言葉の強弱（ワードマップ）
  - 書き込みと追加した議題は、この端末のブラウザの中（localStorage）だけに保存します
  文言・見本データは content/board.json に書いてください（このファイルには書きません）。
*/
(function () {
  'use strict';

  var dataEl = document.getElementById('board-data');
  if (!dataEl) return;
  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  var T = data.texts;
  var WM = window.InfostaWordmap;
  var doc = document.documentElement;

  /* ───── 保存（使えない環境でも画面は動かす） ───── */
  var memory = {};
  var store = {
    get: function (area, key) {
      try { return window[area].getItem(key); } catch (e) { return Object.prototype.hasOwnProperty.call(memory, area + key) ? memory[area + key] : null; }
    },
    set: function (area, key, value) {
      try { window[area].setItem(key, value); } catch (e) { memory[area + key] = value; }
    },
    remove: function (area, key) {
      try { window[area].removeItem(key); } catch (e) { /* 何もしない */ }
      delete memory[area + key];
    }
  };
  var SESSION_KEY = 'infosta-board-session';
  var LOCAL_KEY = 'infosta-board-local-v1';
  var NAME_KEY = 'infosta-board-name';

  /* ───── SHA-256（scripts/set-board-login.mjs と同じ計算） ───── */
  var K = [];
  var H0 = [];
  (function () {
    var primes = [];
    for (var n = 2; primes.length < 64; n += 1) {
      var prime = true;
      for (var i = 0; i < primes.length && primes[i] * primes[i] <= n; i += 1) if (n % primes[i] === 0) { prime = false; break; }
      if (prime) primes.push(n);
    }
    var frac = function (x) { return ((x - Math.floor(x)) * 4294967296) | 0; };
    for (var j = 0; j < 64; j += 1) K.push(frac(Math.pow(primes[j], 1 / 3)));
    for (var k = 0; k < 8; k += 1) H0.push(frac(Math.sqrt(primes[k])));
  })();

  function utf8(text) {
    if (typeof TextEncoder === 'function') return new TextEncoder().encode(text);
    var bin = unescape(encodeURIComponent(text));
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
    return out;
  }

  function sha256hex(text) {
    var bytes = utf8(text);
    var length = bytes.length;
    var total = ((length + 9 + 63) >> 6) << 6;
    var buf = new Uint8Array(total);
    buf.set(bytes);
    buf[length] = 0x80;
    var bits = length * 8;
    var hi = Math.floor(bits / 4294967296);
    var lo = bits >>> 0;
    buf[total - 8] = (hi >>> 24) & 255; buf[total - 7] = (hi >>> 16) & 255; buf[total - 6] = (hi >>> 8) & 255; buf[total - 5] = hi & 255;
    buf[total - 4] = (lo >>> 24) & 255; buf[total - 3] = (lo >>> 16) & 255; buf[total - 2] = (lo >>> 8) & 255; buf[total - 1] = lo & 255;
    var H = H0.slice();
    var W = new Array(64);
    for (var off = 0; off < total; off += 64) {
      var i;
      for (i = 0; i < 16; i += 1) W[i] = (buf[off + 4 * i] << 24) | (buf[off + 4 * i + 1] << 16) | (buf[off + 4 * i + 2] << 8) | buf[off + 4 * i + 3];
      for (i = 16; i < 64; i += 1) {
        var a15 = W[i - 15];
        var a2 = W[i - 2];
        var s0 = ((a15 >>> 7) | (a15 << 25)) ^ ((a15 >>> 18) | (a15 << 14)) ^ (a15 >>> 3);
        var s1 = ((a2 >>> 17) | (a2 << 15)) ^ ((a2 >>> 19) | (a2 << 13)) ^ (a2 >>> 10);
        W[i] = (W[i - 16] + s0 + W[i - 7] + s1) | 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (i = 0; i < 64; i += 1) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + W[i]) | 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
  }

  function loginHash(id, password) {
    var L = data.login;
    var hash = sha256hex(L.salt + '\n' + id + '\n' + password);
    for (var i = 1; i < L.iterations; i += 1) hash = sha256hex(hash + L.salt);
    return hash;
  }

  /* ───── 時刻 ───── */
  var NOW = Date.now();
  var DAY = 86400000;
  function atOf(daysAgo, time) {
    var d = new Date(NOW - (daysAgo || 0) * DAY);
    if (time && /^\d{1,2}:\d{2}$/.test(time)) {
      var parts = time.split(':');
      d.setHours(Number(parts[0]), Number(parts[1]), 0, 0);
    }
    var t = d.getTime();
    // 見本の時刻が「いま」より後になるときは、少し前にずらす
    return t > NOW ? NOW - 20 * 60000 : t;
  }
  var fill = function (template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, function (m, key) { return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m; });
  };
  function relTime(at) {
    var diff = Math.max(0, Date.now() - at);
    var min = Math.floor(diff / 60000);
    if (min < 1) return T.time.now;
    if (min < 60) return fill(T.time.minutes, { n: min });
    var hours = Math.floor(min / 60);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    if (at >= today.getTime()) return fill(T.time.hours, { n: hours });
    var days = Math.ceil((today.getTime() - at) / DAY);
    if (days <= 1) return T.time.yesterday;
    return fill(T.time.days, { n: days });
  }
  function dateText(at) {
    var d = new Date(at);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }
  function isoDate(at) {
    var d = new Date(at);
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
  }

  /* ───── 画面の部品を作る（書き込みの文字は必ず textContent で入れる） ───── */
  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        var value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'style') node.setAttribute('style', value);
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    (children || []).forEach(function (child) {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }
  function q(selector, root) { return (root || document).querySelector(selector); }

  /* ───── データ（見本＋この端末の書き込み） ───── */
  var local = { posts: {}, spaces: [] };
  try {
    var saved = JSON.parse(store.get('localStorage', LOCAL_KEY) || 'null');
    if (saved && typeof saved === 'object') {
      local.posts = saved.posts && typeof saved.posts === 'object' ? saved.posts : {};
      local.spaces = Array.isArray(saved.spaces) ? saved.spaces : [];
    }
  } catch (e) { /* 壊れた保存は使わない */ }
  function saveLocal() { store.set('localStorage', LOCAL_KEY, JSON.stringify(local)); }

  var sampleSpaces = (data.spaces || []).map(function (s) {
    return {
      id: s.id,
      title: s.title,
      purpose: s.purpose,
      summary: s.summary,
      sample: Boolean(s.sample),
      basePosts: (s.posts || []).map(function (p, i) {
        return { id: s.id + '-' + i, author: p.author, text: p.text, at: atOf(p.daysAgo, p.time), sample: true };
      })
    };
  });
  function allSpaces() {
    var list = sampleSpaces.concat(local.spaces.map(function (s) {
      return { id: s.id, title: s.title, purpose: s.purpose, summary: null, sample: false, basePosts: [], local: true, createdAt: s.createdAt };
    }));
    return list.map(function (s) {
      var posts = s.basePosts.concat(local.posts[s.id] || []).slice().sort(function (a, b) { return a.at - b.at; });
      var weekAgo = Date.now() - 7 * DAY;
      var week = posts.filter(function (p) { return p.at >= weekAgo; }).length;
      var last = posts.length ? posts[posts.length - 1].at : (s.createdAt || 0);
      return { id: s.id, title: s.title, purpose: s.purpose, summary: s.summary, sample: s.sample, local: s.local, posts: posts, week: week, last: last };
    });
  }
  function hotSpaces() {
    return allSpaces().sort(function (a, b) { return b.week - a.week || b.last - a.last; });
  }
  var WM_OPTIONS = function (extra) {
    var o = data.wordmap || {};
    var out = { glossary: o.glossary || [], stopwords: o.stopwords || [], halfLifeDays: o.halfLifeDays || 7, maxWords: o.maxWords || 24, now: Date.now() };
    Object.keys(extra || {}).forEach(function (k) { out[k] = extra[k]; });
    return out;
  };

  var zones = data.zones || [];
  var zoneById = {};
  zones.forEach(function (z) { zoneById[z.id] = z; });
  var news = (data.news || []).map(function (n) {
    return { id: n.id, zone: n.zone, type: n.type, title: n.title, body: n.body || [], sample: Boolean(n.sample), at: atOf(n.daysAgo, n.time || '09:00') };
  }).sort(function (a, b) { return b.at - a.at; });

  /* ───── 要素 ───── */
  var views = { login: q('[data-view="login"]'), app: q('[data-view="app"]') };
  var panels = {};
  ['home', 'news', 'talk', 'space'].forEach(function (k) { panels[k] = q('[data-panel="' + k + '"]'); });
  var logoutButton = q('[data-logout]');
  var statusEl = q('[data-board-status]');
  var form = q('[data-login-form]');
  var idInput = q('#board-id');
  var passInput = q('#board-pass');
  var errorEl = q('[data-login-error]');
  var submitButton = q('[data-login-submit]');
  var tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
  var baseTitle = document.title;
  var loggedIn = false;
  var failures = 0;

  function announce(text) {
    statusEl.textContent = '';
    window.setTimeout(function () { statusEl.textContent = text; }, 30);
  }

  /* ───── ログイン ───── */
  function enterApp() {
    loggedIn = true;
    doc.classList.remove('board-resume');
    views.login.hidden = true;
    views.app.hidden = false;
    logoutButton.hidden = false;
    route({ initial: true });
  }
  function showLogin() {
    loggedIn = false;
    doc.classList.remove('board-resume');
    views.app.hidden = true;
    views.login.hidden = false;
    logoutButton.hidden = true;
    document.title = baseTitle;
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var id = idInput.value.trim();
    var password = passInput.value;
    errorEl.textContent = '';
    if (!id || !password) {
      errorEl.textContent = T.loginEmpty;
      (id ? passInput : idInput).focus();
      return;
    }
    submitButton.disabled = true;
    submitButton.textContent = T.checking;
    var wait = failures >= 5 ? 1500 : 30;
    window.setTimeout(function () {
      var ok = Boolean(data.login && data.login.hash) && id === data.login.id && loginHash(id, password) === data.login.hash;
      submitButton.disabled = false;
      submitButton.textContent = T.submit;
      if (!ok) {
        failures += 1;
        errorEl.textContent = T.loginError;
        passInput.focus();
        passInput.select();
        return;
      }
      failures = 0;
      store.set('sessionStorage', SESSION_KEY, data.login.hash);
      passInput.value = '';
      if (!/^#(home|news|talk)/.test(location.hash)) {
        try { history.replaceState(null, '', '#home'); } catch (e) { location.hash = '#home'; }
      }
      enterApp();
      var heading = q('.board-panel:not([hidden]) h1');
      if (heading) heading.focus();
    }, wait);
  });

  logoutButton.addEventListener('click', function () {
    store.remove('sessionStorage', SESSION_KEY);
    try { history.replaceState(null, '', location.pathname + location.search); } catch (e) { /* 何もしない */ }
    showLogin();
    form.reset();
    idInput.focus();
  });

  /* ───── 画面の切り替え ───── */
  function parseRoute() {
    var hash = decodeURIComponent(location.hash.replace(/^#/, ''));
    var parts = hash.split('/');
    var name = parts[0];
    if (name === 'news') return { panel: 'news', zone: zoneById[parts[1]] ? parts[1] : null };
    if (name === 'talk' && parts[1]) return { panel: 'space', space: parts[1] };
    if (name === 'talk') return { panel: 'talk' };
    return { panel: 'home' };
  }

  var lastPanel = null;
  function route(options) {
    options = options || {};
    if (!loggedIn) return;
    var r = parseRoute();
    var space = null;
    if (r.panel === 'space') {
      space = allSpaces().filter(function (s) { return s.id === r.space; })[0];
      if (!space) r = { panel: 'talk' };
    }
    Object.keys(panels).forEach(function (k) { panels[k].hidden = k !== r.panel; });
    var tabName = r.panel === 'space' ? 'talk' : r.panel;
    tabs.forEach(function (tab) {
      if (tab.dataset.tab === tabName) tab.setAttribute('aria-current', 'page');
      else tab.removeAttribute('aria-current');
    });
    var title = T.tabs.home;
    if (r.panel === 'home') renderHome();
    if (r.panel === 'news') { renderNews(r.zone); title = r.zone ? zoneById[r.zone].label + '｜' + T.newsTitle : T.newsTitle; }
    if (r.panel === 'talk') { renderTalk(); title = T.talkTitle; }
    if (r.panel === 'space') { renderSpace(space); title = space.title + '｜' + T.talkTitle; }
    document.title = (r.panel === 'home' ? '' : title + '｜') + baseTitle;
    var key = r.panel + (r.zone || '') + (r.space || '');
    if (!options.initial && !options.keepFocus && key !== lastPanel) {
      window.scrollTo(0, 0);
      var heading = q('.board-panel:not([hidden]) h1');
      if (heading) heading.focus({ preventScroll: true });
    }
    lastPanel = key;
  }
  window.addEventListener('hashchange', function () { route(); });

  /* ───── ワードマップ ───── */
  function wordmapNode(rows, options) {
    options = options || {};
    if (!rows.length) return el('p', { class: 'wordmap-empty', text: T.wordsEmpty });
    var order = WM.centerOrder(rows.length);
    var list = el('ul', { class: 'wordmap' + (options.compact ? ' wordmap--compact' : ''), 'aria-label': options.label || T.wordsTitle });
    rows.forEach(function (row, i) {
      var tier = row.rank <= 3 ? 'top' : row.rank <= 8 ? 'mid' : 'low';
      var style = 'order:' + order[i] + ';--level:' + row.level.toFixed(3);
      var hidden = el('span', { class: 'visually-hidden', text: '（' + row.posts + '件の書き込み）' });
      var inner;
      if (options.onPick) {
        inner = el('button', {
          type: 'button',
          class: 'word word--' + tier + (options.fresh && options.fresh[row.word] ? ' is-new' : ''),
          'data-word': row.word,
          'aria-pressed': String(options.selected === row.word),
          onclick: function () { options.onPick(row.word); }
        }, [row.word, hidden]);
      } else {
        inner = el('span', { class: 'word word--' + tier }, [row.word, hidden]);
      }
      list.appendChild(el('li', { style: style }, [inner]));
    });
    return list;
  }

  /* ───── ホーム ───── */
  function growthNode() {
    var g = data.growth;
    if (!g) return null;
    var hasAll = [g.current, g.projected, g.target].every(function (x) { return x && typeof x.value === 'number'; });
    var figure = function (key, item, extra) {
      var value = item && typeof item.value === 'number' ? String(item.value) : T.unitMissing;
      return el('div', { class: 'growth-figure growth-figure--' + key }, [
        el('dt', { text: item.label }),
        el('dd', null, [
          el('span', { class: 'growth-value', text: value }),
          el('span', { class: 'growth-unit', text: g.unit }),
          extra || null
        ])
      ]);
    };
    var year = g.target && g.target.year ? el('span', { class: 'growth-year', text: '（' + g.target.year + '年度）' }) : el('span', { class: 'growth-year', text: '（' + T.unitMissing + '年度）' });
    // 道のり：目標を右端として、いま・見込みの位置を置く（数字がないときは目安の位置）
    var pos = { current: 8, projected: 38 };
    if (hasAll && g.target.value > 0) {
      pos.current = Math.max(2, Math.min(98, (g.current.value / g.target.value) * 100));
      pos.projected = Math.max(pos.current, Math.min(98, (g.projected.value / g.target.value) * 100));
    }
    var track = el('div', { class: 'growth-track' + (hasAll ? '' : ' is-pending'), 'aria-hidden': 'true' }, [
      el('span', { class: 'track-line' }),
      el('span', { class: 'track-done', style: 'width:' + pos.current + '%' }),
      el('span', { class: 'track-plan', style: 'left:' + pos.current + '%;width:' + (pos.projected - pos.current) + '%' }),
      el('span', { class: 'track-point track-point--current', style: 'left:' + pos.current + '%' }, [el('span', { class: 'track-label', text: g.current.label })]),
      el('span', { class: 'track-point track-point--projected', style: 'left:' + pos.projected + '%' }, [el('span', { class: 'track-label', text: '見込み' })]),
      el('span', { class: 'track-point track-point--target', style: 'left:100%' }, [el('span', { class: 'track-label', text: g.target.label })])
    ]);
    var how = el('dl', { class: 'strategy-how' }, (g.how || []).map(function (h) {
      return el('div', null, [el('dt', { text: h.label }), el('dd', { text: h.text })]);
    }));
    return el('section', { class: 'growth', 'aria-labelledby': 'growth-title' }, [
      el('div', { class: 'growth-main' }, [
        el('h2', { id: 'growth-title', text: T.growthTitle }),
        el('p', { class: 'growth-metric', text: g.metric }),
        el('dl', { class: 'growth-figures' }, [figure('current', g.current), figure('projected', g.projected), figure('target', g.target, year)]),
        track,
        hasAll ? null : el('p', { class: 'growth-pending', text: T.growthPending })
      ]),
      el('div', { class: 'strategy' }, [
        el('h3', { text: T.strategyTitle }),
        el('p', { class: 'strategy-direction' }, [el('span', { class: 'strategy-label', text: T.directionLabel }), el('span', { text: g.direction })]),
        how
      ])
    ]);
  }

  /* ───── 伝えるときの材料（理事それぞれが、自分の言葉を足して伝えるために） ───── */
  function fallbackCopy(text) {
    var area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    document.body.appendChild(area);
    area.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(text); });
    }
    return Promise.resolve(fallbackCopy(text));
  }
  function shareKitNode() {
    var k = data.shareKit;
    if (!k || !(k.items || []).length) return null;
    var list = el('ul', { class: 'kit-list' }, k.items.map(function (item, i) {
      var statusId = 'kit-status-' + i;
      var status = el('p', { class: 'kit-status', id: statusId, role: 'status' });
      var button = el('button', {
        type: 'button',
        class: 'copy-btn',
        'aria-label': item.label + 'を' + (k.copy || 'コピー'),
        'aria-describedby': statusId,
        text: k.copy || 'コピー',
        onclick: function () {
          copyText(item.text).then(function (ok) { status.textContent = ok ? k.copied : k.copyFailed; });
        }
      });
      return el('li', { class: 'kit-item' }, [
        el('div', { class: 'kit-head' }, [el('p', { class: 'kit-label', text: item.label }), button]),
        el('p', { class: 'kit-text', text: item.text }),
        item.note ? el('p', { class: 'kit-note', text: item.note }) : null,
        status
      ]);
    }));
    return el('section', { class: 'kit', 'aria-labelledby': 'kit-title' }, [
      el('div', { class: 'kit-intro' }, [el('h2', { id: 'kit-title', text: k.title }), el('p', { text: k.lead })]),
      list
    ]);
  }

  function zoneCounts() {
    var counts = {};
    news.forEach(function (n) { counts[n.zone] = (counts[n.zone] || 0) + 1; });
    return counts;
  }

  function renderHome() {
    var p = panels.home;
    p.textContent = '';
    p.appendChild(el('header', { class: 'panel-head' }, [
      el('h1', { id: 'home-title', tabindex: '-1', text: T.title }),
      el('p', { text: T.welcome })
    ]));
    var growth = growthNode();
    if (growth) p.appendChild(growth);
    var kit = shareKitNode();
    if (kit) p.appendChild(kit);

    var counts = zoneCounts();
    var tiles = el('ul', { class: 'zone-tiles' }, zones.map(function (z) {
      var latest = news.filter(function (n) { return n.zone === z.id; })[0];
      return el('li', null, [el('a', { class: 'zone-tile tone-' + (z.tone || 'slate'), href: '#news/' + z.id }, [
        el('span', { class: 'zone-tile-head' }, [el('span', { class: 'zone-tile-label', text: z.label }), el('span', { class: 'zone-tile-count', text: (counts[z.id] || 0) + '件' })]),
        el('span', { class: 'zone-tile-latest', text: latest ? latest.title : T.zoneEmpty })
      ])]);
    }));
    var newsCard = el('section', { class: 'home-card', 'aria-labelledby': 'home-news-title' }, [
      el('h2', { id: 'home-news-title', text: T.newsTitle }),
      el('p', { class: 'home-card-lead', text: T.newsLead }),
      tiles,
      el('p', { class: 'home-card-action' }, [el('a', { class: 'btn btn--secondary', href: '#news', text: T.newsMore })])
    ]);

    var spaces = hotSpaces();
    var allPosts = [];
    spaces.forEach(function (s) { allPosts = allPosts.concat(s.posts); });
    var rows = WM.compute(allPosts, WM_OPTIONS({ maxWords: 12 }));
    // 今週書き込みのあった議題を、多い順に5つまで（少ないときは、書き込みのない議題も含めて3つ）
    var active = spaces.filter(function (s) { return s.week > 0; });
    var shown = (active.length >= 3 ? active : spaces).slice(0, 5);
    var hot = el('ul', { class: 'hot-spaces' }, shown.map(function (s) {
      return el('li', null, [
        el('a', { href: '#talk/' + encodeURIComponent(s.id), text: s.title }),
        el('span', { class: 'hot-count', text: fill(T.weekCount, { count: s.week }) })
      ]);
    }));
    var talkCard = el('section', { class: 'home-card', 'aria-labelledby': 'home-talk-title' }, [
      el('h2', { id: 'home-talk-title', text: T.talkTitle }),
      el('p', { class: 'home-card-lead', text: T.hotWordsNote }),
      wordmapNode(rows, { compact: true, label: T.hotWordsTitle }),
      hot,
      el('p', { class: 'home-card-action' }, [el('a', { class: 'btn btn--secondary', href: '#talk', text: T.talkMore })])
    ]);
    p.appendChild(el('div', { class: 'home-grid' }, [newsCard, talkCard]));
  }

  /* ───── ニュース（ゾーンごと） ───── */
  function newsItem(n, full) {
    var meta = el('p', { class: 'news-meta' }, [
      el('time', { datetime: isoDate(n.at), text: dateText(n.at) }),
      T.types[n.type] ? el('span', { class: 'type-tag', text: T.types[n.type] }) : null,
      n.sample ? el('span', { class: 'sample-tag', text: T.sampleTag }) : null
    ]);
    var paragraphs = full ? n.body : n.body.slice(0, 1);
    var body = el('div', { class: 'news-body' + (full ? '' : ' is-clamped') }, paragraphs.map(function (t) { return el('p', { text: t }); }));
    return el('li', null, [el('article', { class: 'news-item' }, [meta, el('h3', { text: n.title }), body])]);
  }

  function renderNews(zoneId) {
    var p = panels.news;
    p.textContent = '';
    p.appendChild(el('header', { class: 'panel-head' }, [
      el('h1', { id: 'news-title', tabindex: '-1', text: T.newsTitle }),
      el('p', { text: T.newsLead })
    ]));
    var switcher = el('nav', { class: 'zone-switch', 'aria-label': 'ゾーン' }, [el('ul', null, [{ id: null, label: T.zoneAll }].concat(zones).map(function (z) {
      var current = (z.id || null) === (zoneId || null);
      return el('li', null, [el('a', {
        href: z.id ? '#news/' + z.id : '#news',
        class: 'zone-switch-link' + (z.tone ? ' tone-' + z.tone : ''),
        'aria-current': current ? 'page' : null
      }, [z.label])]);
    }))]);
    p.appendChild(switcher);
    var counts = zoneCounts();
    if (zoneId) {
      var z = zoneById[zoneId];
      var items = news.filter(function (n) { return n.zone === zoneId; });
      p.appendChild(el('section', { class: 'zone zone--single tone-' + (z.tone || 'slate'), 'aria-labelledby': 'zone-' + z.id }, [
        el('header', { class: 'zone-head' }, [el('h2', { id: 'zone-' + z.id, text: z.label }), el('p', { text: z.text })]),
        items.length ? el('ul', { class: 'news-list' }, items.map(function (n) { return newsItem(n, true); })) : el('p', { class: 'zone-empty', text: T.zoneEmpty }),
        el('p', { class: 'zone-more' }, [el('a', { href: '#news', text: T.zoneBack })])
      ]));
      return;
    }
    var board = el('div', { class: 'zone-board' }, zones.map(function (z, i) {
      var items = news.filter(function (n) { return n.zone === z.id; });
      return el('section', { class: 'zone tone-' + (z.tone || 'slate') + (i === 0 ? ' zone--wide' : ''), 'aria-labelledby': 'zone-' + z.id }, [
        el('header', { class: 'zone-head' }, [el('h2', { id: 'zone-' + z.id, text: z.label }), el('p', { text: z.text })]),
        items.length ? el('ul', { class: 'news-list' }, items.slice(0, 3).map(function (n) { return newsItem(n, false); })) : el('p', { class: 'zone-empty', text: T.zoneEmpty }),
        el('p', { class: 'zone-more' }, [el('a', { href: '#news/' + z.id, text: fill(T.zoneMore, { zone: z.label, count: counts[z.id] || 0 }) })])
      ]);
    }));
    p.appendChild(board);
  }

  /* ───── 議論の場 ───── */
  function heatNode(week, max) {
    var filled = week > 0 ? Math.max(1, Math.round((week / Math.max(1, max)) * 5)) : 0;
    var dots = [];
    for (var i = 0; i < 5; i += 1) dots.push(el('span', { class: 'heat-dot' + (i < filled ? ' is-on' : '') }));
    return el('span', { class: 'heat', 'aria-hidden': 'true' }, dots);
  }

  var addOpen = false;
  var resetArmed = false;
  function renderTalk() {
    var p = panels.talk;
    p.textContent = '';
    p.appendChild(el('header', { class: 'panel-head' }, [
      el('h1', { id: 'talk-title', tabindex: '-1', text: T.talkTitle }),
      el('p', { text: T.talkLead })
    ]));
    var spaces = hotSpaces();
    var allPosts = [];
    spaces.forEach(function (s) { allPosts = allPosts.concat(s.posts); });
    p.appendChild(el('section', { class: 'hot-words', 'aria-labelledby': 'hot-words-title' }, [
      el('h2', { id: 'hot-words-title', text: T.hotWordsTitle }),
      el('p', { class: 'note', text: T.hotWordsNote }),
      wordmapNode(WM.compute(allPosts, WM_OPTIONS({ maxWords: 26 })), { label: T.hotWordsTitle })
    ]));
    var max = spaces.reduce(function (m, s) { return Math.max(m, s.week); }, 0);
    var list = el('ul', { class: 'space-list' }, spaces.map(function (s) {
      var words = WM.compute(s.posts, WM_OPTIONS({ maxWords: 5 }));
      return el('li', null, [el('a', { class: 'space-card', href: '#talk/' + encodeURIComponent(s.id) }, [
        el('span', { class: 'space-card-head' }, [
          el('span', { class: 'space-card-title', text: s.title }),
          s.sample ? el('span', { class: 'sample-tag', text: T.sampleTag }) : null
        ]),
        s.purpose ? el('span', { class: 'space-card-purpose', text: s.purpose }) : null,
        el('span', { class: 'space-card-heat' }, [
          heatNode(s.week, max),
          el('span', { class: 'heat-count', text: fill(T.weekCount, { count: s.week }) }),
          el('span', { class: 'heat-last', text: s.posts.length ? fill(T.lastPost, { when: relTime(s.last) }) : T.noPosts })
        ]),
        words.length ? el('span', { class: 'space-card-words' }, words.map(function (w) { return el('span', { class: 'mini-word', text: w.word }); })) : null
      ])]);
    }));
    var addForm = el('form', { class: 'add-space', 'data-add-space': true, novalidate: true, hidden: !addOpen }, [
      el('div', { class: 'field' }, [el('label', { for: 'space-title-input', text: T.addSpaceTitle }), el('input', { id: 'space-title-input', type: 'text', maxlength: '40', required: true })]),
      el('div', { class: 'field' }, [el('label', { for: 'space-purpose-input', text: T.addSpacePurpose }), el('input', { id: 'space-purpose-input', type: 'text', maxlength: '80' })]),
      el('p', { class: 'form-error', role: 'alert' }),
      el('div', { class: 'form-actions' }, [
        el('button', { type: 'submit', class: 'btn btn--primary', text: T.addSpaceSubmit }),
        el('button', { type: 'button', class: 'btn btn--quiet', text: T.addSpaceCancel, onclick: function () { addOpen = false; renderTalk(); q('[data-add-toggle]').focus(); } })
      ])
    ]);
    addForm.addEventListener('submit', function (event) {
      event.preventDefault();
      var title = q('#space-title-input').value.trim();
      var purpose = q('#space-purpose-input').value.trim();
      if (!title) { q('.form-error', addForm).textContent = T.addSpaceTitle + 'を入れてください。'; q('#space-title-input').focus(); return; }
      var id = 'local-' + Date.now().toString(36);
      local.spaces.push({ id: id, title: title, purpose: purpose, createdAt: Date.now() });
      saveLocal();
      addOpen = false;
      announce(fill(T.addSpaceDone, { title: title }));
      location.hash = '#talk/' + id;
    });
    p.appendChild(el('section', { class: 'spaces', 'aria-labelledby': 'spaces-title' }, [
      el('div', { class: 'spaces-head' }, [
        el('h2', { id: 'spaces-title', text: T.spacesTitle }),
        el('button', { type: 'button', class: 'btn btn--quiet', 'data-add-toggle': true, 'aria-expanded': String(addOpen), text: T.addSpace, onclick: function () {
          addOpen = !addOpen;
          renderTalk();
          if (addOpen) q('#space-title-input').focus();
        } })
      ]),
      addForm,
      list
    ]));
    var reset = el('button', { type: 'button', class: 'btn btn--quiet', 'data-reset-local': true, text: resetArmed ? 'もう一度押すと消えます' : T.resetLocal, onclick: function () {
      if (!resetArmed) { resetArmed = true; renderTalk(); q('[data-reset-local]').focus(); return; }
      resetArmed = false;
      local = { posts: {}, spaces: [] };
      store.remove('localStorage', LOCAL_KEY);
      renderTalk();
      q('[data-reset-local]').focus();
      announce(T.resetDone);
    } });
    p.appendChild(el('div', { class: 'local-note' }, [el('p', { text: T.localNote }), reset]));
  }

  /* ───── 議題のスペース ───── */
  var spaceState = { id: null, mode: 'recent', word: null, fresh: {}, freshPost: null };

  function highlight(text, word) {
    var node = el('p', { class: 'post-text' });
    if (!word) { node.textContent = text; return node; }
    var source = text.normalize ? text.normalize('NFKC') : text;
    var parts = source.split(word);
    parts.forEach(function (part, i) {
      if (part) node.appendChild(document.createTextNode(part));
      if (i < parts.length - 1) node.appendChild(el('mark', { text: word }));
    });
    return node;
  }

  function renderSpace(space, options) {
    options = options || {};
    var p = panels.space;
    if (spaceState.id !== space.id) spaceState = { id: space.id, mode: 'recent', word: null, fresh: {}, freshPost: null };
    var rows = WM.compute(space.posts, WM_OPTIONS({ mode: spaceState.mode }));
    if (spaceState.word && !rows.some(function (r) { return r.word === spaceState.word; })) spaceState.word = null;
    var matches = space.posts.filter(function (post) {
      if (!spaceState.word) return true;
      return WM.wordsOf(post.text, WM_OPTIONS()).indexOf(spaceState.word) !== -1;
    });
    p.textContent = '';
    p.appendChild(el('p', { class: 'back-link' }, [el('a', { href: '#talk', text: T.backToTalk })]));
    p.appendChild(el('header', { class: 'panel-head' }, [
      el('h1', { id: 'space-title', tabindex: '-1', text: space.title }),
      space.purpose || space.sample ? el('p', null, [space.sample ? el('span', { class: 'sample-tag', text: T.sampleTag }) : null, space.sample && space.purpose ? ' ' : null, space.purpose || null]) : null
    ]));

    var modeButton = function (mode, label) {
      return el('button', { type: 'button', class: 'seg-button', 'aria-pressed': String(spaceState.mode === mode), 'data-mode': mode, text: label, onclick: function () {
        spaceState.mode = mode;
        spaceState.fresh = {};
        renderSpace(space, { focus: '[data-mode="' + mode + '"]' });
      } });
    };
    var side = el('div', { class: 'space-side' }, [
      space.summary ? el('section', { class: 'summary', 'aria-labelledby': 'summary-title' }, [el('h2', { id: 'summary-title', text: T.summaryTitle }), el('p', { text: space.summary })]) : null,
      el('section', { class: 'words', 'aria-labelledby': 'words-title' }, [
        el('div', { class: 'words-head' }, [
          el('h2', { id: 'words-title', text: T.wordsTitle }),
          el('div', { class: 'seg', role: 'group', 'aria-label': '数える期間' }, [modeButton('recent', T.wordsRecent), modeButton('all', T.wordsAll)])
        ]),
        rows.length ? el('p', { class: 'note', text: T.wordsHint }) : null,
        wordmapNode(rows, {
          label: T.wordsTitle,
          selected: spaceState.word,
          fresh: spaceState.fresh,
          onPick: function (word) {
            spaceState.word = spaceState.word === word ? null : word;
            spaceState.fresh = {};
            renderSpace(space, { focus: '.word[data-word="' + word.replace(/"/g, '') + '"]' });
          }
        })
      ])
    ]);

    var list = el('ol', { class: 'post-list' }, matches.map(function (post) {
      return el('li', { class: 'post' + (spaceState.freshPost === post.id ? ' is-new' : ''), id: 'post-' + post.id }, [
        el('p', { class: 'post-meta' }, [
          el('span', { class: 'post-author', text: post.author || T.you }),
          el('time', { datetime: new Date(post.at).toISOString(), text: relTime(post.at) })
        ]),
        highlight(post.text, spaceState.word)
      ]);
    }));
    var filterState = spaceState.word
      ? el('p', { class: 'filter-state' }, [
        el('span', { text: fill(T.filterOn, { word: spaceState.word, count: matches.length }) }),
        el('button', { type: 'button', class: 'btn btn--quiet', 'data-filter-clear': true, text: T.filterClear, onclick: function () {
          spaceState.word = null;
          renderSpace(space, { focus: '#posts-title' });
        } })
      ])
      : null;

    var nameInput = el('input', { id: 'post-name', type: 'text', maxlength: '20', autocomplete: 'nickname', placeholder: T.namePlaceholder, value: store.get('localStorage', NAME_KEY) || '' });
    var textInput = el('textarea', { id: 'post-text', rows: '4', maxlength: '600', required: true });
    var composerError = el('p', { class: 'form-error', role: 'alert' });
    var composer = el('form', { class: 'composer', novalidate: true, 'aria-labelledby': 'composer-title' }, [
      el('h2', { id: 'composer-title', text: T.composerTitle }),
      el('div', { class: 'field' }, [el('label', { for: 'post-name', text: T.nameLabel }), nameInput]),
      el('div', { class: 'field' }, [el('label', { for: 'post-text', text: T.textLabel }), textInput]),
      composerError,
      el('button', { type: 'submit', class: 'btn btn--primary', text: T.postSubmit }),
      el('p', { class: 'note', text: T.localNote })
    ]);
    composer.addEventListener('submit', function (event) {
      event.preventDefault();
      var text = textInput.value.trim();
      if (!text) { composerError.textContent = T.postEmpty; textInput.focus(); return; }
      var author = nameInput.value.trim();
      if (author) store.set('localStorage', NAME_KEY, author);
      var before = {};
      WM.compute(space.posts, WM_OPTIONS({ mode: spaceState.mode })).forEach(function (r) { before[r.word] = true; });
      var post = { id: 'local-' + Date.now().toString(36), author: author || T.you, text: text, at: Date.now() };
      (local.posts[space.id] = local.posts[space.id] || []).push(post);
      saveLocal();
      var updated = allSpaces().filter(function (s) { return s.id === space.id; })[0];
      var fresh = {};
      WM.compute(updated.posts, WM_OPTIONS({ mode: spaceState.mode })).forEach(function (r) { if (!before[r.word]) fresh[r.word] = true; });
      spaceState.word = null;
      spaceState.fresh = fresh;
      spaceState.freshPost = post.id;
      renderSpace(updated, { focus: '#post-' + post.id, scrollTo: '#post-' + post.id });
      announce(T.postDone);
    });

    var main = el('div', { class: 'space-main' }, [
      el('section', { class: 'posts', 'aria-labelledby': 'posts-title' }, [
        el('div', { class: 'posts-head' }, [el('h2', { id: 'posts-title', tabindex: '-1', text: T.postsTitle }), el('span', { class: 'posts-count', text: fill(T.postsCount, { count: space.posts.length }) })]),
        filterState,
        list
      ]),
      composer
    ]);
    p.appendChild(el('div', { class: 'space-layout' }, [side, main]));

    if (options.scrollTo) {
      var target = q(options.scrollTo, p);
      if (target) target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    if (options.focus) {
      var focusTarget = q(options.focus, p);
      if (focusTarget) {
        if (!focusTarget.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(focusTarget.tagName)) focusTarget.setAttribute('tabindex', '-1');
        focusTarget.focus({ preventScroll: true });
      }
    }
  }

  /* ───── はじめに ───── */
  if (!data.login || !data.login.hash) {
    errorEl.textContent = 'ログインの設定がありません（content/board.json の login）。';
    submitButton.disabled = true;
  }
  var session = store.get('sessionStorage', SESSION_KEY);
  if (session && data.login && session === data.login.hash) enterApp();
  else showLogin();
})();
