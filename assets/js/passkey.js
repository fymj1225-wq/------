/* ===================================================================
   顔認証・指紋認証（パスキー）
   ・端末の Face ID / Touch ID / Windows Hello をそのまま使う
   ・合言葉を端末に残さずに済む
   ・https（または localhost）でのみ使える
   =================================================================== */
(function (global) {
  'use strict';

  function enc(buf) {
    var b = new Uint8Array(buf), s = '';
    for (var i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function dec(str) {
    var s = String(str).replace(/-/g, '+').replace(/_/g, '/');
    while (s.length % 4) s += '=';
    var bin = atob(s), b = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i);
    return b.buffer;
  }

  var Passkey = {};

  Passkey.supported = function () {
    return !!(global.PublicKeyCredential && global.isSecureContext &&
      navigator.credentials && navigator.credentials.create);
  };

  /* この端末に顔認証・指紋の仕組みがあるか */
  Passkey.available = function () {
    if (!Passkey.supported()) return Promise.resolve(false);
    if (!global.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable) {
      return Promise.resolve(false);
    }
    return global.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()
      .catch(function () { return false; });
  };

  function post(path, body, token) {
    var h = { 'Content-Type': 'application/json' };
    if (token) h['X-Restore-Token'] = token;
    return fetch(path, {
      method: 'POST', headers: h, cache: 'no-store',
      credentials: 'same-origin',
      body: body ? JSON.stringify(body) : '{}'
    });
  }

  Passkey.status = function () {
    return fetch('/api/webauthn/status', { cache: 'no-store', credentials: 'same-origin' })
      .then(function (r) { return r.json(); });
  };

  /* この端末を登録する（合言葉で本人確認が済んでいることが前提） */
  Passkey.register = function (label, token) {
    return post('/api/webauthn/register/start', null, token).then(function (r) {
      if (!r.ok) throw new Error('start');
      return r.json();
    }).then(function (o) {
      return navigator.credentials.create({
        publicKey: {
          challenge: dec(o.challenge),
          rp: o.rp,
          user: { id: dec(o.user.id), name: o.user.name, displayName: o.user.displayName },
          pubKeyCredParams: o.pubKeyCredParams,
          excludeCredentials: (o.excludeCredentials || []).map(function (c) {
            return { type: 'public-key', id: dec(c.id) };
          }),
          authenticatorSelection: o.authenticatorSelection,
          timeout: o.timeout,
          attestation: o.attestation
        }
      });
    }).then(function (cred) {
      if (!cred) throw new Error('cancel');
      var res = cred.response;
      if (!res.getPublicKey) throw new Error('この端末のブラウザは対応していません');
      var pub = res.getPublicKey();
      if (!pub) throw new Error('公開鍵を取り出せませんでした');
      return post('/api/webauthn/register/finish', {
        id: cred.id,
        publicKey: enc(pub),
        alg: res.getPublicKeyAlgorithm ? res.getPublicKeyAlgorithm() : -7,
        clientDataJSON: enc(res.clientDataJSON),
        label: label || '端末'
      }, token);
    }).then(function (r) {
      if (!r.ok) throw new Error('finish');
      return true;
    });
  };

  /* 顔認証で入る */
  Passkey.login = function () {
    return post('/api/webauthn/login/start').then(function (r) {
      if (!r.ok) throw new Error('start');
      return r.json();
    }).then(function (o) {
      return navigator.credentials.get({
        publicKey: {
          challenge: dec(o.challenge),
          rpId: o.rpId,
          allowCredentials: (o.allowCredentials || []).map(function (c) {
            return { type: 'public-key', id: dec(c.id) };
          }),
          userVerification: o.userVerification,
          timeout: o.timeout
        }
      });
    }).then(function (as) {
      if (!as) throw new Error('cancel');
      var r = as.response;
      return post('/api/webauthn/login/finish', {
        id: as.id,
        authenticatorData: enc(r.authenticatorData),
        clientDataJSON: enc(r.clientDataJSON),
        signature: enc(r.signature)
      });
    }).then(function (r) {
      if (!r.ok) throw new Error('login');
      return true;
    });
  };

  Passkey.forget = function () {
    return post('/api/webauthn/forget').then(function (r) { return r.ok; });
  };
  Passkey.signOut = function () {
    return post('/api/webauthn/logout').then(function (r) { return r.ok; });
  };

  global.Passkey = Passkey;
})(window);
