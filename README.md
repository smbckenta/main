# Claude Code の設定を3台の PC で共有する

3 台の Windows PC で同じアカウントの Claude Code を使うとき、

1. **設定・スキル・エージェント・共通指示**を Git で共有する
2. **作業フォルダ**を Google ドライブ上の `▲0Claude` に統一する

の 2 つを行うためのリポジトリです。1 は「設定が同じ」、2 は「ファイルが同じ」を担当します。

```
このリポジトリ                     各 PC の ~/.claude/
├── claude/settings.json    <────  settings.json   (シンボリックリンク)
├── claude/CLAUDE.md        <────  CLAUDE.md
├── claude/agents/          <────  agents/         (Junction)
├── claude/commands/        <────  commands/
├── claude/rules/           <────  rules/
└── claude/skills/          <────  skills/

作業フォルダ（Google ドライブ側で3台に同期される）
G:\共有ドライブ\★Kevin\▲0Claude\
├── ev-partner-payment-notice\
└── elevator-pt-system\
```

---

## セットアップ（Windows）

> **事前に「開発者モード」を有効にしてください。**
> `設定 > プライバシーとセキュリティ > 開発者向け > 開発者モード`
> ファイルのシンボリックリンク作成に必要です。無効のままだとコピーにフォールバックし、
> その分は自動同期されません（スクリプトが警告を出します）。

> **このリポジトリは C: ドライブ（ローカル）に clone してください。**
> `▲0Claude` の中に置くと、Google ドライブの仮想ドライブ上に Junction を張ることになり
> 動作が不安定になります。**設定リポジトリはローカル、作業ファイルはドライブ**が原則です。

### 1台目（設定の持ち主になる PC）

```powershell
git clone https://github.com/smbckenta/main.git $HOME\claude-config
cd $HOME\claude-config
.\scripts\install.ps1
.\scripts\setup-workspace.ps1
```

`install.ps1` は、その PC の `~/.claude\` に既にある設定を**リポジトリ側へ取り込んでから**
リンクを張ります（既存ファイルを上書きしません）。取り込まれた内容を確認してコミットします。

```powershell
git status          # 何が取り込まれたか確認
git add -A
git commit -m "Import Claude Code config from first machine"
git push -u origin claude/multi-pc-sync-qdxhfh
```

元の設定は `~/.claude\backup-<日時>\` に退避されているので、問題があれば戻せます。

> **`settings.json` / `CLAUDE.md` について**
> この 2 つはリポジトリに雛形が入っているため、その PC の既存の内容は
> 上書きされずにバックアップへ退避されます（スクリプトが該当ファイル名を表示します）。
> 元の設定を引き継ぎたい場合は、バックアップと見比べて手動でマージしてください。

### 2台目・3台目

```powershell
git clone https://github.com/smbckenta/main.git $HOME\claude-config
cd $HOME\claude-config
.\scripts\install.ps1 -NoAdopt
.\scripts\setup-workspace.ps1
```

2 台目以降は 1 台目の設定に揃えたいので `-NoAdopt` を付けます
（その PC のローカル設定はバックアップへ退避され、リポジトリには取り込まれません）。

### 実行前に内容を確認したい場合

```powershell
.\scripts\install.ps1 -DryRun
.\scripts\setup-workspace.ps1 -DryRun
```

### macOS / Linux / WSL

同等の bash 版があります。

```bash
./scripts/install.sh            # 1台目
./scripts/install.sh --no-adopt # 2台目以降
```

---

## 作業フォルダ（▲0Claude）

`setup-workspace.ps1` は Google Drive for Desktop 上の `▲0Claude` を自動検出し、
次を設定します。

| 設定内容 | 効果 |
| --- | --- |
| 環境変数 `CLAUDE_WORKSPACE` | `▲0Claude` の絶対パス。Claude はこれを見て保存先を判断します |
| PowerShell 関数 `ws` | `▲0Claude` へ移動 |
| PowerShell 関数 `cws` | `▲0Claude` へ移動して `claude` を起動 |

日常はこれだけです。

```powershell
cws
```

自動検出に失敗する場合はエクスプローラーで実際のパスを確認し、明示してください。

```powershell
.\scripts\setup-workspace.ps1 -Path 'G:\共有ドライブ\★Kevin\▲0Claude'
```

### 保存先のルール

`claude/CLAUDE.md` に書いてあり、3 台すべてに適用されます。

1. 保存先の指定がないファイルは `▲0Claude` 配下に保存する
2. 既存プロジェクトの成果物は、これまでどおりそのプロジェクトのフォルダに保存する
   （例: 支払通知書 PDF は `▲0Claude\ev-partner-payment-notice\` のまま。移動しない）
3. 新しい案件は `▲0Claude` 直下に案件フォルダを作って作業する
4. 一時ファイル・中間生成物は `▲0Claude` に置かず一時ディレクトリを使う

### Google ドライブ上で作業するときの注意

- **同じフォルダを 2 台で同時に編集しない**（同期の競合でファイルが二重化します）
- **git リポジトリをドライブ上に置くのは避ける**。同期の競合で `.git` が壊れることがあります。
  どうしても置く場合は、そのリポジトリを触る PC を 1 台に固定してください
- `▲0Claude` は Drive の設定で「オフラインで利用可能」にしておくと動作が安定します
- パスに `★` `▲` が含まれるため、コマンドで指定するときは必ず引用符で囲んでください

---

## 日々の使い方

### 他の PC の設定変更を取り込む（作業開始時）

```powershell
cd $HOME\claude-config; .\scripts\sync.ps1
```

`git pull --rebase` してからリンクを張り直します（新しく増えたスキルにも対応）。

### 自分の設定変更を共有する

スキルやエージェントを追加・編集すると、リンク経由でこのリポジトリの中身が直接
書き換わります。そのままコミットしてください。

```powershell
cd $HOME\claude-config
git add -A
git commit -m "Add xxx skill"
git push -u origin claude/multi-pc-sync-qdxhfh
```

> `~/.claude\skills\` に新しいスキルを作れば、それはこのリポジトリの
> `claude/skills/` にそのまま入ります。別途コピーする必要はありません。

なお `▲0Claude` 内の**作業ファイル**は Google ドライブが自動で同期するので、
git 操作は不要です。git が必要なのは `~/claude-config`（設定）だけです。

---

## 同期されるもの / されないもの

### Git で同期される（設定）

| パス | 中身 |
| --- | --- |
| `~/.claude\settings.json` | 権限ルール、環境変数、フック、プラグインの有効化設定 |
| `~/.claude\CLAUDE.md` | 全プロジェクト共通の指示（保存先ルールもここ） |
| `~/.claude\rules\` | 分割した共通ルール |
| `~/.claude\agents\` | サブエージェント定義 |
| `~/.claude\skills\` | 個人スキル（`@skills-dir` プラグインも含む） |
| `~/.claude\commands\` | カスタムスラッシュコマンド |

### Google ドライブで同期される（作業ファイル）

`▲0Claude` 配下すべて。git 管理外です。

### どちらでも同期されない（意図的に除外）

| パス | 理由 |
| --- | --- |
| `~/.claude\.credentials.json` | **認証トークン。** 共有すると重大なセキュリティリスク |
| `~/.claude.json` | OAuth セッション・会話履歴・許可履歴・user スコープの MCP 設定が同居 |
| `~/.claude\projects\`, `todos\`, `shell-snapshots\` | セッションの実行時データ |
| `~/.claude\plugins\` | プラグインのキャッシュ（マシン固有。宣言のみ同期する） |
| `.claude\settings.local.json` | 「この PC だけ」の上書き設定を置く場所 |

**認証情報とマシン固有の状態は仕組み上どうしても各 PC で用意する必要があります。**
手順は [`docs/per-machine-setup.md`](docs/per-machine-setup.md) にまとめました。

---

## MCP サーバーとプラグインについて

user スコープの MCP サーバーは `~/.claude.json` に書かれるため、この方式では同期
できません。全 PC で同じ MCP サーバーを使いたい場合は次の 3 択です。

1. **各 PC で `claude mcp add --scope user` を実行する** — 一番手軽
2. **プロジェクトの `.mcp.json` に入れる** — そのリポジトリ内で共有される
3. **`claude/skills/<名前>/` を `@skills-dir` プラグインにして `.mcp.json` を同梱する**
   — このリポジトリ経由で 3 台に自動配布される（推奨）

詳細は [`docs/per-machine-setup.md`](docs/per-machine-setup.md) を参照してください。

---

## 業務スクリプト

| スクリプト | 用途 | 手順書 |
|---|---|---|
| `scripts/make_ev_bank_report.py` | 「【EVPT】エレベーター特約店管理表」の `【成約済】EV案件 管理表` シートを、銀行提出用の A3 印刷 Excel に変換する | [`docs/ev-bank-report.md`](docs/ev-bank-report.md) |

Claude Code からは `claude/skills/ev-bank-report/` のスキルが呼ばれるので、
「銀行提出用の Excel を作って」と頼むだけでも実行できます。

---

## 元に戻したいとき

```powershell
# リンクを外す（Junction 自体を消すだけで、リンク先の実体は消えません）
Remove-Item -LiteralPath $HOME\.claude\agents, $HOME\.claude\commands, `
            $HOME\.claude\rules, $HOME\.claude\skills -Force -Recurse
Remove-Item -LiteralPath $HOME\.claude\settings.json, $HOME\.claude\CLAUDE.md -Force

# 退避してあった元の設定を戻す
Copy-Item "$HOME\.claude\backup-<日時>\*" $HOME\.claude\ -Recurse -Force
```

`ws` / `cws` を消したい場合は、PowerShell プロファイル
（`$PROFILE.CurrentUserAllHosts`）内の `claude-config workspace` ブロックを削除してください。

---

## 補足

- 3 台とも同じアカウントでログインすれば、サブスクリプション・利用可能なモデル・
  使用量の枠は共通です。同時利用に制限はありませんが、使用量は合算されます。
- PowerShell スクリプトは UTF-8 BOM 付きで保存しています。Windows PowerShell 5.1 は
  BOM の無いファイルを ANSI として読むため、日本語が文字化けするのを防ぐためです。
  編集時は BOM を落とさないでください。
