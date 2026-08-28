#!/usr/bin/env python3
"""ひな形 xlsx をツールが読める形に整える。

ブラウザ側は無圧縮(STORE)の ZIP しか読まないので、Excel で編集したひな形は
このスクリプトを通してから data/template.xlsx に置く。

  python3 scripts/pack-template.py 編集したひな形.xlsx template/ev-hikaku-template.xlsx

あわせて次の後始末をする。
  - calcChain.xml を削除（行を増減させると不整合になるため）
  - 開いたときに全再計算させる（fullCalcOnLoad）
  - 印刷範囲外に残っている #REF! セルを空にする
"""
import os
import re
import sys
import zipfile

def main(src, dst):
    zin = zipfile.ZipFile(src)
    parts = {n: zin.read(n) for n in zin.namelist()}

    parts.pop('xl/calcChain.xml', None)
    ct = parts['[Content_Types].xml'].decode()
    ct = re.sub(r'<Override[^>]*calcChain\.xml"[^>]*/>', '', ct)
    parts['[Content_Types].xml'] = ct.encode()

    rels = parts['xl/_rels/workbook.xml.rels'].decode()
    rels = re.sub(r'<Relationship[^>]*calcChain\.xml"/>', '', rels)
    parts['xl/_rels/workbook.xml.rels'] = rels.encode()

    wb = parts['xl/workbook.xml'].decode()
    if 'fullCalcOnLoad' not in wb:
        wb = re.sub(r'<calcPr ([^/]*?)/>', r'<calcPr \1 fullCalcOnLoad="1"/>', wb)
    parts['xl/workbook.xml'] = wb.encode()

    sheet = parts['xl/worksheets/sheet1.xml'].decode()

    def blank_if_out_of_range(m):
        col = m.group(1)
        if re.match(r'^(D[D-X]|E[A-L])$', col):
            cell = re.sub(r'>.*?</c>', '/>', m.group(0), flags=re.S)
            return re.sub(r'(<c\b[^>]*?)\s+t="[^"]*"', r'\1', cell)
        return m.group(0)

    sheet = re.sub(r'<c r="([A-Z]+)(?:5[1-9])"[^>]*?(?:/>|>.*?</c>)',
                   blank_if_out_of_range, sheet, flags=re.S)
    parts['xl/worksheets/sheet1.xml'] = sheet.encode()

    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    with zipfile.ZipFile(dst, 'w', zipfile.ZIP_STORED) as zout:
        for name in zin.namelist():
            if name in parts:
                zout.writestr(name, parts[name])
    print('wrote %s (%d bytes)' % (dst, os.path.getsize(dst)))


if __name__ == '__main__':
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    main(sys.argv[1], sys.argv[2])
