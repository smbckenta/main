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
