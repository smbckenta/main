/**
 * グループ内で打てるコマンド。
 *
 * ボットへのメンションは環境によって取れないことがあるので、
 * 「タスク」「完了 3f2a」のような素の日本語を先頭一致で拾う方式にしている。
 * 雑談を誤ってコマンド扱いしないよう、コマンド語は完全一致か「語 + 引数」に限定する。
 */

import { hoursUntil } from "../time.js";
import { listOpenTasks, createTasks, findTaskById, updateTask } from "../store/taskRepo.js";
import { sortByUrgency } from "../jobs/digest.js";
import { runAnalyze } from "../jobs/analyze.js";
import { planActions } from "../ai/planner.js";
import { dispatchActions } from "../actions/executor.js";
import { HELP_TEXT, taskListMessage, text } from "./messages.js";
import type { messagingApi } from "@line/bot-sdk";

type Message = messagingApi.Message;

export interface CommandContext {
  groupId: string;
  userId: string;
  displayName: string;
}

/**
 * コマンドとして解釈できればメッセージを返す。
 * null を返した場合は通常の会話としてバッファへ積まれる。
 */
export async function handleCommand(
  body: string,
  context: CommandContext,
): Promise<Message[] | null> {
  const trimmed = body.trim();
  const [head = "", ...rest] = trimmed.split(/[\s　]+/);
  const argument = rest.join(" ").trim();

  switch (head) {
    case "タスク":
    case "たすく":
    case "/tasks":
      if (argument) return null;
      return taskList(context.groupId);

    case "今日":
    case "/today":
      if (argument) return null;
      return todayTasks(context.groupId);

    case "解析":
    case "/analyze":
      if (argument) return null;
      return analyzeNow(context.groupId);

    case "完了":
    case "/done":
      if (!argument) return null;
      return completeTask(argument);

    case "追加":
    case "/add":
      if (!argument) return null;
      return addTask(argument, context);

    case "実行案":
    case "/plan":
      if (!argument) return null;
      return proposeActions(context.groupId, argument);

    case "ヘルプ":
    case "へるぷ":
    case "/help":
      if (argument) return null;
      return [text(HELP_TEXT)];

    default:
      return null;
  }
}

async function taskList(groupId: string): Promise<Message[]> {
  const tasks = await listOpenTasks(groupId);
  return [taskListMessage("📋 未完了タスク", sortByUrgency(tasks))];
}

async function todayTasks(groupId: string): Promise<Message[]> {
  const tasks = await listOpenTasks(groupId);
  const today = tasks.filter((task) => {
    if (!task.dueAt) return false;
    const hours = hoursUntil(task.dueAt);
    return hours < 24;
  });
  return [taskListMessage("📅 今日中のタスク", sortByUrgency(today))];
}

async function analyzeNow(groupId: string): Promise<Message[]> {
  const results = await runAnalyze({ groupId, force: true });
  const result = results[0];
  if (!result) {
    return [text("解析対象の新しいメッセージはありませんでした。")];
  }
  if (result.createdTasks.length === 0 && result.updatedTasks === 0) {
    return [
      text(
        `${result.analyzedMessages} 件のメッセージを読みましたが、新しいタスクは見つかりませんでした。`,
      ),
    ];
  }
  // 新規タスクの通知は runAnalyze 側が送るため、ここでは件数だけ返す
  return [
    text(
      `${result.analyzedMessages} 件のメッセージを解析しました。新規 ${result.createdTasks.length} 件 / 更新 ${result.updatedTasks} 件。`,
    ),
  ];
}

async function completeTask(taskId: string): Promise<Message[]> {
  const task = await findTaskById(taskId);
  if (!task) {
    return [text(`ID ${taskId} のタスクが見つかりません。`)];
  }
  await updateTask(task, { status: "done" });
  return [text(`✅ 完了にしました: ${task.title}`)];
}

async function addTask(
  body: string,
  context: CommandContext,
): Promise<Message[]> {
  const [created] = await createTasks([
    {
      groupId: context.groupId,
      title: body.slice(0, 100),
      detail: "",
      assignee: context.displayName,
      assigneeUserId: context.userId,
      notes: "手動追加",
    },
  ]);
  return [text(`➕ 追加しました: ${created?.title ?? body}（ID ${created?.id ?? "?"}）`)];
}

async function proposeActions(
  groupId: string,
  taskId: string,
): Promise<Message[]> {
  const task = await findTaskById(taskId);
  if (!task) {
    return [text(`ID ${taskId} のタスクが見つかりません。`)];
  }
  const proposals = await planActions(task);
  if (proposals.length === 0) {
    return [text(`「${task.title}」について、自動実行できる操作はありませんでした。`)];
  }
  const result = await dispatchActions(groupId, task, proposals);
  return [
    text(
      `「${task.title}」の実行案: 自動実行 ${result.executed} 件 / 要承認 ${result.awaitingApproval} 件${result.failed > 0 ? ` / 失敗 ${result.failed} 件` : ""}`,
    ),
  ];
}
