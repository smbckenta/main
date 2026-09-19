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

/** メーカー名（社名の書き方はばらつくので、続く語ごと落とす） */
const MAKER_PREFIX =
  /^(?:株式会社\s*)?(RICOH|CANON|KYOCERA|SHARP|TOSHIBA|KONICA\s*MINOLTA|FUJI\s*XEROX|FUJIFILM|XEROX|リコージャパン|リコー|キヤノン|キャノン|京セラ|シャープ|東芝テック|東芝|コニカミノルタ|富士フイルム|ゼロックス)(?:\s*(?:ジャパン|テック|ドキュメントソリューションズ?))?\s*(?:株式会社|\(株\)|（株）)?\s*(?:コピー|複写機|複合機|プリンター?)?\s*/i;

/** メーカー名と括弧書きを落とし、機種DBで引ける型番だけにする */
export function cleanModelText(text: string): string {
  return text
    .replace(MAKER_PREFIX, "")
    // 「IM C4500（[302B]IMC4500)」のような括弧書きは製品コード。型番の後ろで切る
    .split(/[（(【[]/)[0]
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * 複合機として筋の通る印刷速度か。
 *
 * 機種DBには、仕様ページの読み違いで「4枚/分」のような値が
 * 入ってしまったことがある（「A4ヨコ 25枚/分」の A4 を拾っていた）。
 * そのまま比較表に出すと実機と違う数字がお客様に渡るので、
 * 筋の通らない値は「分からない」として扱い、取り直す。
 */
export const plausiblePpm = (ppm: number | undefined): number | undefined =>
  ppm !== undefined && Number.isFinite(ppm) && ppm >= 10 && ppm <= 250 ? ppm : undefined;

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
    // 画面に入っている値も筋を確かめる。読み違えた「4枚/分」が
    // すでに入っている台は、入っていないものとして取り直す
    const current = plausiblePpm(unit.current.ppm);
    if (current && !options.forceRefresh) continue;
    const model = cleanModelText(unit.current.modelText ?? "");
    if (model.length < 3) continue;

    const label = unit.location || model;
    const cached = await findDeviceByModel(model);
    // 読み違えた値が機種DBに残っていることがあるので、ここでも筋を確かめる
    const ppmOf = (d?: { ppmColor?: number; ppmMono?: number }) =>
      plausiblePpm(d?.ppmColor) ?? plausiblePpm(d?.ppmMono);

    let ppm = options.forceRefresh ? undefined : ppmOf(cached);
    let origin: "local" | "web" = "local";
    if (!ppm && options.fetchSpec !== false) {
      // 機種DBに筋の通らない値が残っている場合は取り直す。
      // そのままだと、おかしな値がキャッシュから何度も返ってくる
      const stale = Boolean(cached) && !ppmOf(cached);
      const looked = await lookupSpec(model, undefined, {
        forceRefresh: options.forceRefresh || stale,
      });
      ppm = ppmOf(looked.device);
      origin = looked.origin === "web" ? "web" : "local";
    }

    if (!ppm) {
      // 読み違えた値が画面に残らないように消す
      if (unit.current.ppm !== undefined && !current) {
        units[i] = { ...unit, current: { ...unit.current, ppm: undefined } };
      }
      missing.push(label);
      continue;
    }
    units[i] = { ...unit, current: { ...unit.current, ppm } };
    filled.push({ label, model, ppm, origin });
  }

  return { fleet: { ...fleet, units }, filled, missing };
}
