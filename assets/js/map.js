/*
  理事のつながり（分野の本棚と一覧）
  - 分野（棚）を選ぶと、一覧がその分野の理事に絞られる（もう一度押すと全員に戻る）
  - 背表紙・一覧の「詳しく見る」で理事の紹介を開く（閉じても分野の選択は残る）
  - 一人が複数の棚に並ぶとき、その人の背表紙をすべて強調する
  名前を伏せている人は、画面には「鈴※※※」のように、読み上げでは「鈴、名前の一部を伏せています」と伝えます。
  JavaScriptが動かない場合も、棚と一覧は静的なHTMLとして読めます。
*/
(function () {
  'use strict';

  var root = document.getElementById('map');
  var dataEl = document.getElementById('map-data');
  if (!root || !dataEl) return;

  var data;
  try { data = JSON.parse(dataEl.textContent); } catch (e) { return; }
  if (!data.people || !data.people.length) return;

  var doc = document.documentElement;
  var L = data.labels;
  var domainById = {};
  data.domains.forEach(function (d) { domainById[d.id] = d; });
  var personById = {};
  data.people.forEach(function (p) { personById[p.id] = p; });

  var domainsOf = function (p) {
    var all = p.confirmedDomains.concat(p.provisionalDomains);
    return all.length ? all : ['unclassified'];
  };
  var reduceMotion = function () {
    return doc.dataset.motion === 'none' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };
  var isNarrow = function () { return window.matchMedia('(max-width: 719px)').matches; };
  var fill = function (template, vars) {
    return String(template || '').replace(/\{(\w+)\}/g, function (m, key) { return Object.prototype.hasOwnProperty.call(vars, key) ? String(vars[key]) : m; });
  };

  root.classList.add('is-enhanced');

  /* 棚の見出しを、押せるボタンにする */
  var shelfButtons = [];
  Array.prototype.forEach.call(root.querySelectorAll('[data-domain-title]'), function (title) {
    var id = title.dataset.domainTitle;
    var text = title.querySelector('.shelf-title-text');
    if (!text) return;
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'shelf-button';
    button.dataset.domainButton = id;
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'map-results');
    var name = text.querySelector('.shelf-name');
    if (name) {
      var state = document.createElement('span');
      state.className = 'shelf-state';
      state.setAttribute('aria-hidden', 'true');
      state.textContent = L.selected;
      name.appendChild(state);
    }
    while (text.firstChild) button.appendChild(text.firstChild);
    text.parentNode.replaceChild(button, text);
    shelfButtons.push(button);
  });

  Array.prototype.forEach.call(root.querySelectorAll('.person-open'), function (b) { b.hidden = false; });

  var rows = Array.prototype.slice.call(root.querySelectorAll('[data-person-id]'));
  var spines = Array.prototype.slice.call(root.querySelectorAll('.spine[data-person-open]'));
  var shelves = Array.prototype.slice.call(root.querySelectorAll('[data-shelf]'));
  var resultsTitle = document.getElementById('results-title');
  var resultsLabel = root.querySelector('[data-results-label]');
  var resultsCount = root.querySelector('[data-results-count]');
  var resultsDesc = root.querySelector('[data-results-desc]');
  var resetButton = root.querySelector('[data-domain-reset]');
  var live = root.querySelector('[data-results-live]');

  var state = { domain: null };

  function selectDomain(id, options) {
    options = options || {};
    state.domain = id || null;
    var selected = state.domain ? domainById[state.domain] : null;

    shelfButtons.forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.domainButton === state.domain));
    });
    shelves.forEach(function (s) { s.classList.toggle('is-selected', s.dataset.shelf === state.domain); });

    var visible = 0;
    rows.forEach(function (row) {
      var show = !state.domain || row.dataset.domains.split(' ').indexOf(state.domain) !== -1;
      row.hidden = !show;
      if (show) visible += 1;
    });

    // 選んだ分野の人が、ほかの棚にも並んでいる場所も強調する
    var members = {};
    if (state.domain) {
      data.people.forEach(function (p) { if (domainsOf(p).indexOf(state.domain) !== -1) members[p.id] = true; });
    }
    spines.forEach(function (spine) {
      var shelf = spine.closest('[data-shelf]');
      var on = Boolean(state.domain) && members[spine.dataset.personOpen] === true && shelf && shelf.dataset.shelf !== state.domain;
      spine.classList.toggle('is-related', on);
    });

    resultsLabel.textContent = selected ? selected.label : L.all;
    resultsCount.textContent = visible + L.countSuffix;
    resetButton.hidden = !selected;
    resultsDesc.hidden = !(selected && selected.description);
    resultsDesc.textContent = selected && selected.description ? selected.description : '';
    if (options.announce !== false) {
      live.textContent = fill(L.resultsLive, { label: selected ? selected.label : L.all, count: visible });
    }
    if (options.scroll) scrollToResults();
  }

  function scrollToResults() {
    if (!isNarrow() || !resultsTitle) return;
    var top = resultsTitle.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.55) {
      resultsTitle.scrollIntoView({ behavior: reduceMotion() ? 'auto' : 'smooth', block: 'start' });
    }
  }

  shelfButtons.forEach(function (button) {
    button.addEventListener('click', function () {
      var id = button.dataset.domainButton;
      selectDomain(state.domain === id ? null : id, { scroll: true });
    });
  });

  resetButton.addEventListener('click', function () {
    selectDomain(null);
    if (resultsTitle) resultsTitle.focus();
  });

  /* ───── 理事の紹介 ───── */
  var dialog = document.getElementById('person-dialog');
  var pd = {
    role: dialog.querySelector('[data-pd-role]'),
    name: dialog.querySelector('[data-pd-name]'),
    nameCheck: dialog.querySelector('[data-pd-namecheck]'),
    list: dialog.querySelector('[data-pd-list]'),
    basis: dialog.querySelector('[data-pd-basis]')
  };
  var CONFIRMED_ORDER = ['ownWords', 'helpfulWhen', 'reachableCommunities', 'canHelpWith', 'introductions', 'episodes', 'aspirations', 'availability'];
  var lastTrigger = null;

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined && text !== null) node.textContent = text;
    return node;
  }
  function addItem(list, label, content) {
    var wrap = el('div');
    wrap.appendChild(el('dt', null, label));
    var dd = el('dd');
    dd.appendChild(content);
    wrap.appendChild(dd);
    list.appendChild(wrap);
  }
  function valueNode(value) {
    if (Array.isArray(value)) {
      var ul = el('ul');
      value.forEach(function (v) { ul.appendChild(el('li', null, typeof v === 'string' ? v : (v && v.text) || '')); });
      return ul;
    }
    return el('p', null, typeof value === 'string' ? value : (value && value.text) || '');
  }

  function openPerson(id, trigger) {
    var p = personById[id];
    if (!p) return;
    lastTrigger = trigger || null;

    pd.role.textContent = p.appointmentConfirmed ? L.rolePublic : L.rolePreview;
    pd.name.textContent = '';
    if (p.masked) {
      var shown = el('span', null, p.name);
      shown.setAttribute('aria-hidden', 'true');
      pd.name.appendChild(shown);
      pd.name.appendChild(el('span', 'visually-hidden', p.spokenName));
    } else {
      pd.name.textContent = p.name;
    }
    pd.nameCheck.hidden = !p.nameNeedsCheck;

    pd.list.textContent = '';
    if (p.title) addItem(pd.list, L.title, el('p', null, p.title));

    var domainList = el('ul', 'pd-domains');
    var labels = [];
    p.confirmedDomains.concat(p.provisionalDomains).forEach(function (d) {
      var label = domainById[d] ? domainById[d].label : d;
      var b = el('button', 'pd-domain', label);
      b.type = 'button';
      b.dataset.pdDomain = d;
      b.setAttribute('aria-label', fill(L.domainButtonHint, { domain: label }));
      var li = el('li');
      li.appendChild(b);
      domainList.appendChild(li);
      labels.push(label);
    });
    if (!labels.length) domainList = el('p', null, L.unclassified);
    addItem(pd.list, L.domains, domainList);

    // 岡さんの話から書き起こした、本人確認前のメモ（内部メモを含める設定のときだけ）
    if (p.okaView) {
      var oka = valueNode(p.okaView);
      if (p.okaView && p.okaView.source) {
        var wrap = el('div');
        wrap.appendChild(oka);
        wrap.appendChild(el('p', 'pd-source', p.okaView.source));
        oka = wrap;
      }
      addItem(pd.list, L.okaView, oka);
    }

    // 本人に確認した紹介（あるときだけ）
    var confirmedKeys = CONFIRMED_ORDER.filter(function (k) { return p.confirmed && p.confirmed[k]; });
    if (confirmedKeys.length) {
      var box = el('div');
      confirmedKeys.forEach(function (k) {
        box.appendChild(el('p', 'pd-sublabel', L[k] || k));
        box.appendChild(valueNode(p.confirmed[k]));
      });
      addItem(pd.list, L.confirmed, box);
    }

    // 仮整理の根拠は、「表示の調整」欄で表示を選んだときだけ出す
    var showBasis = Boolean(p.basis) && doc.dataset.showBasis === 'true';
    pd.basis.hidden = !showBasis;
    pd.basis.textContent = showBasis ? L.basis + '：' + p.basis : '';

    setCurrent(id, true);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    try { history.replaceState(null, '', '#person-' + id); } catch (e) { /* 履歴を変えられなくても表示は続ける */ }
  }

  function setCurrent(id, on) {
    spines.forEach(function (s) { s.classList.toggle('is-current', on && s.dataset.personOpen === id); });
    rows.forEach(function (r) { r.classList.toggle('is-current', on && r.dataset.personId === id); });
  }

  function closePerson() {
    if (typeof dialog.close === 'function') dialog.close();
    else { dialog.removeAttribute('open'); onClosed(); }
  }

  function onClosed() {
    setCurrent(null, false);
    if (/^#person-/.test(location.hash)) {
      try { history.replaceState(null, '', '#map'); } catch (e) { /* 同上 */ }
    }
    var target = lastTrigger;
    if (!target || !document.contains(target) || target.offsetParent === null) target = resultsTitle;
    if (target) target.focus();
  }
  dialog.addEventListener('close', onClosed);
  dialog.querySelector('[data-pd-close]').addEventListener('click', closePerson);
  dialog.addEventListener('click', function (event) {
    if (event.target === dialog) closePerson(); // 背景を押したとき
  });
  pd.list.addEventListener('click', function (event) {
    var button = event.target.closest('[data-pd-domain]');
    if (!button) return;
    lastTrigger = resultsTitle;
    closePerson();
    selectDomain(button.dataset.pdDomain, { scroll: true });
  });

  root.addEventListener('click', function (event) {
    var opener = event.target.closest('[data-person-open]');
    if (!opener || dialog.contains(opener)) return;
    event.preventDefault();
    openPerson(opener.dataset.personOpen, opener);
  });

  /* 同じ人の背表紙を、ほかの棚でも同時に強調する */
  var setTwins = function (id, on) {
    spines.forEach(function (s) { if (s.dataset.personOpen === id) s.classList.toggle('is-twin', on); });
  };
  var canHover = window.matchMedia('(hover: hover)').matches; // iPhone・iPad ではタップ後に強調が残らないようにする
  spines.forEach(function (spine) {
    var id = spine.dataset.personOpen;
    if (canHover) {
      spine.addEventListener('mouseenter', function () { setTwins(id, true); });
      spine.addEventListener('mouseleave', function () { setTwins(id, false); });
    }
    spine.addEventListener('focus', function () { setTwins(id, true); });
    spine.addEventListener('blur', function () { setTwins(id, false); });
  });

  /* 本棚が最初に見えたときだけ、背表紙をそっと並べる */
  var wall = root.querySelector('[data-shelfwall]');
  if (wall && 'IntersectionObserver' in window && !reduceMotion() && !isNarrow()) {
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        wall.classList.add('is-arriving');
        observer.disconnect();
        window.setTimeout(function () { wall.classList.remove('is-arriving'); }, 1400);
      });
    }, { threshold: 0.2 });
    observer.observe(wall);
  }

  /* #person-xx 付きのURLで来たときは、その人の紹介を開く */
  var match = /^#person-([\w-]+)$/.exec(location.hash);
  if (match && personById[match[1]]) {
    var row = document.getElementById('person-' + match[1]);
    openPerson(match[1], row ? row.querySelector('.person-open') : null);
  }

  selectDomain(null, { announce: false });
})();
