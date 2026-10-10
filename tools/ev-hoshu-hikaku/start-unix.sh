#!/bin/sh
# EV保守 価格比較表 作成ツールを起動する
cd "$(dirname "$0")" || exit 1
exec node serve.js
