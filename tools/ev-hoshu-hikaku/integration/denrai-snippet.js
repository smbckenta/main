/*
 * 統合基幹システム側に足す分。実際の組み込み時にこの3か所を入れる。
 * 見本として動く形は integration/example-host.html にある。
 */

/* ---- 1. メニューに1行足す（NAV 配列） ---- */
// {id:"evHikaku", cat:"sales", label:"EV保守 価格比較表", icon:"🛗"},

/* ---- 2. render() の分岐に1行足す ---- */
// else if(activeTab==="evHikaku") main.innerHTML = pageEvHikaku();

/* ---- 3. 画面を作る関数と、その後始末 ---- */

// ツールを置く枠を返すだけ。中身は mount() が作る。
function pageEvHikaku() {
  return '<div id="evHikakuMount" style="min-height:560px"></div>';
}

// render() の最後（bindPageEvents のあたり）から呼ぶ。
// main.innerHTML を書き換えるたびに枠は作り直されるので、その都度 mount する。
function mountEvHikakuIfNeeded() {
  var el = document.getElementById('evHikakuMount');
  if (!el) {
    // 別の画面に移った：開いていたら片付ける
    if (window.EvHikaku && el !== evHikakuMounted) {
      try { EvHikaku.unmount(); } catch (e) { }
      evHikakuMounted = null;
    }
    return;
  }
  if (el === evHikakuMounted) return;
  evHikakuMounted = el;

  EvHikaku.mount(el, {
    store: evHikakuStore(),
    embedded: true
  });
}
var evHikakuMounted = null;

// 保存先。ホストに専用のデータベースができたら、ここを差し替える。
function evHikakuStore() {
  var store = createBrowserStore({ prefix: 'denrai:evh:', label: 'ブラウザ内' });

  // ひな形 Excel はホストが渡す（base64 で埋め込む場合の例）
  var baseExists = store.exists;
  var baseReadBytes = store.readBytes;
  store.exists = function (path) {
    return path === 'template.xlsx' ? Promise.resolve(true) : baseExists(path);
  };
  store.readBytes = function (path) {
    if (path !== 'template.xlsx') return baseReadBytes(path);
    var bin = atob(EVH_TEMPLATE_BASE64);          // ← ひな形を base64 で持っておく
    var out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return Promise.resolve(out);
  };
  return store;
}
