/**
 * 自社基幹システム（開発中）への登録クライアント。
 *
 * 相手の API がまだ固まっていないため、次の 3 つを設定で吸収できるようにしてある。
 * 1. エンドポイントのパス   … CORE_CREATE_PATH / CORE_SEARCH_PATH
 * 2. 送るフィールド名        … CORE_FIELD_MAP（こちらの名前 → 先方の名前）
 * 3. レスポンスの読み取り位置 … CORE_ID_PATH / CORE_URL_PATH（ドット区切り）
 *
 * 期待する API 契約は docs/core-system-api.md に書いてある。
 * 先方の形が違っても、上の 3 つを調整すればコードを触らずに合わせられるはず。
 *
 * 冪等性: リクエストに X-Idempotency-Key として記録 ID を載せる。
 * 再送しても二重登録されないよう、基幹システム側でこのキーを見て弾いてほしい。
 */

import { config } from "../config.js";
import { logger } from "../logger.js";
import type { Counterparty, InteractionRecord } from "../types.js";
import type { RecordSink, SyncResult } from "./types.js";

/** ネットワークと 5xx のみ再試行する。4xx は投げ直しても結果が変わらない。 */
const RETRY_DELAYS_MS = [500, 2000];

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`基幹システムが ${status} を返しました: ${body.slice(0, 300)}`);
    this.name = "HttpError";
  }
}

function headers(idempotencyKey?: string): Record<string, string> {
  const result: Record<string, string> = {
    "content-type": "application/json",
    accept: "application/json",
  };
  if (config.core.authHeader && config.core.authValue) {
    result[config.core.authHeader] = config.core.authValue;
  }
  if (idempotencyKey) {
    result["x-idempotency-key"] = idempotencyKey;
  }
  return result;
}

async function request(
  path: string,
  init: RequestInit,
  idempotencyKey?: string,
): Promise<unknown> {
  const url = new URL(path, config.core.baseUrl).toString();

  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        headers: { ...headers(idempotencyKey), ...(init.headers ?? {}) },
        signal: AbortSignal.timeout(config.core.timeoutMs),
      });

      const body = await response.text();
      if (!response.ok) {
        const error = new HttpError(response.status, body);
        // 4xx はこちらの送り方の問題。再試行しても同じなので即座に諦める
        if (response.status < 500) throw error;
        lastError = error;
      } else {
        return body ? (JSON.parse(body) as unknown) : {};
      }
    } catch (error) {
      if (error instanceof HttpError && error.status < 500) throw error;
      lastError = error;
    }

    const delay = RETRY_DELAYS_MS[attempt];
    if (delay !== undefined) {
      logger.warn("基幹システムへのリクエストを再試行します", {
        url,
        attempt: attempt + 1,
        error: lastError instanceof Error ? lastError.message : String(lastError),
      });
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error(`基幹システムへのリクエストに失敗しました: ${String(lastError)}`);
}

/** "data.record.id" のようなドット区切りのパスで値を取り出す。 */
export function pickPath(source: unknown, path: string): string {
  if (!path) return "";
  let current: unknown = source;
  for (const segment of path.split(".")) {
    if (current === null || typeof current !== "object") return "";
    current = (current as Record<string, unknown>)[segment];
  }
  if (current === null || current === undefined) return "";
  if (typeof current === "object") return "";
  return String(current);
}

/**
 * こちらのフィールド名を先方のフィールド名へ置き換える。
 * マップに無いフィールドはこちらの名前のまま送る。
 */
export function mapFields(
  record: InteractionRecord,
  fieldMap: Record<string, string>,
): Record<string, unknown> {
  const source: Record<string, unknown> = {
    kind: record.kind,
    counterpartyName: record.counterpartyName,
    counterpartyId: record.counterpartyId || null,
    contactPerson: record.contactPerson,
    ourStaff: record.ourStaff,
    occurredAt: record.occurredAt || null,
    channel: record.channel,
    subject: record.subject,
    summary: record.summary,
    detail: record.detail,
    nextAction: record.nextAction,
    nextActionDueAt: record.nextActionDueAt || null,
    stage: record.stage,
    amount: record.amount,
    // 出所を追えるように、こちら側の ID と根拠メッセージも送る
    sourceSystem: "line-task-bot",
    sourceRecordId: record.id,
    sourceGroupId: record.groupId,
    sourceMessageIds: record.sourceMessageIds,
  };

  const mapped: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(source)) {
    mapped[fieldMap[key] ?? key] = value;
  }
  return mapped;
}

export class CoreSystemSink implements RecordSink {
  readonly name = "基幹システム";

  async createRecord(record: InteractionRecord): Promise<SyncResult> {
    const payload = mapFields(record, config.core.fieldMap);

    const response = await request(
      config.core.createPath,
      { method: "POST", body: JSON.stringify(payload) },
      record.id,
    );

    const externalId = pickPath(response, config.core.idPath);
    if (!externalId) {
      logger.warn("基幹システムのレスポンスから ID を取得できませんでした", {
        recordId: record.id,
        idPath: config.core.idPath,
      });
    }

    return {
      externalId,
      externalUrl: pickPath(response, config.core.urlPath),
    };
  }

  /**
   * 相手先マスタを名称で照合する。
   * 候補が 1 件に絞れたときだけ ID を返し、複数あれば ambiguous を立てて人の判断に回す。
   */
  async findCounterparty(
    name: string,
    kind: InteractionRecord["kind"],
  ): Promise<Counterparty | null> {
    if (!config.core.searchPath || !name.trim()) return null;

    const path = `${config.core.searchPath}?${config.core.searchQueryParam}=${encodeURIComponent(name)}&kind=${kind}`;
    const response = await request(path, { method: "GET" });

    const items = pickArray(response, config.core.searchItemsPath);
    if (items.length === 0) return null;

    const exact = items.filter(
      (item) =>
        normalizeName(pickPath(item, config.core.searchNamePath)) ===
        normalizeName(name),
    );
    const chosen = exact.length === 1 ? exact[0] : items.length === 1 ? items[0] : undefined;

    if (!chosen) {
      return {
        id: "",
        name,
        ambiguous: true,
      };
    }

    return {
      id: pickPath(chosen, config.core.searchIdPath),
      name: pickPath(chosen, config.core.searchNamePath) || name,
      ambiguous: false,
    };
  }
}

function pickArray(source: unknown, path: string): unknown[] {
  let current: unknown = source;
  if (path) {
    for (const segment of path.split(".")) {
      if (current === null || typeof current !== "object") return [];
      current = (current as Record<string, unknown>)[segment];
    }
  }
  return Array.isArray(current) ? current : [];
}

/** 「株式会社」等の表記ゆれを吸収して比較する。 */
export function normalizeName(value: string): string {
  return value
    .replace(/[\s　]/g, "")
    .replace(/株式会社|有限会社|合同会社|\(株\)|（株）|\(有\)|（有）/g, "")
    .toLowerCase();
}
