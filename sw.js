/* ===================================================================
   オフラインでも起動できるようにするための仕掛け（Service Worker）
   ・アプリ本体（HTML/CSS/JS/アイコン）を端末に持っておく
   ・データのやり取り（/api/）は絶対にキャッシュしない
   ※ ブラウザの決まりで、https:// か localhost でのみ有効になる
   =================================================================== */
'use strict';

var CACHE = 'restore-cost-v6';
var SHELL = [
  './',
  'index.html',
  'manifest.webmanifest',
  'assets/app.css',
  'assets/js/format.js',
  'assets/js/calc.js',
  'assets/js/store.js',
  'assets/js/passkey.js',
  'assets/js/sync.js',
  'assets/js/sample.js',
  'assets/js/app.js',
  'assets/icon-180.png',
  'assets/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(new Request(u, { cache: 'reload' })).catch(function () { /* 無ければ飛ばす */ });
      }));
    }).then(function () { return self.skipWaiting(); })   /* 新しい版をすぐ有効にする */
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        return k === CACHE ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('message', function (e) {
  if (e.data === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') === 0) return;      /* データは必ず通信する */

  /* 画面そのものは通信優先。繋がらなければ持っている版で開く */
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req).then(function (r) {
        var copy = r.clone();
        caches.open(CACHE).then(function (c) { c.put('index.html', copy); });
        return r;
      }).catch(function () {
        return caches.match('index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  /* それ以外は手持ちを即返しつつ、裏で新しいものを取っておく */
  e.respondWith(
    caches.match(req).then(function (hit) {
      var net = fetch(req).then(function (r) {
        if (r && r.status === 200) {
          var copy = r.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return r;
      }).catch(function () { return hit; });
      return hit || net;
    })
  );
});
