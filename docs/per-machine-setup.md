# PC ごとに必要な設定（同期できないもの）

Git で同期できるのは「設定ファイル」だけです。認証情報とマシン固有の状態は
仕組み上どうしても各 PC でセットアップする必要があります。ここではその一覧と、
できるだけ手間を減らす方法をまとめます。

---

## 1. ログイン（必須・各 PC で1回）

```bash
claude
```

初回起動時にブラウザが開き、アカウント認証が行われます。同じアカウントで
ログインすれば、サブスクリプションや利用可能なモデルは 3 台とも同じです。

認証トークンの保存先:

| OS | 保存先 |
| --- | --- |
| macOS | キーチェーン |
| Windows / Linux | `~/.claude/.credentials.json` |

**このファイルは絶対に Git にコミットしないでください。**
本リポジトリの `.gitignore` で除外済みですが、手動で `git add -f` しないよう注意してください。

---

## 2. MCP サーバー（各 PC で1回）

MCP サーバーの設定はスコープによって保存場所が違います。

| スコープ | 読み込まれる範囲 | 保存先 | Git 同期 |
| --- | --- | --- | --- |
| `local`（既定） | そのプロジェクトのみ | `~/.claude.json` | 不可 |
| `project` | そのプロジェクトのみ | プロジェクトの `.mcp.json` | **可能** |
| `user` | 全プロジェクト | `~/.claude.json` | 不可 |

`~/.claude.json` には OAuth セッション・プロジェクトごとの許可履歴・会話履歴が
同居しているため、このファイル自体を同期するのは危険です。したがって:

### 方法 A: 各 PC でコマンドを実行する（シンプル）

```bash
claude mcp add --transport http linear https://mcp.linear.app/mcp --scope user
claude mcp add --transport http sentry https://mcp.sentry.dev/mcp --scope user
```

よく使うサーバーは、下の「セットアップ用スクリプト」にまとめておくと
新しい PC でも 1 コマンドで済みます。

### 方法 B: プロジェクトの `.mcp.json` に入れる（チーム／リポジトリ単位で共有したい場合）

```bash
claude mcp add --transport http shared-server --scope project https://example.com/mcp
```

`.mcp.json` はプロジェクトのルートに作られるので、そのリポジトリを
コミットすれば全 PC・全メンバーで共有されます。API キーなどは
`${VAR}` 形式の環境変数展開が使えるため、値そのものをコミットせずに済みます。

### 方法 C: プラグインにまとめる（全プロジェクトで共有したい場合の推奨）

プラグインの直下に `.mcp.json` を置くと、そのプラグインを有効にした
すべての PC・すべてのプロジェクトで同じ MCP サーバーが使えます。
下の「4. プラグイン」を参照してください。

---

## 3. Claude Code 本体のインストール

各 PC にインストールが必要です。インストール方法は PC ごとに違って構いません。

```bash
# macOS (Homebrew)
brew install claude-code

# npm
npm install -g @anthropic-ai/claude-code@latest
```

バージョンを揃えたい場合は 3 台とも同じ方法で入れ、定期的に更新してください。

```bash
claude --version
```

---

## 4. プラグイン（各 PC で1回）

プラグインの実体は `~/.claude/plugins/` にキャッシュとして展開されます。
ここはマシン固有なので同期対象外ですが、**どのプラグインを使うか** の宣言は
同期できます。

### マーケットプレイスの追加とインストール

```bash
claude plugin marketplace add anthropics/claude-code
claude plugin install commit-commands@claude-code-plugins
```

`claude plugin install` は既定で user スコープにインストールされます。

### 自分専用のプラグインを作って 3 台で共有する

MCP サーバー・エージェント・フック・スキルをまとめて配布したい場合は、
GitHub リポジトリをマーケットプレイスにするのが一番確実です。

1. リポジトリのルートに `.claude-plugin/marketplace.json` を置く
2. 各 PC で 1 回だけ登録する

```bash
claude plugin marketplace add <owner>/<repo>
claude plugin install <plugin-name>@<marketplace-name>
```

以後、リポジトリを更新すれば各 PC は自動更新（`autoUpdate`）または
`claude plugin marketplace update <name>` で追従できます。

### `~/.claude/skills/` に置くだけの方法（マーケットプレイス不要）

`~/.claude/skills/<name>/.claude-plugin/plugin.json` を置くと、
`<name>@skills-dir` というプラグインとしてインストール不要で読み込まれます。
本リポジトリは `claude/skills/` を同期しているので、**この方法なら
プラグインごと 3 台で自動的に共有されます。** MCP サーバーやフックを
含めたい場合に有効です。

```
claude/skills/my-tools/
├── .claude-plugin/plugin.json
├── .mcp.json          ← MCP サーバー
├── hooks/hooks.json   ← フック
├── agents/            ← サブエージェント
└── skills/            ← スキル
```

雛形は `claude plugin init my-tools` で作れます。

---

## 5. マシンごとの上書き設定

「この PC だけ設定を変えたい」場合は、同期対象の `~/.claude/settings.json` を
編集するのではなく、プロジェクト側の `.claude/settings.local.json` を使ってください。
このファイルは Git 管理外（gitignore 対象）です。

設定の優先順位（強い順）:

1. 管理者設定（`managed-settings.json`）
2. コマンドライン引数
3. `.claude/settings.local.json`
4. `.claude/settings.json`（プロジェクト）
5. `~/.claude/settings.json` ← **本リポジトリが同期している場所**

---

## セットアップ用スクリプトの例

新しい PC を追加するときに叩くコマンドをまとめておくと楽です。
`scripts/bootstrap-machine.sh` などに置いて、内容は各自の環境に合わせて編集してください。

```bash
#!/usr/bin/env bash
set -euo pipefail

# MCP サーバー（user スコープ）
claude mcp add --transport http linear https://mcp.linear.app/mcp --scope user || true

# プラグイン
claude plugin marketplace add anthropics/claude-code || true
claude plugin install commit-commands@claude-code-plugins || true

echo "完了。claude を起動してログインしてください。"
```
