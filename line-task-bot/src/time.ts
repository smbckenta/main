/**
 * タイムゾーン付きの日時ユーティリティ。
 * シートには常に ISO 8601（オフセット付き）で保存し、表示のときだけローカル表記に落とす。
 */

import { config } from "./config.js";

const TZ = config.behavior.timezone;

/** 「2026-08-22 14:30」のような人間向け表記。曜日つき。 */
export function formatLocal(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const formatter = new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return formatter.format(date);
}

/** 日付のみの表記（期限一覧など）。 */
export function formatLocalDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ,
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).format(date);
}

/** LLM に「今」を伝えるための文字列。オフセット込みで曖昧さを消す。 */
export function nowIsoInTimezone(): string {
  return toIsoInTimezone(new Date());
}

/**
 * Date を指定タイムゾーンのオフセット付き ISO 文字列に変換する。
 * 例: 2026-08-22T14:30:00+09:00
 */
export function toIsoInTimezone(date: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);

  const get = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((p) => p.type === type)?.value ?? "00";

  // 24 時制で 00 時が "24" として返る実装があるため正規化する
  const hour = get("hour") === "24" ? "00" : get("hour");
  const local = `${get("year")}-${get("month")}-${get("day")}T${hour}:${get("minute")}:${get("second")}`;
  return `${local}${offsetString(date)}`;
}

/** 指定タイムゾーンの UTC オフセットを "+09:00" 形式で返す。 */
function offsetString(date: Date): string {
  const utc = new Date(date.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(date.toLocaleString("en-US", { timeZone: TZ }));
  const diffMinutes = Math.round((local.getTime() - utc.getTime()) / 60000);
  const sign = diffMinutes >= 0 ? "+" : "-";
  const abs = Math.abs(diffMinutes);
  const hours = String(Math.floor(abs / 60)).padStart(2, "0");
  const minutes = String(abs % 60).padStart(2, "0");
  return `${sign}${hours}:${minutes}`;
}

export function hoursUntil(iso: string, from: Date = new Date()): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return Number.POSITIVE_INFINITY;
  return (target - from.getTime()) / 3_600_000;
}

export function minutesSince(iso: string, from: Date = new Date()): number {
  const target = new Date(iso).getTime();
  if (Number.isNaN(target)) return 0;
  return (from.getTime() - target) / 60_000;
}

/** 文字列が妥当な日時として解釈できるか。LLM 出力の検証に使う。 */
export function isValidIso(value: string | null | undefined): value is string {
  if (!value) return false;
  return !Number.isNaN(new Date(value).getTime());
}
