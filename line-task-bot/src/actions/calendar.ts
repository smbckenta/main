/** Google カレンダーへの予定作成。 */

import { google } from "googleapis";
import { getGoogleAuth } from "../google/auth.js";
import { config } from "../config.js";
import { formatLocal, isValidIso } from "../time.js";
import type { ActionParams } from "../types.js";

export async function createCalendarEvent(
  params: ActionParams,
  fallbackTitle: string,
): Promise<string> {
  if (!isValidIso(params.startAt)) {
    throw new Error("開始日時が特定できないため予定を作成できません");
  }

  // 終了時刻の指定がなければ 1 時間の予定として扱う
  const start = params.startAt;
  const end = isValidIso(params.endAt)
    ? params.endAt
    : new Date(new Date(start).getTime() + 3_600_000).toISOString();

  const calendar = google.calendar({ version: "v3", auth: getGoogleAuth() });

  const response = await calendar.events.insert({
    calendarId: config.google.calendarId,
    requestBody: {
      summary: params.title ?? fallbackTitle,
      description: params.body ?? undefined,
      location: params.location ?? undefined,
      start: { dateTime: start, timeZone: config.behavior.timezone },
      end: { dateTime: end, timeZone: config.behavior.timezone },
      attendees: params.attendees?.map((email) => ({ email })),
    },
    sendUpdates: params.attendees && params.attendees.length > 0 ? "all" : "none",
  });

  const link = response.data.htmlLink ?? "";
  return `カレンダーに登録しました: ${params.title ?? fallbackTitle}（${formatLocal(start)}）${link ? `\n${link}` : ""}`;
}
