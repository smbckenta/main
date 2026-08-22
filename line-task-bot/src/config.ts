/**
 * 環境変数の読み込みと検証。
 * 起動時に一度だけ評価し、必須項目が欠けていれば即座に落とす（Cloud Run のヘルスチェックで気づけるように）。
 */

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`環境変数 ${name} が設定されていません`);
  }
  return value;
}

function optional(name: string, fallback: string): string {
  return process.env[name] ?? fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (Number.isNaN(parsed)) {
    throw new Error(`環境変数 ${name} は数値である必要があります: ${raw}`);
  }
  return parsed;
}

function optionalBoolean(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return raw === "true" || raw === "1";
}

function optionalList(name: string): string[] {
  const raw = process.env[name];
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/** アクションを自動実行してよいリスク上限。これを超えるものは LINE 上での承認を要求する。 */
export type RiskLevel = "low" | "medium" | "high";

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
};

export const config = {
  port: optionalNumber("PORT", 8080),

  line: {
    channelSecret: required("LINE_CHANNEL_SECRET"),
    channelAccessToken: required("LINE_CHANNEL_ACCESS_TOKEN"),
  },

  anthropic: {
    /** SDK は ANTHROPIC_API_KEY を自動で読む。ここでは存在確認だけ行う。 */
    apiKey: required("ANTHROPIC_API_KEY"),
    model: optional("ANTHROPIC_MODEL", "claude-opus-5"),
    /** 抽出・計画それぞれの effort。ルーチンな抽出は medium で十分。 */
    extractEffort: optional("ANTHROPIC_EXTRACT_EFFORT", "medium"),
    planEffort: optional("ANTHROPIC_PLAN_EFFORT", "high"),
  },

  sheets: {
    spreadsheetId: required("SPREADSHEET_ID"),
    tasksSheet: optional("TASKS_SHEET_NAME", "tasks"),
    messagesSheet: optional("MESSAGES_SHEET_NAME", "messages"),
    actionsSheet: optional("ACTIONS_SHEET_NAME", "actions"),
  },

  google: {
    /**
     * ドメイン全体の委任（DWD）を使う場合に、代理でアクセスするユーザーのメールアドレス。
     * Gmail 送信・個人カレンダーへの書き込みに必要。空なら通常のサービスアカウント権限で動く。
     */
    impersonateSubject: optional("GOOGLE_IMPERSONATE_SUBJECT", ""),
    calendarId: optional("GOOGLE_CALENDAR_ID", "primary"),
  },

  behavior: {
    timezone: optional("TIMEZONE", "Asia/Tokyo"),
    /** 解析ジョブが 1 回で読むメッセージの上限。 */
    analyzeBatchSize: optionalNumber("ANALYZE_BATCH_SIZE", 120),
    /** この件数以上未処理メッセージが溜まったら解析する。 */
    analyzeMinMessages: optionalNumber("ANALYZE_MIN_MESSAGES", 3),
    /** 未処理メッセージがこの分数より古ければ、件数が足りなくても解析する。 */
    analyzeMaxAgeMinutes: optionalNumber("ANALYZE_MAX_AGE_MINUTES", 30),
    /** 抽出時に文脈として渡す直近メッセージ数（処理済みも含む）。 */
    contextMessages: optionalNumber("CONTEXT_MESSAGES", 40),
    /** 期限の何時間前にリマインドするか。 */
    reminderLeadHours: optionalNumber("REMINDER_LEAD_HOURS", 24),
    /** 自動実行を許可するリスク上限。"none" ならすべて承認制。 */
    autoExecuteMaxRisk: optional("AUTO_EXECUTE_MAX_RISK", "low") as
      | RiskLevel
      | "none",
    /** 解析・通知の対象にするグループ ID。空なら全グループ。 */
    allowedGroupIds: optionalList("ALLOWED_GROUP_IDS"),
    /** 新規タスクを検出したときにグループへ通知するか。 */
    notifyOnNewTasks: optionalBoolean("NOTIFY_ON_NEW_TASKS", true),
  },

  jobs: {
    /**
     * Cloud Scheduler から /jobs/* を叩くときの共有シークレット。
     * OIDC 認証を併用する場合でも、多層防御として設定を推奨。
     */
    secret: optional("JOB_SECRET", ""),
  },
} as const;

export type AppConfig = typeof config;
