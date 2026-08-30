import { findDeviceByModel } from "../store";
import { lookupSpec } from "./lookup";
import type { Fleet } from "../types";

/**
 * 複数台の案件で、現行機の印刷速度を埋める。
 *
 * 印刷速度はカウンター明細にも請求書にも載っていない。けれども
 * 「現行と同等以上の機種を出す」判断はこれが無いと当てずっぽうになる
 * （枚数だけで決めると、少部数でも高速機を使っている拠点に
 * 小さい機種を当ててしまう）。
 *
 * 機種DBにあればそれを使い、無ければメーカーのサイトから引く。
 * 引いた仕様は機種DBに残るので、2台目以降・次の案件では
 * インターネットに出ない。
 */

/** メーカー名と括弧書きを落とし、機種DBで引ける型番だけにする */
export function cleanModelText(text: string): string {
  return text
    .replace(/^(RICOH|CANON|KYOCERA|SHARP|TOSHIBA|KONICA\s*MINOLTA|FUJI\s*XEROX|FUJIFILM|リコー|キヤノン|キャノン|京セラ|シャープ|東芝|コニカミノルタ|富士フイルム|ゼロックス)\s*/i, "")
    // 「IM C4500（[302B]IMC4500)」のような括弧書きは製品コード。型番の後ろで切る
    .split(/[（(【[]/)[0]
    .replace(/\s+/g, " ")
    .trim();
}

export interface FleetSpecResult {
  fleet: Fleet;
  /** 速度を入れられた台（設置場所または型番） */
  filled: { label: string; model: string; ppm: number; origin: "local" | "web" }[];
  /** 速度が分からなかった台 */
  missing: string[];
}

/**
 * 全台の現行機の印刷速度を調べて入れる。
 * すでに入っている台には手を出さない（手で直した値を上書きしないため）。
 */
export async function fillFleetSpecs(
  fleet: Fleet,
  options: { fetchSpec?: boolean; forceRefresh?: boolean } = {},
): Promise<FleetSpecResult> {
  const filled: FleetSpecResult["filled"] = [];
  const missing: string[] = [];
  const units = [...fleet.units];

  for (const [i, unit] of units.entries()) {
    if (unit.current.ppm && !options.forceRefresh) continue;
    const model = cleanModelText(unit.current.modelText ?? "");
    if (model.length < 3) continue;

    const label = unit.location || model;
    const cached = await findDeviceByModel(model);
    const ppmOf = (d?: { ppmColor?: number; ppmMono?: number }) => d?.ppmColor ?? d?.ppmMono;

    let ppm = options.forceRefresh ? undefined : ppmOf(cached);
    let origin: "local" | "web" = "local";
    if (!ppm && options.fetchSpec !== false) {
      // 取得できた仕様は機種DBに保存される（次からはローカルで当たる）
      const looked = await lookupSpec(model, undefined, { forceRefresh: options.forceRefresh });
      ppm = ppmOf(looked.device);
      origin = looked.origin === "web" ? "web" : "local";
    }

    if (!ppm) {
      missing.push(label);
      continue;
    }
    units[i] = { ...unit, current: { ...unit.current, ppm } };
    filled.push({ label, model, ppm, origin });
  }

  return { fleet: { ...fleet, units }, filled, missing };
}
