/* 画面まわり */
(function (global) {
  'use strict';

  var F = global.F, Store = global.Store, Calc = global.Calc;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var STATUSES = Calc.STATUSES;

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

  /* 車両名は「車名＋車台番号の下4桁」をひと組で扱う */
  function vehicleTitle(v) {
    var name = (v.name || '').trim() || '（無名）';
    var t = F.last4(v.no);
    return t ? name + ' ' + t : name;
  }

  /* 画面に出すとき、下4桁は等幅で少し落として車名と区別する */
  function vehicleTitleHtml(v) {
    var name = (v.name || '').trim() || '（無名）';
    var t = F.last4(v.no);
    return F.esc(name) + (t ? ' <span class="vin">' + F.esc(t) + '</span>' : '');
  }

  /* ---------------- トップ（車両アカウント一覧） ---------------- */

  function photoStyle(v) {
    return v.photo ? ' style="background-image:url(' + v.photo.replace(/"/g, '') + ')"' : '';
  }

  function accountCard(v) {
    var t = Calc.vehicleTotals(v, workers());
    var sub = [v.grade, v.color, v.year, v.engine].filter(Boolean).join('・');
    var st = Calc.normalizeStatus(v.status);
    return '<article class="acct" data-open="' + v.id + '">' +
      '<div class="acct-photo' + (v.photo ? '' : ' empty') + '"' + photoStyle(v) + '>' +
        '<span class="scrim"></span>' +
        '<span class="status s-' + F.esc(st) + '"><i></i>' + F.esc(st) + '</span>' +
        (v.no ? '<span class="tag">#' + F.esc(v.no) + '</span>' : '') +
        '<div class="acct-title">' +
          '<div class="acct-name">' + vehicleTitleHtml(v) + '</div>' +
          '<div class="acct-sub">' + F.esc(sub || '—') + '</div>' +
        '</div>' +
      '</div>' +
      '<dl class="acct-figs">' +
        '<div><dt>仕入原価</dt><dd class="n">' + F.yen(t.purchasePrice) + '</dd></div>' +
        '<div><dt>工数</dt><dd class="n">' + (F.hours(t.totalHours) || '0') + '<span class="u">h</span>' +
          '<span class="brk">自社 ' + (F.hours(t.selfHours) || '0') + '・外注 ' + (F.hours(t.outsourceHours) || '0') + '</span></dd></div>' +
        '<div><dt>金額</dt><dd class="n">' + F.yen(t.spentCost) +
          '<span class="brk">部品外注 ' + F.money(t.materialCost) + '・人件費 ' + F.money(t.laborCost) + '</span></dd></div>' +
      '</dl>' +
      compBar(t, true) +
      '<div class="acct-total"><span>総計</span><b class="n">' + F.yen(t.grandTotal) + '</b></div>' +
      '</article>';
  }

  /* 原価の内訳を1本の帯で見せる */
  function compBar(t, slim) {
    var total = t.grandTotal || 1;
    var w = function (x) { return (Math.max(0, x) / total * 100).toFixed(2) + '%'; };
    return '<div class="comp' + (slim ? ' slim' : '') + '">' +
      '<div class="comp-bar">' +
        '<span class="seg s1" style="width:' + w(t.purchasePrice) + '"></span>' +
        '<span class="seg s2" style="width:' + w(t.materialCost) + '"></span>' +
        '<span class="seg s3" style="width:' + w(t.laborCost) + '"></span>' +
      '</div>' +
      (slim ? '' :
        '<div class="comp-legend">' +
          '<span><i class="s1"></i>仕入 <b class="n">' + F.money(t.purchasePrice) + '</b></span>' +
          '<span><i class="s2"></i>部品・外注 <b class="n">' + F.money(t.materialCost) + '</b></span>' +
          '<span><i class="s3"></i>人件費 <b class="n">' + F.money(t.laborCost) + '</b></span>' +
        '</div>') +
      '</div>';
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
        '<p class="hint">車両を選ぶと作業明細に入れます。</p></div>' +
        '<div class="home-stat"><span>登録 ' + Store.state.vehicles.length + ' 台 ／ 原価合計</span>' +
        '<b class="n">' + F.yen(all) + '</b></div>' +
      '</div>' +
      (list.length
        ? '<div class="acct-grid">' + list.map(accountCard).join('') + '</div>'
        : '<div class="emptystate"><h2>' + (q ? '該当する車両がありません' : 'まだ車両がありません') + '</h2>' +
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
      var st = Calc.normalizeStatus(v.status);
      return '<div class="veh-card' + (v.id === Store.state.selectedId ? ' active' : '') + '" data-veh="' + v.id + '">' +
        '<div class="nm">' + vehicleTitleHtml(v) +
        '<span class="status s-' + F.esc(st) + '"><i></i>' + F.esc(st) + '</span></div>' +
        '<div class="sub">' + F.esc(sub) + (v.no ? '　#' + F.esc(v.no) : '') + '</div>' +
        '<div class="tot"><small>総計</small><b class="n">' + F.yen(t.grandTotal) + '</b></div>' +
        '</div>';
    }).join('');

    $('#vehList').innerHTML = html ||
      '<div class="hint" style="padding:14px 6px">該当する車両がありません</div>';
    $('#vehCount').textContent = Store.state.vehicles.length + ' 台';

    var all = Store.state.vehicles.reduce(function (a, v) {
      return a + Calc.vehicleTotals(v, workers()).grandTotal;
    }, 0);
    $('#grandAll').innerHTML = '<b class="n">' + F.yen(all) + '</b>';
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
      var h = hourCell(r.hours && r.hours[w.id]);
      return '<td class="num hr' + (h ? '' : ' zero') + '" data-label="' + F.esc(w.name) + '">' +
        '<input data-f="h:' + w.id + '" data-kind="hours" value="' + F.esc(h) + '"></td>';
    }).join('');
    return '<tr data-row="' + r.id + '">' +
      '<td class="no">' + idx + '</td>' +
      '<td class="dt" data-label="作業日"><input data-f="date" data-kind="date" title="' + F.esc(F.fullDate(r.date)) +
        '" value="' + F.esc(F.shortDate(r.date)) + '"></td>' +
      '<td class="c-work" data-label="作業"><input data-f="work" title="' + F.esc(r.work) + '" value="' + F.esc(r.work) + '"></td>' +
      '<td class="c-part' + (r.part ? '' : ' zero') + '" data-label="部品"><input data-f="part" title="' +
        F.esc(r.part) + '" value="' + F.esc(r.part) + '"></td>' +
      '<td class="num c-money' + (F.toNum(r.partCost) ? '' : ' zero') + '" data-label="部品代">' +
        '<input data-f="partCost" data-kind="money" value="' + F.esc(moneyCell(r.partCost)) + '"></td>' +
      '<td class="num c-money' + (F.toNum(r.outCost) ? '' : ' zero') + '" data-label="外注費">' +
        '<input data-f="outCost" data-kind="money" value="' + F.esc(moneyCell(r.outCost)) + '"></td>' +
      cells +
      '<td class="num hr' + (hourCell(r.outHours) ? '' : ' zero') + '" data-label="外注"><input data-f="outHours" data-kind="hours" value="' +
        F.esc(hourCell(r.outHours)) + '"></td>' +
      '<td class="act">' + actBtns() + '</td></tr>';
  }

  var ROW_ACTS = [['up', '↑ 上へ移動'], ['down', '↓ 下へ移動'], ['dup', '⧉ この行を複製'], ['del', '✕ この行を削除']];

  function actBtns() {
    return '<button class="mini hide-mobile" data-act="up" title="上へ">↑</button>' +
      '<button class="mini hide-mobile" data-act="down" title="下へ">↓</button>' +
      '<button class="mini hide-mobile" data-act="dup" title="複製">⧉</button>' +
      '<button class="mini del hide-mobile" data-act="del" title="削除">✕</button>' +
      '<button class="mini only-mobile" data-act="menu" title="この行の操作">⋮</button>';
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
      '<td id="tot-part" data-label="部品代"></td>' +
      '<td id="tot-out" data-label="外注費"></td>' +
      ws.map(function (w) {
        return '<td id="tot-w-' + w.id + '" data-label="' + F.esc(w.name) + '"></td>';
      }).join('') +
      '<td id="tot-outh" data-label="外注"></td>' +
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
    var body = v.rows.map(function (r) {
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
    }).join('');

    /* 合計は tfoot にするとページごとに繰り返されるので、最後の行として入れる */
    var total = '<tr class="total-row"><td class="lbl" colspan="4">合計（税込）</td>' +
      '<td>' + F.money(t.partCost) + '</td><td>' + F.money(t.outsourceCost) + '</td>' +
      ws.map(function (w) { return '<td>' + (F.hours(t.workerHours[w.id]) || '0') + '</td>'; }).join('') +
      '<td>' + (F.hours(t.outsourceHours) || '0') + '</td></tr>';

    return '<table class="cost print-tbl">' + head + '<tbody>' + body + total + '</tbody></table>';
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

  var setupFor = null;      /* いま作ったばかりの車両（車両情報を開いた状態で出す） */

  function renderDetail() {
    var v = Store.selected();
    var isNew = !!v && v.id === setupFor;
    var el = $('#detail');
    if (!v) {
      el.innerHTML = '<div class="emptystate"><h2>車両が選ばれていません</h2>' +
        '<p>左の一覧から選ぶか、上の「＋ 車両を追加」で新しい箱を作ってください。</p></div>';
      return;
    }

    el.innerHTML =
      '<div class="print-head"><div class="t">' + F.esc(vehicleTitle(v)) +
        '<span class="spec">' + F.esc([v.grade, v.color, v.year, v.engine, v.no]
          .filter(function (x) { return x && String(x).trim(); }).join('　')) + '</span></div>' +
        '<div class="p">仕入価格　' + F.yen(v.purchasePrice) + '</div></div>' +

      '<details class="card no-print" id="vehCard"' +
        ((window.innerWidth > 760 || isNew) ? ' open' : '') + '>' +
      '<summary class="card-head"><h3>車両情報</h3><span class="spacer"></span>' +
        '<span class="hint">タップで開閉</span>' +
      '</summary><div class="card-body"><div class="veh-info">' +
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
        field('車台番号', 'no', v.no, { ph: '例）NA6CE-218287' }) +
        field('状態', 'status', v.status, { type: 'select', options: STATUSES }) +
        field('年式', 'year', v.year, { ph: '例）H5年式' }) +
        field('排気量', 'engine', v.engine, { ph: '例）1600cc' }) +
        field('仕入価格（税込）', 'purchasePrice', v.purchasePrice, { type: 'money', span: 2 }) +
        field('時間単価（円/h）', 'hourlyRate', v.hourlyRate, { type: 'money', span: 2 }) +
        field('メモ', 'memo', v.memo, { type: 'textarea', span: 6 }) +
      '</div></div>' +
      '<div class="veh-acts">' +
        '<button class="btn sm" data-vact="dup">この車両を複製</button>' +
        '<button class="btn sm danger" data-vact="del">車両を削除</button>' +
      '</div></div></details>' +

      '<section class="card" id="sumCard"><div class="card-head"><h3>原価サマリー</h3></div>' +
      '<div class="card-body" id="sumBody"></div></section>' +

      '<section class="card" id="tblCard"><div class="card-head"><h3>作業明細</h3><span class="spacer"></span>' +
        '<span class="hint">Enterで下の行へ／最終行なら新しい行を追加</span>' +
      '</div><div class="tbl-wrap" id="tblWrap">' + tableHtml(v) + '</div>' +
      '<div id="printTbl"></div>' +
      '<div class="tbl-tools no-print">' +
        '<button class="btn primary" data-tact="add">＋ 行を追加</button>' +
        '<button class="btn" data-tact="add10">＋ 10行</button>' +
        '<button class="btn" data-tact="divider">＋ 区切り行</button>' +
        '<button class="btn only-mobile" data-tact="empty" id="btnEmpty"></button>' +
        '<span class="spacer" style="flex:1"></span>' +
        '<span class="hint" id="rowInfo"></span>' +
      '</div></section>';

    updateTotals();
    setShowEmpty(document.body.classList.contains('show-empty'));
  }

  /* 合計だけを差し替える（入力中もフォーカスを保つ） */
  function updateTotals() {
    var v = Store.selected();
    if (!v || isHome()) return;
    var ws = workers();
    var t = Calc.vehicleTotals(v, ws);

    var g = $('#sumBody');
    if (g) {
      g.innerHTML =
        '<div class="grand"><span class="k">原価総計（税込）</span>' +
        '<b class="n">' + F.yen(t.grandTotal) + '</b></div>' +
        compBar(t) +
        '<div class="sum-grid" id="sumGrid">' +
          sumCell('仕入価格', F.yen(t.purchasePrice)) +
          sumCell('部品代', F.yen(t.partCost)) +
          sumCell('外注費', F.yen(t.outsourceCost)) +
          sumCell('部品代＋外注費', F.yen(t.materialCost), 'hi') +
          sumCell('自社作業時間', F.hours(t.selfHours) || '0', '', 'h') +
          sumCell('人件費 @' + F.money(v.hourlyRate), F.yen(t.laborCost), 'hi') +
          sumCell('外注作業時間', F.hours(t.outsourceHours) || '0', '', 'h') +
          sumCell('作業時間総計', F.hours(t.totalHours) || '0', '', 'h') +
        '</div>';
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
    if (card) card.innerHTML = '<small>総計</small><b class="n">' + F.yen(t.grandTotal) + '</b>';
    var all = Store.state.vehicles.reduce(function (a, x) {
      return a + Calc.vehicleTotals(x, ws).grandTotal;
    }, 0);
    $('#grandAll').innerHTML = '<b class="n">' + F.yen(all) + '</b>';
  }

  function setTot(sel, val, fmt) {
    var el = $(sel);
    if (!el) return;
    el.textContent = F.toNum(val) === 0 ? '0' : fmt(val);
    el.className = F.toNum(val) === 0 ? 'zero' : '';
  }

  function sumCell(k, v, cls, unit) {
    return '<div class="sum ' + (cls || '') + '"><div class="k">' + F.esc(k) + '</div>' +
      '<div class="v n">' + v + (unit ? '<span class="u">' + unit + '</span>' : '') + '</div></div>';
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
    if (id !== setupFor) setupFor = null;
    Store.state.selectedId = id;
    Store.state.view = 'vehicle';
    Store.save();
    renderAll();
    $('#detail').scrollTop = 0;
    window.scrollTo(0, 0);
  }

  function goHome() {
    setupFor = null;
    Store.state.view = 'home';
    Store.save();
    renderAll();
    $('#detail').scrollTop = 0;
    window.scrollTo(0, 0);
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
      } else if (f === 'outHours') {
        r.outHours = F.toNum(el.value);
      } else {
        r[f] = F.toNum(el.value);
      }
    });
    if (f !== 'work' && f !== 'date') {
      var td = el.closest('td');
      var blank = f === 'part' ? !el.value : F.toNum(el.value) === 0;
      if (td) td.classList.toggle('zero', blank);
    }
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

  /* 携帯では空の欄を畳んで表示を短くする。入力したいときはこれで開く */
  function setShowEmpty(on) {
    document.body.classList.toggle('show-empty', !!on);
    var b = $('#btnEmpty');
    if (b) b.textContent = on ? '空欄を隠す' : '空欄も表示';
  }

  function addRows(count, type) {
    var v = Store.selected();
    if (!v) return;
    Store.mutate(null, function () {
      for (var i = 0; i < count; i++) v.rows.push(Calc.emptyRow(type));
    });
    renderTableOnly();
    setShowEmpty(true);   /* 足した行にすぐ書き込めるように */
    var last = $('#tblWrap tbody').lastElementChild;
    if (last) last.scrollIntoView({ block: 'center' });
  }

  function renderTableOnly() {
    var v = Store.selected();
    if (!v) return;
    $('#tblWrap').innerHTML = tableHtml(v);
    updateTotals();
    setShowEmpty(document.body.classList.contains('show-empty'));
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
      else if (btn.dataset.tact === 'empty') {
        setShowEmpty(!document.body.classList.contains('show-empty'));
      }
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
      if (btn.dataset.act === 'menu') openRowMenu(v, i);
      else rowAction(v, i, btn.dataset.act);
    }
  }

  function rowAction(v, i, act) {
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

  /* 携帯は指で押せるように、行の操作をまとめて出す */
  function openRowMenu(v, i) {
    var r = v.rows[i];
    var name = r.work || r.part || (r.type === 'divider' ? '区切り行' : '（空の行）');
    var body = '<p class="note" style="margin:0 0 12px">' + F.esc(name) + '</p><div class="menu-list">' +
      ROW_ACTS.map(function (a) {
        var off = (a[0] === 'up' && i === 0) || (a[0] === 'down' && i === v.rows.length - 1);
        return '<button class="btn' + (a[0] === 'del' ? ' danger' : '') + '" data-rowact="' + a[0] + '"' +
          (off ? ' disabled' : '') + '>' + F.esc(a[1]) + '</button>';
      }).join('') + '</div>';
    var ov = modal('行 ' + (i + 1) + ' の操作', body, '<button class="btn" data-close>閉じる</button>');
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('[data-rowact]');
      if (!b) return;
      ov.remove();
      rowAction(v, i, b.dataset.rowact);
    });
  }

  function newVehicle() {
    var v = Calc.emptyVehicle(Store.state.settings);
    Store.mutate(null, function (s) { s.vehicles.push(v); s.selectedId = v.id; s.view = 'vehicle'; });
    setupFor = v.id;                /* 車名をすぐ打てるよう、先頭に開いて出す */
    renderAll();
    var f = $('#detail [data-v="name"]');
    if (f) { f.focus(); f.select(); }
  }

  function duplicateVehicle(v) {
    var copy = JSON.parse(JSON.stringify(v));
    copy.id = F.uid('v');
    copy.name = (v.name || '車両') + '（複製）';
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
    if (!confirm('「' + vehicleTitle(v) + '」を削除します。\n明細もすべて消えます。よろしいですか？')) return;
    if (v.id === setupFor) setupFor = null;
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

  /* 携帯ではツールバーを畳んでメニューにまとめる */
  function openMenu() {
    var items = [
      ['btnUndo', '↶ 元に戻す'],
      ['btnRedo', '↷ やり直す'],
      ['btnPrint', '印刷 / PDF'],
      ['btnWorkers', '職人・単価の設定'],
      ['btnCsv', 'CSV書き出し'],
      ['btnBackup', 'バックアップを保存'],
      ['btnRestore', 'バックアップから復元']
    ].filter(function (it) {
      var el = document.getElementById(it[0]);
      return el && !el.hidden;
    });
    var body = '<div class="menu-list">' + items.map(function (it) {
      var el = document.getElementById(it[0]);
      return '<button class="btn" data-run="' + it[0] + '"' + (el.disabled ? ' disabled' : '') + '>' +
        F.esc(it[1]) + '</button>';
    }).join('') + '</div>';
    var ov = modal('メニュー', body, '<button class="btn" data-close>閉じる</button>');
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('[data-run]');
      if (!b) return;
      ov.remove();
      document.getElementById(b.dataset.run).click();
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
    L.push([vehicleTitle(v)].map(csvEscape).join(','));
    L.push(['車台番号', v.no || ''].map(csvEscape).join(','));
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
      download('原価表_' + vehicleTitle(v).replace(/\s+/g, '_') + '_' + F.stamp() + '.csv',
        '﻿' + vehicleCsv(v), 'text/csv');
      ov.remove(); toast('CSVを書き出しました');
    });
    $('#csvAll', ov).addEventListener('click', function () {
      var text = Store.state.vehicles.map(vehicleCsv).join('\r\n\r\n\r\n');
      download('原価表_全車両_' + F.stamp() + '.csv', '﻿' + text, 'text/csv');
      ov.remove(); toast('CSVを書き出しました');
    });
  }

  var BK_AT = 'restore-cost-app:backupAt';
  var BK_N = 'restore-cost-app:changes';

  function noteChange() {
    try {
      var n = parseInt(localStorage.getItem(BK_N) || '0', 10) || 0;
      localStorage.setItem(BK_N, String(n + 1));
    } catch (e) {}
  }
  function markBackedUp() {
    try {
      localStorage.setItem(BK_AT, String(Date.now()));
      localStorage.setItem(BK_N, '0');
    } catch (e) {}
  }
  function backupInfo() {
    var at = 0, n = 0;
    try {
      at = parseInt(localStorage.getItem(BK_AT) || '0', 10) || 0;
      n = parseInt(localStorage.getItem(BK_N) || '0', 10) || 0;
    } catch (e) {}
    return { at: at, changes: n, days: at ? Math.floor((Date.now() - at) / 86400000) : null };
  }

  /* 携帯では「共有」から LINE・メール・ファイルへ直接渡せるようにする */
  function backup() {
    var name = 'レストア原価管理_' + F.stamp() + '.json';
    var json = JSON.stringify(Store.state, null, 2);
    var file = null;
    try { file = new File([json], name, { type: 'application/json' }); } catch (e) {}

    if (file && navigator.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
      navigator.share({ files: [file], title: 'レストア原価管理のバックアップ' })
        .then(function () { markBackedUp(); toast('バックアップを渡しました'); })
        .catch(function () { /* 取り消しただけ */ });
      return;
    }
    download(name, json, 'application/json');
    markBackedUp();
    toast('バックアップを保存しました');
  }

  /* しばらく取っていなければ、そっと知らせる */
  function backupReminder() {
    var i = backupInfo();
    if (!i.changes) return;
    var stale = (i.at === 0 && i.changes >= 40) || (i.at > 0 && i.days >= 7);
    if (!stale) return;
    setTimeout(function () {
      var el = document.createElement('div');
      el.className = 'toast tap';
      el.innerHTML = '<b>バックアップしませんか</b><span>' +
        (i.at ? i.days + '日前から' : 'まだ一度も取っていません。') +
        (i.at ? ' ' + i.changes + '件の変更' : '') + '　▶ タップ</span>';
      el.addEventListener('click', function () { el.remove(); backup(); });
      document.body.appendChild(el);
      setTimeout(function () { el.remove(); }, 9000);
    }, 1800);
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
      markBackedUp();
      if (!Store.selected() && Store.state.vehicles.length) {
        Store.state.selectedId = Store.state.vehicles[0].id;
      }
      renderAll();
      toast('復元しました');
    };
    fr.readAsText(file, 'utf-8');
  }

  /* ---------------- 開くための画面（顔認証／合言葉） ---------------- */

  function faceLabel() {
    var ua = navigator.userAgent || '';
    if (/iPhone|iPad/.test(ua)) return 'Face ID / Touch ID';
    if (/Android/.test(ua)) return '指紋・顔認証';
    if (/Windows/.test(ua)) return 'Windows Hello';
    if (/Mac/.test(ua)) return 'Touch ID';
    return '端末の認証';
  }

  function showUnlock(info, again) {
    var canFace = info.passkeys > 0 && global.Passkey && global.Passkey.supported();
    var body = '<p class="note" style="margin:0 0 14px">' +
      (again ? '確認できませんでした。もう一度お試しください。'
             : 'このデータは持ち主だけが開けるようにしてあります。') + '</p>' +
      '<div class="menu-list">' +
      (canFace ? '<button class="btn primary rolebtn" id="unlockFace">' +
          '<b>' + F.esc(faceLabel()) + 'で開く</b>' +
          '<span>この端末に登録した顔・指紋で開きます</span></button>' : '') +
      '<button class="btn rolebtn" id="unlockToken"><b>合言葉で開く</b>' +
      '<span>' + (canFace ? '顔認証が使えないときはこちら' : '管理している人から聞いた合言葉を入れます') +
      '</span></button></div>';

    document.body.classList.add('locked');
    var ov = modal('データを開く', body,
      '<button class="btn" data-close>あとで（この端末の分だけ見る）</button>');
    var unlockUi = function () { document.body.classList.remove('locked'); };
    ov.addEventListener('click', function (e) {
      if (e.target === ov || e.target.closest('[data-close]')) unlockUi();
    });
    var b;
    if ((b = $('#unlockFace', ov))) b.addEventListener('click', function () {
      b.disabled = true;
      b.querySelector('b').textContent = '確認中…';
      global.Passkey.login().then(function () {
        ov.remove(); unlockUi();
        return global.Sync.retryConnect();
      }).then(function () {
        renderAll(); syncChip(); toast('開きました');
      }).catch(function () {
        ov.remove();
        showUnlock(info, true);
      });
    });
    if ((b = $('#unlockToken', ov))) b.addEventListener('click', function () {
      ov.remove(); unlockUi(); askToken();
    });
  }

  /* 合言葉で入っている端末に、顔認証へ切り替えてもらう */
  function offerPasskey() {
    if (!global.Passkey || !global.Passkey.supported()) return;
    if (localStorage.getItem('restore-cost-app:nopasskey') === '1') return;
    global.Passkey.available().then(function (ok) {
      if (!ok) return;
      var body = '<p class="note" style="margin:0 0 14px">' +
        'この端末では <b>' + F.esc(faceLabel()) + '</b> が使えます。<br>' +
        '登録しておくと、次からは合言葉を打たずに開けます。<br>' +
        '<b>合言葉はこの端末から消します</b>ので、盗み見される心配もなくなります。</p>';
      var ov = modal('顔認証で開けるようにする', body,
        '<button class="btn" id="pkLater">あとで</button>' +
        '<button class="btn primary" id="pkGo">登録する</button>');
      $('#pkLater', ov).addEventListener('click', function () {
        try { localStorage.setItem('restore-cost-app:nopasskey', '1'); } catch (e) {}
        ov.remove();
      });
      $('#pkGo', ov).addEventListener('click', function () {
        var btn = $('#pkGo', ov);
        btn.disabled = true; btn.textContent = '確認中…';
        var tok = null;
        try { tok = localStorage.getItem('restore-cost-app:token'); } catch (e) {}
        global.Passkey.register(deviceLabel(), tok).then(function () {
          global.Sync.setToken('');          /* 合言葉は端末に残さない */
          ov.remove();
          syncChip();
          toast('登録しました。次からは' + faceLabel() + 'で開けます');
        }).catch(function () {
          btn.disabled = false; btn.textContent = '登録する';
          alert('登録できませんでした。時間をおいて、左上のランプからやり直せます。');
        });
      });
    });
  }

  function deviceLabel() {
    var ua = navigator.userAgent || '';
    if (/iPhone/.test(ua)) return 'iPhone';
    if (/iPad/.test(ua)) return 'iPad';
    if (/Android/.test(ua)) return 'Android';
    if (/Mac/.test(ua)) return 'Mac';
    if (/Windows/.test(ua)) return 'Windows';
    return 'ブラウザ';
  }

  /* ---------------- 同期の表示と操作 ---------------- */

  var lastSavedAt = '';

  function roleLabel(r) { return r === 'master' ? '親機' : '子機'; }

  function syncChip() {
    var el = $('#savedAt');
    if (!el) return;
    var S = global.Sync;
    var kind = 'local', text = 'この端末に保存' + (lastSavedAt ? ' ' + lastSavedAt : '');
    if (S && S.enabled) {
      var head = roleLabel(S.role) + '・';
      if (S.status === 'saving') { kind = 'busy'; text = head + '送信中…'; }
      else if (S.status === 'offline') { kind = 'warn'; text = head + '未接続'; }
      else if (S.status === 'waiting') { kind = 'busy'; text = '親機の入力待ち'; }
      else if (S.status === 'pending') { kind = 'warn'; text = head + '未送信の変更'; }
      else if (S.status === 'token') { kind = 'warn'; text = '合言葉が必要'; }
      else { kind = 'ok'; text = head + (S.isMaster() ? '共有中' : '同期済') + (lastSavedAt ? ' ' + lastSavedAt : ''); }
    } else if (S && S.status === 'locked') {
      kind = 'warn'; text = 'ロック中';
    } else if (S && S.status === 'offline') {
      kind = 'warn'; text = roleLabel(S.role) + '・未接続';
    } else if (S && S.status === 'token') {
      kind = 'warn'; text = '合言葉が必要';
    }
    el.className = 'saved ' + kind;
    el.innerHTML = '<i class="dot"></i><span class="t">' + F.esc(text) + '</span>';
    el.title = kind === 'local' ? 'この端末のブラウザだけに保存しています' : 'クリックすると同期の状態を確認できます';
  }

  function roleCard(r, chosen) {
    var t = r === 'master'
      ? ['親機にする', 'いつも使う携帯はこちら。<br>この端末の内容が「正」になり、編集すると自動で共有されます。']
      : ['子機にする', '見る・印刷するPCはこちら。<br>開くたびに親機の内容を取り込みます。'];
    return '<button class="btn rolebtn' + (chosen === r ? ' on' : '') + '" data-role="' + r + '">' +
      '<b>' + t[0] + '</b><span>' + t[1] + '</span></button>';
  }

  function askRole(suggest) {
    var body = '<p class="note" style="margin:0 0 12px">' +
      'この端末の役割を決めてください。あとから変更できます。<br>' +
      '<b>親機は1台だけ</b>にしてください。</p>' +
      '<div class="menu-list">' + roleCard('master', suggest) + roleCard('viewer', suggest) + '</div>';
    var ov = modal('この端末の役割', body, '');
    ov.addEventListener('click', function (e) {
      var b = e.target.closest('[data-role]');
      if (!b) return;
      ov.remove();
      global.Sync.setRole(b.dataset.role);
      syncChip();
      toast(roleLabel(b.dataset.role) + 'に設定しました');
    });
  }

  function openSync() {
    var S = global.Sync;
    var body;
    if (S && !S.enabled && S.status === 'offline') {
      body = '<p class="note">この端末は <b>' + roleLabel(S.role) + '</b> として設定されていますが、' +
        'いま置き場所（PC）につながっていません。<br><br>' +
        '入力はこのまま続けられます。つながった時点で自動的にやり取りします。' +
        (S.isMaster() ? '' : '<br><br>PCの電源が入っているか、同じWi-Fiにいるか確認してください。') + '</p>' +
        '<div class="menu-list" style="margin-top:14px">' +
          '<button class="btn" id="syncPull">いますぐつなぎ直す</button>' +
          '<button class="btn" id="syncRole">役割を変える（いまは' + roleLabel(S.role) + '）</button>' +
        '</div>';
    } else if (!S || !S.enabled) {
      var i = backupInfo();
      body = '<dl class="kv">' +
        '<div><dt>保存先</dt><dd>この端末だけ</dd></div>' +
        '<div><dt>最後のバックアップ</dt><dd style="font-size:11.5px">' +
          (i.at ? new Date(i.at).toLocaleString('ja-JP') +
                  (i.days ? '（' + i.days + '日前）' : '（今日）') : 'まだ取っていません') + '</dd></div>' +
        '<div><dt>その後の変更</dt><dd class="n">' + i.changes + ' 件</dd></div>' +
        '</dl>' +
        '<p class="note" style="margin-top:12px">データはこの端末の中だけにあります。' +
        'どこにも送られませんが、<b>端末を無くしたり、ブラウザのデータを消すと一緒に消えます。</b><br>' +
        '節目ごとにバックアップを取って、LINEやメールで自分宛に送っておくのが確実です。</p>' +
        '<div class="menu-list" style="margin-top:14px">' +
          '<button class="btn primary" id="localBackup">バックアップを取る</button>' +
          '<button class="btn" id="localRestore">バックアップから戻す</button>' +
        '</div>' +
        '<p class="note" style="margin-top:14px">' +
        'PCや他の端末とも共有したくなったら、置き場所を用意して同じURLを開いてください。' +
        '手順は同梱の DEPLOY.md にあります。</p>' +
        '<div class="menu-list" style="margin-top:8px">' +
          '<button class="btn" id="localLook">置き場所を探し直す</button>' +
        '</div>' +
        (S && S.status === 'token'
          ? '<div class="menu-list" style="margin-top:8px"><button class="btn" id="syncToken">合言葉を入れ直す</button></div>' : '');
    } else {
      var st = { synced: S.isMaster() ? '共有中' : '同期済', saving: '送信中',
                 offline: 'サーバーに繋がっていません', waiting: '親機の入力待ち',
                 pending: 'この端末の変更が未送信です', token: '合言葉が必要' }[S.status] || S.status;
      var up = S.lastUpdate
        ? new Date(S.lastUpdate.updatedAt).toLocaleString('ja-JP') + (S.lastUpdate.by ? '（' + F.esc(S.lastUpdate.by) + '）' : '')
        : '—';
      body = '<dl class="kv">' +
        '<div><dt>この端末</dt><dd>' + roleLabel(S.role) + '</dd></div>' +
        '<div><dt>状態</dt><dd>' + F.esc(st) + '</dd></div>' +
        '<div><dt>最終更新</dt><dd style="font-size:11.5px">' + up + '</dd></div>' +
        '<div><dt>版</dt><dd class="n">rev. ' + S.metaRev() + '</dd></div>' +
        '</dl>' +
        '<p class="note" style="margin-top:12px">' +
        (S.isMaster()
          ? 'この端末の内容が「正」です。編集すると自動で送られ、子機はそれを受け取ります。' +
            '電波が届かない間も普通に入力でき、つながった時点でまとめて送られます。'
          : '開いたとき・画面に戻ったときに、親機の内容を取り込みます。' +
            'この端末で編集した内容は、親機の内容が来たときに置き換わります。') +
        '</p>' +
        (S.status === 'pending'
          ? '<div class="menu-list" style="margin-top:14px">' +
              '<button class="btn primary" id="syncSend">この端末の変更を親機側へ送る</button>' +
              '<button class="btn" id="syncDrop">変更を捨てて親機に合わせる</button>' +
            '</div>'
          : '<div class="menu-list" style="margin-top:14px">' +
              '<button class="btn" id="syncPull">いますぐ同期する</button>' +
            '</div>') +
        '<div class="menu-list" style="margin-top:8px">' +
          '<button class="btn" id="syncRole">役割を変える（いまは' + roleLabel(S.role) + '）</button>' +
          (S.serverInfo && S.serverInfo.needToken && global.Passkey && global.Passkey.supported()
            ? '<button class="btn" id="syncFace">' +
              (S.serverInfo.passkeys ? faceLabel() + 'の設定' : faceLabel() + 'で開けるようにする') +
              '</button>' : '') +
        '</div>';
    }
    var ov = modal((S && S.enabled) ? 'データの共有' : 'データの保存', body,
      '<button class="btn" data-close>閉じる</button>');
    var b;
    if ((b = $('#localBackup', ov))) b.addEventListener('click', function () { ov.remove(); backup(); });
    if ((b = $('#localRestore', ov))) b.addEventListener('click', function () { ov.remove(); $('#fileInput').click(); });
    if ((b = $('#localLook', ov))) b.addEventListener('click', function () {
      ov.remove();
      global.Sync.lookAgain().then(function (ok) {
        syncChip();
        toast(ok ? '置き場所が見つかりました' : '置き場所は見つかりませんでした');
        if (ok) renderAll();
      });
    });
    if ((b = $('#syncPull', ov))) b.addEventListener('click', function () {
      ov.remove();
      if (global.Sync.isMaster() && global.Sync.dirty) global.Sync.push();
      else global.Sync.pull();
      toast('同期しました');
    });
    if ((b = $('#syncSend', ov))) b.addEventListener('click', function () {
      if (!confirm('この端末の内容で、共有されている内容を置き換えます。\n親機で加えた変更が消える場合があります。よろしいですか？')) return;
      ov.remove();
      global.Sync.sendLocal().then(function () { toast('送信しました'); });
    });
    if ((b = $('#syncDrop', ov))) b.addEventListener('click', function () {
      if (!confirm('この端末で加えた変更を捨てて、親機の内容に合わせます。よろしいですか？')) return;
      ov.remove();
      global.Sync.adoptServer().then(function () { renderAll(); toast('親機の内容に合わせました'); });
    });
    if ((b = $('#syncRole', ov))) b.addEventListener('click', function () {
      ov.remove(); askRole(global.Sync.role);
    });
    if ((b = $('#syncFace', ov))) b.addEventListener('click', function () { ov.remove(); faceSettings(); });
    if ((b = $('#syncToken', ov))) b.addEventListener('click', function () { ov.remove(); askToken(); });
  }

  function faceSettings() {
    global.Passkey.status().then(function (st) {
      var mine = st.signedIn;
      var body = '<dl class="kv">' +
        '<div><dt>登録済みの端末</dt><dd>' + (st.devices || []).length + ' 台</dd></div>' +
        '<div><dt>この端末</dt><dd>' + (mine ? faceLabel() + 'で開いています' : '合言葉で開いています') + '</dd></div>' +
        '</dl>' +
        '<p class="note" style="margin-top:12px">端末ごとに登録します。' +
        '登録した端末の顔・指紋の情報がこちらに送られることはありません' +
        '（端末の中だけで照合され、合鍵の署名だけがやり取りされます）。</p>' +
        '<div class="menu-list" style="margin-top:14px">' +
          (mine ? '<button class="btn danger" id="faceOff">この端末の登録を解除する</button>'
                : '<button class="btn primary" id="faceOn">この端末を登録する</button>') +
        '</div>';
      var ov = modal(faceLabel() + 'の設定', body, '<button class="btn" data-close>閉じる</button>');
      var b;
      if ((b = $('#faceOn', ov))) b.addEventListener('click', function () {
        b.disabled = true; b.textContent = '確認中…';
        var tok = null;
        try { tok = localStorage.getItem('restore-cost-app:token'); } catch (e) {}
        global.Passkey.register(deviceLabel(), tok).then(function () {
          global.Sync.setToken('');
          ov.remove(); syncChip();
          toast('登録しました。次からは' + faceLabel() + 'で開けます');
        }).catch(function () {
          b.disabled = false; b.textContent = 'この端末を登録する';
          alert('登録できませんでした。');
        });
      });
      if ((b = $('#faceOff', ov))) b.addEventListener('click', function () {
        if (!confirm('この端末の' + faceLabel() + '登録を解除します。\n次からは合言葉が必要になります。よろしいですか？')) return;
        global.Passkey.forget().then(function () {
          ov.remove();
          toast('解除しました');
          location.reload();
        });
      });
    });
  }

  function askToken(again) {
    var body = '<p class="note" style="margin:0 0 12px">' +
      (again ? '合言葉が違うようです。もう一度入れてください。'
             : 'この置き場所は合言葉で守られています。管理している人から聞いた合言葉を入れてください。') +
      '<br>一度入れれば、この端末では次から聞かれません。</p>' +
      '<div class="f"><label>合言葉</label>' +
      '<input type="password" id="tokenInput" autocomplete="current-password" ' +
      'autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="合言葉"></div>';
    var ov = modal('合言葉の入力', body,
      '<button class="btn" data-close>あとで</button><button class="btn primary" id="tokenOk">入力する</button>');
    var input = $('#tokenInput', ov);
    setTimeout(function () { input.focus(); }, 60);
    var go = function () {
      var t = (input.value || '').trim();
      if (!t) { input.focus(); return; }
      global.Sync.setToken(t);
      ov.remove();
      global.Sync.retryConnect().then(function (ok) {
        syncChip();
        if (ok) { renderAll(); toast('開きました'); }
        else if (global.Sync.status === 'locked') askToken(true);
      });
    };
    $('#tokenOk', ov).addEventListener('click', go);
    input.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
  }

  /* オフラインでも開けるようにする（https か localhost のときだけ有効） */
  function registerWorker() {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('sw.js').then(function (reg) {
      reg.addEventListener('updatefound', function () {
        var w = reg.installing;
        if (!w) return;
        w.addEventListener('statechange', function () {
          if (w.state === 'installed' && navigator.serviceWorker.controller) {
            var el = document.createElement('div');
            el.className = 'toast tap';
            el.innerHTML = '<b>新しい版があります</b><span>タップで今すぐ切り替える</span>';
            el.addEventListener('click', function () { location.reload(); });
            document.body.appendChild(el);
            setTimeout(function () { el.remove(); }, 12000);
          }
        });
      });
    }).catch(function () { /* 使えない環境なら何もしない */ });
  }

  /* ---------------- 起動 ---------------- */

  function seedSample() {
    if (global.SAMPLE && global.SAMPLE.vehicle) {
      Store.state.settings.workers = JSON.parse(JSON.stringify(global.SAMPLE.workers));
      Store.state.settings.hourlyRate = 5000;
      Store.state.vehicles = [JSON.parse(JSON.stringify(global.SAMPLE.vehicle))];
      Store.state.selectedId = Store.state.vehicles[0].id;
    } else {
      /* 見本を外した場合は空で始める */
      Store.state.vehicles = [];
      Store.state.selectedId = null;
      Store.state.view = 'home';
    }
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
      if (ok) { lastSavedAt = F.clock().slice(0, 5); noteChange(); syncChip(); }
      else { $('#savedAt').className = 'saved warn'; $('#savedAt').innerHTML = '<i class="dot"></i><span class="t">保存できません</span>'; }
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
    $('#btnMenu').addEventListener('click', openMenu);
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
    registerWorker();
    $('#savedAt').addEventListener('click', openSync);

    renderAll();
    syncChip();
    backupReminder();

    if (global.Sync) {
      global.Sync.onStatus = syncChip;
      global.Sync.onApplied = function () { renderAll(); };
      global.Sync.onNotice = toast;
      global.Sync.onNeedRole = askRole;
      global.Sync.onLocked = function (info) { showUnlock(info, false); };
      global.Sync.onOfferPasskey = offerPasskey;
      global.Sync.init(Store, function (ok) {
        syncChip();
        if (ok) renderAll();
        else if (global.Sync.status === 'token') askToken(true);
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else { init(); }
})(window);
