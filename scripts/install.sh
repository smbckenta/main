#!/usr/bin/env bash
#
# このリポジトリの claude/ 配下を ~/.claude/ にシンボリックリンクする。
# macOS / Linux / WSL / Git Bash で動作する。何度実行しても安全（冪等）。
#
#   ./scripts/install.sh              既存の設定をリポジトリに取り込んでからリンク
#   ./scripts/install.sh --no-adopt   取り込まずにリンク（既存はバックアップへ退避）
#   ./scripts/install.sh --dry-run    実際には変更せず、やることだけ表示
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC_DIR="$REPO_ROOT/claude"
DEST_DIR="${CLAUDE_HOME:-$HOME/.claude}"
BACKUP_DIR="$DEST_DIR/backup-$(date +%Y%m%d-%H%M%S)"

# 同期する対象。ここに無いものは一切触らない。
# 特に ~/.claude/.credentials.json と ~/.claude.json は認証情報とマシン固有の
# 状態を含むため、意図的に対象外にしている。
LINK_DIRS=(agents commands rules skills)
LINK_FILES=(settings.json CLAUDE.md keybindings.json statusline.sh)

ADOPT=1
DRY_RUN=0
# リポジトリ側にも同名ファイルがあったため、ローカルの内容を採用できなかったもの
NEEDS_MERGE=()
for arg in "$@"; do
  case "$arg" in
    --no-adopt) ADOPT=0 ;;
    --dry-run)  DRY_RUN=1 ;;
    -h|--help)  sed -n '2,9p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "不明なオプション: $arg" >&2; exit 2 ;;
  esac
done

run() {
  if [ "$DRY_RUN" -eq 1 ]; then
    echo "  [dry-run] $*"
  else
    "$@"
  fi
}

backup() {
  local target="$1"
  run mkdir -p "$BACKUP_DIR"
  run mv "$target" "$BACKUP_DIR/"
  echo "  退避: $target -> $BACKUP_DIR/"
}

# 既に正しいリンクなら 0 を返す
already_linked() {
  local target="$1" src="$2"
  [ -L "$target" ] && [ "$(readlink "$target")" = "$src" ]
}

echo "リポジトリ: $REPO_ROOT"
echo "リンク先  : $DEST_DIR"
[ "$DRY_RUN" -eq 1 ] && echo "(dry-run: 実際には変更しません)"
echo

if [ ! -d "$SRC_DIR" ]; then
  echo "エラー: $SRC_DIR が見つかりません。リポジトリのルートから実行してください。" >&2
  exit 1
fi

run mkdir -p "$DEST_DIR"

for name in "${LINK_DIRS[@]}"; do
  src="$SRC_DIR/$name"
  target="$DEST_DIR/$name"
  [ -d "$src" ] || continue

  if already_linked "$target" "$src"; then
    echo "OK   $name/ (リンク済み)"
    continue
  fi

  echo "設定 $name/"
  if [ -e "$target" ] && [ ! -L "$target" ]; then
    # 既存の実ディレクトリ。中身をリポジトリへ取り込んでから退避する。
    if [ "$ADOPT" -eq 1 ] && [ -d "$target" ]; then
      if [ "$DRY_RUN" -eq 1 ]; then
        echo "  [dry-run] cp -Rn $target/. $src/  (既存ファイルは上書きしない)"
      else
        # -n: リポジトリ側に既にあるファイルは上書きしない
        cp -Rn "$target/." "$src/" 2>/dev/null || true
        echo "  取り込み: $target/ の中身をリポジトリへコピー（既存は保持）"
      fi
    fi
    backup "$target"
  elif [ -L "$target" ]; then
    backup "$target"
  fi
  run ln -s "$src" "$target"
  echo "  リンク: $target -> $src"
done

for name in "${LINK_FILES[@]}"; do
  src="$SRC_DIR/$name"
  target="$DEST_DIR/$name"

  # リポジトリに無く、ローカルにだけある場合は取り込む
  if [ ! -e "$src" ]; then
    if [ "$ADOPT" -eq 1 ] && [ -f "$target" ] && [ ! -L "$target" ]; then
      echo "設定 $name"
      run cp "$target" "$src"
      echo "  取り込み: $target -> $src"
    else
      continue
    fi
  fi

  if already_linked "$target" "$src"; then
    echo "OK   $name (リンク済み)"
    continue
  fi

  echo "設定 $name"
  if [ -e "$target" ] || [ -L "$target" ]; then
    # 実ファイルを退避する場合、リポジトリ側の内容が優先される。
    # 元の内容が必要なら手動でマージしてもらう。
    if [ -f "$target" ] && [ ! -L "$target" ]; then
      NEEDS_MERGE+=("$name")
    fi
    backup "$target"
  fi
  run ln -s "$src" "$target"
  echo "  リンク: $target -> $src"
done

echo
echo "完了しました。"
if [ -d "$BACKUP_DIR" ]; then
  echo "元の設定は $BACKUP_DIR に残してあります。問題なければ削除してください。"
fi

if [ "${#NEEDS_MERGE[@]}" -gt 0 ]; then
  echo
  echo "注意: 次のファイルはリポジトリ側の内容が使われています。"
  for f in "${NEEDS_MERGE[@]}"; do
    echo "    $f  (この PC の元の内容: $BACKUP_DIR/$f)"
  done
  echo "元の設定に残したい内容があれば、リポジトリ側へ手動でマージしてください:"
  echo "    diff \"$BACKUP_DIR/${NEEDS_MERGE[0]}\" \"$SRC_DIR/${NEEDS_MERGE[0]}\""
fi

if [ "$ADOPT" -eq 1 ] && [ "$DRY_RUN" -eq 0 ]; then
  cd "$REPO_ROOT"
  if ! git diff --quiet || [ -n "$(git ls-files --others --exclude-standard)" ]; then
    echo
    echo "リポジトリに取り込まれた変更があります。中身を確認してからコミットしてください:"
    echo "    git -C \"$REPO_ROOT\" status"
  fi
fi

echo
echo "次にこの PC で必要な手順（各 PC で1回ずつ・同期対象外）:"
echo "  1. claude  を起動してログイン（認証情報は PC ごとに保存されます）"
echo "  2. 必要な MCP サーバーを追加:  claude mcp add --scope user <name> ..."
echo "  3. 必要なプラグインを追加:      claude plugin marketplace add <owner/repo>"
echo "     詳細は docs/per-machine-setup.md を参照してください。"
