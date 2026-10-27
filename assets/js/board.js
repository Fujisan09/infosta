/*
  理事のページ（掲示板）
  - ログイン：Supabase の認証。理事は全員で1つの「共通ID」、管理者は一人ずつの「管理用ID」
  - 共通IDで書くときの名前は、書く人が入れる（この端末で覚える）。直せる・消せるのは、この端末で書いたものだけ
    （端末の印 x-board-device をデータベースが確かめる）
  - 保存：Supabase のデータベース（ログインした「利用中」の理事だけが読み書きできる。権限はデータベースが判断）
  - 投稿・議題の「書いた人」は、ログイン情報からデータベースが決める（画面からは送らない）
  - 送信に失敗したときは「送れた」と表示せず、内容を残して再送できる。同じ送信番号（client_id）で二重投稿を防ぐ
  - この端末に保存するのは、下書き・ログインの状態など本人のものだけ。共有の投稿は保存しない
  - 以前の試作版でこの端末に残った書き込みは、勝手に消したり送ったりしない（本人が確かめて送れる）
  画面の言葉は content/board.json の texts に書いてください（このファイルには書きません）。
*/
(() => {
  'use strict';

  const cfgEl = document.getElementById('board-config');
  if (!cfgEl) return;
  let CFG;
  try { CFG = JSON.parse(cfgEl.textContent); } catch (e) { return; }
  const T = CFG.texts || {};
  const WM = window.InfostaWordmap;
  const conn = CFG.connection || {};
  const doc = document.documentElement;

  /* ───── 小さな道具 ───── */
  const q = (selector, root) => (root || document).querySelector(selector);
  const fill = (template, vars) => String(template || '').replace(/\{(\w+)\}/g, (m, key) => (Object.prototype.hasOwnProperty.call(vars || {}, key) ? String(vars[key]) : m));
  const uuid = () => {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    const b = new Uint8Array(16);
    window.crypto.getRandomValues(b);
    b[6] = (b[6] & 15) | 64;
    b[8] = (b[8] & 63) | 128;
    const h = Array.from(b, (x) => (x + 256).toString(16).slice(1)).join('');
    return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
  };
  /** 画面の部品を作る。文字は必ず textContent で入れる（書き込みの中身が命令として動かないように） */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((key) => {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'style') Object.keys(value).forEach((p) => node.style.setProperty(p, value[p]));
        else if (key.indexOf('on') === 0) node.addEventListener(key.slice(2), value);
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    (children || []).forEach((child) => {
      if (child === null || child === undefined || child === false) return;
      node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
    });
    return node;
  }

  /* ───── この端末だけの保存（下書き・送った印）。共有の投稿はここに保存しない ───── */
  const device = {
    get(key) { try { return window.localStorage.getItem(key); } catch (e) { return null; } },
    set(key, value) { try { window.localStorage.setItem(key, value); return true; } catch (e) { return false; } },
    remove(key) { try { window.localStorage.removeItem(key); } catch (e) { /* 何もしない */ } },
    keys() { try { return Object.keys(window.localStorage); } catch (e) { return []; } }
  };
  const AUTH_KEY = 'infosta-board-auth';
  const DRAFT_PREFIX = 'infosta-board-draft:';
  const LEGACY_KEY = 'infosta-board-local-v1';
  const LEGACY_SENT_KEY = 'infosta-board-legacy-sent';
  const DEVICE_KEY = 'infosta-board-device';
  const NAME_KEY = 'infosta-board-name';
  const LEGACY_TITLES = { places: '新しい図書館の場所', youth: '若い世代に知ってもらう', books: '本の寄贈を増やす', network: '理事のつながりを生かす', funds: '活動を支えるお金', page: 'このページの使い方・要望' };

  /* ───── 時刻 ───── */
  const DAY = 86400000;
  const ms = (value) => (value ? new Date(value).getTime() : 0);
  function relTime(at) {
    const tt = T.time || {};
    const diff = Math.max(0, Date.now() - at);
    const min = Math.floor(diff / 60000);
    if (min < 1) return tt.now;
    if (min < 60) return fill(tt.minutes, { n: min });
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    if (at >= today.getTime()) return fill(tt.hours, { n: Math.floor(min / 60) });
    const days = Math.ceil((today.getTime() - at) / DAY);
    if (days <= 1) return tt.yesterday;
    return fill(tt.days, { n: days });
  }
  const dateText = (at) => { const d = new Date(at); return `${d.getMonth() + 1}月${d.getDate()}日`; };
  const fullTime = (at) => { const d = new Date(at); const p = (n) => (n < 10 ? '0' : '') + n; return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`; };

  /* ───── 要素 ───── */
  const views = {};
  ['loading', 'setup', 'login', 'password', 'denied', 'app'].forEach((k) => { views[k] = q(`[data-view="${k}"]`); });
  const panels = {};
  ['home', 'news', 'talk', 'space', 'admin'].forEach((k) => { panels[k] = q(`[data-panel="${k}"]`); });
  const logoutButton = q('[data-logout]');
  const userLabel = q('[data-user]');
  const statusEl = q('[data-board-status]');
  const tabs = Array.prototype.slice.call(document.querySelectorAll('[data-tab]'));
  const adminTab = q('[data-admin-only]');
  const updateBar = q('[data-update-bar]');
  const updateText = q('[data-update-text]');
  const baseTitle = document.title;

  function show(name) {
    Object.keys(views).forEach((k) => { if (views[k]) views[k].hidden = k !== name; });
    const signedIn = name === 'app' || name === 'password' || name === 'denied';
    logoutButton.hidden = !signedIn;
    userLabel.hidden = name !== 'app';
    if (name !== 'app') document.title = baseTitle;
  }
  function announce(text) {
    statusEl.textContent = '';
    window.setTimeout(() => { statusEl.textContent = text; }, 30);
  }

  /* ───── 接続 ───── */
  if (!conn.supabaseUrl || !conn.publishableKey || !window.supabase || typeof window.supabase.createClient !== 'function') {
    show('setup');
    return;
  }
  // 招待・再設定のリンクから来たとき（Supabase がアドレスの # を読む前に、種類を控える）
  const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const linkType = hashParams.get('access_token') ? hashParams.get('type') : null;
  const linkError = hashParams.get('error_code') || (hashParams.get('error') ? hashParams.get('error') : null);
  // この端末の印（乱数）。共通IDで書いた書き込みを、この端末から直す・消すときに使う（データベースには、そのままでは保存しない）
  let deviceKey = device.get(DEVICE_KEY);
  if (!deviceKey || !/^[0-9a-f]{64}$/.test(deviceKey)) {
    const b = new Uint8Array(32);
    window.crypto.getRandomValues(b);
    deviceKey = Array.from(b, (x) => (x + 256).toString(16).slice(1)).join('');
    device.set(DEVICE_KEY, deviceKey);
  }
  let deviceHash = null;
  async function computeDeviceHash() {
    if (deviceHash) return deviceHash;
    try {
      const buf = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(deviceKey));
      deviceHash = Array.from(new Uint8Array(buf), (x) => (x + 256).toString(16).slice(1)).join('');
    } catch (e) { deviceHash = null; }
    return deviceHash;
  }
  const sb = window.supabase.createClient(conn.supabaseUrl, conn.publishableKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit', storageKey: AUTH_KEY },
    global: { headers: { 'x-board-device': deviceKey } }
  });
  /** ID を、ログインに使うメールアドレスの形にする（共通IDは「ID@団体のドメイン」。管理用IDはメールアドレスそのもの） */
  const loginEmailOf = (id) => {
    const v = String(id || '').trim().toLowerCase();
    if (!v || v.indexOf('@') !== -1 || !conn.idDomain) return v;
    return `${v}@${conn.idDomain}`;
  };
  const loginIdOf = (email) => {
    const v = String(email || '');
    const suffix = conn.idDomain ? `@${conn.idDomain}` : null;
    return suffix && v.slice(-suffix.length) === suffix ? v.slice(0, -suffix.length) : v;
  };
  const isShared = () => Boolean(state.me && state.me.kind === 'shared');
  /** 自分の書き込みか（共通IDでは、この端末で書いたものだけ） */
  const isMine = (row, field) => Boolean(state.me) && row[field] === state.me.member_id && (!isShared() || (Boolean(deviceHash) && row.device_hash === deviceHash));
  /** 共通IDで書くときの名前（この端末で覚える） */
  const savedName = () => String(device.get(NAME_KEY) || '').slice(0, 40);
  const saveName = (name) => { if (name) device.set(NAME_KEY, name); };

  /** 失敗の種類：network（通信できない）・auth（ログインの期限切れ）・forbidden（許可がない）・conflict（同じ送信が届いていた）・invalid（内容の問題）・server */
  function kindOf(error, status) {
    if (!error) return 'ok';
    const s = typeof status === 'number' ? status : error.status;
    const code = String(error.code || '');
    const msg = String(error.message || '');
    if (s === 0 || error.name === 'AuthRetryableFetchError' || /Failed to fetch|NetworkError|fetch failed|Load failed|network/i.test(msg)) return 'network';
    if (s === 401 || code === 'PGRST301' || code === 'PGRST303') return 'auth';
    if (s === 403 || code === '42501') return 'forbidden';
    if (code === '23505' || s === 409) return 'conflict';
    if (s >= 500) return 'server';
    return 'invalid';
  }
  async function api(promise) {
    try {
      const r = await promise;
      return { data: r.data, error: r.error, status: r.status, kind: kindOf(r.error, r.status) };
    } catch (e) {
      return { data: null, error: e, status: 0, kind: 'network' };
    }
  }
  const failText = (r) => {
    if (r.kind === 'network' || r.kind === 'server') return T.networkError;
    if (r.kind === 'auth') return T.sessionExpired;
    if (r.kind === 'forbidden') return T.notAllowed;
    return r.error && r.error.message && /[ぁ-んァ-ン一-龥]/.test(r.error.message) ? r.error.message : T.invalidInput;
  };

  /* ───── 状態 ───── */
  const state = {
    me: null,
    zones: [],
    news: [],
    topics: [],
    recent: [],
    posts: {},
    growth: null,
    members: [],
    seen: { topics: {}, news: '' },
    pendingUpdate: false
  };
  let signingOut = false;

  async function handleAuthTrouble(r) {
    if (r.kind === 'auth') {
      const refreshed = await api(sb.auth.refreshSession());
      if (refreshed.kind === 'ok' && refreshed.data && refreshed.data.session) return true;
      await signOut(T.sessionExpired);
      return false;
    }
    if (r.kind === 'forbidden') return await checkStillAllowed();
    return true;
  }
  /** 利用が止められた・名簿から外れた・共通IDのパスワードが変わった、を確かめる（続けて使えるなら true） */
  async function checkStillAllowed() {
    const me = await api(sb.rpc('board_me'));
    if (me.kind !== 'ok') return true;
    if (me.data && me.data.status === 'active' && me.data.stale) {
      await signOut(T.passwordChanged);
      return false;
    }
    if (!me.data || me.data.status !== 'active') {
      stopPolling();
      denied(me.data && me.data.status === 'suspended' ? T.suspendedText : T.deniedText);
      return false;
    }
    return true;
  }

  /* ───── ログイン ───── */
  const loginForm = q('[data-login-form]');
  const idInput = q('#board-id');
  const passInput = q('#board-pass');
  const loginError = q('[data-login-error]');
  const loginNotice = q('[data-login-notice]');
  const loginSubmit = q('[data-login-submit]');
  let loggingIn = false;

  function showLogin(notice) {
    stopPolling();
    state.me = null;
    show('login');
    loginNotice.hidden = !notice;
    loginNotice.textContent = notice || '';
  }

  loginForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (loggingIn) return;
    const email = loginEmailOf(idInput.value);
    const password = passInput.value;
    loginError.textContent = '';
    if (!email || !password) {
      loginError.textContent = T.loginEmpty;
      (email ? passInput : idInput).focus();
      return;
    }
    loggingIn = true;
    loginSubmit.disabled = true;
    loginSubmit.textContent = T.checking;
    const r = await api(sb.auth.signInWithPassword({ email, password }));
    loggingIn = false;
    loginSubmit.disabled = false;
    loginSubmit.textContent = T.submit;
    if (r.kind !== 'ok') {
      const code = r.error && r.error.code;
      loginError.textContent = r.kind === 'network' || r.kind === 'server' ? T.loginNetwork : code === 'user_banned' ? T.loginBanned : T.loginError;
      passInput.focus();
      passInput.select();
      return;
    }
    passInput.value = '';
    loginNotice.hidden = true;
    await enterApp({ focus: true });
  });

  async function signOut(notice) {
    signingOut = true;
    stopPolling();
    const id = state.me && state.me.member_id;
    if (id) device.keys().filter((k) => k.indexOf(`${DRAFT_PREFIX}${id}:`) === 0).forEach((k) => device.remove(k));
    await api(sb.auth.signOut({ scope: 'local' }));
    signingOut = false;
    try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* 何もしない */ }
    showLogin(notice);
    loginForm.reset();
    idInput.focus();
  }
  logoutButton.addEventListener('click', () => { signOut(T.loggedOut); });

  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT' && !signingOut && state.me) {
      showLogin(T.sessionExpired);
    }
  });

  /* ───── パスワードを決める（招待・再設定のリンクから来たとき） ───── */
  const passwordForm = q('[data-password-form]');
  const passwordError = q('[data-password-error]');
  const passwordSubmit = q('[data-password-submit]');
  let settingPassword = false;
  async function showPassword(kind) {
    const me = await api(sb.rpc('board_me'));
    const name = me.data && me.data.display_name ? me.data.display_name : '';
    q('[data-password-lead]').textContent = kind === 'recovery' ? T.passwordLeadRecovery : fill(T.passwordLeadInvite, { name });
    show('password');
    q('#password-title').focus();
  }
  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (settingPassword) return;
    const p1 = q('#new-pass').value;
    const p2 = q('#new-pass-2').value;
    passwordError.textContent = '';
    if (p1.length < 8) { passwordError.textContent = T.passwordShort; q('#new-pass').focus(); return; }
    if (p1 !== p2) { passwordError.textContent = T.passwordMismatch; q('#new-pass-2').focus(); return; }
    settingPassword = true;
    passwordSubmit.disabled = true;
    passwordSubmit.textContent = T.checking;
    const r = await api(sb.auth.updateUser({ password: p1 }));
    let done = r.kind === 'ok';
    if (done) done = (await api(sb.rpc('board_complete_signup'))).kind === 'ok';
    settingPassword = false;
    passwordSubmit.disabled = false;
    passwordSubmit.textContent = T.passwordSubmit;
    if (!done) { passwordError.textContent = r.kind === 'ok' ? T.networkError : r.error && r.error.code === 'weak_password' ? T.passwordShort : failText(r); return; }
    passwordForm.reset();
    announce(T.passwordDone);
    await enterApp({ focus: true });
  });

  function denied(text) {
    q('[data-denied-text]').textContent = text;
    show('denied');
    q('#denied-title').focus();
  }

  /* ───── 掲示板に入る ───── */
  async function enterApp(options) {
    options = options || {};
    show('loading');
    const r = await api(sb.rpc('board_me'));
    if (r.kind === 'network' || r.kind === 'server') {
      views.loading.textContent = T.networkError;
      views.loading.appendChild(el('button', { type: 'button', class: 'btn btn--secondary', text: T.retry, onclick: () => { views.loading.textContent = T.loading; enterApp(options); } }));
      return;
    }
    if (r.kind === 'auth') { showLogin(T.sessionExpired); return; }
    const me = r.data;
    if (!me) { denied(T.deniedText); return; }
    if (me.status === 'suspended') { denied(T.suspendedText); return; }
    if (me.status === 'invited') { await showPassword('invite'); return; }
    if (me.stale) { await signOut(T.passwordChanged); return; }
    state.me = me;
    await computeDeviceHash();
    userLabel.textContent = me.kind === 'shared' ? T.signedInShared : fill(T.signedInAs, { name: me.display_name });
    adminTab.hidden = me.role !== 'admin';
    const ok = await loadBase();
    if (!ok) return;
    show('app');
    if (!/^#(home|news|talk|admin)/.test(window.location.hash)) {
      try { window.history.replaceState(null, '', '#home'); } catch (e) { window.location.hash = '#home'; }
    }
    route({ initial: !options.focus });
    if (options.focus) {
      const heading = q('.board-panel:not([hidden]) h1');
      if (heading) heading.focus();
    }
    startPolling();
  }

  /* ───── 読み込み ───── */
  const TOPIC_COLUMNS = 'id,title,purpose,created_by,created_by_name,created_at,updated_at,last_post_at,post_count,device_hash';
  async function loadBase() {
    const [zones, news, topics, recent, growth] = await Promise.all([
      api(sb.from('board_zones').select('*').order('sort')),
      api(sb.from('board_news').select('*').order('published_at', { ascending: false }).limit(200)),
      api(sb.from('board_topics').select(TOPIC_COLUMNS).order('last_post_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false })),
      api(sb.from('board_posts').select('id,topic_id,body,created_at').order('created_at', { ascending: false }).limit(500)),
      api(sb.from('board_settings').select('*').eq('key', 'growth').maybeSingle())
    ]);
    const failed = [zones, news, topics, recent, growth].find((x) => x.kind !== 'ok');
    if (failed) {
      if (!(await handleAuthTrouble(failed))) return false;
      show('app');
      showUpdateBar(T.networkError, true);
      return true;
    }
    state.zones = zones.data || [];
    state.news = news.data || [];
    state.topics = topics.data || [];
    state.recent = recent.data || [];
    state.growth = growth.data ? growth.data.value : null;
    markSeen();
    hideUpdateBar();
    return true;
  }
  async function loadPosts(topicId) {
    const r = await api(sb.from('board_posts').select('*').eq('topic_id', topicId).order('created_at'));
    if (r.kind !== 'ok') { await handleAuthTrouble(r); return null; }
    state.posts[topicId] = r.data || [];
    return state.posts[topicId];
  }
  function markSeen() {
    state.seen.topics = {};
    state.topics.forEach((t) => { state.seen.topics[t.id] = `${t.post_count}|${t.last_post_at || ''}|${t.updated_at}`; });
    state.seen.news = state.news.length ? `${state.news[0].id}|${state.news[0].updated_at}` : '';
    state.seen.newsCount = state.news.length;
  }

  /* ───── 新着の確認（30秒ごと。画面が見えているときだけ） ───── */
  let pollTimer = null;
  function startPolling() {
    stopPolling();
    pollTimer = window.setInterval(() => { if (document.visibilityState === 'visible') poll(); }, 30000);
  }
  function stopPolling() { if (pollTimer) window.clearInterval(pollTimer); pollTimer = null; }
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && pollTimer) poll(); });
  window.addEventListener('focus', () => { if (pollTimer) poll(); });
  let polling = false;
  async function poll() {
    if (polling || !state.me) return;
    polling = true;
    const [topics, news, me] = await Promise.all([
      api(sb.from('board_topics').select('id,post_count,last_post_at,updated_at')),
      api(sb.from('board_news').select('id,updated_at').order('published_at', { ascending: false }).limit(1)),
      api(sb.rpc('board_me'))
    ]);
    polling = false;
    if (me.kind === 'ok' && (!me.data || me.data.status !== 'active' || me.data.stale)) {
      await checkStillAllowed();
      return;
    }
    if (topics.kind !== 'ok' || news.kind !== 'ok') {
      const bad = topics.kind !== 'ok' ? topics : news;
      if (bad.kind === 'auth' || bad.kind === 'forbidden') await handleAuthTrouble(bad);
      return;
    }
    let newPosts = 0;
    let changed = false;
    const known = state.seen.topics;
    (topics.data || []).forEach((t) => {
      const key = `${t.post_count}|${t.last_post_at || ''}|${t.updated_at}`;
      if (known[t.id] === undefined) { changed = true; return; }
      if (known[t.id] !== key) {
        changed = true;
        const before = Number(known[t.id].split('|')[0]);
        if (t.post_count > before) newPosts += t.post_count - before;
      }
    });
    if ((topics.data || []).length !== Object.keys(known).length) changed = true;
    const latestNews = news.data && news.data[0] ? `${news.data[0].id}|${news.data[0].updated_at}` : '';
    const newsChanged = latestNews !== state.seen.news;
    if (!changed && !newsChanged) return;
    const parts = [];
    if (newPosts > 0) parts.push(fill(T.newPosts, { count: newPosts }));
    else if (changed) parts.push(T.topicsChanged);
    if (newsChanged) parts.push(T.newNews);
    showUpdateBar(parts.join(' '), false);
  }
  function showUpdateBar(text, isError) {
    updateText.textContent = text;
    updateBar.classList.toggle('is-error', Boolean(isError));
    updateBar.hidden = false;
    state.pendingUpdate = true;
  }
  function hideUpdateBar() { updateBar.hidden = true; state.pendingUpdate = false; }
  q('[data-update-load]').addEventListener('click', async () => {
    const button = q('[data-update-load]');
    button.disabled = true;
    const ok = await loadBase();
    button.disabled = false;
    if (!ok) return;
    const r = parseRoute();
    if (r.panel === 'space') await loadPosts(r.topic);
    route({ keepFocus: true });
    announce(T.updated);
  });

  /* ───── 画面の切り替え ───── */
  function parseRoute() {
    const hash = decodeURIComponent(window.location.hash.replace(/^#/, ''));
    const parts = hash.split('/');
    const zoneIds = state.zones.map((z) => z.id);
    if (parts[0] === 'news') return { panel: 'news', zone: zoneIds.indexOf(parts[1]) !== -1 ? parts[1] : null };
    if (parts[0] === 'talk' && parts[1]) return { panel: 'space', topic: parts[1] };
    if (parts[0] === 'talk') return { panel: 'talk' };
    if (parts[0] === 'admin' && state.me && state.me.role === 'admin') return { panel: 'admin' };
    return { panel: 'home' };
  }
  let lastKey = null;
  let routing = 0;
  async function route(options) {
    options = options || {};
    if (!state.me) return;
    const token = ++routing;
    let r = parseRoute();
    let topic = null;
    if (r.panel === 'space') {
      topic = state.topics.find((t) => t.id === r.topic) || null;
      if (!topic) r = { panel: 'talk' };
      else if (!state.posts[topic.id] || options.reloadPosts) {
        await loadPosts(topic.id);
        if (token !== routing) return;
      }
    }
    Object.keys(panels).forEach((k) => { panels[k].hidden = k !== r.panel; });
    const tabName = r.panel === 'space' ? 'talk' : r.panel;
    tabs.forEach((tab) => { if (tab.dataset.tab === tabName) tab.setAttribute('aria-current', 'page'); else tab.removeAttribute('aria-current'); });
    let title = '';
    if (r.panel === 'home') renderHome();
    if (r.panel === 'news') { renderNews(r.zone); title = T.newsTitle; }
    if (r.panel === 'talk') { renderTalk(); title = T.talkTitle; }
    if (r.panel === 'space') { renderSpace(topic); title = `${topic.title}｜${T.talkTitle}`; }
    if (r.panel === 'admin') { renderAdmin(); title = T.adminTitle; }
    document.title = (title ? `${title}｜` : '') + baseTitle;
    const key = r.panel + (r.zone || '') + (r.topic || '');
    if (!options.initial && !options.keepFocus && key !== lastKey) {
      window.scrollTo(0, 0);
      const heading = q('.board-panel:not([hidden]) h1');
      if (heading) heading.focus({ preventScroll: true });
    }
    lastKey = key;
  }
  window.addEventListener('hashchange', () => { if (!/access_token|error_code/.test(window.location.hash)) route(); });

  /* ───── ワードマップ ───── */
  const WM_OPTIONS = (extra) => {
    const o = CFG.wordmap || {};
    return Object.assign({ glossary: o.glossary || [], stopwords: o.stopwords || [], halfLifeDays: o.halfLifeDays || 7, maxWords: o.maxWords || 24, now: Date.now() }, extra || {});
  };
  const asWords = (posts) => posts.map((p) => ({ text: p.body, at: ms(p.created_at) }));
  function wordmapNode(rows, options) {
    options = options || {};
    if (!rows.length) return el('p', { class: 'wordmap-empty', text: T.wordsEmpty });
    const order = WM.centerOrder(rows.length);
    const list = el('ul', { class: `wordmap${options.compact ? ' wordmap--compact' : ''}`, 'aria-label': options.label || T.wordsTitle });
    rows.forEach((row, i) => {
      const tier = row.rank <= 3 ? 'top' : row.rank <= 8 ? 'mid' : 'low';
      const hidden = el('span', { class: 'visually-hidden', text: `（${row.posts}件の書き込み）` });
      const inner = options.onPick
        ? el('button', { type: 'button', class: `word word--${tier}`, 'data-word': row.word, 'aria-pressed': String(options.selected === row.word), onclick: () => options.onPick(row.word) }, [row.word, hidden])
        : el('span', { class: `word word--${tier}` }, [row.word, hidden]);
      list.appendChild(el('li', { style: { order: String(order[i]), '--level': row.level.toFixed(3) } }, [inner]));
    });
    return list;
  }

  /* ───── ホーム ───── */
  function growthNode() {
    const g = state.growth;
    if (!g) return null;
    const unit = g.unit || '';
    const figures = [
      { key: 'current', label: T.growthCurrent, value: g.current && g.current.value },
      { key: 'projected', label: T.growthProjected, value: g.projected && g.projected.value },
      { key: 'target', label: T.growthTarget, value: g.target && g.target.value }
    ];
    const hasAll = figures.every((f) => typeof f.value === 'number');
    const year = g.target && g.target.year ? `（${g.target.year}年度）` : `（${T.unitMissing}年度）`;
    let posCurrent = 8;
    let posProjected = 38;
    if (hasAll && g.target.value > 0) {
      posCurrent = Math.max(2, Math.min(98, (g.current.value / g.target.value) * 100));
      posProjected = Math.max(posCurrent, Math.min(98, (g.projected.value / g.target.value) * 100));
    }
    const track = el('div', { class: `growth-track${hasAll ? '' : ' is-pending'}`, 'aria-hidden': 'true' }, [
      el('span', { class: 'track-line' }),
      el('span', { class: 'track-done', style: { width: `${posCurrent}%` } }),
      el('span', { class: 'track-plan', style: { left: `${posCurrent}%`, width: `${posProjected - posCurrent}%` } }),
      el('span', { class: 'track-point track-point--current', style: { left: `${posCurrent}%` } }, [el('span', { class: 'track-label', text: T.growthCurrent })]),
      el('span', { class: 'track-point track-point--projected', style: { left: `${posProjected}%` } }, [el('span', { class: 'track-label', text: T.growthProjectedShort })]),
      el('span', { class: 'track-point track-point--target', style: { left: '100%' } }, [el('span', { class: 'track-label', text: T.growthTarget })])
    ]);
    const how = el('dl', { class: 'strategy-how' }, (g.how || []).map((h) => el('div', null, [el('dt', { text: h.label }), el('dd', { text: h.text })])));
    return el('section', { class: 'growth', 'aria-labelledby': 'growth-title' }, [
      el('div', { class: 'growth-main' }, [
        el('h2', { id: 'growth-title', text: T.growthTitle }),
        el('p', { class: 'growth-metric', text: g.metric || '' }),
        el('dl', { class: 'growth-figures' }, figures.map((f) => el('div', { class: `growth-figure growth-figure--${f.key}` }, [
          el('dt', { text: f.label }),
          el('dd', null, [
            el('span', { class: 'growth-value', text: typeof f.value === 'number' ? String(f.value) : T.unitMissing }),
            el('span', { class: 'growth-unit', text: unit }),
            f.key === 'target' ? el('span', { class: 'growth-year', text: year }) : null
          ])
        ]))),
        track,
        hasAll ? null : el('p', { class: 'growth-pending', text: T.growthPending })
      ]),
      el('div', { class: 'strategy' }, [
        el('h3', { text: g.draft ? T.strategyTitleDraft : T.strategyTitle }),
        g.direction ? el('p', { class: 'strategy-direction' }, [el('span', { class: 'strategy-label', text: T.directionLabel }), el('span', { text: g.direction })]) : null,
        how
      ])
    ]);
  }

  function fallbackCopy(text) {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.className = 'copy-buffer';
    document.body.appendChild(area);
    area.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(area);
    return ok;
  }
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text).then(() => true, () => fallbackCopy(text));
    return Promise.resolve(fallbackCopy(text));
  }
  function copyButton(label, getText, statusNode) {
    return el('button', { type: 'button', class: 'copy-btn', text: label, onclick: () => { copyText(getText()).then((ok) => { statusNode.textContent = ok ? T.copied : T.copyFailed; }); } });
  }

  function shareKitNode() {
    const k = CFG.shareKit;
    if (!k || !(k.items || []).length) return null;
    const list = el('ul', { class: 'kit-list' }, k.items.map((item, i) => {
      const status = el('p', { class: 'kit-status', id: `kit-status-${i}`, role: 'status' });
      const button = copyButton(k.copy || T.copy, () => item.text, status);
      button.setAttribute('aria-label', `${item.label}を${k.copy || T.copy}`);
      button.setAttribute('aria-describedby', `kit-status-${i}`);
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

  function zoneTone(zoneId) { const z = state.zones.find((x) => x.id === zoneId); return z ? z.tone : 'slate'; }
  function weekCounts() {
    const weekAgo = Date.now() - 7 * DAY;
    const counts = {};
    state.recent.forEach((p) => { if (ms(p.created_at) >= weekAgo) counts[p.topic_id] = (counts[p.topic_id] || 0) + 1; });
    return counts;
  }
  function hotTopics() {
    const counts = weekCounts();
    return state.topics.map((t) => Object.assign({}, t, { week: counts[t.id] || 0, last: ms(t.last_post_at) || ms(t.created_at) }))
      .sort((a, b) => b.week - a.week || b.last - a.last);
  }

  function renderHome() {
    const p = panels.home;
    p.textContent = '';
    p.appendChild(el('header', { class: 'panel-head' }, [
      el('h1', { id: 'home-title', tabindex: '-1', text: T.title }),
      el('p', { text: T.welcome }),
      el('p', { class: 'shared-note', text: T.sharedNote })
    ]));
    const legacy = legacyNode();
    if (legacy) p.appendChild(legacy);
    const growth = growthNode();
    if (growth) p.appendChild(growth);
    const kit = shareKitNode();
    if (kit) p.appendChild(kit);

    const counts = {};
    state.news.forEach((n) => { counts[n.zone] = (counts[n.zone] || 0) + 1; });
    const tiles = el('ul', { class: 'zone-tiles' }, state.zones.map((z) => {
      const latest = state.news.find((n) => n.zone === z.id);
      return el('li', null, [el('a', { class: `zone-tile tone-${z.tone || 'slate'}`, href: `#news/${z.id}` }, [
        el('span', { class: 'zone-tile-head' }, [el('span', { class: 'zone-tile-label', text: z.label }), el('span', { class: 'zone-tile-count', text: fill(T.countUnit, { count: counts[z.id] || 0 }) })]),
        el('span', { class: 'zone-tile-latest', text: latest ? latest.title : T.zoneEmpty })
      ])]);
    }));
    const newsCard = el('section', { class: 'home-card', 'aria-labelledby': 'home-news-title' }, [
      el('h2', { id: 'home-news-title', text: T.newsTitle }),
      el('p', { class: 'home-card-lead', text: T.newsLead }),
      tiles,
      el('p', { class: 'home-card-action' }, [el('a', { class: 'btn btn--secondary', href: '#news', text: T.newsMore })])
    ]);
    const spaces = hotTopics();
    const rows = WM.compute(asWords(state.recent), WM_OPTIONS({ maxWords: 12 }));
    const active = spaces.filter((s) => s.week > 0);
    const shown = (active.length >= 3 ? active : spaces).slice(0, 5);
    const hot = shown.length
      ? el('ul', { class: 'hot-spaces' }, shown.map((s) => el('li', null, [
        el('a', { href: `#talk/${encodeURIComponent(s.id)}`, text: s.title }),
        el('span', { class: 'hot-count', text: fill(T.weekCount, { count: s.week }) })
      ])))
      : el('p', { class: 'zone-empty', text: T.topicsEmpty });
    const talkCard = el('section', { class: 'home-card', 'aria-labelledby': 'home-talk-title' }, [
      el('h2', { id: 'home-talk-title', text: T.talkTitle }),
      el('p', { class: 'home-card-lead', text: T.hotWordsNote }),
      wordmapNode(rows, { compact: true, label: T.hotWordsTitle }),
      hot,
      el('p', { class: 'home-card-action' }, [el('a', { class: 'btn btn--secondary', href: '#talk', text: T.talkMore })])
    ]);
    p.appendChild(el('div', { class: 'home-grid' }, [newsCard, talkCard]));
  }

  /* ───── 共通：その場で確かめる（ブラウザの確認ダイアログは使わない） ───── */
  function confirmRow(message, yesLabel, onYes, onNo) {
    const row = el('div', { class: 'confirm-row', role: 'group', 'aria-label': message }, [
      el('p', { text: message }),
      el('div', { class: 'form-actions' }, [
        el('button', { type: 'button', class: 'btn btn--danger', 'data-confirm-yes': true, text: yesLabel, onclick: onYes }),
        el('button', { type: 'button', class: 'btn btn--quiet', text: T.cancel, onclick: onNo })
      ])
    ]);
    return row;
  }
  function busy(button, on, label) {
    button.disabled = on;
    if (label) button.textContent = label;
  }

  /* ───── お知らせ（事業ごと） ───── */
  let newsEditing = null;
  function newsForm(item) {
    const isNew = !item;
    const clientId = uuid();
    const zoneSelect = el('select', { id: 'news-zone' }, state.zones.map((z) => el('option', { value: z.id, text: z.label, selected: item ? item.zone === z.id : z.sort === Math.min.apply(null, state.zones.map((x) => x.sort)) })));
    const kindSelect = el('select', { id: 'news-kind' }, Object.keys(T.types || {}).map((k) => el('option', { value: k, text: T.types[k], selected: item ? item.kind === k : k === 'notice' })));
    const titleInput = el('input', { id: 'news-title-input', type: 'text', maxlength: '80', required: true, value: item ? item.title : '' });
    const bodyInput = el('textarea', { id: 'news-body', rows: '6', maxlength: '4000' });
    bodyInput.value = item ? item.body : '';
    const error = el('p', { class: 'form-error', role: 'alert' });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary', text: isNew ? T.newsSubmit : T.save });
    const form = el('form', { class: 'news-form', novalidate: true, 'aria-label': isNew ? T.newsWrite : T.newsEditTitle }, [
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', { for: 'news-zone', text: T.newsZone }), zoneSelect]),
        el('div', { class: 'field' }, [el('label', { for: 'news-kind', text: T.newsKind }), kindSelect])
      ]),
      el('div', { class: 'field' }, [el('label', { for: 'news-title-input', text: T.newsTitleLabel }), titleInput]),
      el('div', { class: 'field' }, [el('label', { for: 'news-body', text: T.newsBody }), bodyInput]),
      error,
      el('div', { class: 'form-actions' }, [submit, el('button', { type: 'button', class: 'btn btn--quiet', text: T.cancel, onclick: () => { newsEditing = null; renderNews(parseRoute().zone); } })])
    ]);
    let sending = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (sending) return;
      const row = { zone: zoneSelect.value, kind: kindSelect.value, title: titleInput.value.trim(), body: bodyInput.value.trim() };
      if (!row.title) { error.textContent = T.newsTitleEmpty; titleInput.focus(); return; }
      sending = true;
      busy(submit, true, T.sending);
      let r = isNew
        ? await api(sb.from('board_news').insert(Object.assign({ client_id: clientId }, row)).select())
        : await api(sb.from('board_news').update(row).eq('id', item.id).select());
      if (isNew && r.kind === 'conflict') r = await api(sb.from('board_news').select('*').eq('client_id', clientId).eq('created_by', state.me.member_id));
      sending = false;
      busy(submit, false, isNew ? T.newsSubmit : T.save);
      if (r.kind !== 'ok' || !r.data || !r.data.length) {
        if (r.kind === 'ok') { error.textContent = T.notAllowed; return; }
        if (!(await handleAuthTrouble(r))) return;
        error.textContent = r.kind === 'network' || r.kind === 'server' ? T.sendFailed : failText(r);
        return;
      }
      const saved = r.data[0];
      state.news = [saved].concat(state.news.filter((n) => n.id !== saved.id)).sort((a, b) => ms(b.published_at) - ms(a.published_at));
      markSeen();
      newsEditing = null;
      renderNews(parseRoute().zone);
      announce(isNew ? T.newsPublished : T.updatedDone);
    });
    return form;
  }

  function newsItem(n, full) {
    const isAdmin = state.me.role === 'admin';
    if (newsEditing === n.id) return el('li', null, [newsForm(n)]);
    const meta = el('p', { class: 'news-meta' }, [
      el('time', { datetime: new Date(ms(n.published_at)).toISOString(), title: fullTime(ms(n.published_at)), text: dateText(ms(n.published_at)) }),
      T.types && T.types[n.kind] ? el('span', { class: 'type-tag', text: T.types[n.kind] }) : null,
      el('span', { class: 'news-author', text: n.created_by_name })
    ]);
    const paragraphs = String(n.body || '').split(/\n{2,}|\r\n\r\n/).filter((x) => x.trim());
    const body = el('div', { class: `news-body${full ? '' : ' is-clamped'}` }, (full ? paragraphs : paragraphs.slice(0, 1)).map((t) => el('p', { text: t })));
    const actions = isAdmin && full ? el('p', { class: 'item-actions' }, [
      el('button', { type: 'button', class: 'btn btn--quiet btn--small', text: T.edit, onclick: () => { newsEditing = n.id; renderNews(parseRoute().zone); const f = q('#news-title-input'); if (f) f.focus(); } }),
      el('button', { type: 'button', class: 'btn btn--quiet btn--small', text: T.delete, onclick: (event) => {
        const li = event.target.closest('li');
        const row = confirmRow(T.newsDeleteConfirm, T.deleteYes, async () => {
          const yes = q('[data-confirm-yes]', row);
          busy(yes, true);
          const r = await api(sb.from('board_news').delete().eq('id', n.id).select());
          if (r.kind === 'ok' && r.data && r.data.length) {
            state.news = state.news.filter((x) => x.id !== n.id);
            markSeen();
            renderNews(parseRoute().zone);
            announce(T.deleted);
            return;
          }
          if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
          busy(yes, false);
          row.replaceWith(el('p', { class: 'form-error', role: 'alert', text: r.kind === 'ok' ? T.notAllowed : failText(r) }));
        }, () => { row.remove(); });
        li.appendChild(row);
        q('[data-confirm-yes]', row).focus();
      } })
    ]) : null;
    return el('li', null, [el('article', { class: 'news-item' }, [meta, el('h3', { text: n.title }), body, actions])]);
  }

  function renderNews(zoneId) {
    const p = panels.news;
    const isAdmin = state.me.role === 'admin';
    p.textContent = '';
    p.appendChild(el('header', { class: 'panel-head' }, [
      el('h1', { id: 'news-title', tabindex: '-1', text: T.newsTitle }),
      el('p', { text: T.newsLead })
    ]));
    if (isAdmin) {
      if (newsEditing === 'new') p.appendChild(newsForm(null));
      else p.appendChild(el('p', { class: 'panel-action' }, [el('button', { type: 'button', class: 'btn btn--secondary', 'data-news-new': true, text: T.newsWrite, onclick: () => { newsEditing = 'new'; renderNews(zoneId); q('#news-title-input').focus(); } })]));
    }
    const switcher = el('nav', { class: 'zone-switch', 'aria-label': T.newsZone }, [el('ul', null, [{ id: null, label: T.zoneAll }].concat(state.zones).map((z) => el('li', null, [el('a', {
      href: z.id ? `#news/${z.id}` : '#news',
      class: `zone-switch-link${z.tone ? ` tone-${z.tone}` : ''}`,
      'aria-current': (z.id || null) === (zoneId || null) ? 'page' : null
    }, [z.label])])))]);
    p.appendChild(switcher);
    const counts = {};
    state.news.forEach((n) => { counts[n.zone] = (counts[n.zone] || 0) + 1; });
    if (zoneId) {
      const z = state.zones.find((x) => x.id === zoneId);
      const items = state.news.filter((n) => n.zone === zoneId);
      p.appendChild(el('section', { class: `zone zone--single tone-${z.tone || 'slate'}`, 'aria-labelledby': `zone-${z.id}` }, [
        el('header', { class: 'zone-head' }, [el('h2', { id: `zone-${z.id}`, text: z.label }), el('p', { text: z.description })]),
        items.length ? el('ul', { class: 'news-list' }, items.map((n) => newsItem(n, true))) : el('p', { class: 'zone-empty', text: T.zoneEmpty }),
        el('p', { class: 'zone-more' }, [el('a', { href: '#news', text: T.zoneBack })])
      ]));
      return;
    }
    p.appendChild(el('div', { class: 'zone-board' }, state.zones.map((z, i) => {
      const items = state.news.filter((n) => n.zone === z.id);
      return el('section', { class: `zone tone-${z.tone || 'slate'}${i === 0 ? ' zone--wide' : ''}`, 'aria-labelledby': `zone-${z.id}` }, [
        el('header', { class: 'zone-head' }, [el('h2', { id: `zone-${z.id}`, text: z.label }), el('p', { text: z.description })]),
        items.length ? el('ul', { class: 'news-list' }, items.slice(0, 3).map((n) => newsItem(n, false))) : el('p', { class: 'zone-empty', text: T.zoneEmpty }),
        el('p', { class: 'zone-more' }, [el('a', { href: `#news/${z.id}`, text: fill(T.zoneMore, { zone: z.label, count: counts[z.id] || 0 }) })])
      ]);
    })));
  }

  /* ───── 議論の場 ───── */
  function heatNode(week, max) {
    const filled = week > 0 ? Math.max(1, Math.round((week / Math.max(1, max)) * 5)) : 0;
    const dots = [];
    for (let i = 0; i < 5; i += 1) dots.push(el('span', { class: `heat-dot${i < filled ? ' is-on' : ''}` }));
    return el('span', { class: 'heat', 'aria-hidden': 'true' }, dots);
  }
  let addOpen = false;
  const addDraft = { title: '', purpose: '', clientId: uuid() };
  function renderTalk() {
    const p = panels.talk;
    p.textContent = '';
    p.appendChild(el('header', { class: 'panel-head' }, [
      el('h1', { id: 'talk-title', tabindex: '-1', text: T.talkTitle }),
      el('p', { text: T.talkLead })
    ]));
    const spaces = hotTopics();
    p.appendChild(el('section', { class: 'hot-words', 'aria-labelledby': 'hot-words-title' }, [
      el('h2', { id: 'hot-words-title', text: T.hotWordsTitle }),
      el('p', { class: 'note', text: T.hotWordsNote }),
      wordmapNode(WM.compute(asWords(state.recent), WM_OPTIONS({ maxWords: 26 })), { label: T.hotWordsTitle })
    ]));
    const max = spaces.reduce((m, s) => Math.max(m, s.week), 0);
    const byTopic = {};
    state.recent.forEach((r) => { (byTopic[r.topic_id] = byTopic[r.topic_id] || []).push(r); });
    const list = spaces.length ? el('ul', { class: 'space-list' }, spaces.map((s) => {
      const words = WM.compute(asWords(byTopic[s.id] || []), WM_OPTIONS({ maxWords: 5 }));
      return el('li', null, [el('a', { class: 'space-card', href: `#talk/${encodeURIComponent(s.id)}` }, [
        el('span', { class: 'space-card-head' }, [el('span', { class: 'space-card-title', text: s.title })]),
        s.purpose ? el('span', { class: 'space-card-purpose', text: s.purpose }) : null,
        el('span', { class: 'space-card-heat' }, [
          heatNode(s.week, max),
          el('span', { class: 'heat-count', text: fill(T.weekCount, { count: s.week }) }),
          el('span', { class: 'heat-last', text: s.post_count ? fill(T.lastPost, { when: relTime(s.last) }) : T.noPosts })
        ]),
        words.length ? el('span', { class: 'space-card-words' }, words.map((w) => el('span', { class: 'mini-word', text: w.word }))) : null
      ])]);
    })) : el('p', { class: 'zone-empty', text: T.topicsEmpty });

    const titleInput = el('input', { id: 'space-title-input', type: 'text', maxlength: '60', required: true, value: addDraft.title, oninput: (e) => { addDraft.title = e.target.value; } });
    const topicNameInput = isShared() ? el('input', { id: 'space-name', type: 'text', maxlength: '40', autocomplete: 'name', value: savedName() }) : null;
    const purposeInput = el('input', { id: 'space-purpose-input', type: 'text', maxlength: '200', value: addDraft.purpose, oninput: (e) => { addDraft.purpose = e.target.value; } });
    const addError = el('p', { class: 'form-error', role: 'alert' });
    const addSubmit = el('button', { type: 'submit', class: 'btn btn--primary', text: T.addSpaceSubmit });
    const addForm = el('form', { class: 'add-space', 'data-add-space': true, novalidate: true, hidden: !addOpen }, [
      el('div', { class: 'field' }, [el('label', { for: 'space-title-input', text: T.addSpaceTitle }), titleInput]),
      el('div', { class: 'field' }, [el('label', { for: 'space-purpose-input', text: T.addSpacePurpose }), purposeInput]),
      topicNameInput ? el('div', { class: 'field' }, [el('label', { for: 'space-name', text: T.nameLabel }), topicNameInput, el('p', { class: 'hint', text: T.nameHint })]) : null,
      addError,
      el('div', { class: 'form-actions' }, [
        addSubmit,
        el('button', { type: 'button', class: 'btn btn--quiet', text: T.cancel, onclick: () => { addOpen = false; renderTalk(); q('[data-add-toggle]').focus(); } })
      ])
    ]);
    let sending = false;
    addForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (sending) return;
      const title = titleInput.value.trim();
      const purpose = purposeInput.value.trim();
      if (!title) { addError.textContent = T.addSpaceEmpty; titleInput.focus(); return; }
      const row = { title, purpose, client_id: addDraft.clientId };
      if (topicNameInput) {
        const name = topicNameInput.value.trim();
        if (!name || name.length > 40) { addError.textContent = T.nameEmpty; topicNameInput.focus(); return; }
        saveName(name);
        row.created_by_name = name;
      }
      sending = true;
      busy(addSubmit, true, T.sending);
      let r = await api(sb.from('board_topics').insert(row).select(TOPIC_COLUMNS));
      if (r.kind === 'conflict') r = await api(sb.from('board_topics').select(TOPIC_COLUMNS).eq('client_id', addDraft.clientId).eq('created_by', state.me.member_id));
      sending = false;
      busy(addSubmit, false, T.addSpaceSubmit);
      if (r.kind !== 'ok' || !r.data || !r.data.length) {
        if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
        addError.textContent = r.kind === 'network' || r.kind === 'server' ? T.sendFailed : failText(r);
        addSubmit.textContent = r.kind === 'network' || r.kind === 'server' ? T.retrySend : T.addSpaceSubmit;
        return;
      }
      const topic = r.data[0];
      state.topics = [topic].concat(state.topics.filter((t) => t.id !== topic.id));
      state.posts[topic.id] = state.posts[topic.id] || [];
      markSeen();
      addOpen = false;
      addDraft.title = '';
      addDraft.purpose = '';
      addDraft.clientId = uuid();
      announce(fill(T.addSpaceDone, { title: topic.title }));
      window.location.hash = `#talk/${topic.id}`;
    });
    p.appendChild(el('section', { class: 'spaces', 'aria-labelledby': 'spaces-title' }, [
      el('div', { class: 'spaces-head' }, [
        el('h2', { id: 'spaces-title', text: T.spacesTitle }),
        el('button', { type: 'button', class: 'btn btn--quiet', 'data-add-toggle': true, 'aria-expanded': String(addOpen), text: T.addSpace, onclick: () => {
          addOpen = !addOpen;
          renderTalk();
          if (addOpen) q('#space-title-input').focus();
        } })
      ]),
      addForm,
      list
    ]));
  }

  /* ───── 議題のスペース ───── */
  let spaceState = { id: null, mode: 'recent', word: null, fresh: {}, freshPost: null, editing: null, topicEditing: false };
  function highlight(text, word) {
    const node = el('p', { class: 'post-text' });
    if (!word) { node.textContent = text; return node; }
    const source = text.normalize ? text.normalize('NFKC') : text;
    source.split(word).forEach((part, i, all) => {
      if (part) node.appendChild(document.createTextNode(part));
      if (i < all.length - 1) node.appendChild(el('mark', { text: word }));
    });
    return node;
  }
  const canManagePost = (post) => state.me.role === 'admin' || isMine(post, 'author_id');
  const canEditTopic = (topic) => state.me.role === 'admin' || isMine(topic, 'created_by');
  const canDeleteTopic = (topic) => state.me.role === 'admin' || (isMine(topic, 'created_by') && topic.post_count === 0);

  function draftKeyOf(topicId) { return `${DRAFT_PREFIX}${state.me.member_id}:${topicId}`; }
  function readDraft(topicId) {
    try {
      const d = JSON.parse(device.get(draftKeyOf(topicId)) || 'null');
      if (d && typeof d.body === 'string' && d.body.trim() && typeof d.clientId === 'string') return d;
    } catch (e) { /* 壊れた下書きは使わない */ }
    return { body: '', clientId: uuid(), failed: false };
  }
  function saveDraft(topicId, draft) {
    if (draft.body) device.set(draftKeyOf(topicId), JSON.stringify(draft));
    else device.remove(draftKeyOf(topicId));
  }

  function applyPost(topic, post, isNew) {
    const list = state.posts[topic.id] = (state.posts[topic.id] || []).filter((x) => x.id !== post.id);
    list.push(post);
    list.sort((a, b) => ms(a.created_at) - ms(b.created_at));
    if (isNew) {
      topic.post_count = list.length;
      topic.last_post_at = post.created_at;
      state.recent = [{ id: post.id, topic_id: post.topic_id, body: post.body, created_at: post.created_at }].concat(state.recent.filter((r) => r.id !== post.id));
    } else {
      state.recent = state.recent.map((r) => (r.id === post.id ? { id: post.id, topic_id: post.topic_id, body: post.body, created_at: post.created_at } : r));
    }
    markSeen();
  }
  function removePost(topic, postId) {
    state.posts[topic.id] = (state.posts[topic.id] || []).filter((x) => x.id !== postId);
    state.recent = state.recent.filter((r) => r.id !== postId);
    topic.post_count = state.posts[topic.id].length;
    const last = state.posts[topic.id][state.posts[topic.id].length - 1];
    topic.last_post_at = last ? last.created_at : null;
    markSeen();
  }

  function postNode(topic, post) {
    const mine = isMine(post, 'author_id');
    if (spaceState.editing === post.id) return postEditor(topic, post);
    const editedMark = post.edited_at ? el('span', { class: 'post-edited', text: post.edited_by && post.edited_by !== post.author_id ? T.editedByAdmin : T.edited }) : null;
    const actions = canManagePost(post) ? el('p', { class: 'item-actions' }, [
      mine ? el('button', { type: 'button', class: 'btn btn--quiet btn--small', 'data-edit': post.id, text: T.edit, onclick: () => {
        spaceState.editing = post.id;
        renderSpace(topic, { focus: `#edit-${post.id}` });
      } }) : null,
      el('button', { type: 'button', class: 'btn btn--quiet btn--small', 'data-delete': post.id, text: T.delete, onclick: (event) => {
        const li = event.target.closest('li');
        if (q('.confirm-row', li)) return;
        const row = confirmRow(mine ? T.deleteConfirm : fill(T.deleteOtherConfirm, { name: post.author_name }), T.deleteYes, async () => {
          const yes = q('[data-confirm-yes]', row);
          busy(yes, true, T.sending);
          const r = await api(sb.from('board_posts').delete().eq('id', post.id).select('id'));
          if (r.kind === 'ok' && r.data && r.data.length) {
            removePost(topic, post.id);
            renderSpace(topic, { focus: '#posts-title' });
            announce(T.deleted);
            return;
          }
          if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
          busy(yes, false, T.deleteYes);
          const err = q('.form-error', row) || row.appendChild(el('p', { class: 'form-error', role: 'alert' }));
          err.textContent = r.kind === 'ok' ? T.notAllowed : r.kind === 'network' || r.kind === 'server' ? T.deleteFailed : failText(r);
        }, () => { row.remove(); event.target.focus(); });
        li.appendChild(row);
        q('[data-confirm-yes]', row).focus();
      } })
    ]) : null;
    return el('li', { class: `post${mine ? ' is-mine' : ''}${spaceState.freshPost === post.id ? ' is-new' : ''}`, id: `post-${post.id}` }, [
      el('p', { class: 'post-meta' }, [
        el('span', { class: 'post-author', text: post.author_name }),
        el('time', { datetime: new Date(ms(post.created_at)).toISOString(), title: fullTime(ms(post.created_at)), text: relTime(ms(post.created_at)) }),
        editedMark
      ]),
      highlight(post.body, spaceState.word),
      actions
    ]);
  }

  function postEditor(topic, post) {
    const area = el('textarea', { id: `edit-${post.id}`, rows: '4', maxlength: '2000', 'aria-label': T.editLabel });
    area.value = post.body;
    const error = el('p', { class: 'form-error', role: 'alert' });
    const save = el('button', { type: 'submit', class: 'btn btn--primary btn--small', text: T.save });
    const form = el('form', { class: 'post-editor', novalidate: true }, [
      area,
      error,
      el('div', { class: 'form-actions' }, [save, el('button', { type: 'button', class: 'btn btn--quiet btn--small', text: T.cancel, onclick: () => { spaceState.editing = null; renderSpace(topic, { focus: `#post-${post.id} [data-edit]` }); } })])
    ]);
    let saving = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      const body = area.value.trim();
      if (!body) { error.textContent = T.postEmpty; area.focus(); return; }
      if (body === post.body) { spaceState.editing = null; renderSpace(topic); return; }
      saving = true;
      busy(save, true, T.sending);
      const r = await api(sb.from('board_posts').update({ body }).eq('id', post.id).select());
      saving = false;
      busy(save, false, T.save);
      if (r.kind === 'ok' && r.data && r.data.length) {
        spaceState.editing = null;
        applyPost(topic, r.data[0], false);
        renderSpace(topic, { focus: `#post-${post.id}` });
        announce(T.updatedDone);
        return;
      }
      if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
      error.textContent = r.kind === 'ok' ? T.notAllowed : r.kind === 'network' || r.kind === 'server' ? T.saveFailed : failText(r);
    });
    return el('li', { class: 'post is-mine is-editing', id: `post-${post.id}` }, [
      el('p', { class: 'post-meta' }, [el('span', { class: 'post-author', text: post.author_name }), el('span', { text: T.editing })]),
      form
    ]);
  }

  function topicHeader(topic) {
    if (spaceState.topicEditing) {
      const t = el('input', { id: 'topic-title-edit', type: 'text', maxlength: '60', value: topic.title });
      const pu = el('input', { id: 'topic-purpose-edit', type: 'text', maxlength: '200', value: topic.purpose || '' });
      const error = el('p', { class: 'form-error', role: 'alert' });
      const save = el('button', { type: 'submit', class: 'btn btn--primary', text: T.save });
      const form = el('form', { class: 'topic-editor', novalidate: true }, [
        el('div', { class: 'field' }, [el('label', { for: 'topic-title-edit', text: T.addSpaceTitle }), t]),
        el('div', { class: 'field' }, [el('label', { for: 'topic-purpose-edit', text: T.addSpacePurpose }), pu]),
        error,
        el('div', { class: 'form-actions' }, [save, el('button', { type: 'button', class: 'btn btn--quiet', text: T.cancel, onclick: () => { spaceState.topicEditing = false; renderSpace(topic, { focus: '#space-title' }); } })])
      ]);
      let saving = false;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (saving) return;
        const title = t.value.trim();
        if (!title) { error.textContent = T.addSpaceEmpty; t.focus(); return; }
        saving = true;
        busy(save, true, T.sending);
        const r = await api(sb.from('board_topics').update({ title, purpose: pu.value.trim() }).eq('id', topic.id).select(TOPIC_COLUMNS));
        saving = false;
        busy(save, false, T.save);
        if (r.kind === 'ok' && r.data && r.data.length) {
          Object.assign(topic, r.data[0]);
          markSeen();
          spaceState.topicEditing = false;
          renderSpace(topic, { focus: '#space-title' });
          announce(T.updatedDone);
          return;
        }
        if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
        error.textContent = r.kind === 'ok' ? T.notAllowed : r.kind === 'network' || r.kind === 'server' ? T.saveFailed : failText(r);
      });
      return el('header', { class: 'panel-head' }, [el('h1', { id: 'space-title', tabindex: '-1', text: topic.title }), form]);
    }
    const manage = [];
    if (canEditTopic(topic)) manage.push(el('button', { type: 'button', class: 'btn btn--quiet btn--small', text: T.topicEdit, onclick: () => { spaceState.topicEditing = true; renderSpace(topic, { focus: '#topic-title-edit' }); } }));
    if (canDeleteTopic(topic)) manage.push(el('button', { type: 'button', class: 'btn btn--quiet btn--small', 'data-topic-delete': true, text: T.topicDelete, onclick: (event) => {
      const head = event.target.closest('header');
      if (q('.confirm-row', head)) return;
      const row = confirmRow(topic.post_count ? fill(T.topicDeleteConfirmPosts, { count: topic.post_count }) : T.topicDeleteConfirm, T.deleteYes, async () => {
        const yes = q('[data-confirm-yes]', row);
        busy(yes, true, T.sending);
        const r = await api(sb.from('board_topics').delete().eq('id', topic.id).select('id'));
        if (r.kind === 'ok' && r.data && r.data.length) {
          state.topics = state.topics.filter((x) => x.id !== topic.id);
          state.recent = state.recent.filter((x) => x.topic_id !== topic.id);
          delete state.posts[topic.id];
          markSeen();
          announce(T.deleted);
          window.location.hash = '#talk';
          return;
        }
        if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
        busy(yes, false, T.deleteYes);
        const err = q('.form-error', row) || row.appendChild(el('p', { class: 'form-error', role: 'alert' }));
        err.textContent = r.kind === 'ok' ? T.notAllowed : failText(r);
      }, () => { row.remove(); });
      head.appendChild(row);
      q('[data-confirm-yes]', row).focus();
    } }));
    return el('header', { class: 'panel-head' }, [
      el('h1', { id: 'space-title', tabindex: '-1', text: topic.title }),
      topic.purpose ? el('p', { text: topic.purpose }) : null,
      el('p', { class: 'topic-meta', text: fill(T.topicBy, { name: topic.created_by_name, date: dateText(ms(topic.created_at)) }) }),
      manage.length ? el('p', { class: 'item-actions' }, manage) : null
    ]);
  }

  function renderSpace(topic, options) {
    options = options || {};
    const p = panels.space;
    if (spaceState.id !== topic.id) spaceState = { id: topic.id, mode: 'recent', word: null, fresh: {}, freshPost: null, editing: null, topicEditing: false };
    const posts = state.posts[topic.id] || [];
    const rows = WM.compute(asWords(posts), WM_OPTIONS({ mode: spaceState.mode }));
    if (spaceState.word && !rows.some((r) => r.word === spaceState.word)) spaceState.word = null;
    const matches = posts.filter((post) => !spaceState.word || WM.wordsOf(post.body, WM_OPTIONS()).indexOf(spaceState.word) !== -1);
    p.textContent = '';
    p.appendChild(el('p', { class: 'back-link' }, [el('a', { href: '#talk', text: T.backToTalk })]));
    p.appendChild(topicHeader(topic));

    const modeButton = (mode, label) => el('button', { type: 'button', class: 'seg-button', 'aria-pressed': String(spaceState.mode === mode), 'data-mode': mode, text: label, onclick: () => {
      spaceState.mode = mode;
      renderSpace(topic, { focus: `[data-mode="${mode}"]` });
    } });
    const side = el('div', { class: 'space-side' }, [
      el('section', { class: 'words', 'aria-labelledby': 'words-title' }, [
        el('div', { class: 'words-head' }, [
          el('h2', { id: 'words-title', text: T.wordsTitle }),
          el('div', { class: 'seg', role: 'group', 'aria-label': T.wordsPeriod }, [modeButton('recent', T.wordsRecent), modeButton('all', T.wordsAll)])
        ]),
        rows.length ? el('p', { class: 'note', text: T.wordsHint }) : null,
        wordmapNode(rows, {
          label: T.wordsTitle,
          selected: spaceState.word,
          onPick: (word) => {
            spaceState.word = spaceState.word === word ? null : word;
            renderSpace(topic, { focus: `.word[data-word="${word.replace(/"/g, '')}"]` });
          }
        })
      ])
    ]);

    const list = matches.length ? el('ol', { class: 'post-list' }, matches.map((post) => postNode(topic, post))) : el('p', { class: 'zone-empty', text: T.noPosts });
    const filterState = spaceState.word ? el('p', { class: 'filter-state' }, [
      el('span', { text: fill(T.filterOn, { word: spaceState.word, count: matches.length }) }),
      el('button', { type: 'button', class: 'btn btn--quiet', 'data-filter-clear': true, text: T.filterClear, onclick: () => { spaceState.word = null; renderSpace(topic, { focus: '#posts-title' }); } })
    ]) : null;

    const main = el('div', { class: 'space-main' }, [
      el('section', { class: 'posts', 'aria-labelledby': 'posts-title' }, [
        el('div', { class: 'posts-head' }, [el('h2', { id: 'posts-title', tabindex: '-1', text: T.postsTitle }), el('span', { class: 'posts-count', text: fill(T.postsCount, { count: posts.length }) })]),
        filterState,
        list
      ]),
      composerNode(topic)
    ]);
    p.appendChild(el('div', { class: 'space-layout' }, [side, main]));

    if (options.scrollTo) {
      const target = q(options.scrollTo, p);
      if (target) target.scrollIntoView({ block: 'center', behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    }
    if (options.focus) {
      const focusTarget = q(options.focus, p);
      if (focusTarget) {
        if (!focusTarget.hasAttribute('tabindex') && !/^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(focusTarget.tagName)) focusTarget.setAttribute('tabindex', '-1');
        focusTarget.focus({ preventScroll: !options.scrollTo });
      }
    }
  }

  /* 書き込む欄：送信に失敗しても内容を残し、同じ送信番号で送り直す（二重に投稿されない） */
  const sendingTopics = {};
  function composerNode(topic) {
    const draft = readDraft(topic.id);
    const textInput = el('textarea', { id: 'post-text', rows: '4', maxlength: '2000', required: true, 'aria-describedby': 'post-text-note' });
    textInput.value = draft.body;
    const nameInput = isShared() ? el('input', { id: 'post-name', type: 'text', maxlength: '40', autocomplete: 'name', value: savedName(), 'aria-describedby': 'post-name-hint' }) : null;
    const status = el('p', { class: 'form-error', role: 'alert', 'data-composer-error': true });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary', 'data-post-submit': true, text: draft.failed ? T.retrySend : T.postSubmit });
    if (draft.failed) status.textContent = T.sendFailed;
    let saveTimer = null;
    let sent = false;
    textInput.addEventListener('input', () => {
      draft.body = textInput.value;
      window.clearTimeout(saveTimer);
      // 送ったあと・画面を作り直したあとに、古い下書き（古い送信番号）を書き戻さない
      saveTimer = window.setTimeout(() => { if (!sent && form.isConnected) saveDraft(topic.id, draft); }, 300);
    });
    const form = el('form', { class: 'composer', novalidate: true, 'aria-labelledby': 'composer-title' }, [
      el('h2', { id: 'composer-title', text: T.composerTitle }),
      nameInput
        ? el('div', { class: 'field' }, [el('label', { for: 'post-name', text: T.nameLabel }), nameInput, el('p', { class: 'hint', id: 'post-name-hint', text: T.nameHint })])
        : el('p', { class: 'composer-as', text: fill(T.postingAs, { name: state.me.display_name }) }),
      el('div', { class: 'field' }, [el('label', { for: 'post-text', text: T.textLabel }), textInput]),
      status,
      submit,
      el('p', { class: 'note', id: 'post-text-note', text: nameInput ? `${T.draftNote}${T.sharedEditNote}` : T.draftNote })
    ]);
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (sendingTopics[topic.id]) return;
      const body = textInput.value.trim();
      const name = nameInput ? nameInput.value.trim() : '';
      if (nameInput && (!name || name.length > 40)) { status.textContent = T.nameEmpty; nameInput.focus(); return; }
      if (!body) { status.textContent = T.postEmpty; textInput.focus(); return; }
      if (nameInput) saveName(name);
      sendingTopics[topic.id] = true;
      window.clearTimeout(saveTimer);
      draft.body = textInput.value;
      saveDraft(topic.id, draft);
      busy(submit, true, T.sending);
      status.textContent = '';
      const before = {};
      WM.compute(asWords(state.posts[topic.id] || []), WM_OPTIONS({ mode: spaceState.mode })).forEach((r) => { before[r.word] = true; });
      const row = { topic_id: topic.id, body, client_id: draft.clientId };
      if (nameInput) row.author_name = name;
      let r = await api(sb.from('board_posts').insert(row).select().single());
      let notice = T.postDone;
      if (r.kind === 'conflict') {
        // 前の送信は届いていた（返事だけが届かなかった）。届いたものを使い、本文が違えば直す
        const found = await api(sb.from('board_posts').select('*').eq('client_id', draft.clientId).eq('author_id', state.me.member_id).maybeSingle());
        r = found.kind === 'ok' && found.data ? found : r;
        if (found.kind === 'ok' && found.data && found.data.body !== body) {
          const fixed = await api(sb.from('board_posts').update({ body }).eq('id', found.data.id).select().single());
          if (fixed.kind === 'ok') r = fixed;
        }
        notice = T.postAlready;
      }
      sendingTopics[topic.id] = false;
      if (r.kind !== 'ok' || !r.data) {
        if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
        const retryable = r.kind === 'network' || r.kind === 'server' || r.kind === 'conflict';
        draft.failed = retryable;
        saveDraft(topic.id, draft);
        busy(submit, false, retryable ? T.retrySend : T.postSubmit);
        status.textContent = retryable ? T.sendFailed : failText(r);
        textInput.focus();
        return;
      }
      // 送れた：この送信番号は使い終わり。下書きを消し、次の書き込みには新しい番号を使う
      sent = true;
      window.clearTimeout(saveTimer);
      device.remove(draftKeyOf(topic.id));
      draft.body = '';
      draft.clientId = uuid();
      draft.failed = false;
      const post = r.data;
      applyPost(topic, post, true);
      const fresh = {};
      WM.compute(asWords(state.posts[topic.id]), WM_OPTIONS({ mode: spaceState.mode })).forEach((x) => { if (!before[x.word]) fresh[x.word] = true; });
      spaceState.word = null;
      spaceState.fresh = fresh;
      spaceState.freshPost = post.id;
      renderSpace(topic, { focus: `#post-${post.id}`, scrollTo: `#post-${post.id}` });
      announce(notice);
    });
    return form;
  }

  /* ───── 以前の試作版でこの端末に残った書き込み（本人が確かめて、共有の掲示板に送れる） ───── */
  function legacyItems() {
    let saved = null;
    try { saved = JSON.parse(device.get(LEGACY_KEY) || 'null'); } catch (e) { saved = null; }
    if (!saved || typeof saved !== 'object') return [];
    let sent = {};
    try { sent = JSON.parse(device.get(LEGACY_SENT_KEY) || '{}') || {}; } catch (e) { sent = {}; }
    const spaces = {};
    (Array.isArray(saved.spaces) ? saved.spaces : []).forEach((s) => { if (s && s.id) spaces[s.id] = s.title; });
    const out = [];
    Object.keys(saved.posts || {}).forEach((spaceId) => {
      (Array.isArray(saved.posts[spaceId]) ? saved.posts[spaceId] : []).forEach((p) => {
        if (!p || typeof p.text !== 'string' || !p.text.trim()) return;
        out.push({ id: String(p.id || ''), text: p.text, at: Number(p.at) || 0, author: p.author || '', from: spaces[spaceId] || LEGACY_TITLES[spaceId] || spaceId, sent: Boolean(sent[p.id]) });
      });
    });
    return out.sort((a, b) => a.at - b.at);
  }
  let legacyOpen = false;
  function legacyNode() {
    const items = legacyItems();
    if (!items.length) return null;
    const unsent = items.filter((x) => !x.sent);
    const box = el('section', { class: 'legacy', 'aria-labelledby': 'legacy-title' }, [
      el('h2', { id: 'legacy-title', text: T.legacyTitle }),
      el('p', { text: fill(T.legacyLead, { count: items.length, unsent: unsent.length }) })
    ]);
    if (!legacyOpen) {
      box.appendChild(el('p', { class: 'form-actions' }, [el('button', { type: 'button', class: 'btn btn--secondary', 'data-legacy-open': true, text: T.legacyOpen, onclick: () => { legacyOpen = true; renderHome(); const f = q('[data-legacy-list]'); if (f) f.focus(); } })]));
      return box;
    }
    const targetSelect = el('select', { id: 'legacy-target' }, [el('option', { value: '', text: T.legacyChoose })].concat(state.topics.map((t) => el('option', { value: t.id, text: t.title }))));
    const list = el('ul', { class: 'legacy-list', tabindex: '-1', 'data-legacy-list': true }, items.map((item, i) => el('li', { class: item.sent ? 'is-sent' : '' }, [
      el('label', { class: 'legacy-item' }, [
        el('input', { type: 'checkbox', 'data-legacy-index': String(i), disabled: item.sent, checked: false }),
        el('span', { class: 'legacy-text' }, [
          el('span', { class: 'legacy-meta', text: `${item.at ? fullTime(item.at) : ''}　${T.legacyFrom}${item.from}${item.sent ? `　${T.legacySent}` : ''}` }),
          el('span', { class: 'legacy-body', text: item.text })
        ])
      ])
    ])));
    const error = el('p', { class: 'form-error', role: 'alert' });
    const area = el('div', { class: 'legacy-confirm' });
    const legacyName = isShared() ? el('input', { id: 'legacy-name', type: 'text', maxlength: '40', autocomplete: 'name', value: savedName() }) : null;
    const sendButton = el('button', { type: 'button', class: 'btn btn--primary', text: T.legacyPick, onclick: () => {
      error.textContent = '';
      area.textContent = '';
      const picked = Array.prototype.slice.call(list.querySelectorAll('input[data-legacy-index]:checked')).map((c) => items[Number(c.dataset.legacyIndex)]);
      const topic = state.topics.find((t) => t.id === targetSelect.value);
      if (!picked.length) { error.textContent = T.legacyNonePicked; return; }
      if (!topic) { error.textContent = T.legacyNoTarget; targetSelect.focus(); return; }
      const fallbackName = legacyName ? legacyName.value.trim() : state.me.display_name;
      if (legacyName && (!fallbackName || fallbackName.length > 40) && picked.some((item) => !item.author)) { error.textContent = T.nameEmpty; legacyName.focus(); return; }
      if (legacyName && fallbackName) saveName(fallbackName);
      area.appendChild(confirmRow(fill(isShared() ? T.legacyConfirmShared : T.legacyConfirm, { name: fallbackName, count: picked.length, topic: topic.title }), T.legacySend, async () => {
        const yes = q('[data-confirm-yes]', area);
        busy(yes, true, T.sending);
        let sentMap = {};
        try { sentMap = JSON.parse(device.get(LEGACY_SENT_KEY) || '{}') || {}; } catch (e) { sentMap = {}; }
        let done = 0;
        for (const item of picked) {
          // 同じ元の書き込みは、何度送っても1件になる（送信番号を元の書き込みごとに決めて保存する）
          const rec = sentMap[item.id] || { clientId: uuid(), done: false };
          sentMap[item.id] = rec;
          device.set(LEGACY_SENT_KEY, JSON.stringify(sentMap));
          const body = `${fill(T.legacyPrefix, { date: item.at ? fullTime(item.at) : '' })}\n${item.text}`.slice(0, 2000);
          const row = { topic_id: topic.id, body, client_id: rec.clientId };
          if (legacyName) row.author_name = String(item.author || fallbackName).trim().slice(0, 40);
          let r = await api(sb.from('board_posts').insert(row).select().single());
          if (r.kind === 'conflict') r = await api(sb.from('board_posts').select('*').eq('client_id', rec.clientId).eq('author_id', state.me.member_id).maybeSingle());
          if (r.kind !== 'ok' || !r.data) {
            if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
            error.textContent = fill(T.legacyPartial, { done, count: picked.length });
            busy(yes, false, T.legacySend);
            return;
          }
          rec.done = true;
          device.set(LEGACY_SENT_KEY, JSON.stringify(sentMap));
          applyPost(topic, r.data, true);
          done += 1;
        }
        announce(fill(T.legacyDone, { count: done }));
        renderHome();
        const status = q('[data-legacy-status]');
        if (status) { status.textContent = fill(T.legacyDone, { count: done }); status.focus(); }
      }, () => { area.textContent = ''; }));
      q('[data-confirm-yes]', area).focus();
    } });
    const deleteButton = el('button', { type: 'button', class: 'btn btn--quiet', text: T.legacyDelete, onclick: () => {
      area.textContent = '';
      area.appendChild(confirmRow(fill(T.legacyDeleteConfirm, { count: items.length }), T.deleteYes, () => {
        device.remove(LEGACY_KEY);
        device.remove(LEGACY_SENT_KEY);
        legacyOpen = false;
        renderHome();
        announce(T.legacyDeleted);
      }, () => { area.textContent = ''; }));
      q('[data-confirm-yes]', area).focus();
    } });
    box.appendChild(list);
    box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'legacy-target', text: T.legacyTarget }), targetSelect]));
    if (legacyName) box.appendChild(el('div', { class: 'field' }, [el('label', { for: 'legacy-name', text: T.nameLabel }), legacyName, el('p', { class: 'hint', text: T.legacyNameHint })]));
    box.appendChild(error);
    box.appendChild(el('p', { class: 'form-actions' }, [sendButton, deleteButton]));
    box.appendChild(area);
    box.appendChild(el('p', { class: 'note', tabindex: '-1', 'data-legacy-status': true, role: 'status' }));
    return box;
  }

  /* ───── 管理（管理者だけ。データベースと管理用の関数でも、管理者だけに制限している） ───── */
  const adminState = { loaded: false, link: null, selftest: null, running: false };
  async function invokeAdmin(name, body) {
    const r = await api(sb.functions.invoke(name, { body }));
    if (r.kind === 'ok') return { ok: true, data: r.data };
    let message = failText(r);
    try {
      if (r.error && r.error.context && typeof r.error.context.json === 'function') {
        const detail = await r.error.context.json();
        if (detail && detail.error) message = detail.error;
      }
    } catch (e) { /* 詳しい理由は読めなかった */ }
    if (r.error && /Failed to send a request|FunctionsFetchError/.test(String(r.error.name || r.error.message))) message = T.networkError;
    return { ok: false, message };
  }
  async function loadMembers() {
    const r = await api(sb.from('board_members').select('*').order('created_at'));
    if (r.kind !== 'ok') { await handleAuthTrouble(r); return false; }
    state.members = r.data || [];
    adminState.loaded = true;
    return true;
  }
  function renderAdmin() {
    const p = panels.admin;
    p.textContent = '';
    p.appendChild(el('header', { class: 'panel-head' }, [
      el('h1', { id: 'admin-title', tabindex: '-1', text: T.adminTitle }),
      el('p', { text: T.adminLead })
    ]));
    if (!adminState.loaded) {
      p.appendChild(el('p', { class: 'note', text: T.loading }));
      loadMembers().then((ok) => { if (ok && !panels.admin.hidden) renderAdmin(); });
      return;
    }
    p.appendChild(sharedNode());
    p.appendChild(membersNode());
    p.appendChild(growthEditorNode());
    p.appendChild(backupNode());
    p.appendChild(selftestNode());
  }

  function linkBox(text, link) {
    const status = el('p', { class: 'kit-status', role: 'status' });
    return el('div', { class: 'link-box', 'data-link-box': true }, [
      el('p', { class: 'link-box-title', text }),
      el('input', { type: 'text', readonly: true, value: link, 'aria-label': T.linkLabel, onfocus: (e) => e.target.select() }),
      el('div', { class: 'form-actions' }, [copyButton(T.copyLink, () => link, status)]),
      el('p', { class: 'note', text: T.linkNote }),
      status
    ]);
  }

  /* 共通ID：理事みんなで使う1つのID（登録・パスワードの変更・停止） */
  const sharedState = { notice: '', changing: false };
  function passwordPair(prefix) {
    const p1 = el('input', { id: `${prefix}-pass`, type: 'password', autocomplete: 'new-password', minlength: '6' });
    const p2 = el('input', { id: `${prefix}-pass-2`, type: 'password', autocomplete: 'new-password', minlength: '6' });
    return {
      p1, p2,
      nodes: [
        el('div', { class: 'field' }, [el('label', { for: `${prefix}-pass`, text: T.sharedPassLabel }), p1]),
        el('div', { class: 'field' }, [el('label', { for: `${prefix}-pass-2`, text: T.sharedPass2Label }), p2])
      ],
      problem() {
        if (p1.value.length < 6 || p1.value.length > 72) return T.sharedPassShort;
        if (p1.value !== p2.value) return T.sharedPassMismatch;
        return '';
      }
    };
  }
  function sharedNode() {
    const shared = state.members.filter((m) => m.kind === 'shared');
    const notice = el('p', { class: 'note', role: 'status', 'data-shared-status': true, text: sharedState.notice });
    const section = el('section', { class: 'admin-card', 'aria-labelledby': 'shared-title', 'data-shared': true }, [
      el('h2', { id: 'shared-title', text: T.sharedTitle }),
      el('p', { class: 'note', text: T.sharedLead })
    ]);
    if (!shared.length) {
      const idInput2 = el('input', { id: 'shared-id', type: 'text', maxlength: '40', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false', 'aria-describedby': 'shared-id-hint' });
      const pair = passwordPair('shared');
      const error = el('p', { class: 'form-error', role: 'alert' });
      const submit = el('button', { type: 'submit', class: 'btn btn--primary', text: T.sharedCreate });
      const form = el('form', { class: 'shared-form', novalidate: true, 'aria-labelledby': 'shared-title' }, [
        el('p', { text: T.sharedNone }),
        el('div', { class: 'field' }, [el('label', { for: 'shared-id', text: T.sharedIdLabel }), idInput2, el('p', { class: 'hint', id: 'shared-id-hint', text: T.sharedIdHint })]),
        ...pair.nodes,
        error,
        submit
      ]);
      let sending = false;
      form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (sending) return;
        error.textContent = '';
        const id = idInput2.value.trim().toLowerCase();
        if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(id)) { error.textContent = T.sharedIdInvalid; idInput2.focus(); return; }
        const bad = pair.problem();
        if (bad) { error.textContent = bad; pair.p1.focus(); return; }
        sending = true;
        busy(submit, true, T.sending);
        const r = await invokeAdmin('board-admin', { action: 'create_shared', login_email: loginEmailOf(id), password: pair.p1.value, display_name: T.sharedDisplayName });
        sending = false;
        busy(submit, false, T.sharedCreate);
        if (!r.ok) { error.textContent = r.message; return; }
        form.reset();
        sharedState.notice = T.sharedCreated;
        await loadMembers();
        renderAdmin();
        const box = q('[data-shared-status]');
        if (box) { box.setAttribute('tabindex', '-1'); box.focus(); }
      });
      section.appendChild(form);
      section.appendChild(notice);
      return section;
    }
    shared.forEach((m) => {
      const out = el('p', { class: 'member-status', role: 'status' });
      const row = el('div', { class: 'shared-row' }, [
        el('p', { class: 'shared-id' }, [el('span', { class: 'shared-id-label', text: `${T.sharedIdLabel}：` }), el('strong', { text: loginIdOf(m.email) })]),
        el('p', { class: 'member-tags' }, [el('span', { class: `status-tag status-tag--${m.status}`, text: (T.statuses || {})[m.status] || m.status })])
      ]);
      section.appendChild(row);
      const actions = el('p', { class: 'item-actions' });
      if (m.status !== 'suspended') {
        actions.appendChild(el('button', { type: 'button', class: 'btn btn--secondary btn--small', 'data-shared-change': true, 'aria-expanded': String(sharedState.changing), text: T.sharedChange, onclick: () => { sharedState.changing = !sharedState.changing; sharedState.notice = ''; renderAdmin(); const f = q('#change-pass'); if (f) f.focus(); } }));
      }
      const toggle = el('button', { type: 'button', class: 'btn btn--quiet btn--small', 'data-label': m.status === 'suspended' ? T.resume : T.suspend, text: m.status === 'suspended' ? T.resume : T.suspend, onclick: async (event) => {
        const button = event.target;
        const go = async () => {
          busy(button, true, T.sending);
          const r = await invokeAdmin('board-admin', { action: m.status === 'suspended' ? 'resume' : 'suspend', member_id: m.id });
          busy(button, false, button.dataset.label);
          if (!r.ok) { out.textContent = r.message; return; }
          sharedState.notice = m.status === 'suspended' ? T.sharedResumed : T.sharedSuspended;
          await loadMembers();
          renderAdmin();
        };
        if (m.status === 'suspended') { go(); return; }
        if (q('.confirm-row', section)) return;
        const confirm = confirmRow(T.sharedSuspendConfirm, T.suspend, () => { confirm.remove(); go(); }, () => confirm.remove());
        section.appendChild(confirm);
        q('[data-confirm-yes]', confirm).focus();
      } });
      actions.appendChild(toggle);
      section.appendChild(actions);
      if (sharedState.changing && m.status !== 'suspended') {
        const pair = passwordPair('change');
        const error = el('p', { class: 'form-error', role: 'alert' });
        const submit = el('button', { type: 'submit', class: 'btn btn--primary', text: T.sharedChangeSubmit });
        const form = el('form', { class: 'shared-form', novalidate: true, 'aria-label': T.sharedChange }, [el('p', { class: 'note', text: T.sharedChangeLead }), ...pair.nodes, error, submit]);
        let sending = false;
        form.addEventListener('submit', async (event) => {
          event.preventDefault();
          if (sending) return;
          error.textContent = '';
          const bad = pair.problem();
          if (bad) { error.textContent = bad; pair.p1.focus(); return; }
          sending = true;
          busy(submit, true, T.sending);
          const r = await invokeAdmin('board-admin', { action: 'set_password', member_id: m.id, password: pair.p1.value });
          sending = false;
          busy(submit, false, T.sharedChangeSubmit);
          if (!r.ok) { error.textContent = r.message; return; }
          sharedState.changing = false;
          sharedState.notice = T.sharedChanged;
          await loadMembers();
          renderAdmin();
          const box = q('[data-shared-status]');
          if (box) { box.setAttribute('tabindex', '-1'); box.focus(); }
        });
        section.appendChild(form);
      }
      section.appendChild(out);
    });
    section.appendChild(notice);
    return section;
  }

  function membersNode() {
    const roleSelect = el('select', { id: 'invite-role' }, [el('option', { value: 'admin', text: T.roleAdmin }), el('option', { value: 'member', text: T.roleMember })]);
    const nameInput = el('input', { id: 'invite-name', type: 'text', maxlength: '40', autocomplete: 'off' });
    const emailInput2 = el('input', { id: 'invite-email', type: 'email', autocomplete: 'off', autocapitalize: 'none', spellcheck: 'false' });
    const error = el('p', { class: 'form-error', role: 'alert' });
    const submit = el('button', { type: 'submit', class: 'btn btn--primary', text: T.inviteSubmit });
    const form = el('form', { class: 'invite-form', novalidate: true, 'aria-labelledby': 'invite-title' }, [
      el('h3', { id: 'invite-title', text: T.invite }),
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', { for: 'invite-name', text: T.inviteName }), nameInput]),
        el('div', { class: 'field' }, [el('label', { for: 'invite-email', text: T.inviteEmail }), emailInput2]),
        el('div', { class: 'field' }, [el('label', { for: 'invite-role', text: T.inviteRole }), roleSelect])
      ]),
      error,
      submit
    ]);
    let sending = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (sending) return;
      error.textContent = '';
      const name = nameInput.value.trim();
      const email = emailInput2.value.trim().toLowerCase();
      if (!name) { error.textContent = T.inviteNameEmpty; nameInput.focus(); return; }
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { error.textContent = T.inviteEmailInvalid; emailInput2.focus(); return; }
      sending = true;
      busy(submit, true, T.sending);
      const r = await invokeAdmin('board-admin', { action: 'invite', email, display_name: name, role: roleSelect.value, redirect_to: window.location.origin + window.location.pathname });
      sending = false;
      busy(submit, false, T.inviteSubmit);
      if (!r.ok) { error.textContent = r.message; return; }
      adminState.link = { text: fill(T.inviteDone, { name }), link: r.data.link };
      await loadMembers();
      renderAdmin();
      const box = q('[data-link-box] input');
      if (box) box.focus();
    });

    const memberRows = state.members.filter((m) => m.kind !== 'shared').map((m) => {
      const isMe = m.id === state.me.member_id;
      const actions = [];
      const act = (label, handler, attrs) => el('button', Object.assign({ type: 'button', class: 'btn btn--quiet btn--small', text: label, onclick: handler }, attrs || {}));
      const run = async (button, body, done) => {
        busy(button, true, T.sending);
        const r = await invokeAdmin('board-admin', body);
        busy(button, false, button.dataset.label);
        const out = button.closest('li').querySelector('.member-status');
        if (!r.ok) { out.textContent = r.message; return; }
        await loadMembers();
        if (done) done(r.data);
        renderAdmin();
        if (r.data && r.data.link) { const box = q('[data-link-box] input'); if (box) box.focus(); }
      };
      if (m.status !== 'suspended') actions.push(act(T.reissue, (e) => run(e.target, { action: 'reissue', member_id: m.id, redirect_to: window.location.origin + window.location.pathname }, (d) => { adminState.link = { text: fill(T.reissueDone, { name: m.display_name }), link: d.link }; }), { 'data-label': T.reissue }));
      if (!isMe && m.status !== 'suspended') actions.push(act(T.suspend, (e) => {
        const li = e.target.closest('li');
        if (q('.confirm-row', li)) return;
        const row = confirmRow(fill(T.suspendConfirm, { name: m.display_name }), T.suspend, () => run(q('[data-confirm-yes]', row), { action: 'suspend', member_id: m.id }), () => row.remove());
        q('[data-confirm-yes]', row).dataset.label = T.suspend;
        li.appendChild(row);
        q('[data-confirm-yes]', row).focus();
      }, { 'data-label': T.suspend }));
      if (m.status === 'suspended') actions.push(act(T.resume, (e) => run(e.target, { action: 'resume', member_id: m.id }), { 'data-label': T.resume }));
      if (!isMe) actions.push(act(m.role === 'admin' ? T.makeMember : T.makeAdmin, (e) => run(e.target, { action: 'set_role', member_id: m.id, role: m.role === 'admin' ? 'member' : 'admin' }), { 'data-label': m.role === 'admin' ? T.makeMember : T.makeAdmin }));
      actions.push(act(T.rename, (e) => {
        const li = e.target.closest('li');
        if (q('.rename-form', li)) return;
        const input = el('input', { type: 'text', maxlength: '40', value: m.display_name, 'aria-label': T.renameLabel });
        const save = el('button', { type: 'submit', class: 'btn btn--primary btn--small', text: T.save });
        const f = el('form', { class: 'rename-form', novalidate: true }, [input, save, el('button', { type: 'button', class: 'btn btn--quiet btn--small', text: T.cancel, onclick: () => f.remove() })]);
        f.addEventListener('submit', async (ev) => {
          ev.preventDefault();
          busy(save, true, T.sending);
          const r = await api(sb.rpc('board_admin_rename', { p_member_id: m.id, p_display_name: input.value.trim() }));
          busy(save, false, T.save);
          if (r.kind !== 'ok') { li.querySelector('.member-status').textContent = failText(r); return; }
          await loadMembers();
          await loadBase();
          if (m.id === state.me.member_id) { state.me.display_name = input.value.trim(); userLabel.textContent = fill(T.signedInAs, { name: state.me.display_name }); }
          renderAdmin();
          announce(T.updatedDone);
        });
        li.appendChild(f);
        input.focus();
      }));
      return el('li', { class: `member member--${m.status}` }, [
        el('div', { class: 'member-main' }, [
          el('p', { class: 'member-name' }, [m.display_name, isMe ? el('span', { class: 'member-me', text: T.you }) : null]),
          el('p', { class: 'member-email', text: m.email }),
          el('p', { class: 'member-tags' }, [
            el('span', { class: `status-tag status-tag--${m.status}`, text: (T.statuses || {})[m.status] || m.status }),
            el('span', { class: 'role-tag', text: m.role === 'admin' ? T.roleAdmin : T.roleMember })
          ])
        ]),
        el('p', { class: 'item-actions' }, actions),
        el('p', { class: 'member-status', role: 'status' })
      ]);
    });
    const section = el('section', { class: 'admin-card', 'aria-labelledby': 'members-title' }, [
      el('h2', { id: 'members-title', text: T.membersTitle }),
      el('p', { class: 'note', text: T.membersLead }),
      adminState.link ? linkBox(adminState.link.text, adminState.link.link) : null,
      form,
      el('ul', { class: 'member-list' }, memberRows)
    ]);
    return section;
  }

  function growthEditorNode() {
    const g = JSON.parse(JSON.stringify(state.growth || {}));
    const num = (id, value) => el('input', { id, type: 'number', inputmode: 'numeric', min: '0', step: '1', value: typeof value === 'number' ? String(value) : '' });
    const fields = {
      current: num('g-current', g.current && g.current.value),
      asOf: el('input', { id: 'g-asof', type: 'text', maxlength: '20', value: (g.current && g.current.asOf) || '', placeholder: T.growthAsOfPlaceholder }),
      projected: num('g-projected', g.projected && g.projected.value),
      target: num('g-target', g.target && g.target.value),
      year: num('g-year', g.target && g.target.year),
      direction: el('input', { id: 'g-direction', type: 'text', maxlength: '120', value: g.direction || '' })
    };
    const howInputs = (g.how || []).map((h, i) => el('input', { id: `g-how-${i}`, type: 'text', maxlength: '160', value: h.text || '' }));
    const draftBox = el('input', { id: 'g-draft', type: 'checkbox', checked: g.draft ? true : null });
    const error = el('p', { class: 'form-error', role: 'alert' });
    const save = el('button', { type: 'submit', class: 'btn btn--primary', text: T.save });
    const toNum = (input) => (input.value === '' ? null : Math.max(0, Math.round(Number(input.value))));
    const form = el('form', { class: 'growth-form', novalidate: true }, [
      el('div', { class: 'field-row' }, [
        el('div', { class: 'field' }, [el('label', { for: 'g-current', text: T.growthCurrent }), fields.current]),
        el('div', { class: 'field' }, [el('label', { for: 'g-asof', text: T.growthAsOf }), fields.asOf]),
        el('div', { class: 'field' }, [el('label', { for: 'g-projected', text: T.growthProjected }), fields.projected]),
        el('div', { class: 'field' }, [el('label', { for: 'g-target', text: T.growthTarget }), fields.target]),
        el('div', { class: 'field' }, [el('label', { for: 'g-year', text: T.growthYear }), fields.year])
      ]),
      el('div', { class: 'field' }, [el('label', { for: 'g-direction', text: T.directionLabel }), fields.direction]),
      ...(g.how || []).map((h, i) => el('div', { class: 'field' }, [el('label', { for: `g-how-${i}`, text: h.label }), howInputs[i]])),
      el('label', { class: 'check' }, [draftBox, ` ${T.growthDraftLabel}`]),
      error,
      save
    ]);
    let saving = false;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (saving) return;
      const value = Object.assign({}, g, {
        current: { value: toNum(fields.current), asOf: fields.asOf.value.trim() || null },
        projected: { value: toNum(fields.projected) },
        target: { value: toNum(fields.target), year: toNum(fields.year) },
        direction: fields.direction.value.trim(),
        how: (g.how || []).map((h, i) => ({ label: h.label, text: howInputs[i].value.trim() })),
        draft: draftBox.checked
      });
      saving = true;
      busy(save, true, T.sending);
      const r = await api(sb.from('board_settings').update({ value }).eq('key', 'growth').select());
      saving = false;
      busy(save, false, T.save);
      if (r.kind === 'ok' && r.data && r.data.length) {
        state.growth = r.data[0].value;
        error.textContent = '';
        announce(T.updatedDone);
        const done = q('[data-growth-status]');
        if (done) done.textContent = T.updatedDone;
        return;
      }
      if (r.kind !== 'ok' && !(await handleAuthTrouble(r))) return;
      error.textContent = r.kind === 'ok' ? T.notAllowed : failText(r);
    });
    return el('section', { class: 'admin-card', 'aria-labelledby': 'growth-edit-title' }, [
      el('h2', { id: 'growth-edit-title', text: T.growthEdit }),
      form,
      el('p', { class: 'note', role: 'status', 'data-growth-status': true })
    ]);
  }

  function backupNode() {
    const status = el('p', { class: 'note', role: 'status', 'data-backup-status': true });
    const button = el('button', { type: 'button', class: 'btn btn--secondary', 'data-backup': true, text: T.backupButton, onclick: async () => {
      busy(button, true, T.sending);
      const r = await api(sb.rpc('board_backup'));
      busy(button, false, T.backupButton);
      if (r.kind !== 'ok' || !r.data) { if (r.kind !== 'ok') await handleAuthTrouble(r); status.textContent = failText(r); return; }
      const d = new Date();
      const p = (n) => (n < 10 ? '0' : '') + n;
      const file = `infosta-board-backup-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}.json`;
      const blob = new Blob([JSON.stringify(r.data, null, 2)], { type: 'application/json' });
      const a = el('a', { href: URL.createObjectURL(blob), download: file, class: 'visually-hidden', text: file });
      document.body.appendChild(a);
      a.click();
      window.setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      const t = r.data.tables || {};
      status.textContent = fill(T.backupDone, { file, topics: (t.board_topics || []).length, posts: (t.board_posts || []).length, news: (t.board_news || []).length, members: (t.board_members || []).length });
    } });
    return el('section', { class: 'admin-card', 'aria-labelledby': 'backup-title' }, [
      el('h2', { id: 'backup-title', text: T.backupTitle }),
      el('p', { text: T.backupLead }),
      button,
      status
    ]);
  }

  function selftestNode() {
    const out = el('div', { class: 'selftest-result', 'data-selftest-result': true, tabindex: '-1' });
    const res = adminState.selftest;
    if (res) {
      out.appendChild(el('p', { class: res.ok ? 'selftest-ok' : 'form-error', text: fill(res.ok ? T.selftestOk : T.selftestNg, { passed: res.passed, total: res.total }) }));
      out.appendChild(el('ol', { class: 'selftest-list' }, (res.results || []).map((x) => el('li', { class: x.ok ? 'is-ok' : 'is-ng' }, [
        el('span', { class: 'selftest-mark', text: x.ok ? T.passMark : T.failMark }),
        el('span', { text: x.name }),
        x.detail ? el('span', { class: 'selftest-detail', text: `（${x.detail}）` }) : null
      ]))));
      const status = el('p', { class: 'kit-status', role: 'status' });
      const text = () => `${T.selftestTitle} ${res.checkedAt || ''}\n${(res.results || []).map((x) => `${x.ok ? 'OK' : 'NG'} ${x.name}${x.detail ? `（${x.detail}）` : ''}`).join('\n')}\n${res.passed}/${res.total}`;
      out.appendChild(el('div', { class: 'form-actions' }, [copyButton(T.copyResult, text, status)]));
      out.appendChild(status);
    }
    const button = el('button', { type: 'button', class: 'btn btn--secondary', 'data-selftest': true, disabled: adminState.running, text: adminState.running ? T.selftestRunning : T.selftestButton, onclick: async () => {
      adminState.running = true;
      adminState.selftest = null;
      renderAdmin();
      const r = await invokeAdmin('board-selftest', {});
      adminState.running = false;
      adminState.selftest = r.ok ? r.data : { ok: false, passed: 0, total: 1, results: [{ name: T.selftestTitle, ok: false, detail: r.message }] };
      renderAdmin();
      const box = q('[data-selftest-result]');
      if (box) box.focus();
    } });
    return el('section', { class: 'admin-card', 'aria-labelledby': 'selftest-title' }, [
      el('h2', { id: 'selftest-title', text: T.selftestTitle }),
      el('p', { text: T.selftestLead }),
      button,
      out
    ]);
  }

  /* ───── はじめに ───── */
  (async () => {
    show('loading');
    const { data } = await sb.auth.getSession();
    if (linkError) {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* 何もしない */ }
      if (!data || !data.session) { showLogin(T.linkExpired); return; }
    }
    if (!data || !data.session) { showLogin(''); return; }
    if (linkType === 'invite' || linkType === 'recovery') {
      try { window.history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* 何もしない */ }
      await showPassword(linkType);
      return;
    }
    await enterApp({});
  })();
})();
