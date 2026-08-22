#!/usr/bin/env bash
#
# Cloud Run へのデプロイ。
# 事前に gcloud auth login と gcloud config set project <PROJECT_ID> を済ませておくこと。
#
# 使い方:
#   PROJECT_ID=my-project ./deploy/deploy.sh
#
set -euo pipefail

PROJECT_ID="${PROJECT_ID:-$(gcloud config get-value project 2>/dev/null)}"
REGION="${REGION:-asia-northeast1}"
SERVICE="${SERVICE:-line-task-bot}"
SERVICE_ACCOUNT="${SERVICE_ACCOUNT:-line-task-bot@${PROJECT_ID}.iam.gserviceaccount.com}"

if [[ -z "${PROJECT_ID}" ]]; then
  echo "PROJECT_ID を指定してください" >&2
  exit 1
fi

echo "==> ${SERVICE} を ${REGION} にデプロイします（プロジェクト: ${PROJECT_ID}）"

# シークレットは Secret Manager から注入する。環境変数に直接書かない。
gcloud run deploy "${SERVICE}" \
  --project "${PROJECT_ID}" \
  --region "${REGION}" \
  --source . \
  --service-account "${SERVICE_ACCOUNT}" \
  --allow-unauthenticated \
  --memory 512Mi \
  --cpu 1 \
  --timeout 300 \
  --max-instances 3 \
  --set-env-vars "TIMEZONE=Asia/Tokyo,GOOGLE_CALENDAR_ID=${GOOGLE_CALENDAR_ID:-primary},AUTO_EXECUTE_MAX_RISK=${AUTO_EXECUTE_MAX_RISK:-low}" \
  --set-secrets "LINE_CHANNEL_SECRET=line-channel-secret:latest,LINE_CHANNEL_ACCESS_TOKEN=line-channel-access-token:latest,ANTHROPIC_API_KEY=anthropic-api-key:latest,SPREADSHEET_ID=spreadsheet-id:latest,JOB_SECRET=job-secret:latest"

URL="$(gcloud run services describe "${SERVICE}" --project "${PROJECT_ID}" --region "${REGION}" --format='value(status.url)')"

echo
echo "==> デプロイ完了: ${URL}"
echo "    LINE Developers の Webhook URL に次を設定してください:"
echo "    ${URL}/line/webhook"
echo
echo "    初回のみシートを初期化します:"
echo "    curl -X POST -H \"x-job-secret: \$JOB_SECRET\" ${URL}/admin/bootstrap"
