/* ===================================================================
   端末どうしの同期

   ・親機（いつも使う携帯）… この端末の内容が「正」。編集すると自動で送る
   ・子機（PCなど）        … 開くたびに親機の内容を取り込む。
                              食い違ったときは必ず親機が優先される

   サーバーが見つからないときは何もしない（従来どおり端末内だけで動く）。
   =================================================================== */
(function (global) {
  'use strict';

  var META_KEY = 'restore-cost-app:sync';
  var TOKEN_KEY = 'restore-cost-app:token';
  var ROLE_KEY = 'restore-cost-app:role';

  var PUSH_DELAY = 900;
  var POLL_MASTER = 30000;    /* 親機はあまり取りに行かなくてよい */
  var POLL_VIEWER = 12000;    /* 子機はこまめに親機を見に行く */
  var RETRY_MIN = 8000, RETRY_MAX = 60000;

  var Sync = {
    enabled: false,
    status: 'local',   /* local | synced | saving | offline | waiting | pending | token */
    role: null,        /* 'master' | 'viewer' */
    rev: 0,
    dirty: false,
    suppress: 0,
    lastUpdate: null,  /* {updatedAt, by} */
    onStatus: null,
    onApplied: null,
    onNeedRole: null,
    onNotice: null
  };

  var pushTimer = null, retryTimer = null, retryWait = RETRY_MIN;
  var busy = false, lastSent = null, autoResolved = false;

  /* ---------------- 保存されている小さな設定 ---------------- */

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

  Sync.setToken = function (t) { ls(TOKEN_KEY, t || ''); };
  Sync.getRole = function () { return ls(ROLE_KEY) || null; };
  Sync.setRole = function (r, Store) {
    ls(ROLE_KEY, r);
    Sync.role = r;
    if (Store && Sync.enabled) reconcile(Store).catch(function () {});
  };
  Sync.suggestedRole = function () {
    var ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod|Android|Mobile/.test(ua) ? 'master' : 'viewer';
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
  function notice(msg) { if (Sync.onNotice) Sync.onNotice(msg); }

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

  /* ---------------- 起動 ---------------- */

  Sync.init = function (Store, done) {
    if (!global.fetch || global.location.protocol === 'file:') { done(false); return; }

    var stored = Sync.getRole();
    Sync.role = stored || Sync.suggestedRole();

    api('/api/ping').then(function (r) {
      if (!r.ok) throw new Error('ping');
      return r.json();
    }).then(function (info) {
      if (!info || info.app !== 'restore-cost') throw new Error('別のサーバー');
      Sync.enabled = true;
      Sync.needToken = !!info.needToken;
      return reconcile(Store);
    }).then(function () {
      done(true);
      watch(Store);
      if (!stored && Sync.onNeedRole) Sync.onNeedRole(Sync.role);
    }).catch(function () {
      Sync.enabled = false;
      setStatus(Sync.status === 'token' ? 'token' : 'local');
      done(false);
    });
  };

  function reconcile(Store) {
    var m = meta();
    return api('/api/state').then(function (r) {
      if (r.status === 401) { setStatus('token'); throw new Error('token'); }
      return r.json();
    }).then(function (srv) {
      remember(srv);

      if (!srv || !srv.rev) {
        /* サーバーはまだ空 */
        if (Sync.isMaster()) return push(Store);
        setStatus('waiting');
        return null;
      }

      if (!Sync.isMaster()) {
        /* 子機は親機の内容に合わせる。ただしこの端末に未送信の変更があれば、
           勝手に消さずに本人へ判断してもらう */
        if (m.dirty) { setStatus('pending'); return null; }
        if (srv.rev !== m.rev) apply(Store, srv);
        else setStatus('synced');
        return null;
      }

      /* 親機 */
      if (!m.dirty) {
        if (srv.rev !== m.rev) apply(Store, srv);
        else { setMeta(srv.rev, false); setStatus('synced'); }
        return null;
      }
      if (srv.rev === m.rev) return push(Store);
      return overwrite(Store);          /* 未送信の変更は親機が優先 */
    });
  }

  function remember(srv) {
    if (srv && srv.updatedAt) Sync.lastUpdate = { updatedAt: srv.updatedAt, by: srv.by || null };
  }

  function apply(Store, srv) {
    var keepView = Store.state && Store.state.view;
    var keepSel = Store.state && Store.state.selectedId;
    Sync.suppress++;
    try {
      Store.replaceAll(srv.state);
      Store.state.selectedId = Store.vehicle(keepSel) ? keepSel : null;
      Store.state.view = Store.state.selectedId ? (keepView || 'home') : 'home';
      lastSent = sharedJson(Store.state);
      setMeta(srv.rev, false);
    } finally {
      Sync.suppress--;
    }
    remember(srv);
    setStatus('synced');
    if (Sync.onApplied) Sync.onApplied(srv);
  }
  Sync.apply = apply;

  /* ---------------- 送信 ---------------- */

  function clearRetry() {
    if (retryTimer) { clearTimeout(retryTimer); retryTimer = null; }
    retryWait = RETRY_MIN;
  }
  function scheduleRetry(Store) {
    if (retryTimer) return;
    retryTimer = setTimeout(function () {
      retryTimer = null;
      retryWait = Math.min(RETRY_MAX, retryWait * 2);
      if (meta().dirty) push(Store);
      else pull(Store);
    }, retryWait);
  }

  function push(Store) {
    if (!Sync.enabled) return Promise.resolve();
    busy = true;
    setStatus('saving');
    var m = meta();
    var sending = sharedJson(Store.state);
    return api('/api/state', {
      method: 'PUT',
      body: '{"baseRev":' + m.rev + ',"by":' + JSON.stringify(deviceName()) + ',"state":' + sending + '}'
    }).then(function (r) {
      if (r.status === 401) { setStatus('token'); return; }
      if (r.status === 409) {
        return r.json().then(function (srv) {
          remember(srv);
          if (Sync.isMaster()) {
            if (autoResolved) { setStatus('offline'); return; }
            autoResolved = true;
            return overwrite(Store).then(function () { autoResolved = false; });
          }
          apply(Store, srv);
          notice('親機の内容に更新しました（元に戻す で戻せます）');
        });
      }
      if (!r.ok) throw new Error('保存に失敗');
      return r.json().then(function (out) {
        lastSent = sending;
        Sync.lastUpdate = { updatedAt: out.updatedAt, by: deviceName() };
        setMeta(out.rev, false);
        clearRetry();
        setStatus('synced');
      });
    }).catch(function () {
      setStatus('offline');
      scheduleRetry(Store);
    }).then(function () { busy = false; });
  }
  Sync.push = push;

  /* サーバーの版に合わせてから、この端末の内容で上書きする */
  function overwrite(Store) {
    return api('/api/state').then(function (r) { return r.json(); }).then(function (srv) {
      setMeta(srv.rev || 0, true);
      return push(Store);
    }).catch(function () { setStatus('offline'); });
  }
  Sync.forceOverwrite = overwrite;

  Sync.markDirty = function (Store) {
    if (!Sync.enabled || Sync.suppress > 0) return;
    if (lastSent !== null && sharedJson(Store.state) === lastSent) return;
    setMeta(meta().rev, true);
    if (!Sync.isMaster()) {
      /* 子機は自動では送らない。親機の内容を勝手に書き換えないため */
      setStatus('pending');
      return;
    }
    if (Sync.status !== 'offline') setStatus('saving');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push(Store); }, PUSH_DELAY);
  };

  /* ---------------- 受信 ---------------- */

  function pull(Store) {
    if (!Sync.enabled || busy) return;
    var m = meta();
    if (Sync.isMaster() && m.dirty) { push(Store); return; }
    if (!Sync.isMaster() && m.dirty) { setStatus('pending'); return; }   /* 判断待ち */
    api('/api/state').then(function (r) {
      if (!r.ok) throw new Error('pull');
      return r.json();
    }).then(function (srv) {
      remember(srv);
      if (!srv || !srv.rev) { setStatus(Sync.isMaster() ? 'synced' : 'waiting'); return; }
      if (srv.rev !== meta().rev) apply(Store, srv);
      else setStatus('synced');
      clearRetry();
    }).catch(function () {
      setStatus('offline');
      scheduleRetry(Store);
    });
  }
  Sync.pull = pull;

  function watch(Store) {
    setInterval(function () {
      if (document.visibilityState === 'visible') pull(Store);
    }, Sync.isMaster() ? POLL_MASTER : POLL_VIEWER);

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') { clearRetry(); pull(Store); }
    });
    global.addEventListener('focus', function () { clearRetry(); pull(Store); });
    global.addEventListener('online', function () { clearRetry(); pull(Store); });
  }

  /* 子機で加えた変更を、本人の意思で親機側へ送る */
  Sync.sendLocal = function (Store) { return overwrite(Store); };

  /* 子機の変更を捨てて、親機の内容に合わせ直す */
  Sync.adoptServer = function (Store) {
    return api('/api/state').then(function (r) { return r.json(); }).then(function (srv) {
      if (srv && srv.rev) apply(Store, srv);
      else { setMeta(0, false); setStatus('waiting'); }
    }).catch(function () { setStatus('offline'); });
  };

  Sync.metaRev = function () { return meta().rev; };

  global.Sync = Sync;
})(window);
