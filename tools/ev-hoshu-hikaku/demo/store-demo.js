/*
 * デモの保存先。lib/browser-store.js をデモ用に設定しているだけ。
 * 本番は Google ドライブの data フォルダ（lib/store.js）を使う。
 */
window.Store = createBrowserStore({
  prefix: 'ev-hikaku-demo:',
  label: 'ブラウザ内（デモ）',
  templateBase64: null,   // 下で差し替える（ページに埋め込んだひな形を使う）
  onBeforeConnect: function () {
    // 見本の案件を、一覧を読む前に置いておく
    if (typeof window.EV_DEMO_SEED === 'function') return window.EV_DEMO_SEED();
  }
});
// ひな形はページに埋め込んであるので、読み出しだけ差し替える
(function () {
  var base = window.Store.readBytes;
  window.Store.readBytes = function (path) {
    if (path === 'template.xlsx') {
      var bin = atob(window.EV_TEMPLATE_BASE64);
      var out = new Uint8Array(bin.length);
      for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return Promise.resolve(out);
    }
    return base(path);
  };
  var exists = window.Store.exists;
  window.Store.exists = function (path) {
    return path === 'template.xlsx' ? Promise.resolve(true) : exists(path);
  };
})();
