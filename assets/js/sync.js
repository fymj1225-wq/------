/* ===================================================================
   端末どうしの同期

   ・親機（いつも使う携帯）… この端末の内容が「正」。編集すると自動で送る
   ・子機（PCなど）        … 開くたびに親機の内容を取り込む。
                              食い違ったときは必ず親機が優先される

   置き場所（サーバー）が見つからないときは、端末内だけで普通に動く。
   一度でも繋いだ端末なら、切れているあいだも自動で復帰を試みる。
   =================================================================== */
(function (global) {
  'use strict';

  var META_KEY = 'restore-cost-app:sync';
  var TOKEN_KEY = 'restore-cost-app:token';
  var ROLE_KEY = 'restore-cost-app:role';
  var PAIRED_KEY = 'restore-cost-app:paired';

  var PUSH_DELAY = 1200;
  var TICK_MASTER = 30000;
  var TICK_VIEWER = 12000;
  var RETRY_MIN = 6000, RETRY_MAX = 60000;

  var Sync = {
    enabled: false,
    status: 'local',   /* local | synced | saving | offline | waiting | pending | token */
    role: null,
    rev: 0,
    dirty: false,
    suppress: 0,
    lastUpdate: null,
    onStatus: null,
    onApplied: null,
    onNeedRole: null,
    onNotice: null
  };

  var store = null;
  var pushTimer = null, retryTimer = null, retryWait = RETRY_MIN, ticker = null;
  var busy = false, lastSent = null, autoResolved = false, watching = false;

  /* ---------------- 端末に残しておく小さな設定 ---------------- */

  function ls(k, v) {
    try {
      if (v === undefined) return global.localStorage.getItem(k);
      global.localStorage.setItem(k, v);
    } catch (e) {}
    return null;
  }
  function meta() {
    try {
      var m = JSON.parse(ls(META_KEY) || '{}');
      return { rev: m.rev || 0, dirty: !!m.dirty };
    } catch (e) { return { rev: 0, dirty: false }; }
  }
  function setMeta(rev, dirty) {
    Sync.rev = rev; Sync.dirty = dirty;
    ls(META_KEY, JSON.stringify({ rev: rev, dirty: dirty }));
  }
  function paired() { return ls(PAIRED_KEY) === '1'; }

  Sync.setToken = function (t) { ls(TOKEN_KEY, t || ''); };
  Sync.getRole = function () { return ls(ROLE_KEY) || null; };
  Sync.setRole = function (r) {
    ls(ROLE_KEY, r);
    Sync.role = r;
    restartTicker();
    if (Sync.enabled && store) connect();
  };
  Sync.suggestedRole = function () {
    return /iPhone|iPad|iPod|Android|Mobile/.test(navigator.userAgent || '') ? 'master' : 'viewer';
  };
  Sync.isMaster = function () { return Sync.role === 'master'; };

  function deviceName() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'ブラウザ';
  }

  function setStatus(s) {
    if (Sync.status === s) return;
    Sync.status = s;
    if (Sync.onStatus) Sync.onStatus(s);
  }
  function notice(m) { if (Sync.onNotice) Sync.onNotice(m); }

  function api(path, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' };
    var t = ls(TOKEN_KEY);
    if (t) h['X-Restore-Token'] = t;
    return fetch(path, { method: opts.method || 'GET', headers: h, body: opts.body, cache: 'no-store' });
  }

  /* 「どの車両を開いているか」は端末ごとの話なので共有しない */
  function shared(state) {
    var c = {}, k;
    for (k in state) if (Object.prototype.hasOwnProperty.call(state, k)) c[k] = state[k];
    delete c.view;
    delete c.selectedId;
    return c;
  }
  function sharedJson(state) { return JSON.stringify(shared(state)); }

  /* ---------------- 起動と復帰 ---------------- */

  Sync.init = function (Store, done) {
    store = Store;
    if (!global.fetch || global.location.protocol === 'file:') { done(false); return; }

    var stored = Sync.getRole();
    Sync.role = stored || Sync.suggestedRole();

    connect().then(function (ok) {
      done(ok);
      if (ok && !stored && Sync.onNeedRole) Sync.onNeedRole(Sync.role);
    });
    watch();
  };

  function connect() {
    return api('/api/ping').then(function (r) {
      if (r.status === 401) { setStatus('token'); throw new Error('token'); }
      if (!r.ok) throw new Error('ping');
      return r.json();
    }).then(function (info) {
      if (!info || info.app !== 'restore-cost') throw new Error('別のサーバー');
      Sync.enabled = true;
      Sync.needToken = !!info.needToken;
      ls(PAIRED_KEY, '1');
      restartTicker();
      return reconcile().then(function () { return true; });
    }).catch(function () {
      Sync.enabled = false;
      setStatus(Sync.status === 'token' ? 'token' : (paired() ? 'offline' : 'local'));
      if (paired()) scheduleRetry();
      return false;
    });
  }

  function reconcile() {
    var m = meta();
    return api('/api/state').then(function (r) {
      if (r.status === 401) { setStatus('token'); throw new Error('token'); }
      return r.json();
    }).then(function (srv) {
      remember(srv);
      if (!srv || !srv.rev) {
        if (Sync.isMaster()) return push();
        setStatus('waiting');
        return null;
      }
      if (!Sync.isMaster()) {
        /* 子機。未送信の変更があれば、勝手に消さずに本人へ判断してもらう */
        if (m.dirty) { setStatus('pending'); return null; }
        if (srv.rev !== m.rev) apply(srv);
        else setStatus('synced');
        return null;
      }
      if (!m.dirty) {
        if (srv.rev !== m.rev) apply(srv);
        else { setMeta(srv.rev, false); setStatus('synced'); }
        return null;
      }
      if (srv.rev === m.rev) return push();
      return overwrite();                  /* 未送信の変更は親機が優先 */
    });
  }

  function remember(srv) {
    if (srv && srv.updatedAt) Sync.lastUpdate = { updatedAt: srv.updatedAt, by: srv.by || null };
  }

  function apply(srv) {
    var keepView = store.state && store.state.view;
    var keepSel = store.state && store.state.selectedId;
    Sync.suppress++;
    try {
      store.replaceAll(srv.state);
      store.state.selectedId = store.vehicle(keepSel) ? keepSel : null;
      store.state.view = store.state.selectedId ? (keepView || 'home') : 'home';
      lastSent = sharedJson(store.state);
      setMeta(srv.rev, false);
    } finally {
      Sync.suppress--;
    }
    remember(srv);
    setStatus('synced');
    if (Sync.onApplied) Sync.onApplied(srv);
  }

  /* ---------------- 送信 ---------------- */

  function clearRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    retryWait = RETRY_MIN;
  }
  function scheduleRetry() {
    if (retryTimer) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      retryWait = Math.min(RETRY_MAX, retryWait * 2);
      if (!Sync.enabled) connect();
      else if (meta().dirty && Sync.isMaster()) push();
      else poll();
    }, retryWait);
  }

  function push() {
    if (!store) return Promise.resolve();
    busy = true;
    setStatus('saving');
    var m = meta();
    var sending = sharedJson(store.state);
    return api('/api/state', {
      method: 'PUT',
      body: '{"baseRev":' + m.rev + ',"by":' + JSON.stringify(deviceName()) + ',"state":' + sending + '}'
    }).then(function (r) {
      if (r.status === 401) { setStatus('token'); return; }
      if (r.status === 429) { setStatus('offline'); scheduleRetry(); return; }
      if (r.status === 409) {
        return r.json().then(function (srv) {
          remember(srv);
          if (Sync.isMaster()) {
            if (autoResolved) { setStatus('offline'); return; }
            autoResolved = true;
            return overwrite().then(function () { autoResolved = false; });
          }
          apply(srv);
          notice('親機の内容に更新しました（元に戻す で戻せます）');
        });
      }
      if (!r.ok) throw new Error('保存に失敗');
      return r.json().then(function (out) {
        lastSent = sending;
        Sync.lastUpdate = { updatedAt: out.updatedAt, by: deviceName() };
        setMeta(out.rev, false);
        Sync.enabled = true;
        clearRetry();
        setStatus('synced');
      });
    }).catch(function () {
      Sync.enabled = false;
      setStatus('offline');
      scheduleRetry();
    }).then(function () { busy = false; });
  }

  /* サーバーの版に合わせてから、この端末の内容で上書きする */
  function overwrite() {
    return api('/api/state').then(function (r) { return r.json(); }).then(function (srv) {
      setMeta(srv.rev || 0, true);
      return push();
    }).catch(function () { setStatus('offline'); scheduleRetry(); });
  }

  Sync.markDirty = function (Store) {
    if (Sync.suppress > 0) return;
    if (lastSent !== null && sharedJson(Store.state) === lastSent) return;
    if (!Sync.enabled && !paired()) return;
    setMeta(meta().rev, true);
    if (!Sync.isMaster()) { setStatus('pending'); return; }   /* 子機は自動で送らない */
    if (!Sync.enabled) { scheduleRetry(); return; }
    if (Sync.status !== 'offline') setStatus('saving');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(push, PUSH_DELAY);
  };

  /* ---------------- 受信 ---------------- */

  /* まず ping で版だけ確認し、変わっているときだけ本体を取りに行く */
  function poll() {
    if (busy || !store) return;
    api('/api/ping').then(function (r) {
      if (!r.ok) throw new Error('ping');
      return r.json();
    }).then(function (info) {
      if (!info || info.app !== 'restore-cost') throw new Error('別のサーバー');
      if (!Sync.enabled) { return connect(); }
      ls(PAIRED_KEY, '1');
      clearRetry();
      var m = meta();
      if (m.dirty) {
        if (Sync.isMaster()) push();
        else setStatus('pending');
        return;
      }
      if (!info.rev) { setStatus(Sync.isMaster() ? 'synced' : 'waiting'); return; }
      if (info.rev !== m.rev) return fetchState();
      setStatus('synced');
    }).catch(function () {
      Sync.enabled = false;
      setStatus(paired() ? 'offline' : 'local');
      scheduleRetry();
    });
  }
  Sync.pull = poll;
  Sync.push = function () { return push(); };
  Sync.forceOverwrite = overwrite;

  function fetchState() {
    return api('/api/state').then(function (r) { return r.json(); }).then(function (srv) {
      if (srv && srv.rev) apply(srv);
    });
  }

  /* 子機で加えた変更を、本人の意思で親機側へ送る */
  Sync.sendLocal = function () { return overwrite(); };

  /* 子機の変更を捨てて、親機の内容に合わせ直す */
  Sync.adoptServer = function () {
    return api('/api/state').then(function (r) { return r.json(); }).then(function (srv) {
      if (srv && srv.rev) apply(srv);
      else { setMeta(0, false); setStatus('waiting'); }
    }).catch(function () { setStatus('offline'); scheduleRetry(); });
  };

  /* ---------------- 見張り ---------------- */

  function restartTicker() {
    if (ticker) clearInterval(ticker);
    ticker = setInterval(function () {
      if (!Sync.enabled && !paired()) return;      /* 置き場所を使っていない端末では見に行かない */
      if (document.visibilityState === 'visible') poll();
    }, Sync.isMaster() ? TICK_MASTER : TICK_VIEWER);
  }

  function watch() {
    if (watching) return;
    watching = true;
    restartTicker();
    var wake = function () {
      if (document.visibilityState === 'hidden') return;
      if (!Sync.enabled && !paired()) return;
      clearRetry();
      if (Sync.enabled) poll(); else connect();
    };
    document.addEventListener('visibilitychange', wake);
    global.addEventListener('focus', wake);
    global.addEventListener('online', wake);
  }

  Sync.metaRev = function () { return meta().rev; };

  global.Sync = Sync;
})(window);
