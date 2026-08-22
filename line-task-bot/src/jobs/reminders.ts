/**
 * 期限リマインドジョブ。
 *
 * 「期限が近い」「期限を過ぎている」タスクをグループへ通知する。
 * 同じタスクを何度も鳴らさないよう、lastRemindedAt を見て 1 日 1 回までに抑える。
 */

import { config } from "../config.js";
import { logger } from "../logger.js";
import { formatLocal, hoursUntil, isValidIso, toIsoInTimezone } from "../time.js";
import { listOpenTasks, updateTasks } from "../store/taskRepo.js";
import { pushSafely } from "../line/client.js";
import { text } from "../line/messages.js";
import type { StoredTask, Task } from "../types.js";

const REMIND_INTERVAL_HOURS = 20;

export interface ReminderResult {
  groupId: string;
  reminded: number;
}

export async function runReminders(): Promise<ReminderResult[]> {
  const tasks = await listOpenTasks();
  const due = tasks.filter(shouldRemind);
  if (due.length === 0) return [];

  const byGroup = new Map<string, StoredTask[]>();
  for (const task of due) {
    const bucket = byGroup.get(task.groupId);
    if (bucket) bucket.push(task);
    else byGroup.set(task.groupId, [task]);
  }

  const results: ReminderResult[] = [];
  const now = toIsoInTimezone(new Date());
  const patches: { task: StoredTask; patch: Partial<Task> }[] = [];

  for (const [groupId, groupTasks] of byGroup) {
    if (!isAllowedGroup(groupId)) continue;
    groupTasks.sort((a, b) => a.dueAt.localeCompare(b.dueAt));
    await pushSafely(groupId, [text(renderReminder(groupTasks))]);
    for (const task of groupTasks) {
      patches.push({ task, patch: { lastRemindedAt: now } });
    }
    results.push({ groupId, reminded: groupTasks.length });
  }

  await updateTasks(patches);
  logger.info("リマインドを送信しました", { groups: results.length });
  return results;
}

function isAllowedGroup(groupId: string): boolean {
  const allowed = config.behavior.allowedGroupIds;
  return allowed.length === 0 || allowed.includes(groupId);
}

function shouldRemind(task: StoredTask): boolean {
  if (!isValidIso(task.dueAt)) return false;
  const hours = hoursUntil(task.dueAt);
  // 期限超過、または期限まで設定時間内
  if (hours > config.behavior.reminderLeadHours) return false;
  if (!task.lastRemindedAt) return true;
  return -hoursUntil(task.lastRemindedAt) >= REMIND_INTERVAL_HOURS;
}

function renderReminder(tasks: StoredTask[]): string {
  const overdue = tasks.filter((task) => hoursUntil(task.dueAt) < 0);
  const upcoming = tasks.filter((task) => hoursUntil(task.dueAt) >= 0);
  const sections: string[] = [];

  if (overdue.length > 0) {
    sections.push(
      `🔴 期限超過（${overdue.length} 件）\n` +
        overdue.map(renderLine).join("\n"),
    );
  }
  if (upcoming.length > 0) {
    sections.push(
      `🟡 期限が近い（${upcoming.length} 件）\n` +
        upcoming.map(renderLine).join("\n"),
    );
  }

  return `⏰ タスクのリマインドです\n\n${sections.join("\n\n")}\n\n完了したものは「完了 <ID>」と送ってください。`;
}

function renderLine(task: StoredTask): string {
  const assignee = task.assignee ? `【${task.assignee}】` : "";
  return `・${assignee}${task.title}\n  期限 ${formatLocal(task.dueAt)} / ID ${task.id}`;
}
