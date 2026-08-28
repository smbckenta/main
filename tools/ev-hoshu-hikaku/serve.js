/*
 * このフォルダをローカルで配信する小さなサーバー。依存パッケージなし。
 *
 *   node serve.js            127.0.0.1 の空きポートで起動してブラウザを開く
 *   node serve.js 8080       ポートを指定する
 *   node serve.js --no-open  ブラウザを開かない
 *
 * file:// で直接開いてもだいたい動くが、フォルダ選択 (File System Access API) が
 * 使えないブラウザ設定があるため、localhost 経由で開くほうが確実。
 */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = __dirname;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.md': 'text/markdown; charset=utf-8'
};

const args = process.argv.slice(2);
const noOpen = args.includes('--no-open');
const wanted = Number(args.find((a) => /^\d+$/.test(a))) || 0;

const server = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';

  // ルート外を読ませない
  const file = path.join(ROOT, path.normalize(rel).replace(/^([/\\])+/, ''));
  if (!file.startsWith(ROOT)) {
    res.writeHead(403).end('forbidden');
    return;
  }

  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('見つかりません: ' + rel);
      return;
    }
    res.writeHead(200, {
      'content-type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'cache-control': 'no-store'
    });
    res.end(data);
  });
});

server.listen(wanted, '127.0.0.1', () => {
  const url = 'http://127.0.0.1:' + server.address().port + '/';
  console.log('EV保守 価格比較表 作成ツール');
  console.log('  ' + url);
  console.log('  終了するときは Ctrl+C');
  if (!noOpen) open(url);
});

function open(url) {
  const cmd = process.platform === 'win32'
    ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin'
      ? ['open', [url]]
      : ['xdg-open', [url]];
  execFile(cmd[0], cmd[1], () => { /* 開けなくても URL は表示済み */ });
}
