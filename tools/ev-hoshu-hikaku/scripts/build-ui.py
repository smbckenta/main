#!/usr/bin/env python3
"""src/evh.css と src/evh.html を、mount() が差し込める JS に変換する。

画面は Shadow DOM の中に作るため、スタイルと骨格を文字列として持つ必要がある。
編集は src/ 側で行い、このスクリプトで lib/ を作り直す。

  python3 scripts/build-ui.py
"""
import io
import json
import os

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def emit(src, dst, varname, note):
    with io.open(os.path.join(BASE, src), encoding='utf-8') as f:
        text = f.read()
    with io.open(os.path.join(BASE, dst), 'w', encoding='utf-8') as f:
        f.write(note + '\n')
        f.write('var %s = %s;\n' % (varname, json.dumps(text, ensure_ascii=False)))
    print('%s -> %s (%d bytes)' % (src, dst, len(text)))


def main():
    emit('src/evh.css', 'lib/evh-css.js', 'EVH_CSS',
         '/* 自動生成: scripts/build-ui.py（元は src/evh.css）\n'
         '   画面のスタイル。mount() が Shadow DOM の中に差し込むので、\n'
         '   ホスト側の .card / .btn / table などとは影響し合わない。 */')
    emit('src/evh.html', 'lib/evh-html.js', 'EVH_HTML',
         '/* 自動生成: scripts/build-ui.py（元は src/evh.html）\n'
         '   画面の骨格。mount() が Shadow DOM の中に差し込む。 */')


if __name__ == '__main__':
    main()
