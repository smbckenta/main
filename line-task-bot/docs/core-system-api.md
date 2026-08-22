# 基幹システム連携の仕様

折衝記録を自社基幹システムへ登録するために、ボットが期待する REST API の契約です。

このボットは **基幹システム側に 2 つのエンドポイントがあること**を前提にしています。
形が違っても、下の「ズレを設定で吸収する」の環境変数で大半は合わせられます。

> **基幹システムがまだ無い間**は `RECORD_SINK=sheets`（既定）のままにしてください。
> 抽出・承認・台帳化はそのまま動き、記録は `records` シートに溜まります。
> API ができたら `RECORD_SINK=http` に切り替えるだけで、以降の承認分から送信が始まります。

---

## 1. 折衝記録の登録

```
POST {CORE_BASE_URL}{CORE_CREATE_PATH}
```

既定のパスは `/api/interactions`。

### リクエストヘッダ

| ヘッダ | 内容 |
|---|---|
| `Content-Type` | `application/json` |
| `Authorization` | `CORE_AUTH_VALUE` の値（ヘッダ名は `CORE_AUTH_HEADER` で変更可） |
| `X-Idempotency-Key` | ボット側の記録 ID |

**`X-Idempotency-Key` は必ず見てください。** 送信失敗時にボットは自動で再送します。
同じキーのリクエストを二度受けたら、新規作成せず既存レコードを返す実装にしてください。
これが無いと、タイムアウト後の再送で記録が二重に入ります。

### リクエストボディ

```json
{
  "kind": "customer",
  "counterpartyName": "株式会社アルファ",
  "counterpartyId": "C-00123",
  "contactPerson": "田中様",
  "ourStaff": "山内",
  "occurredAt": "2026-08-20T14:00:00+09:00",
  "channel": "visit",
  "subject": "複合機の入替提案",
  "summary": "現行機の更新時期について相談を受けた。予算は下期。",
  "detail": "現行は5年経過。カウンタ料金が高いという不満あり。他社見積も取得中とのこと。",
  "nextAction": "見積書を提出する",
  "nextActionDueAt": "2026-08-25T18:00:00+09:00",
  "stage": "提案中",
  "amount": "",
  "sourceSystem": "line-task-bot",
  "sourceRecordId": "a1b2c3d4",
  "sourceGroupId": "Cxxxxxxxx",
  "sourceMessageIds": ["1234567890", "1234567891"]
}
```

| フィールド | 型 | 内容 |
|---|---|---|
| `kind` | `"customer"` \| `"partner"` | 顧客折衝か、パートナー打合せか |
| `counterpartyName` | string | 相手先名。会話に出た表記のまま |
| `counterpartyId` | string \| null | マスタ照合で解決できた ID。できなければ `null` |
| `contactPerson` | string | 先方担当者。不明なら空文字 |
| `ourStaff` | string | 弊社担当者 |
| `occurredAt` | string \| null | 接触日時（ISO 8601、オフセット付き）。特定できなければ `null` |
| `channel` | enum | `visit` / `phone` / `online` / `email` / `chat` / `other` |
| `subject` | string | 件名（30 文字以内） |
| `summary` | string | 要約（3 行程度） |
| `detail` | string | 議題・先方の反応・決定事項 |
| `nextAction` | string | 次回アクション。無ければ空文字 |
| `nextActionDueAt` | string \| null | 次回アクションの期限 |
| `stage` | string | 商談段階。読み取れなければ空文字 |
| `amount` | string | 金額。出ていなければ空文字。**文字列**である点に注意（「約300万」のような表記が来る） |
| `sourceSystem` | string | 常に `"line-task-bot"` |
| `sourceRecordId` | string | ボット側の記録 ID。冪等性キーと同じ値 |
| `sourceGroupId` | string | 発生元の LINE グループ ID |
| `sourceMessageIds` | string[] | 根拠となった LINE メッセージ ID |

日時は **すべてオフセット付き ISO 8601** で送ります。`null` が入りうるフィールドは
上表のとおりです。空文字と `null` を区別しているので、必須制約はそれに合わせてください。

### レスポンス

```json
{ "id": "INT-2026-00842", "url": "https://core.example.com/interactions/842" }
```

- `id` … 基幹システム側の ID。`records` シートの `externalId` 列に入ります
- `url` … 人が開ける画面の URL。省略可（LINE の完了通知にリンクが出せなくなるだけ）

`2xx` 以外はエラー扱いです。
- **4xx** … こちらの送り方の問題とみなし、再送しません。`records` の `status` が `failed` になります
- **5xx / タイムアウト / ネットワークエラー** … 最大 2 回まで即時リトライし、
  それでも駄目なら次回の同期ジョブで再試行します（合計 3 回で打ち切り、LINE に通知）

エラー時はレスポンスボディに理由を入れてください。そのまま `records` の `error` 列と
LINE の通知に出るので、原因が分かる文言だと運用が楽になります。

---

## 2. 相手先マスタの照合（任意）

```
GET {CORE_BASE_URL}{CORE_SEARCH_PATH}?q={名称}&kind={customer|partner}
```

既定のパスは `/api/counterparties`。`CORE_SEARCH_PATH` を空にすると照合を行わず、
`counterpartyId` は常に `null` で送られます（相手先名は残るので、後から人が紐づけられます）。

### レスポンス

```json
{
  "items": [
    { "id": "C-00123", "name": "株式会社アルファ" },
    { "id": "C-00456", "name": "アルファ商事株式会社" }
  ]
}
```

部分一致で候補を返してください。ボット側の絞り込みは次のとおりです。

1. 「株式会社」「(株)」等と空白を除いた名称が**完全一致する候補が 1 件**なら、それを採用
2. 候補が**全体で 1 件**しかなければ、それを採用
3. それ以外（複数候補・0 件）は紐づけず、`counterpartyId` は `null` のまま登録

**照合に失敗しても登録は止めません。** マスタ照合が原因で記録を落とすほうが損失が大きいためです。
照合できなかった記録は `records` シートの `counterpartyId` が空になるので、そこで気づけます。

---

## ズレを設定で吸収する

先方の API が上の形と違っても、環境変数で寄せられます。

| 変数 | 既定 | 用途 |
|---|---|---|
| `CORE_BASE_URL` | （必須） | 基幹システムのベース URL |
| `CORE_CREATE_PATH` | `/api/interactions` | 登録エンドポイントのパス |
| `CORE_SEARCH_PATH` | `/api/counterparties` | 照合エンドポイント。空にすると照合しない |
| `CORE_SEARCH_QUERY_PARAM` | `q` | 検索語のクエリパラメータ名 |
| `CORE_SEARCH_ITEMS_PATH` | `items` | レスポンス中の候補配列の位置（ドット区切り） |
| `CORE_SEARCH_ID_PATH` | `id` | 候補要素の ID の位置 |
| `CORE_SEARCH_NAME_PATH` | `name` | 候補要素の名称の位置 |
| `CORE_ID_PATH` | `id` | 登録レスポンスの ID の位置 |
| `CORE_URL_PATH` | `url` | 登録レスポンスの URL の位置 |
| `CORE_AUTH_HEADER` | `Authorization` | 認証ヘッダ名 |
| `CORE_AUTH_VALUE` | （空） | 認証ヘッダの値。`Bearer xxx` など |
| `CORE_TIMEOUT_MS` | `15000` | リクエストのタイムアウト |
| `CORE_FIELD_MAP` | `{}` | こちらのフィールド名 → 先方のフィールド名 |

### 設定例

レスポンスが `{"data":{"record_id":123,"permalink":"..."}}` で、
フィールド名がスネークケースの場合:

```bash
CORE_ID_PATH=data.record_id
CORE_URL_PATH=data.permalink
CORE_FIELD_MAP='{"counterpartyName":"customer_name","counterpartyId":"customer_id","contactPerson":"contact_name","ourStaff":"staff_name","occurredAt":"contacted_at","nextAction":"next_action","nextActionDueAt":"next_action_due_at"}'
```

`CORE_FIELD_MAP` に無いフィールドは、こちらの名前のまま送られます。
全部書く必要はなく、名前が違うものだけ書けば十分です。

---

## 実装する側へのお願い（まとめ）

基幹システム側で最低限やってほしいことは 3 つです。

1. **`POST /api/interactions` を用意する** — 上のボディを受けて `{id}` を返す
2. **`X-Idempotency-Key` で重複を弾く** — これが無いと再送で二重登録になる
3. **エラー時は理由をボディに入れる** — そのまま LINE と台帳に出る

相手先マスタの照合（`GET /api/counterparties`）は後回しで構いません。
無くても記録は相手先名つきで登録されます。

---

## 動作確認

`RECORD_SINK=http` に切り替えたら、次の順で確認してください。

```bash
# 1. 記録を 1 件作る（LINE のグループで実際に報告を書き、「解析」と送る）
# 2. 承認カードの「登録する」を押す
# 3. 同期ジョブを手で叩く
curl -X POST -H "x-job-secret: ${JOB_SECRET}" "${SERVICE_URL}/jobs/sync-records"
```

`{"synced":1,"failed":0,"skipped":0}` が返り、`records` シートの `status` が
`synced`、`externalId` に基幹システムの ID が入っていれば成功です。

失敗する場合は `error` 列を見てください。試行回数が `[1]` のように先頭に付きます。
3 回失敗すると LINE に通知が飛び、そこで自動再送は止まります
（原因を直したあと、`status` を手で `approved` に戻せば再開します）。
