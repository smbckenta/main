/**
 * 書類の種類。
 * 画面（クライアント）からも参照するため、解析処理から切り離している。
 */
export type DocRole = "lease" | "schedule" | "counter" | "unknown";

export const ROLE_LABELS: Record<DocRole, string> = {
  lease: "リース契約書",
  schedule: "リース支払予定表",
  counter: "印刷明細（カウンター）",
  unknown: "判別できず",
};
