/**
 * records シートの読み書き。折衝記録の台帳。
 *
 * ここは「基幹システムへ送る前の控え」でもある。
 * 送信に失敗しても記録はシートに残るので、システム側が落ちていても取りこぼさない。
 * 送信済みかどうかは status と externalId で判別する。
 */

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { toIsoInTimezone } from "../time.js";
import type {
  InteractionChannel,
  InteractionKind,
  InteractionRecord,
  InteractionStatus,
  StoredInteractionRecord,
} from "../types.js";
import { appendRows, cell, ensureSheet, readRows, updateRows } from "./sheets.js";

export const RECORD_HEADER = [
  "id",
  "groupId",
  "kind",
  "counterpartyName",
  "counterpartyId",
  "contactPerson",
  "ourStaff",
  "occurredAt",
  "channel",
  "subject",
  "summary",
  "detail",
  "nextAction",
  "nextActionDueAt",
  "stage",
  "amount",
  "sourceMessageIds",
  "confidence",
  "status",
  "externalId",
  "externalUrl",
  "syncedAt",
  "error",
  "createdAt",
  "updatedAt",
] as const;

const KINDS: InteractionKind[] = ["customer", "partner"];
const CHANNELS: InteractionChannel[] = [
  "visit",
  "phone",
  "online",
  "email",
  "chat",
  "other",
];
const STATUSES: InteractionStatus[] = [
  "draft",
  "approved",
  "synced",
  "rejected",
  "failed",
];

export function ensureRecordsSheet(): Promise<void> {
  return ensureSheet(config.sheets.recordsSheet, [...RECORD_HEADER]);
}

function toRecord(rowNumber: number, values: string[]): StoredInteractionRecord {
  const kind = cell(values, 2);
  const channel = cell(values, 8);
  const status = cell(values, 18);
  const confidence = Number(cell(values, 17));
  return {
    rowNumber,
    id: cell(values, 0),
    groupId: cell(values, 1),
    kind: (KINDS as string[]).includes(kind)
      ? (kind as InteractionKind)
      : "customer",
    counterpartyName: cell(values, 3),
    counterpartyId: cell(values, 4),
    contactPerson: cell(values, 5),
    ourStaff: cell(values, 6),
    occurredAt: cell(values, 7),
    channel: (CHANNELS as string[]).includes(channel)
      ? (channel as InteractionChannel)
      : "other",
    subject: cell(values, 9),
    summary: cell(values, 10),
    detail: cell(values, 11),
    nextAction: cell(values, 12),
    nextActionDueAt: cell(values, 13),
    stage: cell(values, 14),
    amount: cell(values, 15),
    sourceMessageIds: cell(values, 16)
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    confidence: Number.isNaN(confidence) ? 0 : confidence,
    status: (STATUSES as string[]).includes(status)
      ? (status as InteractionStatus)
      : "draft",
    externalId: cell(values, 19),
    externalUrl: cell(values, 20),
    syncedAt: cell(values, 21),
    error: cell(values, 22),
    createdAt: cell(values, 23),
    updatedAt: cell(values, 24),
  };
}

function toRow(record: InteractionRecord): string[] {
  return [
    record.id,
    record.groupId,
    record.kind,
    record.counterpartyName,
    record.counterpartyId,
    record.contactPerson,
    record.ourStaff,
    record.occurredAt,
    record.channel,
    record.subject,
    record.summary,
    record.detail,
    record.nextAction,
    record.nextActionDueAt,
    record.stage,
    record.amount,
    record.sourceMessageIds.join(","),
    String(record.confidence),
    record.status,
    record.externalId,
    record.externalUrl,
    record.syncedAt,
    record.error,
    record.createdAt,
    record.updatedAt,
  ];
}

export async function listRecords(
  filter?: { groupId?: string; status?: InteractionStatus },
): Promise<StoredInteractionRecord[]> {
  const rows = await readRows(config.sheets.recordsSheet);
  return rows
    .map((row) => toRecord(row.rowNumber, row.values))
    .filter((record) => record.id !== "")
    .filter((record) => !filter?.groupId || record.groupId === filter.groupId)
    .filter((record) => !filter?.status || record.status === filter.status);
}

/** 重複判定と LLM への提示に使う、直近の記録。 */
export async function listRecentRecords(
  groupId: string,
  limit = 30,
): Promise<StoredInteractionRecord[]> {
  const records = await listRecords({ groupId });
  return records
    .filter((record) => record.status !== "rejected")
    .slice(-limit);
}

export async function findRecordById(
  id: string,
): Promise<StoredInteractionRecord | undefined> {
  const records = await listRecords();
  return records.find((record) => record.id === id);
}

export type NewRecordInput = Omit<
  InteractionRecord,
  | "id"
  | "status"
  | "externalId"
  | "externalUrl"
  | "syncedAt"
  | "error"
  | "createdAt"
  | "updatedAt"
> & { status?: InteractionStatus };

export async function createRecords(
  inputs: NewRecordInput[],
): Promise<InteractionRecord[]> {
  if (inputs.length === 0) return [];
  const now = toIsoInTimezone(new Date());
  const records: InteractionRecord[] = inputs.map((input) => ({
    ...input,
    id: randomUUID().slice(0, 8),
    status: input.status ?? "draft",
    externalId: "",
    externalUrl: "",
    syncedAt: "",
    error: "",
    createdAt: now,
    updatedAt: now,
  }));
  await appendRows(config.sheets.recordsSheet, records.map(toRow));
  return records;
}

export async function updateRecords(
  updates: {
    record: StoredInteractionRecord;
    patch: Partial<InteractionRecord>;
  }[],
): Promise<StoredInteractionRecord[]> {
  if (updates.length === 0) return [];
  const now = toIsoInTimezone(new Date());
  const merged = updates.map(({ record, patch }) => ({
    ...record,
    ...patch,
    updatedAt: now,
  }));
  await updateRows(
    config.sheets.recordsSheet,
    merged.map((record) => ({
      rowNumber: record.rowNumber,
      values: toRow(record),
    })),
  );
  return merged;
}

export async function updateRecord(
  record: StoredInteractionRecord,
  patch: Partial<InteractionRecord>,
): Promise<StoredInteractionRecord> {
  const [updated] = await updateRecords([{ record, patch }]);
  return updated ?? record;
}
