/**
 * グループ LINE の会話から「やるべきこと」を抽出する。
 *
 * 設計上のポイント:
 * - 既存の未完了タスクも一緒に渡す。そうしないと同じ依頼を毎回新規タスクとして作ってしまう。
 * - 出力は構造化出力（Zod スキーマ）で受け取る。自由文をパースするより壊れにくい。
 * - 抽出根拠として sourceMessageIds を必ず出させる。誤検出の追跡と重複排除に効く。
 */

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { nowIsoInTimezone } from "../time.js";
import type { StoredChatMessage, StoredTask } from "../types.js";

const NewTaskSchema = z.object({
  title: z
    .string()
    .describe("30 文字以内の命令形の要約。例: 「見積書を A 社へ送付する」"),
  detail: z
    .string()
    .describe("背景・条件・成果物。会話に書かれていないことは書かない。"),
  assignee: z
    .string()
    .describe("会話に出てくる担当者の呼称。特定できなければ空文字。"),
  dueAt: z
    .string()
    .nullable()
    .describe(
      "期限。ISO 8601 のオフセット付き（例 2026-08-25T18:00:00+09:00）。会話から特定できなければ null。",
    ),
  priority: z.enum(["high", "normal", "low"]),
  sourceMessageIds: z
    .array(z.string())
    .describe("このタスクの根拠となったメッセージ ID。必ず 1 件以上。"),
  confidence: z
    .number()
    .describe("タスクとして確かだと考える度合い。0.0〜1.0。"),
});

const TaskUpdateSchema = z.object({
  taskId: z.string().describe("既存タスクの id。"),
  status: z
    .enum(["open", "in_progress", "done", "cancelled"])
    .nullable()
    .describe("状態が変わった場合のみ。変化がなければ null。"),
  dueAt: z
    .string()
    .nullable()
    .describe("期限が変わった場合のみ ISO 8601。変化がなければ null。"),
  assignee: z
    .string()
    .nullable()
    .describe("担当が変わった場合のみ。変化がなければ null。"),
  note: z.string().describe("更新理由を 1 行で。"),
});

const ExtractionSchema = z.object({
  conversationSummary: z
    .string()
    .describe("この区間の会話の要点を 1〜2 文で。"),
  newTasks: z.array(NewTaskSchema),
  updates: z.array(TaskUpdateSchema),
});

export type Extraction = z.infer<typeof ExtractionSchema>;
export type ExtractedTask = z.infer<typeof NewTaskSchema>;
export type ExtractedUpdate = z.infer<typeof TaskUpdateSchema>;

const SYSTEM_PROMPT = `あなたは日本の企業のグループ LINE を読み、実務のタスクを管理するアシスタントです。

## 役割
与えられた会話ログから「誰かが実際にやらなければならないこと」を抽出し、
すでに管理中のタスクについては状態の変化を検出します。

## タスクとして抽出するもの
- 明示的な依頼・指示（「〜お願いします」「〜やっておいて」）
- 合意された次のアクション（「では私が見積もりを出します」）
- 期限や約束を伴う発言（「金曜までに提出します」）
- 未解決のまま放置されている質問で、誰かの対応が必要なもの

## 抽出しないもの
- 単なる感想・雑談・相槌・スタンプ的な発言
- すでに完了したことの報告（これは既存タスクの status 更新として扱う）
- 仮定の話や検討中で、まだ誰も引き受けていないもの
- 既存タスクと実質的に同じ内容（重複させず、必要なら updates で更新する）

## 判断の原則
- 会話に書かれていないことを推測で補わない。担当者が不明なら assignee は空文字にする。
- 「来週」「明日」などの相対表現は、現在時刻を基準に絶対時刻へ変換する。
  時刻の指定がなければその日の 18:00 とする。日付すら特定できなければ dueAt は null。
- 確信が持てないものは confidence を低くする。無理にタスク化しない。
- 1 つの依頼は 1 つのタスクにまとめる。細かく分割しすぎない。`;

export interface ExtractionInput {
  groupId: string;
  /** 解析対象の未処理メッセージ。 */
  targetMessages: StoredChatMessage[];
  /** 文脈として渡す直前のメッセージ（処理済みを含む）。 */
  contextMessages: StoredChatMessage[];
  /** 重複判定と状態更新のための既存タスク。 */
  openTasks: StoredTask[];
}

function renderMessages(messages: StoredChatMessage[]): string {
  return messages
    .map(
      (message) =>
        `[${message.messageId}] ${message.timestamp} ${message.displayName || message.userId}: ${message.text}`,
    )
    .join("\n");
}

function renderTasks(tasks: StoredTask[]): string {
  if (tasks.length === 0) return "（管理中のタスクはありません）";
  return tasks
    .map(
      (task) =>
        `- id=${task.id} status=${task.status} due=${task.dueAt || "未設定"} 担当=${task.assignee || "未定"} : ${task.title}`,
    )
    .join("\n");
}

export async function extractTasks(
  input: ExtractionInput,
): Promise<Extraction | null> {
  const contextBlock =
    input.contextMessages.length > 0
      ? `## これまでの会話（文脈。ここからは新規タスクを作らない）\n${renderMessages(input.contextMessages)}\n\n`
      : "";

  const userContent = `現在時刻: ${nowIsoInTimezone()}

## 管理中のタスク
${renderTasks(input.openTasks)}

${contextBlock}## 今回の解析対象の会話
${renderMessages(input.targetMessages)}

上記の「今回の解析対象の会話」から、新規タスクと既存タスクの更新を抽出してください。`;

  const response = await anthropic.messages.parse({
    model: config.anthropic.model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    output_config: {
      format: zodOutputFormat(ExtractionSchema),
      effort: config.anthropic.extractEffort as "low" | "medium" | "high",
    },
  });

  if (response.stop_reason === "refusal") {
    logger.warn("タスク抽出が拒否されました", {
      groupId: input.groupId,
      category: response.stop_details?.category ?? null,
    });
    return null;
  }

  if (!response.parsed_output) {
    logger.warn("タスク抽出の構造化出力が得られませんでした", {
      groupId: input.groupId,
      stopReason: response.stop_reason,
    });
    return null;
  }

  logger.info("タスク抽出が完了しました", {
    groupId: input.groupId,
    newTasks: response.parsed_output.newTasks.length,
    updates: response.parsed_output.updates.length,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return response.parsed_output;
}
