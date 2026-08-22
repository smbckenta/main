/** tasks シートの読み書き。行 <-> Task の変換をここに閉じ込める。 */

import { randomUUID } from "node:crypto";
import { config } from "../config.js";
import { toIsoInTimezone } from "../time.js";
import type { StoredTask, Task, TaskPriority, TaskStatus } from "../types.js";
import { appendRows, cell, ensureSheet, readRows, updateRows } from "./sheets.js";

export const TASK_HEADER = [
  "id",
  "groupId",
  "title",
  "detail",
  "assignee",
  "assigneeUserId",
  "dueAt",
  "status",
  "priority",
  "sourceMessageIds",
  "createdAt",
  "updatedAt",
  "lastRemindedAt",
  "notes",
] as const;

const STATUSES: TaskStatus[] = ["open", "in_progress", "done", "cancelled"];
const PRIORITIES: TaskPriority[] = ["high", "normal", "low"];

export function ensureTasksSheet(): Promise<void> {
  return ensureSheet(config.sheets.tasksSheet, [...TASK_HEADER]);
}

function toTask(rowNumber: number, values: string[]): StoredTask {
  const status = cell(values, 7);
  const priority = cell(values, 8);
  return {
    rowNumber,
    id: cell(values, 0),
    groupId: cell(values, 1),
    title: cell(values, 2),
    detail: cell(values, 3),
    assignee: cell(values, 4),
    assigneeUserId: cell(values, 5),
    dueAt: cell(values, 6),
    status: (STATUSES as string[]).includes(status)
      ? (status as TaskStatus)
      : "open",
    priority: (PRIORITIES as string[]).includes(priority)
      ? (priority as TaskPriority)
      : "normal",
    sourceMessageIds: cell(values, 9).split(",").map((s) => s.trim()).filter(Boolean),
    createdAt: cell(values, 10),
    updatedAt: cell(values, 11),
    lastRemindedAt: cell(values, 12),
    notes: cell(values, 13),
  };
}

function toRow(task: Task): string[] {
  return [
    task.id,
    task.groupId,
    task.title,
    task.detail,
    task.assignee,
    task.assigneeUserId,
    task.dueAt,
    task.status,
    task.priority,
    task.sourceMessageIds.join(","),
    task.createdAt,
    task.updatedAt,
    task.lastRemindedAt,
    task.notes,
  ];
}

export async function listTasks(groupId?: string): Promise<StoredTask[]> {
  const rows = await readRows(config.sheets.tasksSheet);
  const tasks = rows
    .map((row) => toTask(row.rowNumber, row.values))
    .filter((task) => task.id !== "");
  return groupId ? tasks.filter((task) => task.groupId === groupId) : tasks;
}

export async function listOpenTasks(groupId?: string): Promise<StoredTask[]> {
  const tasks = await listTasks(groupId);
  return tasks.filter(
    (task) => task.status === "open" || task.status === "in_progress",
  );
}

export async function findTaskById(id: string): Promise<StoredTask | undefined> {
  const tasks = await listTasks();
  return tasks.find((task) => task.id === id);
}

export interface NewTaskInput {
  groupId: string;
  title: string;
  detail?: string;
  assignee?: string;
  assigneeUserId?: string;
  dueAt?: string;
  priority?: TaskPriority;
  sourceMessageIds?: string[];
  notes?: string;
}

export async function createTasks(inputs: NewTaskInput[]): Promise<Task[]> {
  if (inputs.length === 0) return [];
  const now = toIsoInTimezone(new Date());
  const tasks: Task[] = inputs.map((input) => ({
    id: randomUUID().slice(0, 8),
    groupId: input.groupId,
    title: input.title,
    detail: input.detail ?? "",
    assignee: input.assignee ?? "",
    assigneeUserId: input.assigneeUserId ?? "",
    dueAt: input.dueAt ?? "",
    status: "open",
    priority: input.priority ?? "normal",
    sourceMessageIds: input.sourceMessageIds ?? [],
    createdAt: now,
    updatedAt: now,
    lastRemindedAt: "",
    notes: input.notes ?? "",
  }));
  await appendRows(config.sheets.tasksSheet, tasks.map(toRow));
  return tasks;
}

/** 既存タスクを部分更新する。rowNumber を持つ StoredTask が前提。 */
export async function updateTasks(
  updates: { task: StoredTask; patch: Partial<Task> }[],
): Promise<StoredTask[]> {
  if (updates.length === 0) return [];
  const now = toIsoInTimezone(new Date());
  const merged = updates.map(({ task, patch }) => ({
    ...task,
    ...patch,
    updatedAt: now,
  }));
  await updateRows(
    config.sheets.tasksSheet,
    merged.map((task) => ({ rowNumber: task.rowNumber, values: toRow(task) })),
  );
  return merged;
}

export function updateTask(
  task: StoredTask,
  patch: Partial<Task>,
): Promise<StoredTask[]> {
  return updateTasks([{ task, patch }]);
}
