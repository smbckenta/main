#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""【EVPT】エレベーター特約店管理表 → 銀行提出用 Excel（A3 印刷用）変換スクリプト

Google スプレッドシート「【EVPT】エレベーター特約店管理表」の
「【成約済】EV案件 管理表」シートを Excel でダウンロードし、このスクリプトに渡すと

  * 銀行提出に不要な社内管理列を削除
  * 文字・行・列を拡大（既定 14pt / 行高 30pt）
  * A3 横・横 1 ページ幅に収まる印刷設定
  * 見出し行を全ページで繰り返し

した提出用ブックを出力します。元のスプレッドシートは一切変更しません。

使い方:
    python scripts/make_ev_bank_report.py <ダウンロードした.xlsx> [-o 出力フォルダ] [--date YYMMDD]

出力ファイル名:
    【EVPT】エレベーター特約店管理表YYMMDD.xlsx   (YYMMDD = 作成日)
"""

from __future__ import annotations

import argparse
import datetime as dt
import os
import re
import sys
import unicodedata

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.properties import PageSetupProperties

# ---------------------------------------------------------------- 設定
SRC_SHEET = "【成約済】EV案件 管理表"      # 変換元シート名
OUT_SHEET = "EV保守成約案件管理"           # 出力シート名
HEADER_ROW = 4                             # 変換元の見出し行
DOC_TITLE = "EV保守成約案件管理"

# 既定の保存先（Windows の共有ドライブ）。存在しない場合はカレントに保存します。
DEFAULT_OUT_DIR = r"G:\共有ドライブ\★Kevin\☆重要\f\EV関連"
FILE_STEM = "【EVPT】エレベーター特約店管理表"   # 語尾に YYMMDD を付けて保存

FONT_NAME = "Meiryo UI"   # 日本語が読みやすく Windows に標準搭載
FONT_SIZE = 16            # 本文の文字サイズ
TITLE_SIZE = 24
META_SIZE = 13
LINE_PT = 22              # 折り返し 1 行あたりの高さ
ROW_PAD_PT = 10           # 行の上下余白
MIN_ROW_PT = 34           # 最低行高

PAPER_A3 = 8
ORIENTATION = "landscape"  # A3 横。縦にしたい場合は "portrait"
MARGIN_IN = 0.25

# 銀行提出用に残す列。(出力見出し, 変換元見出し, 幅px, 表示形式, 折返し, 寄せ)
# 変換元見出しで列を探すため、元シートで列が増減・移動しても追従します。
COLUMNS = [
    ("成約Code",     "成約Code",      96,  None,          False, "center"),
    ("担当",         "担当",          76,  None,          True,  "center"),
    ("顧客名",       "顧客名",        245, None,          True,  "left"),
    ("物件名",       "物件名",        245, None,          True,  "left"),
    ("開始月",       "開始月",        86,  "yyyy/mm",     False, "center"),
    ("弊社\n入金月", "弊社\n入金月",  86,  "yyyy/mm",     False, "center"),
    ("提案内容",     "提案内容",      80,  None,          True,  "center"),
    ("基数",         "基数",          68,  '0"基"',       False, "center"),
    ("契約形態",     "契約形態",      92,  None,          True,  "center"),
    ("点検頻度",     "点検頻度",      92,  None,          True,  "center"),
    ("OP",           "OP",            66,  None,          True,  "center"),
    ("仕切",         "仕切",          132, "¥#,##0",      False, "right"),
    ("見積料金",     "見積料金",      132, "¥#,##0",      False, "right"),
    ("❶EVPT\n売上", "❶EVPT\n売上",  112, "¥#,##0",      False, "right"),
    ("❷PTI",        "❷PTI",         102,  "¥#,##0",      False, "right"),
    ("❸EVPT NP",    "❸EVPT NP",     112, "¥#,##0",      False, "right"),
    ("結果",         "結果",          118, None,          False, "center"),
    ("備考",         "備考",          195, None,          True,  "left"),
]
# 変換元にあっても銀行提出では落とす列（社内管理用）:
#   PT① / 担当(2つ目) / 既存契約 / 仕様 / ベンダー / 既存料金 / 結果番号 /
#   Z列以降の集計ダッシュボード

# レコードの有無はこの列で判定する（成約Code は未採番の行があるため使わない）
ROW_KEY_HEADER = "結果"

ERROR_TEXTS = {"#VALUE!", "#N/A", "#REF!", "#NAME?", "#DIV/0!", "#NULL!", "#NUM!"}

# 「結果」ごとの色分け
RESULT_FILLS = {
    "保守成約":   "E8F3E4",
    "リニュ成約": "E8F3E4",
    "新設成約":   "E8F3E4",
    "進捗中":     "FFF6DC",
    "保留":       "FFF6DC",
    "失注":       "F2F2F2",
    "解約":       "FBE4E4",
}

HEADER_FILL = "1F4E79"
HEADER_FONT_COLOR = "FFFFFF"
BAND_FILL = "F7F9FC"
GRID = Side(style="thin", color="9DB2C6")
BORDER = Border(left=GRID, right=GRID, top=GRID, bottom=GRID)

# Excel の列幅 1 単位 = 既定フォント(Calibri 11)の数字幅 7px。px = width*7 + 5
PX_PER_UNIT = 7.0
CELL_PAD_PX = 5


# ---------------------------------------------------------------- ユーティリティ
def px_to_width(px: float) -> float:
    return round((px - CELL_PAD_PX) / PX_PER_UNIT, 2)


def display_len(text: str) -> int:
    """半角=1 / 全角=2 で数えた表示幅。"""
    return sum(2 if unicodedata.east_asian_width(ch) in "WFA" else 1 for ch in str(text))


def norm(text) -> str:
    """見出し比較用に空白・改行を潰した文字列。"""
    return re.sub(r"\s+", "", str(text or ""))


def clean(value):
    """数式エラー文字列を空にする。"""
    if isinstance(value, str) and value.strip() in ERROR_TEXTS:
        return None
    return value


def find_columns(ws) -> dict:
    """変換元の見出し行から {正規化見出し: 列番号} を作る（最初に出た列を採用）。"""
    found = {}
    for col in range(1, ws.max_column + 1):
        key = norm(ws.cell(HEADER_ROW, col).value)
        if key and key not in found:
            found[key] = col
    return found


def last_data_row(ws, key_col: int) -> int:
    last = HEADER_ROW
    for row in range(HEADER_ROW + 1, ws.max_row + 1):
        if clean(ws.cell(row, key_col).value) not in (None, ""):
            last = row
    return last


def wrapped_lines(value, number_format, width_px: int, wrap: bool) -> int:
    """折り返し後の行数を見積もる。"""
    if value is None or value == "":
        return 1
    if isinstance(value, (dt.datetime, dt.date)):
        text = "0000/00"
    elif isinstance(value, (int, float)):
        text = f"¥{value:,.0f}" if "¥" in (number_format or "") else f"{value:,.0f}"
    else:
        text = str(value)

    # 14pt の半角 1 文字 ≒ FONT_SIZE * 96/72 * 0.5 px
    char_px = FONT_SIZE * (96 / 72) * 0.5
    capacity = max(1, int((width_px - 8) / char_px))
    lines = 0
    for part in text.split("\n"):
        lines += max(1, -(-display_len(part) // capacity)) if wrap else 1
    return max(1, lines)


# ---------------------------------------------------------------- 変換本体
def build(src_path: str, out_path: str, made_on: dt.date) -> tuple[str, int, float, int]:
    src_wb = load_workbook(src_path, data_only=True)
    if SRC_SHEET not in src_wb.sheetnames:
        raise SystemExit(
            f"シート「{SRC_SHEET}」が見つかりません。含まれるシート: {src_wb.sheetnames}"
        )
    src = src_wb[SRC_SHEET]

    header_map = find_columns(src)
    missing = [h for _, h, *_ in COLUMNS if norm(h) not in header_map]
    if missing:
        raise SystemExit("変換元に見出しが見つかりません: " + " / ".join(missing))

    key_col = header_map[norm(ROW_KEY_HEADER)]
    end_row = last_data_row(src, key_col)
    src_rows = [
        r for r in range(HEADER_ROW + 1, end_row + 1)
        if clean(src.cell(r, key_col).value) not in (None, "")
    ]

    wb = Workbook()
    ws = wb.active
    ws.title = OUT_SHEET

    ncols = len(COLUMNS)
    last_letter = get_column_letter(ncols)

    # --- 表題（全ページで繰り返す 1〜3 行目）
    ws.merge_cells(f"A1:{last_letter}1")
    ws["A1"] = DOC_TITLE
    ws["A1"].font = Font(name=FONT_NAME, size=TITLE_SIZE, bold=True, color="1F4E79")
    ws["A1"].alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[1].height = 36

    ws.merge_cells(f"A2:{last_letter}2")
    ws["A2"] = (
        f"作成日：{made_on.strftime('%Y年%m月%d日')}　／　件数：{len(src_rows)} 件"
        f"　／　出典：【EVPT】エレベーター特約店管理表「{SRC_SHEET}」"
    )
    ws["A2"].font = Font(name=FONT_NAME, size=META_SIZE)
    ws["A2"].alignment = Alignment(horizontal="left", vertical="center")
    ws.row_dimensions[2].height = 22

    # --- 見出し行
    hrow = 3
    head_fill = PatternFill("solid", fgColor=HEADER_FILL)
    for i, (label, *_rest) in enumerate(COLUMNS, start=1):
        cell = ws.cell(hrow, i, label)
        cell.font = Font(name=FONT_NAME, size=FONT_SIZE, bold=True, color=HEADER_FONT_COLOR)
        cell.fill = head_fill
        cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
        cell.border = BORDER
    ws.row_dimensions[hrow].height = 54

    # --- 明細
    out_row = hrow
    for n, r in enumerate(src_rows):
        out_row += 1
        result = clean(src.cell(r, header_map[norm("結果")]).value)
        band = BAND_FILL if n % 2 else None
        lines = 1
        for i, (_label, src_head, width_px, numfmt, wrap, halign) in enumerate(COLUMNS, start=1):
            value = clean(src.cell(r, header_map[norm(src_head)]).value)
            cell = ws.cell(out_row, i, value)
            cell.font = Font(name=FONT_NAME, size=FONT_SIZE)
            cell.alignment = Alignment(
                horizontal=halign, vertical="center", wrap_text=wrap, shrink_to_fit=not wrap
            )
            cell.border = BORDER
            if numfmt and isinstance(value, (int, float, dt.datetime, dt.date)):
                cell.number_format = numfmt
            if _label == "結果" and result in RESULT_FILLS:
                cell.fill = PatternFill("solid", fgColor=RESULT_FILLS[result])
            elif band:
                cell.fill = PatternFill("solid", fgColor=band)
            lines = max(lines, wrapped_lines(value, numfmt, width_px, wrap))
        ws.row_dimensions[out_row].height = max(MIN_ROW_PT, lines * LINE_PT + ROW_PAD_PT)

    # --- 列幅
    total_px = 0
    for i, (_l, _s, width_px, *_rest) in enumerate(COLUMNS, start=1):
        ws.column_dimensions[get_column_letter(i)].width = px_to_width(width_px)
        total_px += width_px

    # --- 表示・印刷設定
    ws.freeze_panes = ws.cell(hrow + 1, 5)          # 見出し行と 顧客名/物件名 までを固定
    ws.sheet_view.showGridLines = False

    ws.page_setup.paperSize = PAPER_A3
    ws.page_setup.orientation = ORIENTATION
    ws.sheet_properties.pageSetUpPr = PageSetupProperties(fitToPage=True)
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0                    # 高さはページ数なりで
    ws.print_options.horizontalCentered = True
    ws.print_title_rows = f"1:{hrow}"                # 表題＋見出しを毎ページ印刷
    ws.print_area = f"A1:{last_letter}{out_row}"
    ws.page_margins.left = ws.page_margins.right = MARGIN_IN
    ws.page_margins.top = ws.page_margins.bottom = 0.35
    ws.page_margins.header = ws.page_margins.footer = 0.2
    ws.oddFooter.right.text = "&P / &N"
    ws.oddFooter.right.size = 10
    ws.oddFooter.left.text = DOC_TITLE + "　" + made_on.strftime("%Y/%m/%d")
    ws.oddFooter.left.size = 10

    wb.save(out_path)

    # A3 の印字可能幅（96dpi 換算）から縮小率とページ数を見積もる
    page_w_in = (16.54 if ORIENTATION == "landscape" else 11.69) - MARGIN_IN * 2
    page_h_in = (11.69 if ORIENTATION == "landscape" else 16.54) - 0.35 * 2
    scale = min(1.0, page_w_in * 96 / total_px)
    repeat_pt = sum(ws.row_dimensions[r].height for r in range(1, hrow + 1))
    body_pt = sum(ws.row_dimensions[r].height for r in range(hrow + 1, out_row + 1))
    per_page_pt = page_h_in * 72 / scale - repeat_pt
    pages = max(1, -(-body_pt // per_page_pt))
    return out_path, len(src_rows), scale, int(pages)


# ---------------------------------------------------------------- CLI
def resolve_out_dir(requested: str | None) -> str:
    if requested:
        return requested
    if os.path.isdir(DEFAULT_OUT_DIR):
        return DEFAULT_OUT_DIR
    print(
        f"※ 既定の保存先が見つからないためカレントに保存します: {DEFAULT_OUT_DIR}",
        file=sys.stderr,
    )
    return os.getcwd()


def main() -> None:
    ap = argparse.ArgumentParser(description="EV案件管理表を銀行提出用 A3 Excel に変換します")
    ap.add_argument("src", help="Google スプレッドシートからダウンロードした .xlsx")
    ap.add_argument("-o", "--out-dir", default=None, help=f"保存先フォルダ（既定: {DEFAULT_OUT_DIR}）")
    ap.add_argument("--date", default=None, help="ファイル名の日付 YYMMDD（既定: 本日）")
    args = ap.parse_args()

    if args.date:
        if not re.fullmatch(r"\d{6}", args.date):
            raise SystemExit("--date は YYMMDD の 6 桁で指定してください（例 260511）")
        made_on = dt.datetime.strptime(args.date, "%y%m%d").date()
    else:
        made_on = dt.date.today()

    out_dir = resolve_out_dir(args.out_dir)
    os.makedirs(out_dir, exist_ok=True)
    out_path = os.path.join(out_dir, f"{FILE_STEM}{made_on.strftime('%y%m%d')}.xlsx")

    path, count, scale, pages = build(args.src, out_path, made_on)
    print(f"作成しました: {path}")
    print(f"  件数        : {count} 件")
    print(f"  用紙        : A3 {'横' if ORIENTATION == 'landscape' else '縦'} / 横 1 ページ幅")
    print(f"  印刷縮小率  : 約 {scale * 100:.0f}%（本文 {FONT_SIZE}pt → 実寸 約 {FONT_SIZE * scale:.1f}pt）")
    print(f"  想定ページ数: 約 {pages} ページ")


if __name__ == "__main__":
    main()
