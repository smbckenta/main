/**
 * 折衝記録の登録先の抽象化。
 *
 * 基幹システムがまだ開発中なので、ここを差し替え可能にしてある。
 * - sheets : スプレッドシートに残すだけ（外部システム不要。今日から使える）
 * - http   : 自社基幹システムの REST API へ POST する
 *
 * 抽出・承認フローは sink を知らない。登録先が変わってもそこは触らない。
 */

import type { Counterparty, InteractionRecord } from "../types.js";

export interface SyncResult {
  /** 登録先で採番された ID。 */
  externalId: string;
  /** 人が開けるURL。無ければ空文字。 */
  externalUrl: string;
}

export interface RecordSink {
  /** ログと LINE の文言に出す名前。 */
  readonly name: string;

  /** 折衝記録を登録先へ送る。失敗時は例外を投げる。 */
  createRecord(record: InteractionRecord): Promise<SyncResult>;

  /**
   * 相手先マスタを名称で照合する。
   * 実装しない（マスタ照合を使わない）場合は undefined を返す実装でよい。
   */
  findCounterparty?(
    name: string,
    kind: InteractionRecord["kind"],
  ): Promise<Counterparty | null>;
}
