/**
 * 承認済みの折衝記録を基幹システムへ送る。
 *
 * 承認（postback）の場で送るのではなく、いったん status=approved にして
 * このジョブが拾う形にしてある。理由は 2 つ。
 * - LINE の postback 応答は速く返す必要があり、外部 API の待ち時間を挟みたくない
 * - 基幹システムが落ちていても承認操作は成立し、復旧後に自動で送られる
 *
 * 送信失敗は status=failed にして error を残す。次回の再送対象になる。
 */

import { config } from "../config.js";
import { logger } from "../logger.js";
import { toIsoInTimezone } from "../time.js";
import { listRecords, updateRecord } from "../store/recordRepo.js";
import { getRecordSink } from "../sinks/index.js";
import { pushSafely } from "../line/client.js";
import { text } from "../line/messages.js";
import type { StoredInteractionRecord } from "../types.js";

/** 失敗した記録を何回まで自動再送するか。これを超えたら人が見る。 */
const MAX_RETRY = 3;

export interface SyncResultSummary {
  synced: number;
  failed: number;
  skipped: number;
}

export async function runSyncRecords(): Promise<SyncResultSummary> {
  const summary: SyncResultSummary = { synced: 0, failed: 0, skipped: 0 };
  const sink = getRecordSink();

  const approved = await listRecords({ status: "approved" });
  const retryable = (await listRecords({ status: "failed" })).filter(
    (record) => retryCount(record) < MAX_RETRY,
  );
  const pending = [...approved, ...retryable];

  if (pending.length === 0) return summary;

  for (const record of pending) {
    try {
      const resolved = await resolveCounterparty(record);
      const result = await sink.createRecord(resolved);

      await updateRecord(resolved, {
        status: "synced",
        externalId: result.externalId,
        externalUrl: result.externalUrl,
        syncedAt: toIsoInTimezone(new Date()),
        error: "",
      });

      await pushSafely(record.groupId, [
        text(
          `📥 ${sink.name}に登録しました\n${record.counterpartyName} / ${record.subject}${result.externalUrl ? `\n${result.externalUrl}` : ""}`,
        ),
      ]);
      summary.synced += 1;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const attempts = retryCount(record) + 1;
      logger.error("折衝記録の登録に失敗しました", error, {
        recordId: record.id,
        attempts,
      });

      await updateRecord(record, {
        status: "failed",
        error: `[${attempts}] ${reason}`.slice(0, 1000),
      });

      // 諦める段になって初めてグループへ知らせる。毎回鳴らすとうるさい
      if (attempts >= MAX_RETRY) {
        await pushSafely(record.groupId, [
          text(
            `⚠️ ${sink.name}への登録に ${attempts} 回失敗しました\n${record.counterpartyName} / ${record.subject}\n理由: ${reason}\n\nrecords シートの ID ${record.id} を確認してください。`,
          ),
        ]);
      }
      summary.failed += 1;
    }
  }

  logger.info("折衝記録の同期が完了しました", summary);
  return summary;
}

/** error 列の先頭に入れた `[n]` から試行回数を読む。 */
function retryCount(record: StoredInteractionRecord): number {
  const match = /^\[(\d+)\]/.exec(record.error);
  const parsed = match?.[1] ? Number(match[1]) : 0;
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * 相手先マスタと照合して counterpartyId を埋める。
 * 照合できなくても登録は続行する（名称は残るので、後から人が紐づけられる）。
 */
async function resolveCounterparty(
  record: StoredInteractionRecord,
): Promise<StoredInteractionRecord> {
  if (record.counterpartyId) return record;

  const sink = getRecordSink();
  if (!sink.findCounterparty) return record;

  try {
    const match = await sink.findCounterparty(
      record.counterpartyName,
      record.kind,
    );
    if (!match || match.ambiguous || !match.id) {
      logger.info("相手先マスタで一意に特定できませんでした", {
        recordId: record.id,
        name: record.counterpartyName,
        ambiguous: match?.ambiguous ?? false,
      });
      return record;
    }
    return { ...record, counterpartyId: match.id };
  } catch (error) {
    // 照合の失敗で登録そのものを止めない
    logger.warn("相手先マスタの照合に失敗しました", {
      recordId: record.id,
      error: error instanceof Error ? error.message : String(error),
    });
    return record;
  }
}

/** 記録の抽出を行う対象グループか。 */
export function isInteractionGroup(groupId: string): boolean {
  if (!config.behavior.enableInteractionExtraction) return false;
  const allowed = config.behavior.interactionGroupIds;
  return allowed.length === 0 || allowed.includes(groupId);
}
