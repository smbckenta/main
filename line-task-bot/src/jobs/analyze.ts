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
import {
  extractInteractions,
  type ExtractedInteraction,
} from "../ai/interactionExtractor.js";
import { createRecords, listRecentRecords } from "../store/recordRepo.js";
import { isInteractionGroup } from "./syncRecords.js";
import { pushSafely } from "../line/client.js";
import { newTasksMessage, recordApprovalMessage } from "../line/messages.js";
import type {
  InteractionRecord,
  StoredChatMessage,
  StoredInteractionRecord,
  StoredTask,
  Task,
} from "../types.js";

/** 抽出結果を採用する最低ライン。これ未満は「たぶんタスクではない」として捨てる。 */
const MIN_CONFIDENCE = 0.5;

export interface AnalyzeResult {
  groupId: string;
  analyzedMessages: number;
  createdTasks: Task[];
  updatedTasks: number;
  skipped: number;
  createdRecords: InteractionRecord[];
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

  const withRecords = isInteractionGroup(groupId);
  const openTasks = await listOpenTasks(groupId);
  const recentRecords = withRecords ? await listRecentRecords(groupId) : [];

  // タスク抽出と折衝記録の抽出は目的が違うので別プロンプトにしてある。
  // 入力は同じなので、直列にせず並行で投げて待ち時間を重ねる。
  const [extraction, interactions] = await Promise.all([
    extractTasks({ groupId, targetMessages, contextMessages, openTasks }),
    withRecords
      ? extractInteractions({
          groupId,
          targetMessages,
          contextMessages,
          recentRecords,
        })
      : Promise.resolve(null),
  ]);

  const createdRecords = await saveInteractions(
    groupId,
    interactions,
    recentRecords,
  );

  if (!extraction) {
    // 抽出に失敗したメッセージを未処理のまま残すと毎回リトライして詰まるため、処理済みにする
    await markProcessed(targetMessages);
    return {
      groupId,
      analyzedMessages: targetMessages.length,
      createdTasks: [],
      updatedTasks: 0,
      skipped: 0,
      createdRecords,
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
    records: createdRecords.length,
  });

  return {
    groupId,
    analyzedMessages: targetMessages.length,
    createdTasks,
    updatedTasks: updatedCount,
    skipped,
    createdRecords,
  };
}

/**
 * 抽出した折衝記録を records シートへ保存し、承認カードをグループへ送る。
 *
 * ここでは基幹システムへ送らない。人が承認したものだけを syncRecords ジョブが送る。
 */
async function saveInteractions(
  groupId: string,
  interactions: ExtractedInteraction[] | null,
  recentRecords: StoredInteractionRecord[],
): Promise<InteractionRecord[]> {
  if (!interactions || interactions.length === 0) return [];

  const accepted = filterNewInteractions(interactions, recentRecords);
  if (accepted.length === 0) return [];

  const created = await createRecords(
    accepted.map((item) => ({
      groupId,
      kind: item.kind,
      counterpartyName: item.counterpartyName,
      counterpartyId: "",
      contactPerson: item.contactPerson,
      ourStaff: item.ourStaff,
      occurredAt: isValidIso(item.occurredAt) ? item.occurredAt : "",
      channel: item.channel,
      subject: item.subject,
      summary: item.summary,
      detail: item.detail,
      nextAction: item.nextAction,
      nextActionDueAt: isValidIso(item.nextActionDueAt)
        ? item.nextActionDueAt
        : "",
      stage: item.stage,
      amount: item.amount,
      sourceMessageIds: item.sourceMessageIds,
      confidence: item.confidence,
    })),
  );

  for (const record of created) {
    await pushSafely(groupId, [recordApprovalMessage(record)]);
  }
  return created;
}

/**
 * 確度が低いもの、相手先が空のもの、既存記録と同じ接触を落とす。
 * 同じ接触かどうかは「相手先が同じ」かつ「発生日が同じ」で判定する。
 */
export function filterNewInteractions(
  candidates: ExtractedInteraction[],
  existing: StoredInteractionRecord[],
): ExtractedInteraction[] {
  const knownSourceIds = new Set(
    existing.flatMap((record) => record.sourceMessageIds),
  );
  const knownKeys = new Set(
    existing.map((record) =>
      contactKey(record.counterpartyName, record.occurredAt),
    ),
  );
  const accepted: ExtractedInteraction[] = [];

  for (const candidate of candidates) {
    if (candidate.confidence < config.behavior.interactionMinConfidence) {
      continue;
    }
    if (!candidate.counterpartyName.trim() || !candidate.subject.trim()) {
      continue;
    }
    if (
      candidate.sourceMessageIds.length > 0 &&
      candidate.sourceMessageIds.every((id) => knownSourceIds.has(id))
    ) {
      continue;
    }
    const key = contactKey(candidate.counterpartyName, candidate.occurredAt);
    if (knownKeys.has(key)) continue;

    knownKeys.add(key);
    accepted.push(candidate);
  }

  return accepted;
}

/** 相手先名と発生日で「同じ接触」を表すキーを作る。 */
export function contactKey(
  counterpartyName: string,
  occurredAt: string | null,
): string {
  const name = counterpartyName
    .replace(/[\s　]/g, "")
    .replace(/株式会社|有限会社|合同会社|\(株\)|（株）|\(有\)|（有）/g, "")
    .toLowerCase();
  // 日付までで比較する。同じ日の同じ相手なら 1 回の接触とみなす
  const day = occurredAt ? occurredAt.slice(0, 10) : "";
  return `${name}@${day}`;
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
