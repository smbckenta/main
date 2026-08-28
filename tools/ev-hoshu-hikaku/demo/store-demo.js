/*
 * デモ版の保存先。
 * 本物は Google ドライブの data フォルダを使うが、デモは見ている人の
 * ブラウザ内 (localStorage) に閉じる。lib/store.js と同じ関数を並べてあるので
 * app.js には手を入れていない。
 */
(function (global) {
  'use strict';

  var PREFIX = 'ev-hikaku-demo:';
  var connected = false;

  function notFound(path) {
    var e = new Error('見つかりません: ' + path);
    e.name = 'NotFoundError';
    return e;
  }

  // プライベートウィンドウなどで localStorage が使えなくても画面は動かす
  var memory = {};
  function get(path) {
    try {
      var v = localStorage.getItem(PREFIX + path);
      return v === null ? (path in memory ? memory[path] : null) : v;
    } catch (e) {
      return path in memory ? memory[path] : null;
    }
  }
  function set(path, value) {
    memory[path] = value;
    try { localStorage.setItem(PREFIX + path, value); } catch (e) { /* 容量超過は無視 */ }
  }
  function del(path) {
    delete memory[path];
    try { localStorage.removeItem(PREFIX + path); } catch (e) { }
  }
  function keys() {
    var out = Object.keys(memory);
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k.indexOf(PREFIX) === 0) {
          var p = k.slice(PREFIX.length);
          if (out.indexOf(p) < 0) out.push(p);
        }
      }
    } catch (e) { }
    return out;
  }

  // ひな形はページに埋め込んであるので localStorage には置かない
  function isTemplate(path) { return path === 'template.xlsx'; }
  // 元書類と書き出した控えはデモでは残さない（容量を食うだけなので）
  function isTransient(path) { return /^(uploads|exports)\//.test(path); }

  function b64ToBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  global.Store = {
    supported: function () { return true; },
    connected: function () { return connected; },
    name: function () { return 'ブラウザ内（デモ）'; },
    pick: async function () { connected = true; return {}; },
    restore: async function () {
      // 見本の案件を先に置いてから接続済みにする（一覧の読み込みに間に合わせる）
      if (typeof global.EV_DEMO_SEED === 'function') await global.EV_DEMO_SEED();
      connected = true;
      return {};
    },
    reauthorize: async function () { connected = true; return {}; },

    readBytes: async function (path) {
      if (isTemplate(path)) return b64ToBytes(global.EV_TEMPLATE_BASE64);
      var v = get(path);
      if (v === null) throw notFound(path);
      return b64ToBytes(v);
    },
    readText: async function (path) {
      var v = get(path);
      if (v === null) throw notFound(path);
      return v;
    },
    readJson: async function (path, fallback) {
      var v = get(path);
      if (v === null) return fallback;
      try { return JSON.parse(v); } catch (e) { return fallback; }
    },
    write: async function (path, data) {
      if (isTemplate(path) || isTransient(path)) return;
      set(path, typeof data === 'string' ? data : '');
    },
    writeJson: async function (path, obj) {
      set(path, JSON.stringify(obj, null, 2));
    },
    exists: async function (path) {
      if (isTemplate(path)) return true;
      return get(path) !== null;
    },
    listDir: async function (dir) {
      var prefix = dir.replace(/\/$/, '') + '/';
      return keys()
        .filter(function (p) { return p.indexOf(prefix) === 0 && p.slice(prefix.length).indexOf('/') < 0; })
        .map(function (p) { return p.slice(prefix.length); });
    },
    remove: async function (path) { del(path); }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
