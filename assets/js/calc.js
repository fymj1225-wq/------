/* 原価の集計ロジック（画面に依存しない純粋関数） */
(function (global) {
  'use strict';
  var N = global.F.toNum;

  /* 車両の状態。並びがそのまま選択肢の順になる */
  var STATUSES = ['待機', '進行中', '保留', '完了'];

  /* 以前の呼び方から読み替える（入力済みのデータをそのまま使えるように） */
  var OLD = { '見積': '待機', '作業中': '進行中', '納車済': '完了' };

  function normalizeStatus(v) {
    var s = String(v == null ? '' : v).trim();
    if (OLD[s]) return OLD[s];
    return STATUSES.indexOf(s) >= 0 ? s : STATUSES[0];
  }

  /* 1車両分の集計
     workers: [{id,name}]  … 表示中の職人列
     戻り値の金額はすべて税込（見本の車両管理表に合わせる） */
  function vehicleTotals(vehicle, workers) {
    var rows = (vehicle && vehicle.rows) || [];
    var t = {
      partCost: 0,        // 部品代 合計
      outsourceCost: 0,   // 外注費 合計
      materialCost: 0,    // 部品代 + 外注費
      workerHours: {},    // 職人ごとの工数
      selfHours: 0,       // 自社作業時間 合計
      outsourceHours: 0,  // 外注 作業時間
      totalHours: 0,      // 作業時間総計（外注含む）
      laborCost: 0,       // 人件費 = 自社作業時間 × 時間単価
      purchasePrice: 0,   // 仕入価格
      spentCost: 0,       // 現状かかった金額（部品代＋外注費＋人件費）
      grandTotal: 0,      // 原価総計
      rowCount: 0,
      firstDate: '',      // いちばん古い作業日
      lastDate: '',       // いちばん新しい作業日
      workDays: 0         // 作業した日数（重複なし）
    };
    if (!vehicle) return t;

    workers = workers || [];
    workers.forEach(function (w) { t.workerHours[w.id] = 0; });

    var days = {};
    rows.forEach(function (r) {
      if (r.type === 'divider') return;
      t.rowCount++;
      if (global.F.isISO(r.date)) {
        days[r.date] = true;
        if (!t.firstDate || r.date < t.firstDate) t.firstDate = r.date;
        if (!t.lastDate || r.date > t.lastDate) t.lastDate = r.date;
      }
      t.partCost += N(r.partCost);
      t.outsourceCost += N(r.outCost);
      t.outsourceHours += N(r.outHours);
      workers.forEach(function (w) {
        var h = N(r.hours && r.hours[w.id]);
        t.workerHours[w.id] += h;
        t.selfHours += h;
      });
    });

    t.workDays = Object.keys(days).length;
    t.materialCost = t.partCost + t.outsourceCost;
    t.totalHours = t.selfHours + t.outsourceHours;
    t.purchasePrice = N(vehicle.purchasePrice);
    t.laborCost = Math.round(t.selfHours * N(vehicle.hourlyRate));
    t.spentCost = t.materialCost + t.laborCost;
    t.grandTotal = t.purchasePrice + t.spentCost;

    /* 小数の丸め誤差をならす（0.5h刻みの積み上げ対策） */
    t.selfHours = Math.round(t.selfHours * 100) / 100;
    t.outsourceHours = Math.round(t.outsourceHours * 100) / 100;
    t.totalHours = Math.round(t.totalHours * 100) / 100;
    Object.keys(t.workerHours).forEach(function (k) {
      t.workerHours[k] = Math.round(t.workerHours[k] * 100) / 100;
    });
    return t;
  }

  function emptyRow(type) {
    return {
      id: global.F.uid('r'),
      type: type || 'item',
      date: '',
      work: '',
      part: '',
      partCost: 0,
      outCost: 0,
      hours: {},
      outHours: 0
    };
  }

  function emptyVehicle(settings) {
    return {
      id: global.F.uid('v'),
      name: '新規車両',
      grade: '',
      color: '',
      no: '',
      year: '',
      engine: '',
      status: STATUSES[0],
      photo: '',
      purchasePrice: 0,
      hourlyRate: (settings && global.F.toNum(settings.hourlyRate)) || 5000,
      memo: '',
      createdAt: new Date().toISOString(),
      rows: [emptyRow(), emptyRow(), emptyRow()]
    };
  }

  global.Calc = {
    vehicleTotals: vehicleTotals, emptyRow: emptyRow, emptyVehicle: emptyVehicle,
    STATUSES: STATUSES, normalizeStatus: normalizeStatus
  };
})(window);
