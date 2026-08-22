# 設計とデータモデル

## 処理の流れ

### 1. 受信（webhook）

`POST /line/webhook` は署名を検証したあと、イベント種別で分岐します。

| イベント | 処理 |
|---|---|
| テキストメッセージ（コマンド） | その場で応答して終わり。会話ログには積まない |
| テキストメッセージ（通常） | `messages` シートに `processed=FALSE` で追記するだけ |
| postback（ボタン操作） | 承認実行 / 取消 / 完了 / 実行案立案 |
| join（グループ招待） | 使い方を返す |

ここで LLM を呼ばないのが要点です。LINE の webhook は数秒で応答する必要があり、
Cloud Run はリクエストの外で CPU が絞られるため、重い処理を webhook の裏に逃がすと
中途半端に止まります。

### 2. 解析（ジョブ）

`POST /jobs/analyze` が Cloud Scheduler から呼ばれ、グループごとに次を行います。

```
未処理メッセージを読む
   ↓  件数 >= ANALYZE_MIN_MESSAGES、または最古が ANALYZE_MAX_AGE_MINUTES より古い
   ↓  （どちらも満たさなければ次回に見送る＝API を呼ばない）
既存の未完了タスク + 直前の会話（文脈）+ 対象メッセージ を Claude に渡す
   ↓  構造化出力（Zod スキーマ）で受け取る
newTasks / updates
   ↓  confidence、根拠メッセージ ID の重なり、タイトル類似度でフィルタ
tasks シートへ追記 / 更新
   ↓
対象メッセージを processed=TRUE にする
   ↓
新規タスクがあればグループへ通知
```

**冪等性**: 対象メッセージを `processed=TRUE` にするのは書き込みが済んだあとです。
途中で落ちた場合は次回同じメッセージを読み直しますが、`filterNewTasks` の
重複判定（根拠メッセージ ID の重なり）で二重登録は防がれます。

抽出に失敗した（`extractTasks` が `null` を返した）場合も `processed=TRUE` にします。
未処理のまま残すと毎回同じメッセージでリトライして、後続が詰まるためです。

### 3. 実行

実行案の立案（`ai/planner.ts`）と実行（`actions/executor.ts`）は分かれています。
LLM が出せるのは提案までで、副作用は必ず executor を通ります。

```
planActions(task) → ProposedAction[]（type / risk / summary / params）
   ↓
dispatchActions()
   ├─ risk <= AUTO_EXECUTE_MAX_RISK → actions シートに記録して即実行
   └─ それ以外 → actions シートに awaiting_approval で記録し、LINE に確認カードを送る
                     ↓ 人がボタンを押す
                  postback → executeApprovedAction() → 実行
```

既定の `AUTO_EXECUTE_MAX_RISK=low` では、`gmail.send`（planner が `high` を付ける）は
必ず人の承認を経由します。導入直後は `none` にして全件承認制で運用し、
挙動に納得してから緩めるのが安全です。

---

## データモデル

3 つのシートはすべて 1 行目がヘッダーです。人が直接編集しても構いませんが、
**列の順序は変えないでください**（コードが列インデックスで読んでいます）。

### tasks

| 列 | 内容 |
|---|---|
| `id` | 8 桁の識別子。LINE のコマンドで使う |
| `groupId` | 発生元の LINE グループ |
| `title` | 命令形の要約 |
| `detail` | 背景・条件・成果物 |
| `assignee` | 会話に出てきた担当者の呼称 |
| `assigneeUserId` | 解決できた場合の LINE userId |
| `dueAt` | ISO 8601（オフセット付き）。未設定なら空 |
| `status` | `open` / `in_progress` / `done` / `cancelled` |
| `priority` | `high` / `normal` / `low` |
| `sourceMessageIds` | 根拠となったメッセージ ID（カンマ区切り）。重複判定と監査に使う |
| `createdAt` / `updatedAt` | ISO 8601 |
| `lastRemindedAt` | 最後にリマインドした時刻。同じ通知を繰り返さないため |
| `notes` | 会話の要約や更新理由 |

`status` を手で `done` に書き換えても正しく動きます。台帳として直接触れるのが
スプレッドシートを選んだ理由です。

### messages

| 列 | 内容 |
|---|---|
| `timestamp` | 受信時刻（ISO 8601） |
| `groupId` / `messageId` / `userId` / `displayName` / `text` | 発言の内容 |
| `processed` | `TRUE` なら解析済み |

**このシートは無制限に伸びます。** 全行読み込みで処理しているため、
数千行を超えると解析ジョブが遅くなります。運用に合わせて古い行を定期削除するか、
`processed=TRUE` の行を別シートへ退避してください。

### actions

| 列 | 内容 |
|---|---|
| `id` / `taskId` / `groupId` | 識別子 |
| `type` | `calendar.createEvent` / `gmail.draft` / `gmail.send` / `line.notify` |
| `risk` | `low` / `medium` / `high` |
| `status` | `proposed` / `awaiting_approval` / `executed` / `failed` / `rejected` |
| `summary` | 承認画面に出した 1 行説明 |
| `params` | 実行パラメータ（JSON） |
| `result` | 実行結果、または失敗理由 |
| `createdAt` / `updatedAt` | ISO 8601 |

「いつ・誰の承認で・何が実行されたか」の記録がここに残ります。監査ログとして使えます。

---

## 差し替えを想定している箇所

| やりたいこと | 触る場所 |
|---|---|
| 保存先を Firestore などに変える | `src/store/` の 3 つの repo（呼び出し側は型で繋がっているので影響は閉じる） |
| 実行できる操作を増やす | `src/types.ts` の `ActionType` に追加 → `src/actions/` に実装 → `executor.ts` の `runAction` に分岐 → `planner.ts` のスキーマとプロンプトに追記 |
| 抽出の基準を変える | `src/ai/extractor.ts` の `SYSTEM_PROMPT`（「抽出するもの / しないもの」の節） |
| 一覧の見た目を変える | `src/line/messages.ts` |
| コマンドを増やす | `src/line/commands.ts` の `handleCommand` |

## テスト

`npm test` はネットワークに触れません。

- `test/logic.test.ts` — 日時変換、重複判定、並び替え、リスク判定、Flex Message の生成
- `test/server.test.ts` — 署名検証、ジョブ認証、イベント振り分け

Sheets / Anthropic / LINE の API を叩くパスは含めていません。
そこは実際にデプロイして `解析` コマンドで確認するのが確実です。
