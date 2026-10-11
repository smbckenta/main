/*
 * ブラウザの中だけで完結する保存先。
 *
 * lib/store.js（Google ドライブのフォルダ）と同じ関数を持つので、
 * mount() の options.store にそのまま渡せる。
 *
 *   EvHikaku.mount(el, { store: createBrowserStore({ prefix: 'evh:', templateBase64: '...' }) });
 *
 * 用途:
 *   - 統合基幹システムなど、フォルダ選択 API が使えない場所に組み込むとき
 *   - デモ
 *
 * 注意: localStorage は見ている人のブラウザの中だけに残る。
 * 複数人で同じ案件を共有したい場合は、別の保存先を用意すること。
 */
function createBrowserStore(config) {
  'use strict';

  config = config || {};
  var PREFIX = config.prefix || 'evh:';
  var templateBase64 = config.templateBase64 || null;
  // 元書類と書き出した控えは容量を食うだけなので残さない
  var skip = config.skipPaths || /^(uploads|exports)\//;
  var connected = false;
  var memory = {};

  function notFound(path) {
    var e = new Error('見つかりません: ' + path);
    e.name = 'NotFoundError';
    return e;
  }

  // プライベートウィンドウなどで localStorage が使えなくても動くようにする
  function get(path) {
    try {
      var v = localStorage.getItem(PREFIX + path);
      if (v !== null) return v;
    } catch (e) { /* 使えないときはメモリだけで動く */ }
    return path in memory ? memory[path] : null;
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
        if (k && k.indexOf(PREFIX) === 0) {
          var p = k.slice(PREFIX.length);
          if (out.indexOf(p) < 0) out.push(p);
        }
      }
    } catch (e) { }
    return out;
  }

  function isTemplate(path) { return path === 'template.xlsx' && !!templateBase64; }

  function toBytes(b64) {
    var bin = atob(b64);
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  return {
    supported: function () { return true; },
    connected: function () { return connected; },
    name: function () { return config.label || 'ブラウザ内'; },
    hasSaved: async function () { return keys().length > 0; },
    pick: async function () { connected = true; return {}; },
    restore: async function () {
      if (config.onBeforeConnect) await config.onBeforeConnect();
      connected = true;
      return {};
    },
    reauthorize: async function () { connected = true; return {}; },

    readBytes: async function (path) {
      if (isTemplate(path)) return toBytes(templateBase64);
      var v = get(path);
      if (v === null) throw notFound(path);
      return toBytes(v);
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
      if (isTemplate(path) || skip.test(path)) return;
      set(path, typeof data === 'string' ? data : '');
    },
    writeJson: async function (path, obj) { set(path, JSON.stringify(obj, null, 2)); },
    exists: async function (path) { return isTemplate(path) || get(path) !== null; },
    listDir: async function (dir) {
      var prefix = dir.replace(/\/$/, '') + '/';
      return keys()
        .filter(function (p) { return p.indexOf(prefix) === 0 && p.slice(prefix.length).indexOf('/') < 0; })
        .map(function (p) { return p.slice(prefix.length); });
    },
    remove: async function (path) { del(path); }
  };
}

if (typeof window !== 'undefined') window.createBrowserStore = createBrowserStore;
