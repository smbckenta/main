import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDir } from "./store";
import type { ServiceArea, ServiceAreaBook, ServiceRank } from "./types";

/**
 * メーカーの保守対応エリア（担当エリア表）。
 * 現在は京セラの全国担当エリア表を収録している。
 * ランク S/A は当日対応が可能で、印刷枚数が少なくても基準単価を提示できる。
 * ランク B 以下は翌日対応以降となり、カウンター単価が高くなりやすい。
 */

const FILE = path.join(DATA_DIR, "service-areas.json");

let cache: ServiceAreaBook | null = null;

export async function getServiceAreaBook(): Promise<ServiceAreaBook | null> {
  if (cache) return cache;
  try {
    await ensureDataDir();
    cache = JSON.parse(await fs.readFile(FILE, "utf8")) as ServiceAreaBook;
    return cache;
  } catch {
    return null;
  }
}

function toArea(row: [string, string, string, string]): ServiceArea {
  return { pref: row[0], city: row[1], rank: row[2] as ServiceRank, island: row[3] };
}

/** 県名・市町村名で検索する（部分一致・最大50件） */
export async function searchServiceAreas(query: string, limit = 50): Promise<ServiceArea[]> {
  const book = await getServiceAreaBook();
  if (!book) return [];
  const q = query.trim();
  if (!q) return [];
  const hits: ServiceArea[] = [];
  for (const row of book.areas) {
    if (row[0].includes(q) || row[1].includes(q) || `${row[0]}${row[1]}`.includes(q)) {
      hits.push(toArea(row));
      if (hits.length >= limit) break;
    }
  }
  return hits;
}

/** 県名＋市町村名で1件を引く */
export async function findServiceArea(
  pref?: string,
  city?: string,
): Promise<ServiceArea | undefined> {
  if (!pref || !city) return undefined;
  const book = await getServiceAreaBook();
  if (!book) return undefined;
  const row = book.areas.find((r) => r[0] === pref && r[1] === city);
  return row ? toArea(row) : undefined;
}

export const RANK_LABELS: Record<ServiceRank, string> = {
  S: "S：管轄事務所から1時間以内で現地到着",
  A: "A：当日対応可能",
  B: "B：翌日対応",
  C: "C：翌々日以降の対応",
  D: "D：対応不可",
};

/** 提案しやすいエリアか（当日対応が可能か） */
export const isSameDayRank = (rank?: ServiceRank): boolean => rank === "S" || rank === "A";
