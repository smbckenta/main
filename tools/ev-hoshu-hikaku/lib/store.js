/*
 * Google ドライブ上の data フォルダをそのまま保存先として使う。
 * 複合機ツールと同じ考え方で、アプリ本体はローカル、データはドライブに置く。
 *
 *   data/
 *   ├── settings.json        自社情報と既定値
 *   ├── api-key.txt          Claude API キー（1行）
 *   ├── template.xlsx        比較表のひな形
 *   ├── cases/<id>.json      案件
 *   └── uploads/<id>/        読み取らせた元ファイル
 */
(function (global) {
  'use strict';

  var DB_NAME = 'ev-hikaku';
  var STORE_NAME = 'handles';
  var HANDLE_KEY = 'data-dir';

  function idb() {
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () { req.result.createObjectStore(STORE_NAME); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function idbGet(key) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readonly');
        var req = tx.objectStore(STORE_NAME).get(key);
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    });
  }

  function idbPut(key, value) {
    return idb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(value, key);
        tx.oncomplete = function () { resolve(); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }

  var dir = null;

  function supported() {
    return typeof global.showDirectoryPicker === 'function';
  }

  function connected() { return !!dir; }

  function name() { return dir ? dir.name : ''; }

  async function pick() {
    dir = await global.showDirectoryPicker({ id: 'ev-hikaku-data', mode: 'readwrite' });
    // 保存できなくても動作は続ける（次回また選び直すだけ）
    await idbPut(HANDLE_KEY, dir).catch(function () { });
    await ensureSkeleton();
    return dir;
  }

  // 前回選んだフォルダを許可が残っていれば黙って開き直す
  async function restore() {
    if (!supported()) return null;
    var handle = await idbGet(HANDLE_KEY).catch(function () { return null; });
    if (!handle) return null;
    var perm = await handle.queryPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    dir = handle;
    await ensureSkeleton();
    return dir;
  }

  // 明示的な操作をきっかけに許可を求め直す
  async function reauthorize() {
    var handle = await idbGet(HANDLE_KEY).catch(function () { return null; });
    if (!handle) return null;
    var perm = await handle.requestPermission({ mode: 'readwrite' });
    if (perm !== 'granted') return null;
    dir = handle;
    await ensureSkeleton();
    return dir;
  }

  async function ensureSkeleton() {
    await dir.getDirectoryHandle('cases', { create: true });
    await dir.getDirectoryHandle('uploads', { create: true });
  }

  function requireDir() {
    if (!dir) throw new Error('データフォルダが未接続です');
    return dir;
  }

  // 'cases/xxx.json' のようなパスを辿ってディレクトリハンドルとファイル名に分ける
  async function resolve(path, create) {
    var parts = path.split('/').filter(Boolean);
    var d = requireDir();
    for (var i = 0; i < parts.length - 1; i++) {
      d = await d.getDirectoryHandle(parts[i], { create: !!create });
    }
    return { dir: d, name: parts[parts.length - 1] };
  }

  async function readBytes(path) {
    var r = await resolve(path, false);
    var fh = await r.dir.getFileHandle(r.name);
    var file = await fh.getFile();
    return new Uint8Array(await file.arrayBuffer());
  }

  async function readText(path) {
    var r = await resolve(path, false);
    var fh = await r.dir.getFileHandle(r.name);
    return (await fh.getFile()).text();
  }

  async function readJson(path, fallback) {
    try {
      return JSON.parse(await readText(path));
    } catch (e) {
      return fallback;
    }
  }

  async function write(path, data) {
    var r = await resolve(path, true);
    var fh = await r.dir.getFileHandle(r.name, { create: true });
    var w = await fh.createWritable();
    await w.write(data);
    await w.close();
  }

  function writeJson(path, obj) {
    return write(path, JSON.stringify(obj, null, 2));
  }

  async function exists(path) {
    try {
      var r = await resolve(path, false);
      await r.dir.getFileHandle(r.name);
      return true;
    } catch (e) {
      return false;
    }
  }

  async function listDir(path) {
    var d = requireDir();
    for (var part of path.split('/').filter(Boolean)) {
      d = await d.getDirectoryHandle(part, { create: true });
    }
    var out = [];
    for await (var entry of d.values()) {
      if (entry.kind === 'file') out.push(entry.name);
    }
    return out;
  }

  async function remove(path) {
    var r = await resolve(path, false);
    await r.dir.removeEntry(r.name, { recursive: true });
  }

  global.Store = {
    supported: supported,
    connected: connected,
    name: name,
    pick: pick,
    restore: restore,
    reauthorize: reauthorize,
    readBytes: readBytes,
    readText: readText,
    readJson: readJson,
    write: write,
    writeJson: writeJson,
    exists: exists,
    listDir: listDir,
    remove: remove
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
