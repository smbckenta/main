#!/usr/bin/env bash
#
# Cloud Scheduler のジョブを作成する。
# 解析・リマインド・日次サマリーの 3 本。すべて Cloud Run の /jobs/* を叩く。
#
# 使い方:
#   PROJECT_ID=my-project SERVICE_URL=https://... JOB_SECRET=... ./deploy/scheduler.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-northeast1}"
SERVICE_URL="${SERVICE_URL:?SERVICE_URL を指定してください}"
JOB_SECRET="${JOB_SECRET:?JOB_SECRET を指定してください}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-line-task-bot@${PROJECT_ID}.iam.gserviceaccount.com}"

# 同名ジョブがあれば作り直す（create は冪等ではないため）
create_job() {
  local name="$1" schedule="$2" path="$3"
  gcloud scheduler jobs delete "${name}" \
    --project "${PROJECT_ID}" --location "${REGION}" --quiet 2>/dev/null || true

  gcloud scheduler jobs create http "${name}" \
    --project "${PROJECT_ID}" \
    --location "${REGION}" \
    --schedule "${schedule}" \
    --time-zone "Asia/Tokyo" \
    --uri "${SERVICE_URL}${path}" \
    --http-method POST \
    --headers "x-job-secret=${JOB_SECRET},Content-Type=application/json" \
    --message-body '{}' \
    --oidc-service-account-email "${SERVICE_ACCOUNT}" \
    --attempt-deadline 300s
  echo "==> ${name} を作成しました（${schedule}）"
}

# 会話解析: 平日の 8〜20 時、10 分おき
create_job "line-task-bot-analyze" "*/10 8-20 * * 1-5" "/jobs/analyze"

# 期限リマインド: 平日の 9 時・14 時・18 時
create_job "line-task-bot-reminders" "0 9,14,18 * * 1-5" "/jobs/reminders"

# 日次サマリー: 平日の朝 8:30
create_job "line-task-bot-digest" "30 8 * * 1-5" "/jobs/digest"

# 折衝記録の同期: 平日の 8〜20 時、15 分おき
# 承認済みの記録を基幹システムへ送る（RECORD_SINK=sheets の間は何もしない）
create_job "line-task-bot-sync-records" "*/15 8-20 * * 1-5" "/jobs/sync-records"
