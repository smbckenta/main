/**
 * タスクから「実行できる操作」を組み立てる。
 *
 * ここでは実行しない。提案するだけ。実行の可否は risk とアプリ設定で決まり、
 * 高リスクなものは LINE 上の承認ボタンを経由する（actions/executor.ts）。
 * LLM に実行権限を直結させないための分離。
 */

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { nowIsoInTimezone } from "../time.js";
import { EMPTY_ACTION_PARAMS, type ProposedAction, type Task } from "../types.js";

const ActionParamsSchema = z.object({
  title: z.string().nullable().describe("カレンダー予定のタイトル。"),
  startAt: z
    .string()
    .nullable()
    .describe("開始日時。ISO 8601 のオフセット付き。"),
  endAt: z.string().nullable().describe("終了日時。ISO 8601 のオフセット付き。"),
  location: z.string().nullable().describe("場所。不明なら null。"),
  attendees: z
    .array(z.string())
    .nullable()
    .describe("参加者のメールアドレス。会話に明示されたものだけ。"),
  to: z
    .array(z.string())
    .nullable()
    .describe("メール宛先。会話に明示されたアドレスだけ。推測しない。"),
  subject: z.string().nullable().describe("メール件名。"),
  body: z.string().nullable().describe("メール本文。日本語のビジネス文面。"),
  text: z.string().nullable().describe("LINE へ送る通知本文。"),
});

const ProposedActionSchema = z.object({
  type: z.enum([
    "calendar.createEvent",
    "gmail.draft",
    "gmail.send",
    "line.notify",
  ]),
  risk: z
    .enum(["low", "medium", "high"])
    .describe(
      "取り消しやすさで判断する。社内向けで取り消せるものは low、社外に出るものは high。",
    ),
  summary: z.string().describe("承認画面に出す 1 行説明。40 文字以内。"),
  params: ActionParamsSchema,
});

const PlanSchema = z.object({
  reasoning: z.string().describe("なぜこのアクションが必要かを 1〜2 文で。"),
  actions: z.array(ProposedActionSchema),
});

const SYSTEM_PROMPT = `あなたは業務タスクを実際の操作に落とし込むアシスタントです。

## 使えるアクション
- calendar.createEvent : Google カレンダーに予定を作る。日時が確定している打ち合わせ・訪問・締切に使う。
- gmail.draft          : Gmail の下書きを作る。送信はしない。
- gmail.send           : Gmail からメールを送信する。取り消せないので risk は必ず high。
- line.notify          : LINE グループへ通知を送る。担当者への確認や念押しに使う。

## 原則
- タスクを進めるために本当に必要な操作だけを提案する。何もなければ actions を空配列にする。
- 会話に書かれていない情報（メールアドレス、相手の氏名、金額など）を捏造しない。
  必要な情報が欠けている場合は、その操作を提案せず line.notify で不足情報を尋ねる。
- 社外に出るもの（gmail.send）は risk を high にする。社内で取り消せるものは low。
- 1 タスクにつき 3 件までにする。
- 相対的な日付表現は現在時刻を基準に絶対時刻へ変換する。`;

export async function planActions(task: Task): Promise<ProposedAction[]> {
  const userContent = `現在時刻: ${nowIsoInTimezone()}

## タスク
タイトル: ${task.title}
詳細: ${task.detail || "（なし）"}
担当: ${task.assignee || "未定"}
期限: ${task.dueAt || "未設定"}
優先度: ${task.priority}
備考: ${task.notes || "（なし）"}

このタスクを前に進めるために実行すべき操作を提案してください。`;

  const response = await anthropic.messages.parse({
    model: config.anthropic.model,
    max_tokens: 8000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    output_config: {
      format: zodOutputFormat(PlanSchema),
      effort: config.anthropic.planEffort as "low" | "medium" | "high",
    },
  });

  if (response.stop_reason === "refusal") {
    logger.warn("アクション立案が拒否されました", {
      taskId: task.id,
      category: response.stop_details?.category ?? null,
    });
    return [];
  }

  if (!response.parsed_output) {
    logger.warn("アクション立案の構造化出力が得られませんでした", {
      taskId: task.id,
      stopReason: response.stop_reason,
    });
    return [];
  }

  logger.info("アクションを立案しました", {
    taskId: task.id,
    actions: response.parsed_output.actions.length,
    reasoning: response.parsed_output.reasoning,
  });

  return response.parsed_output.actions.map((action) => ({
    type: action.type,
    risk: action.risk,
    summary: action.summary,
    params: { ...EMPTY_ACTION_PARAMS, ...action.params },
  }));
}
