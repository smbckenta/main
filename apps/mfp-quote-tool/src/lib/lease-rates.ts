import type { Settings } from "./types";

/**
 * リース会社から通知されている料率。
 *
 * 料率はリース会社が決めるもので、こちらで決める数字ではない。
 * 改定の通知が来たらここを書き換える。書き換えた日と出典も残しておく。
 *
 * 保存先に設定ファイルが残っている場合、そちらの料率が優先される。
 * 古いままだと気づかずに安い月額で見積を出してしまうので、
 * ずれていたら画面で知らせる（isOutdatedLeaseRates）。
 */

/** いまの標準料率（支払回数 → 料率） */
export const STANDARD_LEASE_RATES: Record<string, number> = {
  "60": 0.0201, // 5年
  "72": 0.0172, // 6年
  "84": 0.0151, // 7年
};

/** この料率がいつの申込分からか（画面の案内に出す） */
export const LEASE_RATES_EFFECTIVE = "2026年10月26日ご申込分";

/**
 * 通知に載っていた料率の全体。
 * このツールが見積に使うのは5〜7年だが、改定の記録として残しておく。
 */
export const LEASE_RATE_NOTICE = {
  effective: LEASE_RATES_EFFECTIVE,
  before: { 36: 0.031, 48: 0.0238, 60: 0.0195, 72: 0.0166, 84: 0.0145, 96: 0.0137 },
  after: { 36: 0.0316, 48: 0.0244, 60: 0.0201, 72: 0.0172, 84: 0.0151, 96: 0.0143 },
} as const;

/** 設定に入っている料率が、標準とずれているか */
export function isOutdatedLeaseRates(rates: Settings["leaseRates"] | undefined): boolean {
  if (!rates) return false;
  const keys = new Set([...Object.keys(STANDARD_LEASE_RATES), ...Object.keys(rates)]);
  for (const k of keys) {
    if (rates[k] !== STANDARD_LEASE_RATES[k]) return true;
  }
  return false;
}

/** 画面に出す「◯年：◯.◯◯%」の並び */
export function describeRates(rates: Settings["leaseRates"]): string {
  return Object.entries(rates)
    .map(([term, rate]) => ({ term: Number(term), rate }))
    .sort((a, b) => a.term - b.term)
    .map(({ term, rate }) => `${Math.round(term / 12)}年：${(rate * 100).toFixed(2)}%`)
    .join("　");
}
