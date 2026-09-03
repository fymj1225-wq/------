/* ===================================================================
   共有サーバーとの同期
   サーバーが居れば全端末で同じデータを見る。居なければ何もしない
   （この端末のブラウザ内だけで動く、従来どおりの動作）。
   =================================================================== */
(function (global) {
  'use strict';

  var META_KEY = 'restore-cost-app:sync';
  var TOKEN_KEY = 'restore-cost-app:token';
  var PUSH_DELAY = 900;
  var POLL_MS = 20000;

  var Sync = {
    enabled: false,       /* サーバーが見つかったか */
    status: 'local',      /* local | synced | saving | offline | conflict */
    rev: 0,
    dirty: false,
    suppress: 0,          /* 内部書き込み中は「変更あり」にしない */
    onStatus: null,
    onApplied: null,      /* サーバーの内容を取り込んだ */
    onConflict: null      /* 他端末と食い違った */
  };

  var pushTimer = null;
  var busy = false;
  var lastSent = null;      /* 直近にサーバーへ送った内容（無駄な送信を避ける） */

  /* 「どの車両を開いているか」は端末ごとの話なので共有しない */
  function shared(state) {
    var c = {}, k;
    for (k in state) if (Object.prototype.hasOwnProperty.call(state, k)) c[k] = state[k];
    delete c.view;
    delete c.selectedId;
    return c;
  }
  function sharedJson(state) { return JSON.stringify(shared(state)); }

  function meta() {
    try {
      var m = JSON.parse(global.localStorage.getItem(META_KEY) || '{}');
      return { rev: m.rev || 0, dirty: !!m.dirty };
    } catch (e) { return { rev: 0, dirty: false }; }
  }
  function setMeta(rev, dirty) {
    Sync.rev = rev; Sync.dirty = dirty;
    try { global.localStorage.setItem(META_KEY, JSON.stringify({ rev: rev, dirty: dirty })); } catch (e) {}
  }
  function token() {
    try { return global.localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
  }
  Sync.setToken = function (t) {
    try { global.localStorage.setItem(TOKEN_KEY, t || ''); } catch (e) {}
  };

  function setStatus(s) {
    if (Sync.status === s) return;
    Sync.status = s;
    if (Sync.onStatus) Sync.onStatus(s);
  }

  function api(path, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' };
    if (token()) h['X-Restore-Token'] = token();
    return fetch(path, {
      method: opts.method || 'GET',
      headers: h,
      body: opts.body,
      cache: 'no-store'
    });
  }

  /* デバイス名（どの端末が最後に触ったか分かるように） */
  function deviceName() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad|iPod/.test(ua)) return 'iPhone/iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'ブラウザ';
  }

  /* ---------------- 起動時のすり合わせ ---------------- */

  Sync.init = function (Store, done) {
    if (!global.fetch || global.location.protocol === 'file:') { done(false); return; }

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
      startWatchers(Store);
    }).catch(function () {
      Sync.enabled = false;
      setStatus('local');
      done(false);
    });
  };

  function reconcile(Store) {
    var m = meta();
    return api('/api/state').then(function (r) {
      if (r.status === 401) { setStatus('token'); throw new Error('token'); }
      return r.json();
    }).then(function (srv) {
      if (!srv || srv.rev === 0) {
        /* サーバーが空 → この端末の内容を初期値として送る */
        return push(Store, true);
      }
      if (!m.dirty) {
        if (srv.rev !== m.rev) { apply(Store, srv); }
        else { setMeta(srv.rev, false); setStatus('synced'); }
        return null;
      }
      /* この端末に未送信の変更がある */
      if (srv.rev === m.rev) return push(Store, true);
      setStatus('conflict');
      if (Sync.onConflict) Sync.onConflict(srv);
      return null;
    });
  }

  function apply(Store, srv) {
    var keepView = Store.state && Store.state.view;
    var keepSel = Store.state && Store.state.selectedId;
    Sync.suppress++;
    try {
      Store.replaceAll(srv.state);
      /* 表示中の車両は端末ごとに保つ */
      Store.state.selectedId = Store.vehicle(keepSel) ? keepSel : null;
      Store.state.view = Store.state.selectedId ? (keepView || 'home') : 'home';
      lastSent = sharedJson(Store.state);
      setMeta(srv.rev, false);
    } finally {
      Sync.suppress--;
    }
    setStatus('synced');
    if (Sync.onApplied) Sync.onApplied(srv);
  }
  Sync.apply = apply;

  /* ---------------- 送信 ---------------- */

  function push(Store, immediate) {
    if (!Sync.enabled) return Promise.resolve();
    if (busy && !immediate) return Promise.resolve();
    busy = true;
    setStatus('saving');
    var m = meta();
    var sending = sharedJson(Store.state);
    return api('/api/state', {
      method: 'PUT',
      body: '{"baseRev":' + m.rev + ',"by":' + JSON.stringify(deviceName()) + ',"state":' + sending + '}'
    }).then(function (r) {
      if (r.status === 409) {
        return r.json().then(function (srv) {
          setStatus('conflict');
          if (Sync.onConflict) Sync.onConflict(srv);
        });
      }
      if (r.status === 401) { setStatus('token'); return; }
      if (!r.ok) throw new Error('保存に失敗');
      return r.json().then(function (out) {
        lastSent = sending;
        setMeta(out.rev, false);
        setStatus('synced');
      });
    }).catch(function () {
      setStatus('offline');
    }).then(function () {
      busy = false;
    });
  }
  Sync.push = function (Store) { return push(Store, true); };

  /* Store から呼ばれる。ローカル保存のたびに送信を予約する */
  Sync.markDirty = function (Store) {
    if (!Sync.enabled || Sync.suppress > 0) return;
    if (lastSent !== null && sharedJson(Store.state) === lastSent) return;  /* 中身は変わっていない */
    setMeta(meta().rev, true);
    if (Sync.status !== 'conflict') setStatus('saving');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(function () { push(Store, true); }, PUSH_DELAY);
  };

  /* ---------------- 受信 ---------------- */

  function pull(Store) {
    if (!Sync.enabled || busy) return;
    var m = meta();
    if (m.dirty) return;                 /* 送るものがあるなら受け取らない */
    api('/api/state').then(function (r) {
      if (!r.ok) throw new Error('pull');
      return r.json();
    }).then(function (srv) {
      if (srv && srv.rev && srv.rev !== meta().rev && !meta().dirty) apply(Store, srv);
      else setStatus('synced');
    }).catch(function () { setStatus('offline'); });
  }
  Sync.pull = pull;

  function startWatchers(Store) {
    setInterval(function () {
      if (document.visibilityState === 'visible') pull(Store);
    }, POLL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') pull(Store);
    });
    global.addEventListener('focus', function () { pull(Store); });
    global.addEventListener('online', function () { pull(Store); });
  }

  Sync.metaRev = function () { return meta().rev; };
  Sync.forceOverwrite = function (Store) {
    /* サーバーの版に合わせてから、この端末の内容で上書きする */
    return api('/api/state').then(function (r) { return r.json(); }).then(function (srv) {
      setMeta(srv.rev || 0, true);
      return push(Store, true);
    });
  };

  global.Sync = Sync;
})(window);
