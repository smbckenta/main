# Claude Code の設定を複数 PC で共有する

3 台の PC で同じアカウントの Claude Code を使うとき、**設定・スキル・エージェント・
共通指示を Git で共有し、どの PC でも同じ環境で作業できるようにする**ためのリポジトリです。

やっていることは単純で、このリポジトリの `claude/` を各 PC の `~/.claude/` に
シンボリックリンクするだけです。片方で設定を変えて `git push` → もう片方で
`git pull` すれば、そのまま反映されます。

```
このリポジトリ                     各 PC の ~/.claude/
├── claude/settings.json    <────  settings.json   (シンボリックリンク)
├── claude/CLAUDE.md        <────  CLAUDE.md
├── claude/agents/          <────  agents/
├── claude/commands/        <────  commands/
├── claude/rules/           <────  rules/
└── claude/skills/          <────  skills/
```

---

## セットアップ

### 1 台目（設定の持ち主になる PC）

```bash
git clone https://github.com/smbckenta/main.git ~/claude-config
cd ~/claude-config
./scripts/install.sh
```

`install.sh` は、その PC の `~/.claude/` に既にある設定を**リポジトリ側へ取り込んでから**
リンクを張ります（既存ファイルを上書きすることはありません）。取り込まれた内容を確認して
コミットします。

```bash
git status          # 何が取り込まれたか確認
git add -A
git commit -m "Import Claude Code config from first machine"
git push -u origin claude/multi-pc-sync-qdxhfh
```

元の設定は `~/.claude/backup-<日時>/` に退避されているので、問題があれば戻せます。

> **`settings.json` / `CLAUDE.md` について**
> この 2 つはリポジトリに雛形が入っているため、その PC の既存の内容は
> 上書きされずにバックアップへ退避されます（スクリプトが該当ファイル名を表示します）。
> 元の設定を引き継ぎたい場合は、バックアップと見比べて手動でマージしてください。
>
> ```bash
> diff ~/.claude/backup-<日時>/settings.json claude/settings.json
> ```

### 2 台目・3 台目

```bash
git clone https://github.com/smbckenta/main.git ~/claude-config
cd ~/claude-config
./scripts/install.sh --no-adopt
```

2 台目以降は 1 台目の設定に揃えたいので `--no-adopt` を付けます
（その PC のローカル設定はバックアップに退避され、リポジトリ側には取り込まれません）。

### Windows の場合

```powershell
git clone https://github.com/smbckenta/main.git $HOME\claude-config
cd $HOME\claude-config
.\scripts\install.ps1
```

ディレクトリは Junction で接続するため管理者権限は不要ですが、
**ファイルのシンボリックリンクには「開発者モード」が必要**です。
`設定 > プライバシーとセキュリティ > 開発者向け > 開発者モード` を有効にしてから
実行してください。無効のままだとコピーにフォールバックし、その分は自動同期されません。

### 実行前に内容を確認したい場合

```bash
./scripts/install.sh --dry-run
```

---

## 日々の使い方

### 他の PC の変更を取り込む（作業開始時）

```bash
cd ~/claude-config && ./scripts/sync.sh
```

`git pull --rebase` してからリンクを張り直します（新しく増えたスキルなどにも対応）。

### 自分の変更を共有する（作業終了時）

スキルやエージェントを追加・編集すると、リンク経由でこのリポジトリの中身が
直接書き換わります。そのままコミットしてください。

```bash
cd ~/claude-config
git add -A
git commit -m "Add xxx skill"
git push -u origin claude/multi-pc-sync-qdxhfh
```

> `~/.claude/skills/` に新しいスキルを作れば、それはこのリポジトリの
> `claude/skills/` にそのまま入ります。別途コピーする必要はありません。

---

## 同期されるもの / されないもの

### 同期される

| パス | 中身 |
| --- | --- |
| `~/.claude/settings.json` | 権限ルール、環境変数、フック、プラグインの有効化設定 |
| `~/.claude/CLAUDE.md` | 全プロジェクト共通の指示 |
| `~/.claude/rules/` | 分割した共通ルール |
| `~/.claude/agents/` | サブエージェント定義 |
| `~/.claude/skills/` | 個人スキル（`@skills-dir` プラグインも含む） |
| `~/.claude/commands/` | カスタムスラッシュコマンド |

### 同期されない（意図的に除外）

| パス | 理由 |
| --- | --- |
| `~/.claude/.credentials.json` | **認証トークン。** 共有すると重大なセキュリティリスク |
| `~/.claude.json` | OAuth セッション・会話履歴・プロジェクトごとの許可履歴・user スコープの MCP 設定が同居 |
| `~/.claude/projects/`, `todos/`, `shell-snapshots/` | セッションの実行時データ |
| `~/.claude/plugins/` | プラグインのキャッシュ（マシン固有。宣言のみ同期する） |
| `.claude/settings.local.json` | 「この PC だけ」の上書き設定を置く場所 |

**認証情報とマシン固有の状態は仕組み上どうしても各 PC で用意する必要があります。**
その手順は [`docs/per-machine-setup.md`](docs/per-machine-setup.md) にまとめました。

---

## MCP サーバーとプラグインについて

user スコープの MCP サーバーは `~/.claude.json` に書かれるため、この方式では
同期できません。全 PC で同じ MCP サーバーを使いたい場合は次の 3 択です。

1. **各 PC で `claude mcp add --scope user` を実行する** — 一番手軽
2. **プロジェクトの `.mcp.json` に入れる** — そのリポジトリ内で共有される
3. **`claude/skills/<名前>/` を `@skills-dir` プラグインにして `.mcp.json` を同梱する**
   — このリポジトリ経由で 3 台に自動配布される（推奨）

詳細と手順は [`docs/per-machine-setup.md`](docs/per-machine-setup.md) を参照してください。

---

## 元に戻したいとき

リンクを外して、退避しておいた元の設定に戻します。

```bash
rm ~/.claude/settings.json ~/.claude/CLAUDE.md
rm ~/.claude/agents ~/.claude/commands ~/.claude/rules ~/.claude/skills
cp -R ~/.claude/backup-<日時>/* ~/.claude/
```

Windows では Junction の削除に `Remove-Item` を使います
（`Remove-Item -LiteralPath $HOME\.claude\skills -Force -Recurse` は
リンク先の実体ではなく Junction 自体を削除します）。

---

## 補足: 認証について

3 台とも同じアカウントでログインすれば、サブスクリプション・利用可能なモデル・
使用量の枠は共通です。同時に複数 PC で使うこと自体に制限はありませんが、
利用量は 1 つのアカウントとして合算されます。
