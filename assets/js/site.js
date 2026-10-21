/*
  情報ステーション：ページ全体の操作
  - スマホ・タブレット幅のメニュー
  - メールアドレス・電話番号のコピー
  - 確認版の「表示の調整」欄（色・文字サイズ・動きの試し調整）
  文章はここに書かず、content/*.json に書いてください。
*/
(function () {
  'use strict';

  var doc = document.documentElement;

  /* ───── メニュー ───── */
  var menuButton = document.querySelector('.menu-button');
  var nav = document.getElementById('site-nav');
  if (menuButton && nav) {
    var menuLabel = menuButton.querySelector('.menu-label');
    menuButton.hidden = false;
    // 横向きのスマートフォンなど画面の高さが低いとき、メニューが画面の外にはみ出さないよう高さを合わせる
    var fitNav = function () {
      if (!nav.classList.contains('is-open')) { nav.style.maxHeight = ''; return; }
      var top = nav.getBoundingClientRect().top;
      nav.style.maxHeight = Math.max(160, Math.floor(window.innerHeight - top - 8)) + 'px';
    };
    var setMenu = function (open, returnFocus) {
      menuButton.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('is-open', open);
      fitNav();
      if (menuLabel) menuLabel.textContent = open ? menuButton.dataset.labelClose : menuButton.dataset.labelOpen;
      if (!open && returnFocus) menuButton.focus();
    };
    menuButton.addEventListener('click', function () {
      setMenu(menuButton.getAttribute('aria-expanded') !== 'true');
    });
    nav.addEventListener('click', function (event) {
      if (event.target.closest('a')) setMenu(false);
    });
    document.addEventListener('keydown', function (event) {
      if (event.key === 'Escape' && nav.classList.contains('is-open')) setMenu(false, true);
    });
    document.addEventListener('click', function (event) {
      if (nav.classList.contains('is-open') && !event.target.closest('.header-inner')) setMenu(false);
    });
    window.addEventListener('resize', fitNav);
    window.addEventListener('scroll', function () { if (nav.classList.contains('is-open')) fitNav(); }, { passive: true });
    var wide = window.matchMedia('(min-width: 1000px)');
    var onWide = function () { if (wide.matches) setMenu(false); };
    if (wide.addEventListener) wide.addEventListener('change', onWide);
    else if (wide.addListener) wide.addListener(onWide);
  }

  /* ───── メールアドレス・電話番号のコピー ───── */
  Array.prototype.forEach.call(document.querySelectorAll('[data-copy]'), function (button) {
    var status = document.getElementById(button.getAttribute('aria-describedby') || '');
    button.hidden = false;
    button.addEventListener('click', function () {
      copyText(button.dataset.copy).then(function (ok) {
        if (status) status.textContent = ok ? button.dataset.copiedText : button.dataset.failedText;
      });
    });
  });

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return fallbackCopy(text); }
      );
    }
    return Promise.resolve(fallbackCopy(text));
  }
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

  /* ───── 表示の調整（確認版だけ） ───── */
  var reviewOpen = document.querySelector('[data-review-open]');
  var panel = document.getElementById('review-panel');
  if (!reviewOpen || !panel) return;

  var STORE_TOKENS = 'infosta-preview-tokens';
  var STORE_MOTION = 'infosta-preview-motion';
  var STORE_BASIS = 'infosta-preview-basis';
  var storage = {
    get: function (key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
    set: function (key, value) { try { window.localStorage.setItem(key, value); } catch (e) { /* 保存できない環境でも表示は続ける */ } },
    remove: function (key) { try { window.localStorage.removeItem(key); } catch (e) { /* 同上 */ } }
  };

  var inputs = Array.prototype.slice.call(panel.querySelectorAll('[data-var]'));
  var motionSelect = panel.querySelector('[data-motion-select]');
  var contrastOut = panel.querySelector('[data-contrast]');
  var tuneStatus = panel.querySelector('[data-tune-status]');

  // 保存しておいた試し値を先に反映する
  var saved = {};
  try { saved = JSON.parse(storage.get(STORE_TOKENS) || '{}') || {}; } catch (e) { saved = {}; }
  Object.keys(saved).forEach(function (name) { doc.style.setProperty(name, saved[name]); });

  var current = function (name) { return getComputedStyle(doc).getPropertyValue(name).trim(); };

  var lastFocus = null;
  var openPanel = function () {
    lastFocus = document.activeElement;
    panel.hidden = false;
    reviewOpen.setAttribute('aria-expanded', 'true');
    syncInputs();
    panel.focus();
  };
  var closePanel = function () {
    panel.hidden = true;
    reviewOpen.setAttribute('aria-expanded', 'false');
    (lastFocus && document.contains(lastFocus) ? lastFocus : reviewOpen).focus();
  };
  reviewOpen.hidden = false;
  reviewOpen.addEventListener('click', function () { if (panel.hidden) openPanel(); else closePanel(); });
  panel.querySelector('[data-review-close]').addEventListener('click', closePanel);
  panel.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.stopPropagation(); closePanel(); }
  });

  function toHex(value) {
    var v = String(value || '').trim().toLowerCase();
    if (/^#[0-9a-f]{3}$/.test(v)) v = '#' + v[1] + v[1] + v[2] + v[2] + v[3] + v[3];
    return /^#[0-9a-f]{6}$/.test(v) ? v : '#000000';
  }

  function syncInputs() {
    inputs.forEach(function (input) {
      var value = current(input.dataset.var);
      input.value = input.type === 'color' ? toHex(value) : String(parseFloat(value));
      showValue(input);
    });
    if (motionSelect) motionSelect.value = doc.dataset.motion === 'none' ? 'none' : 'minimal';
    showContrast();
  }

  function showValue(input) {
    var out = panel.querySelector('[data-out="' + input.id + '"]');
    if (out) out.textContent = input.value + (input.dataset.unit || '');
  }

  inputs.forEach(function (input) {
    input.addEventListener('input', function () {
      var value = input.value + (input.dataset.unit || '');
      doc.style.setProperty(input.dataset.var, value);
      saved[input.dataset.var] = value;
      storage.set(STORE_TOKENS, JSON.stringify(saved));
      showValue(input);
      showContrast();
      tuneStatus.textContent = '';
    });
  });

  var basisToggle = panel.querySelector('[data-basis-toggle]');
  if (storage.get(STORE_BASIS) === 'true') doc.dataset.showBasis = 'true';
  if (basisToggle) {
    basisToggle.checked = doc.dataset.showBasis === 'true';
    basisToggle.addEventListener('change', function () {
      if (basisToggle.checked) {
        doc.dataset.showBasis = 'true';
        storage.set(STORE_BASIS, 'true');
      } else {
        delete doc.dataset.showBasis;
        storage.remove(STORE_BASIS);
      }
    });
  }

  if (motionSelect) {
    motionSelect.addEventListener('change', function () {
      if (motionSelect.value === 'none') {
        doc.dataset.motion = 'none';
        storage.set(STORE_MOTION, 'none');
      } else {
        delete doc.dataset.motion;
        storage.remove(STORE_MOTION);
      }
    });
  }

  /* コントラスト比（WCAGの計算式） */
  function luminance(hex) {
    var h = toHex(hex);
    var rgb = [1, 3, 5].map(function (i) {
      var c = parseInt(h.substr(i, 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
  }
  function ratio(a, b) {
    var la = luminance(a);
    var lb = luminance(b);
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }
  function showContrast() {
    if (!contrastOut) return;
    var bg = current('--color-bg');
    var checks = [
      ['ボタンの文字', ratio(current('--color-button'), current('--color-button-text'))],
      ['リンク', ratio(current('--color-button'), bg)],
      ['本文', ratio(current('--color-text'), bg)],
      ['補助文', ratio(current('--color-muted'), bg)],
      ['強みの区画', ratio(current('--color-strength'), '#FFFFFF')]
    ];
    var low = checks.some(function (c) { return c[1] < 4.5; });
    contrastOut.textContent = 'コントラスト比（4.5以上が目安）：' + checks.map(function (c) {
      return c[0] + ' ' + c[1].toFixed(1);
    }).join('／') + (low ? '。4.5未満の組み合わせがあります。' : '');
    contrastOut.classList.toggle('is-low', low);
  }

  panel.querySelector('[data-tune-export]').addEventListener('click', function () {
    var lines = inputs.map(function (input) { return '  ' + input.dataset.var + ': ' + current(input.dataset.var) + ';'; });
    var css = '/* 「表示の調整」で試した値（tokens.css の :root に反映してください） */\n:root {\n' + lines.join('\n') + '\n}\n';
    copyText(css).then(function (ok) {
      tuneStatus.textContent = ok ? 'CSSをコピーしました。tokens.css に貼り付けて反映できます。' : 'コピーできませんでした。';
    });
  });

  panel.querySelector('[data-tune-reset]').addEventListener('click', function () {
    inputs.forEach(function (input) { doc.style.removeProperty(input.dataset.var); });
    saved = {};
    storage.remove(STORE_TOKENS);
    storage.remove(STORE_MOTION);
    storage.remove(STORE_BASIS);
    delete doc.dataset.motion;
    delete doc.dataset.showBasis;
    if (basisToggle) basisToggle.checked = false;
    syncInputs();
    tuneStatus.textContent = '初期値に戻しました。';
  });
})();
