/** アプリ全体で共有するドメイン型。シートの列構成とここが 1:1 で対応する。 */

import type { RiskLevel } from "./config.js";

export type TaskStatus = "open" | "in_progress" | "done" | "cancelled";
export type TaskPriority = "high" | "normal" | "low";

export interface Task {
  id: string;
  groupId: string;
  title: string;
  detail: string;
  /** 会話中に現れた担当者の呼称（「田中さん」など）。 */
  assignee: string;
  /** 解決できた場合の LINE userId。リマインドのメンションに使う。 */
  assigneeUserId: string;
  /** ISO 8601（オフセット付き）。期限なしなら空文字。 */
  dueAt: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** 根拠となった LINE メッセージ ID。重複抽出の判定と監査に使う。 */
  sourceMessageIds: string[];
  createdAt: string;
  updatedAt: string;
  /** 最後にリマインドを送った時刻。同じ通知を繰り返さないため。 */
  lastRemindedAt: string;
  notes: string;
}

/** シート上の行番号を保持したタスク。更新時に必要。 */
export interface StoredTask extends Task {
  rowNumber: number;
}

export interface ChatMessage {
  /** LINE の webhook event message id。冪等性キー。 */
  messageId: string;
  groupId: string;
  userId: string;
  displayName: string;
  text: string;
  /** 受信時刻（ISO 8601）。 */
  timestamp: string;
  /** 解析ジョブが読み終えたか。 */
  processed: boolean;
}

export interface StoredChatMessage extends ChatMessage {
  rowNumber: number;
}

export type ActionType =
  | "calendar.createEvent"
  | "gmail.draft"
  | "gmail.send"
  | "line.notify";

export type ActionStatus =
  | "proposed"
  | "awaiting_approval"
  | "executed"
  | "failed"
  | "rejected";

/** LLM が提案する（あるいはコマンドで組み立てられる）実行可能な操作。 */
export interface ActionParams {
  title: string | null;
  startAt: string | null;
  endAt: string | null;
  location: string | null;
  attendees: string[] | null;
  to: string[] | null;
  subject: string | null;
  body: string | null;
  text: string | null;
}

export interface ProposedAction {
  type: ActionType;
  risk: RiskLevel;
  /** 承認画面に出す 1 行説明。 */
  summary: string;
  params: ActionParams;
}

export interface StoredAction extends ProposedAction {
  id: string;
  taskId: string;
  groupId: string;
  status: ActionStatus;
  result: string;
  createdAt: string;
  updatedAt: string;
  rowNumber: number;
}

/* ------------------------------------------------------------------ *
 * 折衝記録 / 打ち合わせ記録
 * ------------------------------------------------------------------ */

/** 顧客との折衝か、パートナー（代理店等）との打ち合わせか。 */
export type InteractionKind = "customer" | "partner";

export type InteractionChannel =
  | "visit"
  | "phone"
  | "online"
  | "email"
  | "chat"
  | "other";

/**
 * draft     : 抽出しただけ。まだ誰も見ていない
 * approved  : LINE で承認された。基幹システムへ送る直前
 * synced    : 基幹システムへの登録が完了
 * rejected  : 人が「違う」と判断した
 * failed    : 送信を試みたが失敗（error 列に理由）
 */
export type InteractionStatus =
  | "draft"
  | "approved"
  | "synced"
  | "rejected"
  | "failed";

export interface InteractionRecord {
  id: string;
  groupId: string;
  kind: InteractionKind;
  /** 会話に現れた相手先の名称。 */
  counterpartyName: string;
  /** マスタ照合で解決できた場合の基幹システム側の ID。 */
  counterpartyId: string;
  /** 先方の担当者名。 */
  contactPerson: string;
  /** 弊社側の担当者。発言者から推定する。 */
  ourStaff: string;
  /** 折衝が行われた日時（ISO 8601）。会話した日時ではない点に注意。 */
  occurredAt: string;
  channel: InteractionChannel;
  /** 一覧に出す短い件名。 */
  subject: string;
  /** 3 行程度の要約。 */
  summary: string;
  /** 議題・先方の反応・決定事項。 */
  detail: string;
  /** 次にやること。タスク側と重複してよい（記録としての意味が別）。 */
  nextAction: string;
  nextActionDueAt: string;
  /** 商談の段階。会話から読み取れなければ空。 */
  stage: string;
  /** 金額が出た場合の記録。空欄を扱いやすくするため文字列で持つ。 */
  amount: string;
  sourceMessageIds: string[];
  confidence: number;
  status: InteractionStatus;
  /** 基幹システム側で採番された ID。 */
  externalId: string;
  externalUrl: string;
  syncedAt: string;
  /** 失敗理由。status=failed のときだけ入る。 */
  error: string;
  createdAt: string;
  updatedAt: string;
}

export interface StoredInteractionRecord extends InteractionRecord {
  rowNumber: number;
}

/** マスタ照合の結果。 */
export interface Counterparty {
  id: string;
  name: string;
  /** 複数候補があって絞り切れなかった場合に true。人の確認に回す。 */
  ambiguous: boolean;
}

export const EMPTY_ACTION_PARAMS: ActionParams = {
  title: null,
  startAt: null,
  endAt: null,
  location: null,
  attendees: null,
  to: null,
  subject: null,
  body: null,
  text: null,
};
