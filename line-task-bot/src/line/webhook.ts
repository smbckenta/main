/**
 * LINE webhook のイベント処理。
 *
 * 方針: ここでは重い処理をしない。
 * - 通常のメッセージ → messages シートへ積むだけ（解析はジョブ側）
 * - コマンド / ボタン操作 → その場で応答
 * webhook は 1 秒程度で返さないと LINE 側でタイムアウト扱いになるため。
 */

import type { WebhookEvent, MessageEvent, PostbackEvent } from "@line/bot-sdk";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { toIsoInTimezone } from "../time.js";
import { appendMessages } from "../store/messageRepo.js";
import { findActionById, updateActionStatus } from "../store/actionRepo.js";
import { findTaskById, updateTask } from "../store/taskRepo.js";
import { planActions } from "../ai/planner.js";
import { dispatchActions, executeApprovedAction } from "../actions/executor.js";
import { reply, resolveDisplayName } from "./client.js";
import { HELP_TEXT, text } from "./messages.js";
import { handleCommand } from "./commands.js";
import type { ChatMessage } from "../types.js";

export async function handleEvents(events: WebhookEvent[]): Promise<void> {
  // イベントは独立しているので並行処理でよい。1 件の失敗が他を巻き込まないよう個別に握る。
  await Promise.all(
    events.map(async (event) => {
      try {
        await handleEvent(event);
      } catch (error) {
        logger.error("イベント処理に失敗しました", error, {
          type: event.type,
        });
      }
    }),
  );
}

async function handleEvent(event: WebhookEvent): Promise<void> {
  switch (event.type) {
    case "message":
      return handleMessageEvent(event);
    case "postback":
      return handlePostbackEvent(event);
    case "join":
      if (event.source.type === "group") {
        await reply(event.replyToken, [
          text(
            `グループに参加しました。会話からタスクを拾って整理します。\n\n${HELP_TEXT}`,
          ),
        ]);
      }
      return;
    default:
      return;
  }
}

/** グループ／複数人トークの種別と ID を取り出す。1:1 トークは対象外。 */
function conversation(
  source: WebhookEvent["source"],
): { type: "group" | "room"; id: string } | null {
  if (source.type === "group") return { type: "group", id: source.groupId };
  if (source.type === "room") return { type: "room", id: source.roomId };
  return null;
}

function conversationId(source: WebhookEvent["source"]): string | null {
  return conversation(source)?.id ?? null;
}

async function handleMessageEvent(event: MessageEvent): Promise<void> {
  if (event.message.type !== "text") return;

  const talk = conversation(event.source);
  const groupId = talk?.id;
  if (!talk || !groupId) {
    await reply(event.replyToken, [
      text("このボットはグループトークで使ってください。"),
    ]);
    return;
  }

  const allowed = config.behavior.allowedGroupIds;
  if (allowed.length > 0 && !allowed.includes(groupId)) {
    logger.debug("許可されていないグループからのメッセージを無視しました", {
      groupId,
    });
    return;
  }

  const userId = event.source.userId ?? "";
  const displayName = userId
    ? await resolveDisplayName(talk.type, groupId, userId)
    : "unknown";

  const commandReply = await handleCommand(event.message.text, {
    groupId,
    userId,
    displayName,
  });

  if (commandReply) {
    await reply(event.replyToken, commandReply);
    return;
  }

  const message: ChatMessage = {
    messageId: event.message.id,
    groupId,
    userId,
    displayName,
    text: event.message.text,
    timestamp: toIsoInTimezone(new Date(event.timestamp)),
    processed: false,
  };
  await appendMessages([message]);
}

async function handlePostbackEvent(event: PostbackEvent): Promise<void> {
  const groupId = conversationId(event.source);
  if (!groupId) return;

  const params = new URLSearchParams(event.postback.data);
  const kind = params.get("action");

  switch (kind) {
    case "approve":
      return approveAction(event, params.get("actionId"));
    case "reject":
      return rejectAction(event, params.get("actionId"));
    case "done":
      return completeTask(event, params.get("taskId"));
    case "plan":
      return planForTask(event, groupId, params.get("taskId"));
    default:
      logger.warn("未知の postback を受信しました", {
        data: event.postback.data,
      });
  }
}

async function approveAction(
  event: PostbackEvent,
  actionId: string | null,
): Promise<void> {
  if (!actionId) return;
  const action = await findActionById(actionId);
  if (!action) {
    await reply(event.replyToken, [text("対象の操作が見つかりませんでした。")]);
    return;
  }
  if (action.status !== "awaiting_approval") {
    await reply(event.replyToken, [
      text(`この操作はすでに処理済みです（状態: ${action.status}）。`),
    ]);
    return;
  }

  const task = await findTaskById(action.taskId);
  if (!task) {
    await reply(event.replyToken, [
      text("対象のタスクが見つかりませんでした。"),
    ]);
    return;
  }

  const result = await executeApprovedAction(action, task);
  await reply(event.replyToken, [
    text(result.ok ? `✅ ${result.message}` : `⚠️ 実行に失敗しました: ${result.message}`),
  ]);
}

async function rejectAction(
  event: PostbackEvent,
  actionId: string | null,
): Promise<void> {
  if (!actionId) return;
  const action = await findActionById(actionId);
  if (!action) return;
  await updateActionStatus(action, "rejected", "利用者が取り消しました");
  await reply(event.replyToken, [text(`取り消しました: ${action.summary}`)]);
}

async function completeTask(
  event: PostbackEvent,
  taskId: string | null,
): Promise<void> {
  if (!taskId) return;
  const task = await findTaskById(taskId);
  if (!task) {
    await reply(event.replyToken, [text("対象のタスクが見つかりませんでした。")]);
    return;
  }
  await updateTask(task, { status: "done" });
  await reply(event.replyToken, [text(`✅ 完了にしました: ${task.title}`)]);
}

async function planForTask(
  event: PostbackEvent,
  groupId: string,
  taskId: string | null,
): Promise<void> {
  if (!taskId) return;
  const task = await findTaskById(taskId);
  if (!task) {
    await reply(event.replyToken, [text("対象のタスクが見つかりませんでした。")]);
    return;
  }

  const proposals = await planActions(task);
  if (proposals.length === 0) {
    await reply(event.replyToken, [
      text(`「${task.title}」について、自動実行できる操作はありませんでした。`),
    ]);
    return;
  }

  const result = await dispatchActions(groupId, task, proposals);
  await reply(event.replyToken, [
    text(
      `「${task.title}」: 自動実行 ${result.executed} 件 / 要承認 ${result.awaitingApproval} 件${result.failed > 0 ? ` / 失敗 ${result.failed} 件` : ""}`,
    ),
  ]);
}
