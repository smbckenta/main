/**
 * アクションの実行制御。
 *
 * ここが「LLM の提案」と「実際の副作用」の境界。
 * - 低リスクなものだけ自動実行する（閾値は AUTO_EXECUTE_MAX_RISK）
 * - それ以外は actions シートに awaiting_approval で積み、LINE の確認カードを出す
 * - 実行結果は必ずシートへ書き戻す（誰が何をいつ実行したかを追える状態にする）
 */

import { RISK_ORDER, config, type RiskLevel } from "../config.js";
import { logger } from "../logger.js";
import {
  createActions,
  findActionById,
  updateActionStatus,
} from "../store/actionRepo.js";
import { pushSafely } from "../line/client.js";
import { actionApprovalMessage, text } from "../line/messages.js";
import type { ProposedAction, StoredAction, Task } from "../types.js";
import { createCalendarEvent } from "./calendar.js";
import { createGmailDraft, sendGmail } from "./gmail.js";

/** 設定された自動実行の閾値を満たすか。 */
export function canAutoExecute(risk: RiskLevel): boolean {
  const threshold = config.behavior.autoExecuteMaxRisk;
  if (threshold === "none") return false;
  return RISK_ORDER[risk] <= RISK_ORDER[threshold];
}

/** 実際に副作用を起こす唯一の場所。 */
async function runAction(
  action: Pick<StoredAction, "type" | "params" | "groupId">,
  task: Task,
): Promise<string> {
  switch (action.type) {
    case "calendar.createEvent":
      return createCalendarEvent(action.params, task.title);
    case "gmail.draft":
      return createGmailDraft(action.params);
    case "gmail.send":
      return sendGmail(action.params);
    case "line.notify": {
      const body = action.params.text ?? task.title;
      await pushSafely(action.groupId, [text(body)]);
      return `LINE に通知しました: ${body.slice(0, 80)}`;
    }
  }
}

export interface DispatchResult {
  executed: number;
  awaitingApproval: number;
  failed: number;
}

/**
 * 提案されたアクション群を、自動実行と承認待ちに振り分ける。
 * 承認待ちのものはグループへ確認カードを送る。
 */
export async function dispatchActions(
  groupId: string,
  task: Task,
  proposals: ProposedAction[],
): Promise<DispatchResult> {
  const result: DispatchResult = {
    executed: 0,
    awaitingApproval: 0,
    failed: 0,
  };
  if (proposals.length === 0) return result;

  const auto = proposals.filter((proposal) => canAutoExecute(proposal.risk));
  const manual = proposals.filter((proposal) => !canAutoExecute(proposal.risk));

  // 承認待ちは先に永続化してからカードを送る（postback が先に届いても引けるように）
  const pending = await createActions(
    groupId,
    task.id,
    manual,
    "awaiting_approval",
  );
  for (const action of pending) {
    await pushSafely(groupId, [actionApprovalMessage(action, task)]);
    result.awaitingApproval += 1;
  }

  const autoRecords = await createActions(groupId, task.id, auto, "proposed");
  for (const record of autoRecords) {
    try {
      const message = await runAction(record, task);
      await markByIdSafely(record.id, "executed", message);
      // line.notify は通知そのものがグループに出るので、実行報告を重ねない
      if (record.type !== "line.notify") {
        await pushSafely(groupId, [text(`✅ ${message}`)]);
      }
      result.executed += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      logger.error("アクションの自動実行に失敗しました", error, {
        actionId: record.id,
        type: record.type,
      });
      await markByIdSafely(record.id, "failed", reason);
      await pushSafely(
        groupId,
        [text(`⚠️ 自動実行に失敗しました: ${record.summary}\n理由: ${reason}`)],
      );
      result.failed += 1;
    }
  }

  return result;
}

/** 承認ボタン経由の実行。postback ハンドラから呼ばれる。 */
export async function executeApprovedAction(
  action: StoredAction,
  task: Task,
): Promise<{ ok: boolean; message: string }> {
  try {
    const message = await runAction(action, task);
    await updateActionStatus(action, "executed", message);
    return { ok: true, message };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    logger.error("承認済みアクションの実行に失敗しました", error, {
      actionId: action.id,
      type: action.type,
    });
    await updateActionStatus(action, "failed", reason);
    return { ok: false, message: reason };
  }
}

/**
 * createActions は rowNumber を返さないため、状態更新のために行を引き直す。
 * 失敗しても実行そのものは済んでいるので、ログだけ残して握りつぶす。
 */
async function markByIdSafely(
  actionId: string,
  status: StoredAction["status"],
  result: string,
): Promise<void> {
  try {
    const stored = await findActionById(actionId);
    if (stored) {
      await updateActionStatus(stored, status, result);
    }
  } catch (error) {
    logger.error("アクションの状態更新に失敗しました", error, { actionId });
  }
}
