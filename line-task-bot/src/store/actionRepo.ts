/**
 * actions シートの読み書き。
 *
 * 提案されたアクションは必ずここに永続化してから実行する。
 * 承認ボタン（postback）が返ってくるのは別リクエストなので、状態をシートに置かないと繋がらない。
 */

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { toIsoInTimezone } from "../time.js";
import {
  EMPTY_ACTION_PARAMS,
  type ActionParams,
  type ActionStatus,
  type ActionType,
  type ProposedAction,
  type StoredAction,
} from "../types.js";
import type { RiskLevel } from "../config.js";
import { appendRows, cell, ensureSheet, readRows, updateRow } from "./sheets.js";

export const ACTION_HEADER = [
  "id",
  "taskId",
  "groupId",
  "type",
  "risk",
  "status",
  "summary",
  "params",
  "result",
  "createdAt",
  "updatedAt",
] as const;

const ACTION_TYPES: ActionType[] = [
  "calendar.createEvent",
  "gmail.draft",
  "gmail.send",
  "line.notify",
];

export function ensureActionsSheet(): Promise<void> {
  return ensureSheet(config.sheets.actionsSheet, [...ACTION_HEADER]);
}

function parseParams(raw: string): ActionParams {
  if (!raw) return { ...EMPTY_ACTION_PARAMS };
  try {
    return { ...EMPTY_ACTION_PARAMS, ...(JSON.parse(raw) as ActionParams) };
  } catch {
    return { ...EMPTY_ACTION_PARAMS };
  }
}

function toAction(rowNumber: number, values: string[]): StoredAction {
  const type = cell(values, 3);
  return {
    rowNumber,
    id: cell(values, 0),
    taskId: cell(values, 1),
    groupId: cell(values, 2),
    type: (ACTION_TYPES as string[]).includes(type)
      ? (type as ActionType)
      : "line.notify",
    risk: (cell(values, 4) || "high") as RiskLevel,
    status: (cell(values, 5) || "proposed") as ActionStatus,
    summary: cell(values, 6),
    params: parseParams(cell(values, 7)),
    result: cell(values, 8),
    createdAt: cell(values, 9),
    updatedAt: cell(values, 10),
  };
}

function toRow(action: Omit<StoredAction, "rowNumber">): string[] {
  return [
    action.id,
    action.taskId,
    action.groupId,
    action.type,
    action.risk,
    action.status,
    action.summary,
    JSON.stringify(action.params),
    action.result,
    action.createdAt,
    action.updatedAt,
  ];
}

export async function createActions(
  groupId: string,
  taskId: string,
  proposals: ProposedAction[],
  status: ActionStatus,
): Promise<Omit<StoredAction, "rowNumber">[]> {
  if (proposals.length === 0) return [];
  const now = toIsoInTimezone(new Date());
  const actions = proposals.map((proposal) => ({
    ...proposal,
    id: randomUUID().slice(0, 8),
    taskId,
    groupId,
    status,
    result: "",
    createdAt: now,
    updatedAt: now,
  }));
  await appendRows(config.sheets.actionsSheet, actions.map(toRow));
  return actions;
}

export async function listActions(
  filter?: { groupId?: string; taskId?: string; status?: ActionStatus },
): Promise<StoredAction[]> {
  const rows = await readRows(config.sheets.actionsSheet);
  return rows
    .map((row) => toAction(row.rowNumber, row.values))
    .filter((action) => action.id !== "")
    .filter((action) => !filter?.groupId || action.groupId === filter.groupId)
    .filter((action) => !filter?.taskId || action.taskId === filter.taskId)
    .filter((action) => !filter?.status || action.status === filter.status);
}

export async function findActionById(
  id: string,
): Promise<StoredAction | undefined> {
  const actions = await listActions();
  return actions.find((action) => action.id === id);
}

export async function updateActionStatus(
  action: StoredAction,
  status: ActionStatus,
  result: string,
): Promise<StoredAction> {
  const updated: StoredAction = {
    ...action,
    status,
    result: result.slice(0, 2000),
    updatedAt: toIsoInTimezone(new Date()),
  };
  await updateRow(config.sheets.actionsSheet, action.rowNumber, toRow(updated));
  return updated;
}
