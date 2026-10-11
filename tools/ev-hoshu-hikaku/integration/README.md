# 統合基幹システムへの組み込み

比較表ツールは、単体ページとしても、他のアプリの中の1画面としても動くようにしてあります。
このフォルダは、Denrai 統合基幹システムに組み込むときの手順と見本です。

- `example-host.html` … 統合基幹システムを模したページに実際に組み込んだ見本（そのまま開けます）
- `denrai-snippet.js` … 統合基幹システム側に貼る分のコード

---

## 組み込みの形

ツールは **Shadow DOM の中**に画面を作ります。ホスト側の CSS とは互いに影響しません。

統合基幹システムには `.card` `.btn` `.chip` `.badge` `.field` `.muted` `.dot` といった
同名のクラスがあり、さらに `table` `th` `td` `a` `input` の要素セレクタも定義されています。
クラス名を変えるだけでは要素セレクタを避けられないため、Shadow DOM で遮断しています。

```
ホストのページ
└── <div id="evHikakuMount" class="evh-root">   ← ホストが用意する枠
    └── #shadow-root                            ← ツールが作る
        ├── <style> …ツールのCSS… </style>
        └── …ツールの画面…
```

## 使い方

必要なファイルを読み込み、枠を1つ用意して `mount()` を呼ぶだけです。

```html
<script src="lib/logo.js"></script>
<script src="lib/evh-css.js"></script>
<script src="lib/evh-html.js"></script>
<script src="lib/lifecycle.js"></script>
<script src="lib/zip.js"></script>
<script src="lib/xlsx-fill.js"></script>
<script src="lib/browser-store.js"></script>
<script src="lib/download.js"></script>
<script src="lib/ai.js"></script>
<script src="app.js"></script>
```

```js
EvHikaku.mount(document.getElementById('evHikakuMount'), {
  store: myStore,       // 保存先（省略すると lib/store.js のドライブ版）
  downloader: myDl,     // ファイルの渡し方（省略するとブラウザのダウンロード）
  ai: myAi,             // 書類読み取り（省略すると Claude API を直接呼ぶ）
  embedded: true        // ホストに題名とロゴがあるので、ツール側の見出しを省く
});
```

| API | 内容 |
| --- | --- |
| `EvHikaku.mount(el, options)` | `el` の中に画面を作る。2回目以降は作り直す |
| `EvHikaku.unmount()` | 片付ける。未保存があれば保存してから閉じる |
| `EvHikaku.print()` | 比較表だけを印刷する（ホストの画面は隠れる） |
| `EvHikaku.openCase(id)` | 指定の案件を開く |

**枠の高さはホストが決めます。** ツール側は `height:100%` です。
`#evHikakuMount{flex:1; min-height:560px}` のように指定してください。

## 差し替える3つの部品

いずれも同じ関数さえ持っていれば、中身は自由です。

### 1. 保存先（store）

`lib/store.js` は Google ドライブのフォルダを使いますが、これは
File System Access API が必要なので、ホストの環境によっては使えません。
`lib/browser-store.js` にブラウザ内（localStorage）で完結する実装があります。

```js
var store = createBrowserStore({ prefix: 'denrai:evh:', label: 'ブラウザ内' });
```

必要な関数は `supported / connected / name / hasSaved / pick / restore / reauthorize /
readBytes / readText / readJson / write / writeJson / exists / listDir / remove` です。
ホストが独自のデータベースを持つなら、それに合わせて書いてください。

> localStorage は見ている人のブラウザの中だけに残ります。
> 複数人で案件を共有したいなら、ホスト側の保存先に繋ぎ替えてください。

### 2. ファイルの渡し方（downloader）

```js
var downloader = { async save(fileName, bytes, mimeType) { /* … */ return { status:'saved' }; } };
```

統合基幹システムは `claude.use("downloads")` を使っていますが、
**`.xlsx` は claude.ai 側の保存許可リストに入っていません。**
アーティファクトとして動かす限り、Excel の保存はできません（生成までは動きます）。
Excel が要る作業は、当面ローカル版（`start.cmd`）で行ってください。

### 3. 書類読み取り（ai）

`lib/ai.js` は `https://api.anthropic.com` を直接呼びます。
**claude.ai のアーティファクトからは外部 API を呼べません。**
組み込み版では「① 書類読み取り」は動かないので、次のどちらかにしてください。

- 読み取りはローカル版で行い、案件データを共有の保存先に置く
- ホスト側で読み取り結果を用意し、`ai` に差し替え実装を渡す（`extract()` が同じ形を返せばよい）

## ひな形 Excel

`template/ev-hikaku-template.xlsx`（283KB）が必要です。
`store.readBytes('template.xlsx')` が返せるようにしてください。見本では fetch しています。
ホストが単一 HTML なら、base64 で埋め込む方法もあります（デモ版がその形です）。

## 画面を編集するとき

スタイルと骨格は `src/evh.css` と `src/evh.html` にあります。
編集したら `python3 scripts/build-ui.py` で `lib/evh-css.js` / `lib/evh-html.js` を作り直してください。
`lib/` 側は自動生成なので直接編集しないでください。

## 残っている作業

組み込み自体はこの手順でできますが、統合基幹システム側に次の判断が要ります。

1. **案件データの置き場所** — ホストのデータと同じ所に入れるか、ツール専用に分けるか
2. **書類読み取りの扱い** — 上記の制約をどう回避するか
3. **Excel 出力** — アーティファクトのままにするか、ローカル版に寄せるか
