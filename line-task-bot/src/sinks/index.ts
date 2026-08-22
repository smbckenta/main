/** 設定に応じて登録先を選ぶ。 */

import { config } from "../config.js";
import type { InteractionRecord } from "../types.js";
import { CoreSystemSink } from "./coreSystem.js";
import type { RecordSink, SyncResult } from "./types.js";

/**
 * 外部システムへは送らず、シートに残すだけの実装。
 * 基幹システムの API がまだ無い期間はこれで運用できる。
 */
class SheetsOnlySink implements RecordSink {
  readonly name = "スプレッドシート";

  async createRecord(record: InteractionRecord): Promise<SyncResult> {
    // records シートへの保存は呼び出し側で済んでいる。ここでは何もしない。
    return { externalId: record.id, externalUrl: "" };
  }
}

let cached: RecordSink | null = null;

export function getRecordSink(): RecordSink {
  if (!cached) {
    cached =
      config.core.sink === "http" ? new CoreSystemSink() : new SheetsOnlySink();
  }
  return cached;
}

export type { RecordSink, SyncResult } from "./types.js";
