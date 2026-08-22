# セットアップ手順

所要時間はおよそ 1 時間です。上から順に進めてください。

---

## 1. LINE 公式アカウントを作る

1. [LINE Developers](https://developers.line.biz/console/) にログインし、プロバイダーを作成する
2. **Messaging API** チャネルを新規作成する
3. **チャネル基本設定** タブから **チャネルシークレット** を控える（`LINE_CHANNEL_SECRET`）
4. **Messaging API 設定** タブで **チャネルアクセストークン（長期）** を発行して控える（`LINE_CHANNEL_ACCESS_TOKEN`）
5. 同じタブで以下を設定する
   - **Webhook の利用**: オン
   - **応答メッセージ**: オフ（自動応答が邪魔になるため）
   - **あいさつメッセージ**: 任意
6. [LINE Official Account Manager](https://manager.line.biz/) の
   **設定 > アカウント設定 > 機能の利用** で
   **グループ・複数人トークへの参加を許可する** をオンにする

> **重要**: この最後の設定をオンにしないと、ボットをグループに招待できません。
> また、Messaging API のボットはグループ内の**すべての**メッセージを webhook で受け取ります
> （メンションされたときだけではありません）。導入前にメンバーへ周知してください。

---

## 2. Google スプレッドシートとサービスアカウントを用意する

### スプレッドシートを作る

1. 新しいスプレッドシートを作成する（名前は任意、例「LINEタスク台帳」）
2. URL の `/d/` と `/edit` の間が `SPREADSHEET_ID` です
   ```
   https://docs.google.com/spreadsheets/d/【ここが SPREADSHEET_ID】/edit
   ```
3. シート（タブ）は作らなくて構いません。あとで `/admin/bootstrap` が
   `tasks` / `messages` / `actions` を自動生成します。

### サービスアカウントを作る

```bash
export PROJECT_ID=your-project-id
gcloud config set project "$PROJECT_ID"

# 必要な API を有効化
gcloud services enable \
  run.googleapis.com \
  cloudbuild.googleapis.com \
  cloudscheduler.googleapis.com \
  secretmanager.googleapis.com \
  sheets.googleapis.com \
  calendar-json.googleapis.com \
  gmail.googleapis.com

# サービスアカウント
gcloud iam service-accounts create line-task-bot \
  --display-name "LINE タスク管理ボット"
```

作成したサービスアカウントのメールアドレス
（`line-task-bot@<PROJECT_ID>.iam.gserviceaccount.com`）を
**スプレッドシートの共有設定に「編集者」として追加**します。これを忘れると全ての読み書きが失敗します。

カレンダーを使う場合は、対象カレンダーの **設定と共有 > 特定のユーザーとの共有** にも
同じアドレスを「予定の変更権限」で追加してください。

---

## 3. Gmail を使う場合（任意）

サービスアカウントは自分のメールボックスを持たないため、Gmail は
**ドメイン全体の委任（Domain-Wide Delegation）** で実在ユーザーの権限を借りる必要があります。
Google Workspace の管理者権限が必要です。

1. サービスアカウントの詳細画面で **クライアント ID** を控える
2. サービスアカウントの鍵（JSON）を作成する
   ```bash
   gcloud iam service-accounts keys create sa-key.json \
     --iam-account "line-task-bot@${PROJECT_ID}.iam.gserviceaccount.com"
   ```
3. [Google 管理コンソール](https://admin.google.com/) の
   **セキュリティ > アクセスとデータ管理 > API の制御 > ドメイン全体の委任** で
   クライアント ID と次のスコープを登録する
   ```
   https://www.googleapis.com/auth/gmail.compose,https://www.googleapis.com/auth/gmail.send,https://www.googleapis.com/auth/calendar,https://www.googleapis.com/auth/spreadsheets
   ```
4. `GOOGLE_IMPERSONATE_SUBJECT` に、なりすます対象のユーザーのメールアドレスを設定する
5. 鍵ファイルを Secret Manager に入れ、Cloud Run にマウントして
   `GOOGLE_APPLICATION_CREDENTIALS` でそのパスを指す

> **注意**: 委任の `subject` 指定はサービスアカウント鍵（JWT）経由でのみ機能します。
> Cloud Run のメタデータサーバー由来の資格情報では効かないため、Gmail を使う場合は
> 鍵ファイルの配置が必須です。
>
> Gmail を使わないなら、この節はまるごと飛ばして構いません。
> `GOOGLE_IMPERSONATE_SUBJECT` を空のままにしておけば、Gmail アクションは
> 実行時に「未設定のため操作できません」と返るだけで、他の機能には影響しません。

---

## 4. シークレットを登録する

```bash
create_secret() {
  printf '%s' "$2" | gcloud secrets create "$1" --data-file=- 2>/dev/null \
    || printf '%s' "$2" | gcloud secrets versions add "$1" --data-file=-
}

create_secret line-channel-secret        "＜チャネルシークレット＞"
create_secret line-channel-access-token  "＜チャネルアクセストークン＞"
create_secret anthropic-api-key          "＜Anthropic の API キー＞"
create_secret spreadsheet-id             "＜スプレッドシート ID＞"
create_secret job-secret                 "$(openssl rand -hex 24)"

# サービスアカウントに読み取り権限を付ける
for s in line-channel-secret line-channel-access-token anthropic-api-key spreadsheet-id job-secret; do
  gcloud secrets add-iam-policy-binding "$s" \
    --member "serviceAccount:line-task-bot@${PROJECT_ID}.iam.gserviceaccount.com" \
    --role roles/secretmanager.secretAccessor
done
```

---

## 5. デプロイする

```bash
cd line-task-bot
PROJECT_ID="$PROJECT_ID" ./deploy/deploy.sh
```

完了すると Cloud Run の URL が表示されます。

### LINE 側に webhook を登録する

LINE Developers コンソールの **Messaging API 設定 > Webhook URL** に
`https://＜Cloud Run の URL＞/line/webhook` を設定し、**検証** を押して成功することを確認します。

### シートを初期化する

```bash
export JOB_SECRET=$(gcloud secrets versions access latest --secret=job-secret)
export SERVICE_URL=$(gcloud run services describe line-task-bot \
  --region asia-northeast1 --format='value(status.url)')

curl -X POST -H "x-job-secret: ${JOB_SECRET}" "${SERVICE_URL}/admin/bootstrap"
```

`{"ok":true}` が返り、スプレッドシートに `tasks` / `messages` / `actions` の
3 シートがヘッダーつきで作られます。

---

## 6. 定期ジョブを作る

```bash
PROJECT_ID="$PROJECT_ID" SERVICE_URL="$SERVICE_URL" JOB_SECRET="$JOB_SECRET" \
  ./deploy/scheduler.sh
```

既定のスケジュール（すべて Asia/Tokyo）:

| ジョブ | スケジュール | 内容 |
|---|---|---|
| `line-task-bot-analyze` | 平日 8〜20 時、10 分おき | 会話解析 |
| `line-task-bot-reminders` | 平日 9 時 / 14 時 / 18 時 | 期限リマインド |
| `line-task-bot-digest` | 平日 8:30 | 日次サマリー |

---

## 7. 動作確認

1. LINE アプリで対象のグループにボットを招待する
2. グループで `ヘルプ` と送る → 使い方が返れば webhook は生きています
3. 「明日までに A 社へ見積書を送っておいて」のような発言をする
4. グループで `解析` と送る → タスクが登録され、一覧に現れます
5. `タスク` と送って一覧を確認する

### うまくいかないときの確認順

| 症状 | 確認すること |
|---|---|
| webhook 検証が失敗する | Cloud Run が公開されているか（`--allow-unauthenticated`）、URL に `/line/webhook` が付いているか |
| 何を送っても無反応 | LINE Official Account Manager でグループ参加が許可されているか、応答メッセージがオフか |
| 「解析」でエラーになる | スプレッドシートがサービスアカウントに共有されているか、`/admin/bootstrap` を実行したか |
| タスクが登録されない | Cloud Logging で `タスク抽出が完了しました` の `newTasks` を確認。0 なら会話がタスクとして認識されていない |
| カレンダー登録が失敗する | 対象カレンダーがサービスアカウントに「予定の変更権限」で共有されているか |
| Gmail が失敗する | `GOOGLE_IMPERSONATE_SUBJECT` と DWD の設定、鍵ファイルの配置 |

ログは Cloud Logging で見られます。

```bash
gcloud run services logs read line-task-bot --region asia-northeast1 --limit 50
```

---

## 運用の調整ポイント

| 環境変数 | 効果 |
|---|---|
| `AUTO_EXECUTE_MAX_RISK` | `none` にすると全ての操作が承認制。慣れるまでは `none` を推奨 |
| `ANALYZE_MIN_MESSAGES` | 上げると API 呼び出しが減る（発言が溜まるまで待つ） |
| `NOTIFY_ON_NEW_TASKS` | `false` にすると新規タスクの通知が止まる（うるさい場合） |
| `ALLOWED_GROUP_IDS` | 特定グループだけに限定する。試験導入時に有効 |
| `REMINDER_LEAD_HOURS` | 何時間前からリマインドを始めるか |

`ALLOWED_GROUP_IDS` に入れる groupId は、ボットを招待したあとの Cloud Logging か、
`messages` シートの `groupId` 列で確認できます。
