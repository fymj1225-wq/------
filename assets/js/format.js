/* 数値の表示・入力まわりの共通処理 */
(function (global) {
  'use strict';

  var ZEN = '０１２３４５６７８９';
  function toNum(v) {
    if (typeof v === 'number') return isFinite(v) ? v : 0;
    if (v == null) return 0;
    var s = String(v).replace(/[０-９．，－]/g, function (c) {
      var i = ZEN.indexOf(c);
      if (i >= 0) return String(i);
      if (c === '．') return '.';
      if (c === '，') return ',';
      return '-';
    });
    s = s.replace(/[,\s¥￥円時間h]/g, '');
    if (s === '' || s === '-' || s === '.') return 0;
    var n = parseFloat(s);
    return isFinite(n) ? n : 0;
  }

  /* 金額: 整数・3桁区切り */
  function money(n) {
    n = Math.round(toNum(n));
    return n.toLocaleString('ja-JP');
  }
  function yen(n) {
    return '¥' + money(n);
  }
  /* 工数: 小数第2位まで、余計な0は落とす */
  function hours(n) {
    n = toNum(n);
    if (n === 0) return '';
    return String(Math.round(n * 100) / 100);
  }
  /* 0を空欄で見せたい入力欄向け */
  function blankZero(n, fmt) {
    return toNum(n) === 0 ? '' : fmt(n);
  }

  function pad2(n) { return n < 10 ? '0' + n : String(n); }
  function stamp(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()) +
      '_' + pad2(d.getHours()) + pad2(d.getMinutes());
  }
  function clock(d) {
    d = d || new Date();
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + ':' + pad2(d.getSeconds());
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  global.F = { toNum: toNum, money: money, yen: yen, hours: hours, blankZero: blankZero, stamp: stamp, clock: clock, esc: esc, uid: uid };
})(window);
