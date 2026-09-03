#!/usr/bin/env node
/* ===================================================================
   レストア原価管理 — 共有サーバー
   このフォルダを配信しつつ、データを data/state.json に保管する。
   Node.js があれば追加インストールなしで動く（外部ライブラリ不要）。

       node server.js            … 8787番で起動
       PORT=8080 node server.js  … ポートを変える
       RESTORE_TOKEN=xxxx node server.js … 合言葉を要求する

   起動すると、携帯から開くためのURLを表示する。
   =================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const PORT = parseInt(process.env.PORT, 10) || 8787;
const TOKEN = process.env.RESTORE_TOKEN || '';
const MAX_BODY = 48 * 1024 * 1024;      /* 写真込みでも足りるように */
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const BACKUP_KEEP = 60;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.md': 'text/plain; charset=utf-8'
};

/* ---------------- データの読み書き ---------------- */

function ensureDirs() {
  [DATA_DIR, BACKUP_DIR].forEach(function (d) {
    if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true });
  });
}

function readState() {
  try {
    const raw = fs.readFileSync(STATE_FILE, 'utf8');
    const doc = JSON.parse(raw);
    if (doc && typeof doc.rev === 'number') return doc;
  } catch (e) { /* 初回、または壊れている */ }
  return { rev: 0, updatedAt: null, by: null, state: null };
}

function writeState(doc) {
  ensureDirs();
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(doc), 'utf8');
  fs.renameSync(tmp, STATE_FILE);        /* 途中で切れても壊れないように */
}

function stamp(d) {
  const p = function (n) { return String(n).padStart(2, '0'); };
  return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
}

let lastBackup = 0;
function maybeBackup(doc) {
  const now = Date.now();
  if (now - lastBackup < BACKUP_EVERY_MS) return;
  lastBackup = now;
  try {
    ensureDirs();
    fs.writeFileSync(path.join(BACKUP_DIR, 'state-' + stamp(new Date()) + '.json'),
      JSON.stringify(doc), 'utf8');
    const files = fs.readdirSync(BACKUP_DIR).filter(function (f) { return /^state-.*\.json$/.test(f); }).sort();
    while (files.length > BACKUP_KEEP) {
      fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
    }
  } catch (e) {
    console.error('バックアップに失敗:', e.message);
  }
}

/* ---------------- HTTP ---------------- */

function send(res, code, body, type) {
  res.writeHead(code, {
    'Content-Type': type || 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}
function sendJson(res, code, obj) { send(res, code, JSON.stringify(obj)); }

function authed(req) {
  if (!TOKEN) return true;
  return (req.headers['x-restore-token'] || '') === TOKEN;
}

function readBody(req, cb) {
  let len = 0;
  const chunks = [];
  req.on('data', function (c) {
    len += c.length;
    if (len > MAX_BODY) { req.destroy(); cb(new Error('データが大きすぎます')); return; }
    chunks.push(c);
  });
  req.on('end', function () { cb(null, Buffer.concat(chunks).toString('utf8')); });
  req.on('error', function (e) { cb(e); });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT) || file.startsWith(DATA_DIR)) {
    send(res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) { send(res, 404, 'Not Found', 'text/plain; charset=utf-8'); return; }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(function (req, res) {
  const pathname = (req.url || '/').split('?')[0];

  if (pathname === '/api/ping') {
    sendJson(res, 200, { ok: true, app: 'restore-cost', needToken: !!TOKEN, rev: readState().rev });
    return;
  }

  if (pathname === '/api/state') {
    if (!authed(req)) { sendJson(res, 401, { error: 'token' }); return; }

    if (req.method === 'GET') {
      const doc = readState();
      sendJson(res, 200, doc);
      return;
    }

    if (req.method === 'PUT' || req.method === 'POST') {
      readBody(req, function (err, raw) {
        if (err) { sendJson(res, 413, { error: err.message }); return; }
        let body;
        try { body = JSON.parse(raw); } catch (e) { sendJson(res, 400, { error: 'JSONが不正です' }); return; }
        if (!body || typeof body.state !== 'object' || body.state === null) {
          sendJson(res, 400, { error: 'stateがありません' });
          return;
        }
        const cur = readState();
        const base = typeof body.baseRev === 'number' ? body.baseRev : 0;
        if (cur.rev !== 0 && base !== cur.rev) {
          /* 他の端末が先に保存している */
          sendJson(res, 409, cur);
          return;
        }
        const doc = {
          rev: cur.rev + 1,
          updatedAt: new Date().toISOString(),
          by: String(body.by || '').slice(0, 40) || null,
          state: body.state
        };
        try {
          writeState(doc);
          maybeBackup(doc);
        } catch (e) {
          console.error('保存に失敗:', e.message);
          sendJson(res, 500, { error: '保存に失敗しました' });
          return;
        }
        sendJson(res, 200, { rev: doc.rev, updatedAt: doc.updatedAt });
      });
      return;
    }

    send(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
    return;
  }
  serveStatic(req, res, pathname);
});

function lanAddresses() {
  const out = [];
  const nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (ni) {
      if (ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
    });
  });
  return out;
}

ensureDirs();
server.listen(PORT, '0.0.0.0', function () {
  const doc = readState();
  console.log('');
  console.log('  レストア原価管理 — 共有サーバーを起動しました');
  console.log('  ------------------------------------------------');
  console.log('  このPC      : http://localhost:' + PORT + '/');
  lanAddresses().forEach(function (ip) {
    console.log('  携帯から    : http://' + ip + ':' + PORT + '/');
  });
  console.log('  データ      : ' + STATE_FILE + (doc.rev ? '（保存済 rev.' + doc.rev + '）' : '（まだ空）'));
  console.log('  合言葉      : ' + (TOKEN ? '設定あり' : 'なし（同じネットワークの人は誰でも見られます）'));
  console.log('');
  console.log('  止めるときは Ctrl + C');
  console.log('');
});
