#!/usr/bin/env bash
#
# 他の PC で行った設定変更を取り込み、リンクを張り直す。
# 作業開始時に実行するのが基本。
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

BRANCH="$(git rev-parse --abbrev-ref HEAD)"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ローカルに未コミットの変更があります:"
  git status --short
  echo
  echo "先にコミットするか退避してから再実行してください:"
  echo "    git -C \"$REPO_ROOT\" add -A && git -C \"$REPO_ROOT\" commit -m 'Update Claude Code config'"
  exit 1
fi

echo "origin/$BRANCH から取り込みます..."
for attempt in 1 2 3 4; do
  if git pull --rebase origin "$BRANCH"; then
    break
  fi
  if [ "$attempt" -eq 4 ]; then
    echo "取り込みに失敗しました。" >&2
    exit 1
  fi
  wait=$((2 ** attempt))
  echo "失敗しました。${wait}秒後に再試行します..."
  sleep "$wait"
done

echo
"$REPO_ROOT/scripts/install.sh" "$@"

echo
echo "変更を他の PC へ共有するには:"
echo "    git -C \"$REPO_ROOT\" add -A"
echo "    git -C \"$REPO_ROOT\" commit -m 'Update Claude Code config'"
echo "    git -C \"$REPO_ROOT\" push -u origin $BRANCH"
