/* 画面まわり */
(function (global) {
  'use strict';

  var F = global.F, Store = global.Store, Calc = global.Calc;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var STATUSES = ['見積', '作業中', '完了', '納車済'];

  /* ---------------- 共通ヘルパー ---------------- */

  function workers() { return Store.state.settings.workers; }

  function toast(msg) {
    var el = document.createElement('div');
    el.className = 'toast';
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(function () { el.remove(); }, 2200);
  }

  function download(filename, text, mime) {
    var blob = new Blob([text], { type: (mime || 'text/plain') + ';charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
  }

  function moneyCell(v) { return F.toNum(v) === 0 ? '' : F.money(v); }
  function hourCell(v) { return F.toNum(v) === 0 ? '' : F.hours(v); }

  function vehicleLabel(v) {
    return [v.name, v.grade, v.color, v.no, v.year, v.engine]
      .filter(function (s) { return s && String(s).trim(); }).join('　');
  }

  /* ---------------- トップ（車両アカウント一覧） ---------------- */

  function photoStyle(v) {
    return v.photo ? ' style="background-image:url(' + v.photo.replace(/"/g, '') + ')"' : '';
  }

  function accountCard(v) {
    var t = Calc.vehicleTotals(v, workers());
    var sub = [v.grade, v.color, v.year, v.engine].filter(Boolean).join(' / ');
    return '<article class="acct" data-open="' + v.id + '">' +
      '<div class="acct-photo' + (v.photo ? '' : ' empty') + '"' + photoStyle(v) + '>' +
        (v.photo ? '' : '<span>写真なし</span>') +
        '<span class="pill st-' + F.esc(v.status || '作業中') + '">' + F.esc(v.status || '作業中') + '</span>' +
      '</div>' +
      '<div class="acct-body">' +
        '<div class="acct-name">' + F.esc(v.name || '（無名）') + '</div>' +
        '<div class="acct-sub">' + F.esc(sub || '—') + (v.no ? '　#' + F.esc(v.no) : '') + '</div>' +
        '<dl class="acct-figs">' +
          '<div><dt>仕入原価</dt><dd>' + F.yen(t.purchasePrice) + '</dd></div>' +
          '<div><dt>かかった工数</dt><dd>' + (F.hours(t.totalHours) || '0') + '<span class="u"> h</span>' +
            '<span class="brk">自社 ' + (F.hours(t.selfHours) || '0') + ' / 外注 ' + (F.hours(t.outsourceHours) || '0') + '</span></dd></div>' +
          '<div><dt>かかった金額</dt><dd>' + F.yen(t.spentCost) +
            '<span class="brk">部品・外注 ' + F.money(t.materialCost) + ' / 人件費 ' + F.money(t.laborCost) + '</span></dd></div>' +
        '</dl>' +
        '<div class="acct-total"><span>総計</span><b>' + F.yen(t.grandTotal) + '</b></div>' +
      '</div></article>';
  }

  function renderHome() {
    var q = ($('#vehSearch').value || '').trim().toLowerCase();
    var list = Store.state.vehicles.filter(function (v) {
      return !q || vehicleLabel(v).toLowerCase().indexOf(q) >= 0;
    });
    var all = Store.state.vehicles.reduce(function (a, v) {
      return a + Calc.vehicleTotals(v, workers()).grandTotal;
    }, 0);

    $('#detail').innerHTML =
      '<div class="home-head">' +
        '<div><h2>車両アカウント</h2>' +
        '<p class="hint">開きたい車両をクリックすると、作業明細に入れます。</p></div>' +
        '<div class="home-stat"><span>登録 ' + Store.state.vehicles.length + ' 台</span>' +
        '<b>原価合計 ' + F.yen(all) + '</b></div>' +
      '</div>' +
      (list.length
        ? '<div class="acct-grid">' + list.map(accountCard).join('') + '</div>'
        : '<div class="empty"><h2>' + (q ? '該当する車両がありません' : 'まだ車両がありません') + '</h2>' +
          '<p>' + (q ? '検索条件を変えてみてください。' : '上の「＋ 車両を追加」から最初の1台を登録してください。') + '</p></div>');
  }

  /* ---------------- サイドバー ---------------- */

  function renderSidebar() {
    var q = ($('#vehSearch').value || '').trim().toLowerCase();
    var list = Store.state.vehicles.filter(function (v) {
      if (!q) return true;
      return vehicleLabel(v).toLowerCase().indexOf(q) >= 0;
    });

    var html = list.map(function (v) {
      var t = Calc.vehicleTotals(v, workers());
      var sub = [v.grade, v.color, v.year, v.engine].filter(Boolean).join(' / ') || '—';
      return '<div class="veh-card' + (v.id === Store.state.selectedId ? ' active' : '') + '" data-veh="' + v.id + '">' +
        '<div class="nm">' + F.esc(v.name || '（無名）') +
        '<span class="pill st-' + F.esc(v.status || '作業中') + '">' + F.esc(v.status || '作業中') + '</span></div>' +
        '<div class="sub">' + F.esc(sub) + (v.no ? '　#' + F.esc(v.no) : '') + '</div>' +
        '<div class="tot"><small>原価総計</small>' + F.yen(t.grandTotal) + '</div>' +
        '</div>';
    }).join('');

    $('#vehList').innerHTML = html ||
      '<div class="hint" style="padding:14px 6px">該当する車両がありません</div>';
    $('#vehCount').textContent = Store.state.vehicles.length + ' 台';

    var all = Store.state.vehicles.reduce(function (a, v) {
      return a + Calc.vehicleTotals(v, workers()).grandTotal;
    }, 0);
    $('#grandAll').textContent = '合計 ' + F.yen(all);
  }

  /* ---------------- 明細テーブル ---------------- */

  function colCount() { return 7 + workers().length + 1; }

  function rowHtml(r, idx) {
    var ws = workers();
    if (r.type === 'divider') {
      return '<tr class="divider" data-row="' + r.id + '">' +
        '<td class="no"></td>' +
        '<td colspan="' + (colCount() - 2) + '">' +
          '<input data-f="work" value="' + F.esc(r.work) + '" placeholder="── 区切り／見出し（任意） ──">' +
        '</td>' +
        '<td class="act">' + actBtns() + '</td></tr>';
    }
    var cells = ws.map(function (w) {
      return '<td class="num"><input data-f="h:' + w.id + '" data-kind="hours" value="' +
        F.esc(hourCell(r.hours && r.hours[w.id])) + '"></td>';
    }).join('');
    return '<tr data-row="' + r.id + '">' +
      '<td class="no">' + idx + '</td>' +
      '<td class="dt"><input data-f="date" data-kind="date" title="' + F.esc(F.fullDate(r.date)) +
        '" value="' + F.esc(F.shortDate(r.date)) + '"></td>' +
      '<td><input data-f="work" title="' + F.esc(r.work) + '" value="' + F.esc(r.work) + '"></td>' +
      '<td><input data-f="part" title="' + F.esc(r.part) + '" value="' + F.esc(r.part) + '"></td>' +
      '<td class="num"><input data-f="partCost" data-kind="money" value="' + F.esc(moneyCell(r.partCost)) + '"></td>' +
      '<td class="num"><input data-f="outCost" data-kind="money" value="' + F.esc(moneyCell(r.outCost)) + '"></td>' +
      cells +
      '<td class="num"><input data-f="outHours" data-kind="hours" value="' + F.esc(hourCell(r.outHours)) + '"></td>' +
      '<td class="act">' + actBtns() + '</td></tr>';
  }

  function actBtns() {
    return '<button class="mini" data-act="up" title="上へ">↑</button>' +
      '<button class="mini" data-act="down" title="下へ">↓</button>' +
      '<button class="mini" data-act="dup" title="複製">⧉</button>' +
      '<button class="mini del" data-act="del" title="削除">✕</button>';
  }

  function tableHtml(v) {
    var ws = workers();
    var cols = '<colgroup><col style="width:38px"><col style="width:64px"><col class="w-work"><col class="w-part">' +
      '<col class="w-money"><col class="w-money">' +
      ws.map(function () { return '<col class="w-hour">'; }).join('') +
      '<col class="w-hour"><col style="width:78px"></colgroup>';

    var head = '<thead><tr>' +
      '<th class="no">No</th>' +
      '<th class="c-date" title="作業した日。9/3・0903・2026/9/3 などで入力できます">作業日</th>' +
      '<th class="c-work">作業名</th>' +
      '<th class="c-part">部品名</th>' +
      '<th class="c-money">部品代</th>' +
      '<th class="c-money">外注費</th>' +
      ws.map(function (w) {
        return '<th class="c-hour" title="工数（時間）">' + F.esc(w.name) + '</th>';
      }).join('') +
      '<th class="c-out" title="外注の作業時間">外注</th>' +
      '<th class="act">操作</th></tr></thead>';

    var idx = 0;
    var body = '<tbody>' + v.rows.map(function (r) {
      if (r.type !== 'divider') idx++;
      return rowHtml(r, r.type === 'divider' ? '' : idx);
    }).join('') + '</tbody>';

    var foot = '<tfoot><tr>' +
      '<td class="lbl" colspan="4">合計（税込）</td>' +
      '<td id="tot-part"></td>' +
      '<td id="tot-out"></td>' +
      ws.map(function (w) { return '<td id="tot-w-' + w.id + '"></td>'; }).join('') +
      '<td id="tot-outh"></td>' +
      '<td class="act"></td></tr></tfoot>';

    return '<table class="cost">' + cols + head + body + foot + '</table>';
  }

  /* 印刷用：入力欄だと長い文字が切れるので、印刷直前に文字だけの表へ差し替える */
  function staticTableHtml(v) {
    var ws = workers();
    var t = Calc.vehicleTotals(v, ws);
    var head = '<thead><tr><th class="no">No</th><th class="c-date">作業日</th>' +
      '<th class="c-work">作業名</th><th class="c-part">部品名</th>' +
      '<th class="c-money">部品代</th><th class="c-money">外注費</th>' +
      ws.map(function (w) { return '<th class="c-hour">' + F.esc(w.name) + '</th>'; }).join('') +
      '<th class="c-out">外注</th></tr></thead>';
    var idx = 0;
    var body = '<tbody>' + v.rows.map(function (r) {
      if (r.type === 'divider') {
        return '<tr class="divider"><td class="no"></td><td colspan="' + (colCount() - 2) + '">' +
          F.esc(r.work) + '</td></tr>';
      }
      idx++;
      return '<tr><td class="no">' + idx + '</td>' +
        '<td class="num">' + F.esc(F.shortDate(r.date)) + '</td>' +
        '<td class="tx">' + F.esc(r.work) + '</td>' +
        '<td class="tx">' + F.esc(r.part) + '</td>' +
        '<td class="num">' + F.esc(moneyCell(r.partCost)) + '</td>' +
        '<td class="num">' + F.esc(moneyCell(r.outCost)) + '</td>' +
        ws.map(function (w) {
          return '<td class="num">' + F.esc(hourCell(r.hours && r.hours[w.id])) + '</td>';
        }).join('') +
        '<td class="num">' + F.esc(hourCell(r.outHours)) + '</td></tr>';
    }).join('') + '</tbody>';
    var foot = '<tfoot><tr><td class="lbl" colspan="4">合計（税込）</td>' +
      '<td>' + F.money(t.partCost) + '</td><td>' + F.money(t.outsourceCost) + '</td>' +
      ws.map(function (w) { return '<td>' + (F.hours(t.workerHours[w.id]) || '0') + '</td>'; }).join('') +
      '<td>' + (F.hours(t.outsourceHours) || '0') + '</td></tr></tfoot>';
    return '<table class="cost print-tbl">' + head + body + foot + '</table>';
  }

  function preparePrint() {
    var v = Store.selected();
    var host = $('#printTbl');
    if (!host || !v) return;
    host.innerHTML = staticTableHtml(v);
  }

  /* ---------------- 詳細画面 ---------------- */

  function field(label, key, value, opts) {
    opts = opts || {};
    var cls = 'f' + (opts.span ? ' span' + opts.span : '');
    var input;
    if (opts.type === 'select') {
      input = '<select data-v="' + key + '">' + opts.options.map(function (o) {
        return '<option' + (o === value ? ' selected' : '') + '>' + F.esc(o) + '</option>';
      }).join('') + '</select>';
    } else if (opts.type === 'textarea') {
      input = '<textarea data-v="' + key + '">' + F.esc(value) + '</textarea>';
    } else if (opts.type === 'money') {
      input = '<input class="num" data-v="' + key + '" data-kind="money" value="' + F.esc(F.money(value)) + '">';
    } else {
      input = '<input data-v="' + key + '" value="' + F.esc(value) + '" placeholder="' + F.esc(opts.ph || '') + '">';
    }
    return '<div class="' + cls + '"><label>' + F.esc(label) + '</label>' + input + '</div>';
  }

  function renderDetail() {
    var v = Store.selected();
    var el = $('#detail');
    if (!v) {
      el.innerHTML = '<div class="empty"><h2>車両が選ばれていません</h2>' +
        '<p>左の一覧から選ぶか、上の「＋ 車両を追加」で新しい箱を作ってください。</p></div>';
      return;
    }

    el.innerHTML =
      '<div class="print-head"><div class="t">' + F.esc(vehicleLabel(v)) + '</div>' +
        '<div class="p">仕入価格　' + F.yen(v.purchasePrice) + '</div></div>' +

      '<section class="card no-print"><div class="card-head"><h3>車両情報</h3><span class="spacer"></span>' +
        '<button class="btn sm" data-vact="dup">この車両を複製</button>' +
        '<button class="btn sm danger" data-vact="del">車両を削除</button>' +
      '</div><div class="card-body"><div class="veh-info">' +
      '<div class="photo-box">' +
        '<div class="photo' + (v.photo ? '' : ' empty') + '" id="photoBox"' + photoStyle(v) + '>' +
          (v.photo ? '' : '<span>クリック／ドラッグで<br>写真を追加</span>') + '</div>' +
        '<div class="photo-btns">' +
          '<button class="btn sm" data-vact="photo">写真を選ぶ</button>' +
          '<button class="btn sm danger" id="photoDel" data-vact="photoDel"' + (v.photo ? '' : ' disabled') + '>削除</button>' +
        '</div></div>' +
      '<div class="veh-form">' +
        field('車名', 'name', v.name, { span: 2, ph: '例）ユーノス' }) +
        field('グレード', 'grade', v.grade, { ph: '例）Sパッケージ' }) +
        field('色', 'color', v.color, { ph: '例）シルバー' }) +
        field('管理番号', 'no', v.no, { ph: '例）218287' }) +
        field('状態', 'status', v.status, { type: 'select', options: STATUSES }) +
        field('年式', 'year', v.year, { ph: '例）H5年式' }) +
        field('排気量', 'engine', v.engine, { ph: '例）1600cc' }) +
        field('仕入価格（税込）', 'purchasePrice', v.purchasePrice, { type: 'money', span: 2 }) +
        field('時間単価（円/h）', 'hourlyRate', v.hourlyRate, { type: 'money', span: 2 }) +
        field('メモ', 'memo', v.memo, { type: 'textarea', span: 6 }) +
      '</div></div></div></section>' +

      '<section class="card"><div class="card-head"><h3>原価サマリー</h3></div>' +
      '<div class="card-body"><div class="sum-grid" id="sumGrid"></div></div></section>' +

      '<section class="card"><div class="card-head"><h3>作業明細</h3><span class="spacer"></span>' +
        '<span class="hint">Enterで下の行へ／最終行なら新しい行を追加</span>' +
      '</div><div class="tbl-wrap" id="tblWrap">' + tableHtml(v) + '</div>' +
      '<div id="printTbl"></div>' +
      '<div class="tbl-tools no-print">' +
        '<button class="btn primary" data-tact="add">＋ 行を追加</button>' +
        '<button class="btn" data-tact="add10">＋ 10行</button>' +
        '<button class="btn" data-tact="divider">＋ 区切り行</button>' +
        '<span class="spacer" style="flex:1"></span>' +
        '<span class="hint" id="rowInfo"></span>' +
      '</div></section>';

    updateTotals();
  }

  /* 合計だけを差し替える（入力中もフォーカスを保つ） */
  function updateTotals() {
    var v = Store.selected();
    if (!v || isHome()) return;
    var ws = workers();
    var t = Calc.vehicleTotals(v, ws);

    var g = $('#sumGrid');
    if (g) {
      g.innerHTML =
        sumCell('仕入価格', F.yen(t.purchasePrice)) +
        sumCell('部品代', F.yen(t.partCost)) +
        sumCell('外注費', F.yen(t.outsourceCost)) +
        sumCell('部品代＋外注費', F.yen(t.materialCost), 'hi') +
        sumCell('自社作業時間', F.hours(t.selfHours) || '0', '', ' h') +
        sumCell('人件費（@' + F.money(v.hourlyRate) + '）', F.yen(t.laborCost), 'hi') +
        sumCell('外注作業時間', F.hours(t.outsourceHours) || '0', '', ' h') +
        sumCell('作業時間総計', F.hours(t.totalHours) || '0', '', ' h') +
        sumCell('原価総計（税込）', F.yen(t.grandTotal), 'grand');
    }

    setTot('#tot-part', t.partCost, F.money);
    setTot('#tot-out', t.outsourceCost, F.money);
    ws.forEach(function (w) { setTot('#tot-w-' + w.id, t.workerHours[w.id], F.hours); });
    setTot('#tot-outh', t.outsourceHours, F.hours);

    var ri = $('#rowInfo');
    if (ri) {
      var txt = '明細 ' + t.rowCount + ' 行';
      if (t.firstDate) {
        txt += '　作業日 ' + F.shortDate(t.firstDate) +
          (t.lastDate !== t.firstDate ? ' 〜 ' + F.shortDate(t.lastDate) : '') +
          '（実働 ' + t.workDays + ' 日）';
      }
      ri.textContent = txt;
    }

    // サイドバーの金額も追随させる
    var card = $('.veh-card[data-veh="' + v.id + '"] .tot');
    if (card) card.innerHTML = '<small>原価総計</small>' + F.yen(t.grandTotal);
    var all = Store.state.vehicles.reduce(function (a, x) {
      return a + Calc.vehicleTotals(x, ws).grandTotal;
    }, 0);
    $('#grandAll').textContent = '合計 ' + F.yen(all);
  }

  function setTot(sel, val, fmt) {
    var el = $(sel);
    if (!el) return;
    el.textContent = F.toNum(val) === 0 ? '0' : fmt(val);
    el.className = F.toNum(val) === 0 ? 'zero' : '';
  }

  function sumCell(k, v, cls, unit) {
    return '<div class="sum ' + (cls || '') + '"><div class="k">' + F.esc(k) + '</div>' +
      '<div class="v">' + v + (unit ? '<span class="u">' + unit + '</span>' : '') + '</div></div>';
  }

  function isHome() {
    return Store.state.view !== 'vehicle' || !Store.selected();
  }

  function renderAll() {
    var home = isHome();
    document.body.classList.toggle('view-home', home);
    $('#btnHome').hidden = home;
    $('#btnPrint').hidden = home;
    renderSidebar();
    if (home) renderHome(); else renderDetail();
    refreshUndoButtons();
  }

  function openVehicle(id) {
    Store.state.selectedId = id;
    Store.state.view = 'vehicle';
    Store.save();
    renderAll();
    $('#detail').scrollTop = 0;
  }

  function goHome() {
    Store.state.view = 'home';
    Store.save();
    renderAll();
    $('#detail').scrollTop = 0;
  }

  function refreshUndoButtons() {
    $('#btnUndo').disabled = !Store.canUndo();
    $('#btnRedo').disabled = !Store.canRedo();
  }

  /* ---------------- 入力の受け取り ---------------- */

  function findRow(v, id) {
    for (var i = 0; i < v.rows.length; i++) if (v.rows[i].id === id) return v.rows[i];
    return null;
  }
  function rowIndex(v, id) {
    for (var i = 0; i < v.rows.length; i++) if (v.rows[i].id === id) return i;
    return -1;
  }

  function onDetailInput(e) {
    var el = e.target;
    var v = Store.selected();
    if (!v) return;

    if (el.dataset.v) {                        /* 車両情報 */
      var key = el.dataset.v;
      Store.mutate('veh:' + v.id + ':' + key, function () {
        v[key] = el.dataset.kind === 'money' ? F.toNum(el.value) : el.value;
      });
      if (key === 'name' || key === 'status' || key === 'no' || key === 'grade' ||
          key === 'color' || key === 'year' || key === 'engine') {
        renderSidebar();
      }
      updateTotals();
      refreshUndoButtons();
      return;
    }

    var tr = el.closest('tr[data-row]');
    if (!tr) return;
    var r = findRow(v, tr.dataset.row);
    if (!r) return;
    var f = el.dataset.f;

    Store.mutate('row:' + r.id + ':' + f, function () {
      if (f === 'date') {
        r.date = F.parseDate(el.value);
        el.title = F.fullDate(r.date);
      } else if (f === 'work' || f === 'part') {
        r[f] = el.value;
        el.title = el.value;
      } else if (f.indexOf('h:') === 0) {
        if (!r.hours) r.hours = {};
        r.hours[f.slice(2)] = F.toNum(el.value);
      } else {
        r[f] = F.toNum(el.value);
      }
    });
    updateTotals();
    refreshUndoButtons();
  }

  /* 数値欄はフォーカス中は素の数字、抜けたら3桁区切り */
  function onDetailFocusIn(e) {
    var el = e.target;
    if (!el.dataset || !el.dataset.kind) return;
    if (el.dataset.kind === 'date') { el.select(); return; }
    var n = F.toNum(el.value);
    el.value = n === 0 ? '' : String(n);
    el.select();
  }
  function onDetailFocusOut(e) {
    var el = e.target;
    if (!el.dataset || !el.dataset.kind) return;
    if (el.dataset.kind === 'date') {
      var iso = F.parseDate(el.value);
      el.value = F.shortDate(iso);
      el.title = F.fullDate(iso);
      return;
    }
    var n = F.toNum(el.value);
    if (el.dataset.kind === 'money') {
      el.value = (el.dataset.v && n === 0) ? '0' : (n === 0 ? '' : F.money(n));
    } else {
      el.value = n === 0 ? '' : F.hours(n);
    }
  }

  /* Enterで真下のセルへ。最終行なら1行足す */
  function onDetailKeydown(e) {
    if (e.key !== 'Enter') return;
    var el = e.target;
    if (el.tagName !== 'INPUT' || !el.dataset.f) return;
    e.preventDefault();
    var tr = el.closest('tr[data-row]');
    var v = Store.selected();
    if (!tr || !v) return;
    var f = el.dataset.f;
    var next = tr.nextElementSibling;
    if (!next) {
      addRows(1);
      next = $('#tblWrap tbody').lastElementChild;
    }
    var target = next ? next.querySelector('[data-f="' + f + '"]') : null;
    if (!target && next) target = next.querySelector('input');
    if (target) { target.focus(); }
  }

  /* ---------------- 行・車両の操作 ---------------- */

  function addRows(count, type) {
    var v = Store.selected();
    if (!v) return;
    Store.mutate(null, function () {
      for (var i = 0; i < count; i++) v.rows.push(Calc.emptyRow(type));
    });
    renderTableOnly();
  }

  function renderTableOnly() {
    var v = Store.selected();
    if (!v) return;
    $('#tblWrap').innerHTML = tableHtml(v);
    updateTotals();
    refreshUndoButtons();
  }

  function onDetailClick(e) {
    var card = e.target.closest('[data-open]');
    if (card) { openVehicle(card.dataset.open); return; }
    if (e.target.closest('#photoBox')) { $('#photoInput').click(); return; }

    var v = Store.selected();
    var btn = e.target.closest('button');
    if (!btn || !v) return;

    if (btn.dataset.tact) {
      if (btn.dataset.tact === 'add') addRows(1);
      else if (btn.dataset.tact === 'add10') addRows(10);
      else if (btn.dataset.tact === 'divider') addRows(1, 'divider');
      return;
    }

    if (btn.dataset.vact) {
      if (btn.dataset.vact === 'dup') duplicateVehicle(v);
      else if (btn.dataset.vact === 'del') deleteVehicle(v);
      else if (btn.dataset.vact === 'photo') $('#photoInput').click();
      else if (btn.dataset.vact === 'photoDel') {
        if (confirm('この車両の写真を削除します。よろしいですか？')) setPhoto(v, '');
      }
      return;
    }

    if (btn.dataset.act) {
      var tr = btn.closest('tr[data-row]');
      var i = rowIndex(v, tr.dataset.row);
      if (i < 0) return;
      var act = btn.dataset.act;
      if (act === 'del') {
        var r = v.rows[i];
        var filled = r.work || r.part || F.toNum(r.partCost) || F.toNum(r.outCost);
        if (filled && !confirm('この行を削除します。よろしいですか？\n\n' + (r.work || r.part))) return;
        Store.mutate(null, function () { v.rows.splice(i, 1); });
      } else if (act === 'dup') {
        Store.mutate(null, function () {
          var copy = JSON.parse(JSON.stringify(v.rows[i]));
          copy.id = F.uid('r');
          v.rows.splice(i + 1, 0, copy);
        });
      } else if (act === 'up' && i > 0) {
        Store.mutate(null, function () { v.rows.splice(i - 1, 0, v.rows.splice(i, 1)[0]); });
      } else if (act === 'down' && i < v.rows.length - 1) {
        Store.mutate(null, function () { v.rows.splice(i + 1, 0, v.rows.splice(i, 1)[0]); });
      } else { return; }
      renderTableOnly();
    }
  }

  function newVehicle() {
    var v = Calc.emptyVehicle(Store.state.settings);
    Store.mutate(null, function (s) { s.vehicles.push(v); s.selectedId = v.id; s.view = 'vehicle'; });
    renderAll();
    var f = $('#detail [data-v="name"]');
    if (f) { f.focus(); f.select(); }
  }

  function duplicateVehicle(v) {
    var copy = JSON.parse(JSON.stringify(v));
    copy.id = F.uid('v');
    copy.name = v.name + '（複製）';
    copy.createdAt = new Date().toISOString();
    copy.rows.forEach(function (r) { r.id = F.uid('r'); });
    Store.mutate(null, function (s) {
      s.vehicles.splice(s.vehicles.indexOf(v) + 1, 0, copy);
      s.selectedId = copy.id;
    });
    renderAll();
    toast('車両を複製しました');
  }

  function deleteVehicle(v) {
    if (!confirm('「' + (v.name || '無名') + '」を削除します。\n明細もすべて消えます。よろしいですか？')) return;
    Store.mutate(null, function (s) {
      var i = s.vehicles.indexOf(v);
      s.vehicles.splice(i, 1);
      s.selectedId = null;
      s.view = 'home';
    });
    renderAll();
    toast('車両を削除しました（元に戻すで復活できます）');
  }

  /* ---------------- 車両写真 ---------------- */

  var PHOTO_MAX_W = 1280, PHOTO_MAX_H = 960;

  function readPhoto(file, done) {
    if (!file || !/^image\//.test(file.type)) {
      alert('画像ファイルを選んでください。');
      return;
    }
    var fr = new FileReader();
    fr.onload = function () {
      var img = new Image();
      img.onload = function () {
        var w = img.width, h = img.height;
        var k = Math.min(1, PHOTO_MAX_W / w, PHOTO_MAX_H / h);
        var cv = document.createElement('canvas');
        cv.width = Math.max(1, Math.round(w * k));
        cv.height = Math.max(1, Math.round(h * k));
        var cx = cv.getContext('2d');
        cx.fillStyle = '#fff';
        cx.fillRect(0, 0, cv.width, cv.height);
        cx.drawImage(img, 0, 0, cv.width, cv.height);
        done(cv.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = function () { alert('この画像は読み込めませんでした。'); };
      img.src = fr.result;
    };
    fr.readAsDataURL(file);
  }

  function setPhoto(v, dataUrl) {
    Store.mutate(null, function () { v.photo = dataUrl; });
    var box = $('#photoBox');
    if (box) {
      box.className = 'photo' + (dataUrl ? '' : ' empty');
      box.style.backgroundImage = dataUrl ? 'url(' + dataUrl + ')' : '';
      box.innerHTML = dataUrl ? '' : '<span>クリック／ドラッグで<br>写真を追加</span>';
    }
    var del = $('#photoDel');
    if (del) del.disabled = !dataUrl;
    renderSidebar();
    refreshUndoButtons();
  }

  /* ---------------- モーダル ---------------- */

  function modal(title, bodyHtml, footHtml) {
    var ov = document.createElement('div');
    ov.className = 'overlay';
    ov.innerHTML = '<div class="modal"><div class="modal-head"><h3>' + F.esc(title) + '</h3>' +
      '<span class="spacer"></span><button class="btn ghost" data-close>✕</button></div>' +
      '<div class="modal-body">' + bodyHtml + '</div>' +
      '<div class="modal-foot">' + (footHtml || '<button class="btn" data-close>閉じる</button>') + '</div></div>';
    document.body.appendChild(ov);
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('[data-close]')) ov.remove();
    });
    return ov;
  }

  function openWorkers() {
    var body =
      '<div class="f" style="margin-bottom:14px"><label>時間単価の初期値（円/h）　※車両ごとに個別変更できます</label>' +
      '<input class="num" id="mRate" value="' + F.esc(F.money(Store.state.settings.hourlyRate)) + '"></div>' +
      '<div style="font-size:11px;color:#8c97a6;letter-spacing:.04em;margin-bottom:6px">工数を入力する職人（表の列になります）</div>' +
      '<div id="wkList"></div>' +
      '<button class="btn sm" id="wkAdd" style="margin-top:6px">＋ 職人を追加</button>' +
      '<p class="note" style="margin-top:14px">名前を変えても、入力済みの工数はそのまま残ります。' +
      '削除すると、その列に入っている工数は全車両から消えます。</p>';

    var ov = modal('職人・単価の設定', body,
      '<button class="btn" data-close>キャンセル</button><button class="btn primary" id="wkSave">保存</button>');

    var draft = JSON.parse(JSON.stringify(workers()));

    function paint() {
      $('#wkList', ov).innerHTML = draft.map(function (w, i) {
        return '<div class="wk-row" data-i="' + i + '">' +
          '<input value="' + F.esc(w.name) + '" data-wk-name>' +
          '<button class="btn sm" data-wk="up" ' + (i === 0 ? 'disabled' : '') + '>↑</button>' +
          '<button class="btn sm" data-wk="down" ' + (i === draft.length - 1 ? 'disabled' : '') + '>↓</button>' +
          '<button class="btn sm danger" data-wk="del">削除</button></div>';
      }).join('');
    }
    paint();

    $('#wkList', ov).addEventListener('input', function (e) {
      if (e.target.hasAttribute('data-wk-name')) {
        draft[+e.target.closest('.wk-row').dataset.i].name = e.target.value;
      }
    });
    $('#wkList', ov).addEventListener('click', function (e) {
      var b = e.target.closest('[data-wk]');
      if (!b) return;
      var i = +b.closest('.wk-row').dataset.i;
      if (b.dataset.wk === 'del') {
        if (draft.length <= 1) { alert('職人は最低1人必要です。'); return; }
        if (!confirm('「' + draft[i].name + '」の列を削除します。\n入力済みの工数も全車両から消えます。')) return;
        draft.splice(i, 1);
      } else if (b.dataset.wk === 'up' && i > 0) {
        draft.splice(i - 1, 0, draft.splice(i, 1)[0]);
      } else if (b.dataset.wk === 'down' && i < draft.length - 1) {
        draft.splice(i + 1, 0, draft.splice(i, 1)[0]);
      }
      paint();
    });
    $('#wkAdd', ov).addEventListener('click', function () {
      draft.push({ id: F.uid('w'), name: '新しい職人' });
      paint();
    });
    $('#wkSave', ov).addEventListener('click', function () {
      var rate = F.toNum($('#mRate', ov).value) || 5000;
      var keep = {};
      draft.forEach(function (w) { keep[w.id] = true; });
      Store.mutate(null, function (s) {
        s.settings.hourlyRate = rate;
        s.settings.workers = draft.map(function (w, i) {
          return { id: w.id, name: (w.name || '').trim() || ('担当' + (i + 1)) };
        });
        /* 消した職人の工数を落とす */
        s.vehicles.forEach(function (v) {
          v.rows.forEach(function (r) {
            Object.keys(r.hours || {}).forEach(function (k) {
              if (!keep[k]) delete r.hours[k];
            });
          });
        });
      });
      ov.remove();
      renderAll();
      toast('設定を保存しました');
    });
  }

  /* ---------------- 書き出し／取り込み ---------------- */

  function csvEscape(s) {
    s = String(s == null ? '' : s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function vehicleCsv(v) {
    var ws = workers();
    var t = Calc.vehicleTotals(v, ws);
    var L = [];
    L.push([vehicleLabel(v)].map(csvEscape).join(','));
    L.push(['仕入価格', t.purchasePrice].map(csvEscape).join(','));
    L.push(['時間単価', v.hourlyRate].map(csvEscape).join(','));
    L.push('');
    L.push(['No', '作業日', '作業名', '部品名', '部品代', '外注費']
      .concat(ws.map(function (w) { return w.name; }))
      .concat(['外注']).map(csvEscape).join(','));
    var i = 0;
    v.rows.forEach(function (r) {
      if (r.type === 'divider') {
        L.push(['', '', r.work || '────', '', '', ''].concat(ws.map(function () { return ''; })).concat(['']).map(csvEscape).join(','));
        return;
      }
      i++;
      L.push([i, F.fullDate(r.date), r.work, r.part, F.toNum(r.partCost) || '', F.toNum(r.outCost) || '']
        .concat(ws.map(function (w) { return F.toNum(r.hours && r.hours[w.id]) || ''; }))
        .concat([F.toNum(r.outHours) || '']).map(csvEscape).join(','));
    });
    L.push(['', '', '', '合計（税込）', t.partCost, t.outsourceCost]
      .concat(ws.map(function (w) { return t.workerHours[w.id]; }))
      .concat([t.outsourceHours]).map(csvEscape).join(','));
    L.push('');
    L.push(['部品代＋外注費', t.materialCost].map(csvEscape).join(','));
    L.push(['自社作業時間合計', t.selfHours].map(csvEscape).join(','));
    L.push(['人件費', t.laborCost].map(csvEscape).join(','));
    L.push(['作業時間総計（外注含む）', t.totalHours].map(csvEscape).join(','));
    L.push(['原価総計（税込）', t.grandTotal].map(csvEscape).join(','));
    return L.join('\r\n');
  }

  function openCsv() {
    var v = Store.selected();
    var body = '<p class="note">Excel でそのまま開ける形式（UTF-8 BOM付き CSV）で書き出します。</p>';
    var ov = modal('CSV書き出し', body,
      '<button class="btn" data-close>キャンセル</button>' +
      (v ? '<button class="btn" id="csvOne">この車両だけ</button>' : '') +
      '<button class="btn primary" id="csvAll">全車両まとめて</button>');

    if (v) $('#csvOne', ov).addEventListener('click', function () {
      download('原価表_' + (v.name || '車両') + (v.no ? '_' + v.no : '') + '_' + F.stamp() + '.csv',
        '﻿' + vehicleCsv(v), 'text/csv');
      ov.remove(); toast('CSVを書き出しました');
    });
    $('#csvAll', ov).addEventListener('click', function () {
      var text = Store.state.vehicles.map(vehicleCsv).join('\r\n\r\n\r\n');
      download('原価表_全車両_' + F.stamp() + '.csv', '﻿' + text, 'text/csv');
      ov.remove(); toast('CSVを書き出しました');
    });
  }

  function backup() {
    download('レストア原価管理_バックアップ_' + F.stamp() + '.json',
      JSON.stringify(Store.state, null, 2), 'application/json');
    toast('バックアップを保存しました');
  }

  function restore(file) {
    var fr = new FileReader();
    fr.onload = function () {
      var data;
      try { data = JSON.parse(fr.result); } catch (e) {
        alert('このファイルは読み込めませんでした。バックアップの JSON ファイルを選んでください。');
        return;
      }
      if (!data || !Array.isArray(data.vehicles)) {
        alert('バックアップの形式ではないようです。');
        return;
      }
      if (!confirm('いま入っているデータを、このファイルの内容で置き換えます。\n（元に戻す で戻せます）\n\n車両 ' +
        data.vehicles.length + ' 台を読み込みます。よろしいですか？')) return;
      Store.replaceAll(data);
      if (!Store.selected() && Store.state.vehicles.length) {
        Store.state.selectedId = Store.state.vehicles[0].id;
      }
      renderAll();
      toast('復元しました');
    };
    fr.readAsText(file, 'utf-8');
  }

  /* ---------------- 起動 ---------------- */

  function seedSample() {
    Store.state.settings.workers = JSON.parse(JSON.stringify(global.SAMPLE.workers));
    Store.state.settings.hourlyRate = 5000;
    Store.state.vehicles = [JSON.parse(JSON.stringify(global.SAMPLE.vehicle))];
    Store.state.selectedId = Store.state.vehicles[0].id;
    Store.saveNow();
  }

  function init() {
    var first = Store.load();
    if (first) seedSample();
    if (!Store.selected() && Store.state.vehicles.length) {
      Store.state.selectedId = Store.state.vehicles[0].id;
    }

    var warned = false;
    Store.onSaved = function (ok) {
      $('#savedAt').textContent = ok ? '保存済 ' + F.clock() : '⚠ 保存できません';
      if (!ok && !warned) {
        warned = true;
        alert('データを保存できませんでした。ブラウザの保存容量がいっぱいのようです。\n\n' +
          '「バックアップ」でJSONを書き出して控えを取ったうえで、\n' +
          '使い終わった車両の写真を削除するか、車両を減らしてください。');
      }
    };

    var detail = $('#detail');
    detail.addEventListener('input', onDetailInput);
    detail.addEventListener('change', onDetailInput);
    detail.addEventListener('focusin', onDetailFocusIn);
    detail.addEventListener('focusout', onDetailFocusOut);
    detail.addEventListener('keydown', onDetailKeydown);
    detail.addEventListener('click', onDetailClick);

    $('#vehList').addEventListener('click', function (e) {
      var card = e.target.closest('[data-veh]');
      if (card) openVehicle(card.dataset.veh);
    });
    $('#vehSearch').addEventListener('input', function () {
      if (isHome()) renderHome(); else renderSidebar();
    });

    $('#btnHome').addEventListener('click', goHome);
    $('.brand').addEventListener('click', goHome);
    $('.brand').style.cursor = 'pointer';

    $('#photoInput').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0];
      var v = Store.selected();
      if (f && v) readPhoto(f, function (url) { setPhoto(v, url); });
      e.target.value = '';
    });
    detail.addEventListener('dragover', function (e) {
      var b = e.target.closest('#photoBox');
      if (!b) return;
      e.preventDefault();
      b.classList.add('drag');
    });
    detail.addEventListener('dragleave', function (e) {
      var b = e.target.closest('#photoBox');
      if (b) b.classList.remove('drag');
    });
    detail.addEventListener('drop', function (e) {
      var b = e.target.closest('#photoBox');
      if (!b) return;
      e.preventDefault();
      b.classList.remove('drag');
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      var v = Store.selected();
      if (f && v) readPhoto(f, function (url) { setPhoto(v, url); });
    });

    $('#btnNew').addEventListener('click', newVehicle);
    $('#btnWorkers').addEventListener('click', openWorkers);
    $('#btnCsv').addEventListener('click', openCsv);
    $('#btnBackup').addEventListener('click', backup);
    $('#btnRestore').addEventListener('click', function () { $('#fileInput').click(); });
    $('#fileInput').addEventListener('change', function (e) {
      if (e.target.files && e.target.files[0]) restore(e.target.files[0]);
      e.target.value = '';
    });
    $('#btnPrint').addEventListener('click', function () { preparePrint(); window.print(); });
    window.addEventListener('beforeprint', preparePrint);
    global.__preparePrint = preparePrint;
    $('#btnUndo').addEventListener('click', function () { if (Store.undo()) renderAll(); });
    $('#btnRedo').addEventListener('click', function () { if (Store.redo()) renderAll(); });

    document.addEventListener('keydown', function (e) {
      var mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      var k = e.key.toLowerCase();
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); if (Store.undo()) renderAll(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); if (Store.redo()) renderAll(); }
      else if (k === 's') { e.preventDefault(); Store.saveNow(); toast('保存しました'); }
      else if (k === 'p') { /* ブラウザの印刷に任せる */ }
    });

    window.addEventListener('beforeunload', function () { Store.saveNow(); });

    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})(window);
