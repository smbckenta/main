/*
 * 生成したファイルを利用者に渡す。
 * ローカルで開いたときはブラウザのダウンロードを使う。
 * デモ版はこの Downloader だけを差し替える（app.js は触らない）。
 */
(function (global) {
  'use strict';

  global.Downloader = {
    label: 'ダウンロード',
    async save(fileName, bytes, mimeType) {
      var blob = new Blob([bytes], { type: mimeType || 'application/octet-stream' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = fileName;
      a.style.display = 'none';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
      return { status: 'saved' };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
