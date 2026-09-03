/* ===================================================================
   顔認証・指紋認証（パスキー / WebAuthn）とログイン状態の管理

   ・初回だけ合言葉で本人確認し、その端末に顔認証を登録する
   ・以降はその端末の顔・指紋だけで開ける（合言葉は端末に残さない）
   ・外部ライブラリは使わない。Node 標準の crypto だけで検証する
   =================================================================== */
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const CHALLENGE_TTL = 3 * 60 * 1000;
const SESSION_DAYS = 30;
const COOKIE = 'rc_sess';

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }
function unb64url(s) { return Buffer.from(String(s || ''), 'base64url'); }
function sha256(buf) { return crypto.createHash('sha256').update(buf).digest(); }

function eq(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/* ---------------- 保管 ---------------- */

function makeStore(dataDir) {
  const credFile = path.join(dataDir, 'credentials.json');
  const keyFile = path.join(dataDir, 'secret.key');

  function readCreds() {
    try {
      const a = JSON.parse(fs.readFileSync(credFile, 'utf8'));
      return Array.isArray(a) ? a : [];
    } catch (e) { return []; }
  }
  function writeCreds(list) {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = credFile + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(list, null, 2), 'utf8');
    fs.renameSync(tmp, credFile);
  }
  function secret() {
    try { return fs.readFileSync(keyFile); } catch (e) { /* 無ければ作る */ }
    const s = crypto.randomBytes(32);
    fs.mkdirSync(dataDir, { recursive: true });
    fs.writeFileSync(keyFile, s, { mode: 0o600 });
    return s;
  }
  return { readCreds: readCreds, writeCreds: writeCreds, secret: secret };
}

/* ---------------- ログイン状態（署名付きクッキー） ---------------- */

function makeSession(store) {
  function sign(payload) {
    const p = b64url(JSON.stringify(payload));
    const mac = b64url(crypto.createHmac('sha256', store.secret()).update(p).digest());
    return p + '.' + mac;
  }
  function verify(value) {
    const parts = String(value || '').split('.');
    if (parts.length !== 2) return null;
    const mac = b64url(crypto.createHmac('sha256', store.secret()).update(parts[0]).digest());
    if (!eq(mac, parts[1])) return null;
    let payload;
    try { payload = JSON.parse(unb64url(parts[0]).toString('utf8')); } catch (e) { return null; }
    if (!payload || typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    return payload;
  }
  return { sign: sign, verify: verify };
}

function readCookie(req, name) {
  const raw = req.headers.cookie || '';
  const parts = raw.split(';');
  for (let i = 0; i < parts.length; i++) {
    const kv = parts[i].trim();
    const eqi = kv.indexOf('=');
    if (eqi > 0 && kv.slice(0, eqi) === name) return decodeURIComponent(kv.slice(eqi + 1));
  }
  return null;
}

function cookieHeader(name, value, opts) {
  opts = opts || {};
  let c = name + '=' + encodeURIComponent(value) + '; Path=/; HttpOnly; SameSite=Lax';
  if (opts.secure) c += '; Secure';
  c += '; Max-Age=' + (opts.maxAge === 0 ? 0 : (opts.maxAge || SESSION_DAYS * 86400));
  return c;
}

/* ---------------- 相手の素性（rpId と origin） ---------------- */

function rpInfo(req, override) {
  if (override) {
    const u = new URL(override);
    return { rpId: u.hostname, origin: u.origin, name: 'レストア原価管理' };
  }
  let host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost');
  host = host.split(',')[0].trim();
  const proto = (String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim()) ||
    (req.socket && req.socket.encrypted ? 'https' : 'http');
  return { rpId: host.replace(/:\d+$/, ''), origin: proto + '://' + host, name: 'レストア原価管理' };
}

/* ---------------- チャレンジ ---------------- */

const challenges = new Map();

function newChallenge(purpose) {
  const c = b64url(crypto.randomBytes(32));
  challenges.set(c, { purpose: purpose, exp: Date.now() + CHALLENGE_TTL });
  if (challenges.size > 500) {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.exp < now) challenges.delete(k);
  }
  return c;
}
function takeChallenge(c, purpose) {
  const e = challenges.get(c);
  if (!e) return false;
  challenges.delete(c);
  return e.exp >= Date.now() && e.purpose === purpose;
}

/* ---------------- 検証 ---------------- */

function checkClientData(clientDataJSON, type, origin) {
  let d;
  try { d = JSON.parse(unb64url(clientDataJSON).toString('utf8')); } catch (e) { return null; }
  if (!d || d.type !== type) return null;
  if (d.origin !== origin) return null;
  if (!takeChallenge(d.challenge, type)) return null;
  return d;
}

/* authenticatorData の中身を最低限だけ見る */
function checkAuthData(authData, rpId) {
  const buf = unb64url(authData);
  if (buf.length < 37) return null;
  const rpIdHash = buf.subarray(0, 32);
  if (!rpIdHash.equals(sha256(Buffer.from(rpId, 'utf8')))) return null;
  const flags = buf[32];
  if (!(flags & 0x01)) return null;   /* 本人がその場にいる（UP） */
  if (!(flags & 0x04)) return null;   /* 顔・指紋などで本人確認した（UV） */
  return { buf: buf, counter: buf.readUInt32BE(33) };
}

const ALGS = { '-7': 'ES256', '-257': 'RS256' };

function verifySignature(cred, authDataB64, clientDataJSON, signature) {
  let key;
  try {
    key = crypto.createPublicKey({ key: unb64url(cred.pubkey), format: 'der', type: 'spki' });
  } catch (e) { return false; }

  const data = Buffer.concat([unb64url(authDataB64), sha256(unb64url(clientDataJSON))]);
  const sig = unb64url(signature);

  try {
    if (cred.alg === -7) {
      return crypto.verify('sha256', data, { key: key, dsaEncoding: 'der' }, sig);
    }
    if (cred.alg === -257) {
      return crypto.verify('sha256', data, { key: key, padding: crypto.constants.RSA_PKCS1_PADDING }, sig);
    }
  } catch (e) { /* 壊れた署名 */ }
  return false;
}

module.exports = {
  b64url: b64url,
  unb64url: unb64url,
  makeStore: makeStore,
  makeSession: makeSession,
  readCookie: readCookie,
  cookieHeader: cookieHeader,
  rpInfo: rpInfo,
  newChallenge: newChallenge,
  checkClientData: checkClientData,
  checkAuthData: checkAuthData,
  verifySignature: verifySignature,
  ALGS: ALGS,
  COOKIE: COOKIE,
  SESSION_DAYS: SESSION_DAYS
};
