/**
 * 日次サマリージョブ。朝いちで未完了タスクの一覧をグループへ流す。
 * リマインドが「急ぎのもの」だけなのに対し、こちらは全体の見通しを共有する。
 */

import { config } from "../config.js";
import { logger } from "../logger.js";
import { hoursUntil } from "../time.js";
import { listOpenTasks } from "../store/taskRepo.js";
import { pushSafely } from "../line/client.js";
import { taskListMessage } from "../line/messages.js";
import type { StoredTask } from "../types.js";

export interface DigestResult {
  groupId: string;
  tasks: number;
}

export async function runDigest(): Promise<DigestResult[]> {
  const tasks = await listOpenTasks();
  const byGroup = new Map<string, StoredTask[]>();
  for (const task of tasks) {
    const bucket = byGroup.get(task.groupId);
    if (bucket) bucket.push(task);
    else byGroup.set(task.groupId, [task]);
  }

  const results: DigestResult[] = [];
  for (const [groupId, groupTasks] of byGroup) {
    const allowed = config.behavior.allowedGroupIds;
    if (allowed.length > 0 && !allowed.includes(groupId)) continue;

    await pushSafely(groupId, [
      taskListMessage("📋 本日の未完了タスク", sortByUrgency(groupTasks)),
    ]);
    results.push({ groupId, tasks: groupTasks.length });
  }

  logger.info("日次サマリーを送信しました", { groups: results.length });
  return results;
}

/** 期限が近いものを上に。期限なしは最後にまとめる。 */
export function sortByUrgency(tasks: StoredTask[]): StoredTask[] {
  return [...tasks].sort((a, b) => {
    const aHas = Boolean(a.dueAt);
    const bHas = Boolean(b.dueAt);
    if (aHas !== bHas) return aHas ? -1 : 1;
    if (aHas && bHas) {
      const diff = hoursUntil(a.dueAt) - hoursUntil(b.dueAt);
      if (diff !== 0) return diff;
    }
    const priorityOrder = { high: 0, normal: 1, low: 2 } as const;
    return priorityOrder[a.priority] - priorityOrder[b.priority];
  });
}
