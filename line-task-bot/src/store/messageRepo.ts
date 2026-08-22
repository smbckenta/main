/**
 * messages シートの読み書き。
 *
 * webhook は「受信して積むだけ」に徹し、解析はジョブ側で行う。
 * こうすると LINE への 200 応答が速く、Cloud Run のバックグラウンド CPU 制約も踏まない。
 */

import { config } from "../config.js";
import type { ChatMessage, StoredChatMessage } from "../types.js";
import { appendRows, cell, ensureSheet, readRows, updateRows } from "./sheets.js";

export const MESSAGE_HEADER = [
  "timestamp",
  "groupId",
  "messageId",
  "userId",
  "displayName",
  "text",
  "processed",
] as const;

export function ensureMessagesSheet(): Promise<void> {
  return ensureSheet(config.sheets.messagesSheet, [...MESSAGE_HEADER]);
}

function toMessage(rowNumber: number, values: string[]): StoredChatMessage {
  return {
    rowNumber,
    timestamp: cell(values, 0),
    groupId: cell(values, 1),
    messageId: cell(values, 2),
    userId: cell(values, 3),
    displayName: cell(values, 4),
    text: cell(values, 5),
    processed: cell(values, 6) === "TRUE",
  };
}

function toRow(message: ChatMessage): string[] {
  return [
    message.timestamp,
    message.groupId,
    message.messageId,
    message.userId,
    message.displayName,
    message.text,
    message.processed ? "TRUE" : "FALSE",
  ];
}

export function appendMessages(messages: ChatMessage[]): Promise<void> {
  return appendRows(config.sheets.messagesSheet, messages.map(toRow));
}

export async function listMessages(
  groupId?: string,
): Promise<StoredChatMessage[]> {
  const rows = await readRows(config.sheets.messagesSheet);
  const messages = rows
    .map((row) => toMessage(row.rowNumber, row.values))
    .filter((message) => message.messageId !== "");
  return groupId
    ? messages.filter((message) => message.groupId === groupId)
    : messages;
}

export async function markProcessed(
  messages: StoredChatMessage[],
): Promise<void> {
  if (messages.length === 0) return;
  await updateRows(
    config.sheets.messagesSheet,
    messages.map((message) => ({
      rowNumber: message.rowNumber,
      values: toRow({ ...message, processed: true }),
    })),
  );
}

/** グループ単位に束ねる。解析ジョブがグループごとに回すため。 */
export function groupByGroupId(
  messages: StoredChatMessage[],
): Map<string, StoredChatMessage[]> {
  const map = new Map<string, StoredChatMessage[]>();
  for (const message of messages) {
    const bucket = map.get(message.groupId);
    if (bucket) {
      bucket.push(message);
    } else {
      map.set(message.groupId, [message]);
    }
  }
  for (const bucket of map.values()) {
    bucket.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return map;
}
