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


  /* 作業日: 「9/3」「0903」「2026/9/3」などをまとめて受ける。
     読み取れたら YYYY-MM-DD で持ち、読めなければ書いた文字をそのまま残す。 */
  function parseDate(v) {
    if (v == null) return '';
    var s = String(v).trim().replace(/[０-９]/g, function (c) { return String(ZEN.indexOf(c)); });
    s = s.replace(/[年月]/g, '/').replace(/日/g, '').trim();
    if (!s) return '';
    var y, m, d, parts;
    if (/^\d{8}$/.test(s)) { y = +s.slice(0, 4); m = +s.slice(4, 6); d = +s.slice(6, 8); }
    else if (/^\d{4}$/.test(s)) { y = new Date().getFullYear(); m = +s.slice(0, 2); d = +s.slice(2, 4); }
    else {
      parts = s.split(/[\/\-.\s]+/).filter(function (x) { return x !== ''; });
      if (!parts.every(function (x) { return /^\d{1,4}$/.test(x); })) return s;
      if (parts.length === 2) { y = new Date().getFullYear(); m = +parts[0]; d = +parts[1]; }
      else if (parts.length === 3) {
        y = +parts[0]; m = +parts[1]; d = +parts[2];
        if (y < 100) y += 2000;
      } else return s;
    }
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y >= 1900 && y <= 2999)) return s;
    var dt = new Date(y, m - 1, d);
    if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return s;
    return y + '-' + pad2(m) + '-' + pad2(d);
  }

  function isISO(v) { return /^\d{4}-\d{2}-\d{2}$/.test(String(v || '')); }

  /* 表では月日だけ見せる（年はマウスを乗せると出る） */
  function shortDate(v) {
    if (!isISO(v)) return v || '';
    var p = String(v).split('-');
    return (+p[1]) + '/' + (+p[2]);
  }
  function fullDate(v) {
    if (!isISO(v)) return v || '';
    return String(v).replace(/-/g, '/');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function uid(prefix) {
    return (prefix || 'id') + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  global.F = { toNum: toNum, money: money, yen: yen, hours: hours, blankZero: blankZero, stamp: stamp, clock: clock, esc: esc, uid: uid,
    parseDate: parseDate, isISO: isISO, shortDate: shortDate, fullDate: fullDate };
})(window);
