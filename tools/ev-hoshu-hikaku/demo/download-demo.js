/*
 * デモ版のファイル受け渡し。
 * claude.ai の Artifact は .xlsx の保存を許可していないので、
 * 生成までは本物と同じ処理を通したうえで、保存できないことをそのまま伝える。
 */
(function (global) {
  'use strict';

  global.Downloader = {
    label: '生成のみ',
    async save(fileName, bytes) {
      var kb = Math.round(bytes.length / 1024);
      return {
        status: 'generated',
        message: 'Excel を生成しました（' + fileName + ' / ' + kb +
          ' KB）。デモでは保存まではできません。ローカル版ならここでダウンロードされます。'
      };
    }
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
