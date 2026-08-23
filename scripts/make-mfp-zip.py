#!/usr/bin/env python3
"""複合機見積作成ツールの配布用ZIPを作る。

    python3 scripts/make-mfp-zip.py [出力先ディレクトリ]

中身は git の管理対象だけを使う。APIキー・設定ファイル・案件データは
.gitignore で除外されているので、取り違えて同梱する余地がない。

ファイル名は CP932（Shift_JIS）で書き込む。
Windowsのエクスプローラーは、ZIP内のファイル名を「UTF-8です」という目印
（汎用フラグの11ビット目）が立っていない限り、OSの既定の文字コード＝CP932
として読む。Linuxの zip コマンドはUTF-8のバイトを書くのにこの目印を
立てないことがあり、そのままだと日本語のファイル名が文字化けする。
"""

from __future__ import annotations

import shutil
import subprocess
import sys
import tempfile
import zipfile
from datetime import date
from pathlib import Path

REPO = Path(__file__).resolve().parent.parent
APP = "apps/mfp-quote-tool"
# 展開したときにできるフォルダ名。既存のフォルダに上書きしてもらうので変えない
FOLDER = "複合機見積作成ツール"


def _encode_cp932(self: zipfile.ZipInfo) -> tuple[bytes, int]:
    """ファイル名を CP932 で書き込む（Windowsのエクスプローラー向け）。"""
    return self.filename.encode("cp932"), self.flag_bits


def build(out_dir: Path) -> Path:
    stamp = date.today().strftime("%Y%m%d")
    zip_path = out_dir / f"{FOLDER}_{stamp}.zip"

    with tempfile.TemporaryDirectory() as tmp:
        staging = Path(tmp) / "staging"
        staging.mkdir()
        # git archive を使うと、管理対象のファイルだけが確実に取り出せる
        archive = subprocess.run(
            ["git", "archive", "HEAD", APP],
            cwd=REPO,
            check=True,
            stdout=subprocess.PIPE,
        ).stdout
        tar_path = Path(tmp) / "app.tar"
        tar_path.write_bytes(archive)
        subprocess.run(["tar", "-x", "-C", str(staging), "-f", str(tar_path)], check=True)

        root = staging / FOLDER
        (staging / APP).rename(root)
        shutil.rmtree(staging / "apps")

        files = sorted(p for p in root.rglob("*") if p.is_file())
        if not files:
            raise SystemExit("配布するファイルが見つかりません。")

        zip_path.parent.mkdir(parents=True, exist_ok=True)
        original = zipfile.ZipInfo._encodeFilenameFlags
        zipfile.ZipInfo._encodeFilenameFlags = _encode_cp932  # type: ignore[method-assign]
        try:
            with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as zf:
                for path in files:
                    zf.write(path, f"{FOLDER}/{path.relative_to(root).as_posix()}")
        finally:
            zipfile.ZipInfo._encodeFilenameFlags = original  # type: ignore[method-assign]

    verify(zip_path)
    return zip_path


def verify(zip_path: Path) -> None:
    """Windowsのエクスプローラーで文字化けしないことを確かめる。"""
    data = zip_path.read_bytes()
    at = 0
    checked = 0
    while (at := data.find(b"PK\x03\x04", at)) != -1:
        flag = int.from_bytes(data[at + 6 : at + 8], "little")
        name_len = int.from_bytes(data[at + 26 : at + 28], "little")
        name = data[at + 30 : at + 30 + name_len]
        if flag & 0x800:
            raise SystemExit(f"UTF-8フラグが立っています: {name!r}")
        # CP932として読めない名前は、Windowsで文字化けする
        name.decode("cp932")
        checked += 1
        at += 4
    if not checked:
        raise SystemExit("ZIPの中身が空です。")
    print(f"{zip_path}  ({zip_path.stat().st_size / 1024 / 1024:.1f}MB / {checked}ファイル)")
    print("ファイル名はCP932。Windowsのエクスプローラーで文字化けしません。")


if __name__ == "__main__":
    out = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else REPO
    print(build(out))
