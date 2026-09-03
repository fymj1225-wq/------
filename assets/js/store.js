/* データの保存・読み込み・元に戻す */
(function (global) {
  'use strict';

  var KEY = 'restore-cost-app:v1';
  var MAX_UNDO = 80;

  var Store = {
    state: null,
    _undo: [],
    _redo: [],
    _lastKey: null,
    _lastAt: 0,
    _saveTimer: null,
    onChange: null,   // 差し替え可能なコールバック
    onSaved: null
  };

  function defaults() {
    return {
      version: 1,
      settings: {
        hourlyRate: 5000,
        workers: [
          { id: 'w1', name: '担当A' },
          { id: 'w2', name: '担当B' },
          { id: 'w3', name: '担当C' }
        ]
      },
      vehicles: [],
      selectedId: null,
      view: 'home'
    };
  }

  function migrate(data) {
    var d = data || {};
    if (!d.settings) d.settings = defaults().settings;
    if (!Array.isArray(d.settings.workers) || !d.settings.workers.length) {
      d.settings.workers = defaults().settings.workers;
    }
    d.settings.hourlyRate = global.F.toNum(d.settings.hourlyRate) || 5000;
    if (!Array.isArray(d.vehicles)) d.vehicles = [];
    d.vehicles.forEach(function (v) {
      if (!v.id) v.id = global.F.uid('v');
      if (!Array.isArray(v.rows)) v.rows = [];
      if (v.hourlyRate == null) v.hourlyRate = d.settings.hourlyRate;
      if (!v.status) v.status = '作業中';
      if (v.photo == null) v.photo = '';
      v.rows.forEach(function (r) {
        if (!r.id) r.id = global.F.uid('r');
        if (!r.type) r.type = 'item';
        if (r.date == null) r.date = '';
        if (!r.hours || typeof r.hours !== 'object') r.hours = {};
      });
    });
    if (d.view !== 'vehicle') d.view = 'home';
    d.version = 1;
    return d;
  }

  Store.load = function () {
    var raw = null;
    try { raw = global.localStorage.getItem(KEY); } catch (e) { raw = null; }
    if (raw) {
      try {
        Store.state = migrate(JSON.parse(raw));
        return false; /* 初回ではない */
      } catch (e) { /* 壊れていたら初期化 */ }
    }
    Store.state = migrate(defaults());
    return true; /* 初回起動 */
  };

  Store.saveNow = function () {
    try {
      global.localStorage.setItem(KEY, JSON.stringify(Store.state));
      if (Store.onSaved) Store.onSaved(true);
    } catch (e) {
      if (Store.onSaved) Store.onSaved(false, e);
    }
    if (global.Sync) global.Sync.markDirty(Store);
  };

  Store.save = function () {
    if (Store._saveTimer) clearTimeout(Store._saveTimer);
    Store._saveTimer = setTimeout(Store.saveNow, 350);
  };

  /* 変更を1つの取り消し単位として記録する。
     key を渡すと、同じ key の連続変更（文字入力など）はまとめられる。 */
  Store.mutate = function (key, fn) {
    var now = Date.now();
    var coalesce = key && Store._lastKey === key && (now - Store._lastAt) < 900;
    if (!coalesce) {
      Store._undo.push(JSON.stringify(Store.state));
      if (Store._undo.length > MAX_UNDO) Store._undo.shift();
      Store._redo.length = 0;
    }
    Store._lastKey = key || null;
    Store._lastAt = now;
    fn(Store.state);
    Store.save();
  };

  Store.undo = function () {
    if (!Store._undo.length) return false;
    Store._redo.push(JSON.stringify(Store.state));
    Store.state = migrate(JSON.parse(Store._undo.pop()));
    Store._lastKey = null;
    Store.save();
    return true;
  };

  Store.redo = function () {
    if (!Store._redo.length) return false;
    Store._undo.push(JSON.stringify(Store.state));
    Store.state = migrate(JSON.parse(Store._redo.pop()));
    Store._lastKey = null;
    Store.save();
    return true;
  };

  Store.canUndo = function () { return Store._undo.length > 0; };
  Store.canRedo = function () { return Store._redo.length > 0; };

  Store.replaceAll = function (data) {
    Store._undo.push(JSON.stringify(Store.state));
    Store._redo.length = 0;
    Store.state = migrate(data);
    Store.saveNow();
  };

  Store.vehicle = function (id) {
    var list = Store.state.vehicles, i;
    for (i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  };

  Store.selected = function () {
    return Store.vehicle(Store.state.selectedId);
  };

  global.Store = Store;
})(window);
