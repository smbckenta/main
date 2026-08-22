import type { CurrentMachine } from "./types";

/**
 * 見積書・比較表に入れる枚数の注記。
 * カウンター明細を複数月ぶん読み込んだ場合、月間枚数はその期間の平均になるため、
 * 「（2025/03-2025/08平均印刷枚数）」と対象期間を明記する。
 */
export function pagesAverageNote(current: Pick<CurrentMachine, "pagesPeriod">): string {
  const p = current.pagesPeriod;
  if (!p || p.months < 2 || !p.from || !p.to) return "";
  return `（${yearMonth(p.from)}-${yearMonth(p.to)}平均印刷枚数）`;
}

/** 2025-03-21 → 2025/03 */
export function yearMonth(iso: string): string {
  return iso.slice(0, 7).replace("-", "/");
}
