/**
 * 会話解析ジョブ。このアプリの中心。
 *
 * webhook は溜めるだけなので、実際の「読んで理解する」処理はここで走る。
 * Cloud Scheduler から数分おきに叩く想定。手動コマンド（「解析」）からも同じ関数を呼ぶ。
 */

import { config } from "../config.js";
import { logger } from "../logger.js";
import { minutesSince, isValidIso } from "../time.js";
import {
  groupByGroupId,
  listMessages,
  markProcessed,
} from "../store/messageRepo.js";
import { createTasks, listOpenTasks, updateTasks } from "../store/taskRepo.js";
import { extractTasks, type ExtractedTask } from "../ai/extractor.js";
import { pushSafely } from "../line/client.js";
import { newTasksMessage } from "../line/messages.js";
import type { StoredChatMessage, StoredTask, Task } from "../types.js";

/** 抽出結果を採用する最低ライン。これ未満は「たぶんタスクではない」として捨てる。 */
const MIN_CONFIDENCE = 0.5;

export interface AnalyzeResult {
  groupId: string;
  analyzedMessages: number;
  createdTasks: Task[];
  updatedTasks: number;
  skipped: number;
}

export interface AnalyzeOptions {
  /** 指定したグループだけを対象にする。 */
  groupId?: string;
  /** 件数・経過時間の条件を無視して即座に解析する（手動コマンド用）。 */
  force?: boolean;
}

export async function runAnalyze(
  options: AnalyzeOptions = {},
): Promise<AnalyzeResult[]> {
  const allMessages = await listMessages(options.groupId);
  const byGroup = groupByGroupId(allMessages);
  const results: AnalyzeResult[] = [];

  for (const [groupId, messages] of byGroup) {
    if (!isAllowedGroup(groupId)) continue;

    const unprocessed = messages.filter((message) => !message.processed);
    if (unprocessed.length === 0) continue;
    if (!options.force && !shouldAnalyze(unprocessed)) {
      logger.debug("解析条件を満たさないため見送りました", {
        groupId,
        unprocessed: unprocessed.length,
      });
      continue;
    }

    try {
      results.push(await analyzeGroup(groupId, messages, unprocessed));
    } catch (error) {
      logger.error("グループの解析に失敗しました", error, { groupId });
    }
  }

  return results;
}

function isAllowedGroup(groupId: string): boolean {
  const allowed = config.behavior.allowedGroupIds;
  return allowed.length === 0 || allowed.includes(groupId);
}

/** 件数がまとまったか、古くなったら解析する。呼ばれるたびに毎回 LLM を叩かないための間引き。 */
function shouldAnalyze(unprocessed: StoredChatMessage[]): boolean {
  if (unprocessed.length >= config.behavior.analyzeMinMessages) return true;
  const oldest = unprocessed[0];
  if (!oldest) return false;
  return minutesSince(oldest.timestamp) >= config.behavior.analyzeMaxAgeMinutes;
}

async function analyzeGroup(
  groupId: string,
  allGroupMessages: StoredChatMessage[],
  unprocessed: StoredChatMessage[],
): Promise<AnalyzeResult> {
  const targetMessages = unprocessed.slice(0, config.behavior.analyzeBatchSize);
  const targetIds = new Set(targetMessages.map((message) => message.messageId));

  // 解析対象より前のメッセージを文脈として渡す。指示の背景がここに書かれていることが多い。
  const contextMessages = allGroupMessages
    .filter((message) => !targetIds.has(message.messageId))
    .filter((message) => message.processed)
    .slice(-config.behavior.contextMessages);

  const openTasks = await listOpenTasks(groupId);

  const extraction = await extractTasks({
    groupId,
    targetMessages,
    contextMessages,
    openTasks,
  });

  if (!extraction) {
    // 抽出に失敗したメッセージを未処理のまま残すと毎回リトライして詰まるため、処理済みにする
    await markProcessed(targetMessages);
    return {
      groupId,
      analyzedMessages: targetMessages.length,
      createdTasks: [],
      updatedTasks: 0,
      skipped: 0,
    };
  }

  const { accepted, skipped } = filterNewTasks(extraction.newTasks, openTasks);

  const createdTasks = await createTasks(
    accepted.map((task) => ({
      groupId,
      title: task.title,
      detail: task.detail,
      assignee: task.assignee,
      dueAt: isValidIso(task.dueAt) ? task.dueAt : "",
      priority: task.priority,
      sourceMessageIds: task.sourceMessageIds,
      notes: extraction.conversationSummary,
    })),
  );

  const updatedCount = await applyUpdates(extraction.updates, openTasks);

  await markProcessed(targetMessages);

  if (config.behavior.notifyOnNewTasks && createdTasks.length > 0) {
    await pushSafely(groupId, [newTasksMessage(createdTasks)]);
  }

  logger.info("グループの解析が完了しました", {
    groupId,
    analyzed: targetMessages.length,
    created: createdTasks.length,
    updated: updatedCount,
    skipped,
  });

  return {
    groupId,
    analyzedMessages: targetMessages.length,
    createdTasks,
    updatedTasks: updatedCount,
    skipped,
  };
}

/**
 * 重複と低確度を落とす。
 * LLM 側にも「重複させるな」と指示しているが、同じ依頼が別の言い回しで再登場すると
 * 取りこぼすことがあるので、コード側でも二重に防ぐ。
 */
export function filterNewTasks(
  candidates: ExtractedTask[],
  openTasks: StoredTask[],
): { accepted: ExtractedTask[]; skipped: number } {
  const knownSourceIds = new Set(
    openTasks.flatMap((task) => task.sourceMessageIds),
  );
  const knownTitles = openTasks.map((task) => normalize(task.title));
  const accepted: ExtractedTask[] = [];
  let skipped = 0;

  for (const candidate of candidates) {
    if (candidate.confidence < MIN_CONFIDENCE) {
      skipped += 1;
      continue;
    }
    if (!candidate.title.trim()) {
      skipped += 1;
      continue;
    }
    // 根拠メッセージがすべて既存タスクのものなら、それは同じ依頼
    if (
      candidate.sourceMessageIds.length > 0 &&
      candidate.sourceMessageIds.every((id) => knownSourceIds.has(id))
    ) {
      skipped += 1;
      continue;
    }
    const normalized = normalize(candidate.title);
    if (
      knownTitles.some((title) => isSimilar(title, normalized)) ||
      accepted.some((task) => isSimilar(normalize(task.title), normalized))
    ) {
      skipped += 1;
      continue;
    }
    accepted.push(candidate);
  }

  return { accepted, skipped };
}

export function normalize(title: string): string {
  return title
    .toLowerCase()
    .replace(/[\s　]/g, "")
    .replace(/[「」『』【】（）()、。,.・！？!?]/g, "");
}

/**
 * ざっくりした類似判定。片方がもう片方を含む、または短いほうの 8 割以上が一致すれば同じとみなす。
 * 日本語の短文で編集距離を測るより、この程度の判定のほうが誤爆が少ない。
 */
export function isSimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  if (shorter.length < 6) return false;
  let matched = 0;
  for (const char of shorter) {
    if (longer.includes(char)) matched += 1;
  }
  return matched / shorter.length >= 0.8;
}

async function applyUpdates(
  updates: { taskId: string; status: string | null; dueAt: string | null; assignee: string | null; note: string }[],
  openTasks: StoredTask[],
): Promise<number> {
  const byId = new Map(openTasks.map((task) => [task.id, task]));
  const batch: { task: StoredTask; patch: Partial<Task> }[] = [];

  for (const update of updates) {
    const task = byId.get(update.taskId);
    if (!task) continue;

    const patch: Partial<Task> = {};
    if (update.status && update.status !== task.status) {
      patch.status = update.status as Task["status"];
    }
    if (isValidIso(update.dueAt) && update.dueAt !== task.dueAt) {
      patch.dueAt = update.dueAt;
    }
    if (update.assignee && update.assignee !== task.assignee) {
      patch.assignee = update.assignee;
    }
    if (Object.keys(patch).length === 0) continue;

    patch.notes = [task.notes, update.note].filter(Boolean).join(" / ").slice(0, 1000);
    batch.push({ task, patch });
  }

  await updateTasks(batch);
  return batch.length;
}
