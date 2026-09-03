#!/usr/bin/env node
/* ===================================================================
   レストア原価管理 — 共有サーバー

   このフォルダを配信しつつ、データを state.json に保管する。
   Node.js があれば追加インストールなしで動く（外部ライブラリ不要）。

   ■ 社内LANで使う
       node server.js                        … 8787番で起動
       PORT=8080 node server.js              … ポートを変える

   ■ インターネットに公開する（HTTPS のホストに置く）
       RESTORE_PUBLIC=1 RESTORE_TOKEN=長い合言葉 node server.js
       ・RESTORE_PUBLIC=1 のときは合言葉が必須（無いと起動しない）
       ・DATA_DIR で保存先を指定できる（消えないディスクを指すこと）
   =================================================================== */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT, 10) || 8787;
const TOKEN = process.env.RESTORE_TOKEN || '';
const PUBLIC_MODE = process.env.RESTORE_PUBLIC === '1';
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, 'data'));
const STATE_FILE = path.join(DATA_DIR, 'state.json');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');

const MAX_BODY = 48 * 1024 * 1024;      /* 写真込みでも足りるように */
const BACKUP_EVERY_MS = 10 * 60 * 1000;
const BACKUP_KEEP = 60;
const RATE_WINDOW = 60 * 1000;
const RATE_MAX = 240;                   /* 1分あたりの上限（1IP） */
const AUTH_FAIL_MAX = 20;               /* 合言葉の間違い上限（10分） */
const AUTH_FAIL_WINDOW = 10 * 60 * 1000;

if (PUBLIC_MODE && !TOKEN) {
  console.error('\n  RESTORE_PUBLIC=1 のときは RESTORE_TOKEN（合言葉）が必要です。');
  console.error('  例) RESTORE_TOKEN=' + crypto.randomBytes(18).toString('base64url') + '\n');
  process.exit(1);
}
if (PUBLIC_MODE && TOKEN.length < 12) {
  console.error('\n  合言葉が短すぎます。12文字以上にしてください。\n');
  process.exit(1);
}

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
    const doc = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
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
    fs.writeFileSync(path.join(BACKUP_DIR, 'state-' + stamp(new Date()) + '.json'), JSON.stringify(doc), 'utf8');
    const files = fs.readdirSync(BACKUP_DIR).filter(function (f) { return /^state-.*\.json$/.test(f); }).sort();
    while (files.length > BACKUP_KEEP) fs.unlinkSync(path.join(BACKUP_DIR, files.shift()));
  } catch (e) {
    console.error('バックアップに失敗:', e.message);
  }
}

/* ---------------- 出入口の見張り ---------------- */

const hits = new Map();        /* IP -> {n, until} */
const fails = new Map();       /* IP -> {n, until} */

function bump(map, ip, window) {
  const now = Date.now();
  let e = map.get(ip);
  if (!e || e.until < now) { e = { n: 0, until: now + window }; map.set(ip, e); }
  e.n++;
  if (map.size > 5000) {       /* 放っておくと増え続けるので掃除する */
    for (const [k, v] of map) if (v.until < now) map.delete(k);
  }
  return e.n;
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return String(fwd).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || '?';
}

function tokenOk(req) {
  if (!TOKEN) return true;
  const got = String(req.headers['x-restore-token'] || '');
  const a = Buffer.from(got);
  const b = Buffer.from(TOKEN);
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function baseHeaders(req) {
  const h = {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN'
  };
  if (PUBLIC_MODE && String(req.headers['x-forwarded-proto'] || '') === 'https') {
    h['Strict-Transport-Security'] = 'max-age=15552000';
  }
  return h;
}

function send(req, res, code, body, type) {
  const h = baseHeaders(req);
  h['Content-Type'] = type || 'application/json; charset=utf-8';
  res.writeHead(code, h);
  res.end(body);
}
function sendJson(req, res, code, obj) { send(req, res, code, JSON.stringify(obj)); }

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

/* 画面に要らないファイルは配らない */
const PRIVATE_FILES = new Set(['server.js', 'package.json', 'package-lock.json',
  'dockerfile', 'fly.toml', '.dockerignore', '.gitignore']);
function isPrivate(file) {
  const name = path.basename(file).toLowerCase();
  if (name.startsWith('.')) return true;
  if (PRIVATE_FILES.has(name)) return true;
  return /\.(md|bat|command|log|env)$/.test(name);
}

function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { rel = pathname; }
  if (rel === '/' || rel === '') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  if (!file.startsWith(ROOT + path.sep) || file.startsWith(DATA_DIR) || isPrivate(file)) {
    send(req, res, 403, 'Forbidden', 'text/plain; charset=utf-8');
    return;
  }
  fs.stat(file, function (err, st) {
    if (err || !st.isFile()) { send(req, res, 404, 'Not Found', 'text/plain; charset=utf-8'); return; }
    const h = baseHeaders(req);
    h['Content-Type'] = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
    h['Cache-Control'] = 'no-cache';
    res.writeHead(200, h);
    fs.createReadStream(file).pipe(res);
  });
}

const server = http.createServer(function (req, res) {
  const pathname = (req.url || '/').split('?')[0];
  const ip = clientIp(req);

  if (pathname.indexOf('/api/') === 0) {
    if (bump(hits, ip, RATE_WINDOW) > RATE_MAX) {
      sendJson(req, res, 429, { error: 'アクセスが多すぎます。しばらく待ってください' });
      return;
    }
  }

  if (pathname === '/api/ping') {
    sendJson(req, res, 200, { ok: true, app: 'restore-cost', needToken: !!TOKEN, rev: readState().rev });
    return;
  }

  if (pathname === '/api/state') {
    if (!tokenOk(req)) {
      const n = bump(fails, ip, AUTH_FAIL_WINDOW);
      sendJson(req, res, n > AUTH_FAIL_MAX ? 429 : 401, { error: 'token' });
      return;
    }

    if (req.method === 'GET') { sendJson(req, res, 200, readState()); return; }

    if (req.method === 'PUT' || req.method === 'POST') {
      readBody(req, function (err, raw) {
        if (err) { sendJson(req, res, 413, { error: err.message }); return; }
        let body;
        try { body = JSON.parse(raw); } catch (e) { sendJson(req, res, 400, { error: 'JSONが不正です' }); return; }
        if (!body || typeof body.state !== 'object' || body.state === null) {
          sendJson(req, res, 400, { error: 'stateがありません' });
          return;
        }
        const cur = readState();
        const base = typeof body.baseRev === 'number' ? body.baseRev : 0;
        if (cur.rev !== 0 && base !== cur.rev) {
          sendJson(req, res, 409, cur);          /* 他の端末が先に保存している */
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
          sendJson(req, res, 500, { error: '保存に失敗しました' });
          return;
        }
        sendJson(req, res, 200, { rev: doc.rev, updatedAt: doc.updatedAt });
      });
      return;
    }

    send(req, res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(req, res, 405, 'Method Not Allowed', 'text/plain; charset=utf-8');
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
  console.log('  レストア原価管理 — 共有サーバー');
  console.log('  ------------------------------------------------');
  if (PUBLIC_MODE) {
    console.log('  公開モード  : ポート ' + PORT + ' で待機中（合言葉あり）');
  } else {
    console.log('  このPC      : http://localhost:' + PORT + '/');
    lanAddresses().forEach(function (ip) {
      console.log('  携帯から    : http://' + ip + ':' + PORT + '/');
    });
  }
  console.log('  データ      : ' + STATE_FILE + (doc.rev ? '（保存済 rev.' + doc.rev + '）' : '（まだ空）'));
  console.log('  合言葉      : ' + (TOKEN ? '設定あり' : 'なし（同じネットワークの人は誰でも見られます）'));
  console.log('');
  console.log('  止めるときは Ctrl + C');
  console.log('');
});

['SIGINT', 'SIGTERM'].forEach(function (s) {
  process.on(s, function () { server.close(function () { process.exit(0); }); });
});
