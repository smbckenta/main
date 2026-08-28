#!/usr/bin/env python3
"""デモ版の 1 ファイル HTML を組み立てる。

本体（index.html / app.js / lib/*.js）をそのまま取り込み、
保存先・書類読み取り・ファイル保存の3つだけ demo/ 配下の差し替え版を使う。
本体を直せばデモも同じ挙動になるので、作り直すだけでよい。

  python3 scripts/build-demo.py            → demo/ev-hikaku-demo.html
"""
import base64
import io
import os
import re

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def read(*parts):
    with io.open(os.path.join(BASE, *parts), encoding='utf-8') as f:
        return f.read()


BANNER_CSS = """
/* ---------- デモ版だけの追加 ---------- */
body{display:flex; flex-direction:column; height:100vh}
.app{height:auto; flex:1; min-height:0}
.demo-banner{
  flex:0 0 auto; display:flex; align-items:center; gap:18px; flex-wrap:wrap;
  padding:8px 18px; background:#132a41; color:#c9dbec;
  font-size:12px; line-height:1.5;
}
.demo-banner .text{max-width:none}
.demo-banner .tag{
  font-weight:700; letter-spacing:.14em; color:#fff;
  border:1px solid #3d6488; padding:2px 10px; border-radius:999px;
}
.demo-banner .spacer{flex:1}
.demo-banner button{
  border:1px solid #3d6488; background:transparent; color:#c9dbec;
  border-radius:6px; padding:4px 12px; font:inherit;
}
.demo-banner button:hover{background:#1d3b58; color:#fff}
@media print{ .demo-banner{display:none !important} }
"""

BANNER_HTML = """
<div class="demo-banner no-print">
  <span class="tag">デモ</span>
  <span class="text">実際のツールをそのまま動かしています。デモだけの制限は3つ
    &mdash; データはこのブラウザ内に保存（本番は Google ドライブ）、
    「Claude で読み取る」はサンプルの再生（本番は PDF を Claude へ送信）、
    Excel は生成まで（本番はダウンロード）。</span>
  <span class="spacer"></span>
  <button id="demoReset" type="button">最初の状態に戻す</button>
</div>
"""


def main():
    html = read('index.html')

    style = re.search(r'<style>(.*?)</style>', html, re.S).group(1)
    body = re.search(r'<body>(.*?)</body>', html, re.S).group(1)
    body = re.sub(r'<script[^>]*></script>\s*', '', body)

    with io.open(os.path.join(BASE, 'template', 'ev-hikaku-template.xlsx'), 'rb') as f:
        template_b64 = base64.b64encode(f.read()).decode()

    scripts = [
        read('lib', 'logo.js'),
        'var EV_TEMPLATE_BASE64 = "%s";' % template_b64,
        read('lib', 'zip.js'),
        read('lib', 'xlsx-fill.js'),
        read('demo', 'store-demo.js'),
        read('demo', 'download-demo.js'),
        read('demo', 'ai-demo.js'),
        read('app.js'),
        read('demo', 'seed-demo.js'),
    ]

    out = [
        '<title>EV保守 価格比較表ツール</title>',
        '<style>', style, BANNER_CSS, '</style>',
        BANNER_HTML,
        body.strip(),
        '<script>\n' + '\n;\n'.join(scripts) + '\n</script>',
    ]

    dst = os.path.join(BASE, 'demo', 'ev-hikaku-demo.html')
    with io.open(dst, 'w', encoding='utf-8') as f:
        f.write('\n'.join(out))
    print('wrote %s (%.0f KB)' % (dst, os.path.getsize(dst) / 1024))


if __name__ == '__main__':
    main()
