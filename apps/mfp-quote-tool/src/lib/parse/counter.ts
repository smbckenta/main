import type { CounterReading } from "../types";
import type { ExtractedDoc } from "./extract";
import { parseJpDate, toHalfWidth } from "./normalize";
import { parseDealerInvoice } from "./dealer-invoice";
import { parsePerformanceCharge } from "./performance-charge";

/**
 * 印刷明細書（カウンター明細）の読み取り。
 * メーカー・販売店ごとに様式が違うため、
 * 「区分キーワードを含む行の数値列を関係式で検証する」方式で汎用的に拾う。
 */

const TWO_COLOR = /(2色|２色|ツインカラー|デュアルカラー)/;
const COLOR = /(フルカラー|カラー|ｶﾗｰ|COLOR)/i;
const MONO = /(モノクロ|ﾓﾉｸﾛ|白黒|黒|ブラック|B\/?W)/i;
const SERIAL = /(機番|機械番号|製造番号|シリアル|Serial|S\/N)\s*[:：]?\s*([A-Z0-9-]{5,})/i;
const TOTAL_LINE = /(合計|小計|消費税|税込|請求金額合計|総額)/;

type Category = "mono" | "color" | "twoColor";

function categoryOf(line: string): Category | null {
  if (TWO_COLOR.test(line)) return "twoColor";
  const hasColor = COLOR.test(line);
  const hasMono = MONO.test(line);
  if (hasColor && hasMono) return null; // 見出し行の可能性が高い
  if (hasColor) return "color";
  if (hasMono) return "mono";
  return null;
}

/**
 * 数値を取り出す。
 * 「チャージ枚数 1～1,000」「1001～」のような区間表記は枚数でも単価でもないため先に除去する。
 */
function numbersIn(line: string): number[] {
  // 「1001～」の後ろに続く別の数値まで飲み込まないよう、区間の上限側は空白なしで続く場合のみ除去する
  const cleaned = toHalfWidth(line).replace(/\d[\d,]*\s*[～〜~](\d[\d,]*)?/g, " ");
  return [...cleaned.matchAll(/-?\d[\d,]*(?:\.\d+)?/g)]
    .map((m) => Number(m[0].replace(/,/g, "")))
    .filter(Number.isFinite);
}

/** 単価らしい値か（1枚あたりの金額は概ね 0.1〜100円） */
const isUnitLike = (n: number) => n > 0 && n <= 100 && (!Number.isInteger(n) || n <= 30);

interface LineFacts {
  pages?: number;
  unit?: number;
  amount?: number;
  confidence: number;
}

/**
 * 数値の並びを「前回指針・今回指針・使用枚数・単価・金額」として解釈する。
 * 指針の差＝枚数、枚数×単価＝金額 の関係で検証し、当たった並びを採用する。
 */
function interpretLine(nums: number[]): LineFacts | null {
  if (!nums.length) return null;
  const close = (a: number, b: number) => Math.abs(a - b) <= Math.max(2, Math.abs(b) * 0.02);

  for (let i = 0; i + 2 < nums.length; i++) {
    const [a, b, c] = [nums[i], nums[i + 1], nums[i + 2]];
    // 指針は3桁以上が普通。小さい値の並びは区分番号などの誤検出になりやすい
    // 使用枚数はOCRで1桁崩れることがあるため、指針の差を正として採用する
    if (a >= 100 && b >= a && c > 0 && Math.abs(b - a - c) <= Math.max(1, c * 0.02)) {
      const pages = b - a;
      const rest = nums.slice(i + 3);
      const unit = rest.find(isUnitLike);
      const amount = unit !== undefined ? rest.find((n) => close(n, pages * unit)) : undefined;
      return { pages, unit, amount, confidence: pages === c ? 0.9 : 0.7 };
    }
  }

  for (let i = 0; i + 2 < nums.length; i++) {
    const [pages, unit, amount] = [nums[i], nums[i + 1], nums[i + 2]];
    if (pages > 0 && isUnitLike(unit) && close(amount, pages * unit)) {
      return { pages, unit, amount, confidence: 0.85 };
    }
  }

  // 単価 × 枚数 = 金額（単価が先に来る様式）
  for (let i = 0; i + 2 < nums.length; i++) {
    const [unit, pages, amount] = [nums[i], nums[i + 1], nums[i + 2]];
    if (isUnitLike(unit) && pages > 0 && close(amount, pages * unit)) {
      return { pages, unit, amount, confidence: 0.85 };
    }
  }

  for (let i = 0; i + 1 < nums.length; i++) {
    if (nums[i] > 0 && isUnitLike(nums[i + 1])) {
      return { pages: nums[i], unit: nums[i + 1], confidence: 0.5 };
    }
    if (isUnitLike(nums[i]) && nums[i + 1] > 0 && Number.isInteger(nums[i + 1])) {
      return { pages: nums[i + 1], unit: nums[i], confidence: 0.5 };
    }
  }

  const pages = nums.find((n) => Number.isInteger(n) && n >= 0);
  return pages === undefined ? null : { pages, confidence: 0.25 };
}

/** 期間の月数（1ヶ月未満は1として扱う） */
export function monthsBetween(from?: string, to?: string): number {
  if (!from || !to) return 1;
  const days = (new Date(to).getTime() - new Date(from).getTime()) / 86_400_000;
  if (!Number.isFinite(days) || days <= 0) return 1;
  return Math.max(1, Math.round(days / 30.4));
}

/** 明細を読み取る。機番が複数あればブロックに分割して機械ごとに返す */
export function parseCounter(doc: ExtractedDoc): CounterReading[] {
  // パフォーマンスチャージ様式は縦に段が続くため、行ごとの解釈では拾えない。
  // 専用の読み取りを先に試す。
  const performanceCharge = parsePerformanceCharge(doc);
  if (performanceCharge.length) return performanceCharge;

  // 販売店の請求書・内訳書は、設置場所ごとに台が並ぶ。
  // 台数と設置場所が分かるのはこの様式だけなので、これも先に試す。
  const dealer = parseDealerInvoice(doc);
  if (dealer.length) return dealer;

  const lines = doc.lines.map(toHalfWidth).filter((l) => l.trim());
  if (!lines.length) return [];

  const blocks: { serial?: string; lines: string[] }[] = [];
  let current: { serial?: string; lines: string[] } = { lines: [] };
  for (const line of lines) {
    const m = line.match(SERIAL);
    if (m) {
      if (current.lines.length) blocks.push(current);
      current = { serial: m[2], lines: [line] };
    } else current.lines.push(line);
  }
  if (current.lines.length) blocks.push(current);

  const readings = blocks
    .map((b) => parseBlock(b.lines, b.serial))
    .filter((r): r is CounterReading => r !== null);

  if (readings.length) return readings;
  const single = parseBlock(lines, undefined);
  return single ? [single] : [];
}

function parseBlock(lines: string[], serialNo?: string): CounterReading | null {
  const evidence: string[] = [];
  const agg: Record<Category, { pages: number; amount: number; units: number[] }> = {
    mono: { pages: 0, amount: 0, units: [] },
    color: { pages: 0, amount: 0, units: [] },
    twoColor: { pages: 0, amount: 0, units: [] },
  };
  let score = 0;
  let periodFrom: string | undefined;
  let periodTo: string | undefined;
  let modelText: string | undefined;
  let amount: number | undefined;

  for (const line of lines) {
    // 集計期間
    if (!periodFrom && /(期間|対象期間|ご請求期間|集計期間|検針|印刷月|使用月)/.test(line)) {
      const dates = [
        ...line.matchAll(/(?:令和|平成|昭和|[RHS])?\s*\d{1,4}\s*[年./-]\s*\d{1,2}(?:\s*[月./-]\s*\d{1,2})?\s*日?/g),
      ]
        .map((m) => parseJpDate(m[0]))
        .filter((d): d is string => !!d);
      if (dates.length >= 2) {
        [periodFrom, periodTo] = dates;
        evidence.push(line);
        score += 1;
      } else if (dates.length === 1) {
        periodFrom = dates[0];
        periodTo = dates[0];
        evidence.push(line);
        score += 0.5;
      }
    }

    // 機種名
    if (!modelText) {
      const m = line.match(/(?:機種|品名|物件|型式|機種名|商品名)\s*[:：]?\s*(.{3,40})/);
      if (m) {
        // 同じ行に機番が続く様式があるため、そこで切る
        modelText = m[1].split(/\s*(?:機番|機械番号|製造番号|シリアル|Serial|S\/N)/i)[0].trim();
        evidence.push(line);
        score += 0.5;
      }
    }

    // 請求合計
    if (TOTAL_LINE.test(line)) {
      if (/(請求金額|ご請求額|合計金額)/.test(line)) {
        const big = numbersIn(line).filter((n) => n > 100);
        if (big.length) amount = Math.max(...big);
      }
      continue; // 合計行はカウンター行として扱わない
    }

    const category = categoryOf(line);
    if (!category) continue;
    const facts = interpretLine(numbersIn(line));
    if (!facts?.pages) continue;

    agg[category].pages += facts.pages;
    agg[category].amount += facts.amount ?? (facts.unit ? facts.pages * facts.unit : 0);
    if (facts.unit) agg[category].units.push(facts.unit);
    evidence.push(line);
    score += facts.confidence;
  }

  const has = (c: Category) => agg[c].pages > 0;
  if (!has("mono") && !has("color") && !has("twoColor")) return null;

  // 段階単価の明細は「金額 ÷ 枚数」で加重平均単価にする
  const unitOf = (c: Category): number | undefined => {
    const a = agg[c];
    if (a.pages > 0 && a.amount > 0) return Math.round((a.amount / a.pages) * 100) / 100;
    return a.units.length ? a.units[0] : undefined;
  };

  return {
    serialNo,
    modelText,
    periodFrom,
    periodTo,
    monoPages: has("mono") ? agg.mono.pages : undefined,
    colorPages: has("color") ? agg.color.pages : undefined,
    twoColorPages: has("twoColor") ? agg.twoColor.pages : undefined,
    monoUnit: unitOf("mono"),
    colorUnit: unitOf("color"),
    twoColorUnit: unitOf("twoColor"),
    amount,
    confidence: Math.min(1, score / 2.5),
    evidence,
  };
}

/** 複数枚・複数月の明細から月間平均を求める */
/**
 * 同じ明細を2回読み込んだ場合（写真とPDFの両方を渡した等）に枚数が二重計上されるのを防ぐ。
 * 期間と枚数がすべて一致する読み取りは同一の明細とみなす。
 */
export function dedupeReadings(readings: CounterReading[]): CounterReading[] {
  const seen = new Set<string>();
  const out: CounterReading[] = [];
  for (const r of readings) {
    const key = [r.periodFrom, r.periodTo, r.monoPages, r.colorPages, r.twoColorPages].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

export interface MonthlyAverage {
  monoPages: number;
  colorPages: number;
  twoColorPages: number;
  monoUnit?: number;
  colorUnit?: number;
  twoColorUnit?: number;
  /** 平均のもとにした集計期間（複数月ぶんを読み込んだ場合） */
  period?: { from: string; to: string; months: number };
}

export function toMonthlyAverage(input: CounterReading[]): MonthlyAverage {
  const readings = dedupeReadings(input);
  if (!readings.length) return { monoPages: 0, colorPages: 0, twoColorPages: 0 };

  // 同一機番は期間で割り、複数機番は合算する
  const bySerial = new Map<string, CounterReading[]>();
  for (const r of readings) bySerial.set(r.serialNo ?? "-", [...(bySerial.get(r.serialNo ?? "-") ?? []), r]);

  let mono = 0;
  let color = 0;
  let twoColor = 0;
  const monoUnits: number[] = [];
  const colorUnits: number[] = [];
  const twoColorUnits: number[] = [];

  for (const group of bySerial.values()) {
    let months = 0;
    let m = 0;
    let c = 0;
    let t = 0;
    for (const r of group) {
      months += monthsBetween(r.periodFrom, r.periodTo);
      m += r.monoPages ?? 0;
      c += r.colorPages ?? 0;
      t += r.twoColorPages ?? 0;
      if (r.monoUnit) monoUnits.push(r.monoUnit);
      if (r.colorUnit) colorUnits.push(r.colorUnit);
      if (r.twoColorUnit) twoColorUnits.push(r.twoColorUnit);
    }
    const divisor = Math.max(1, months);
    mono += m / divisor;
    color += c / divisor;
    twoColor += t / divisor;
  }

  return {
    monoPages: Math.round(mono),
    colorPages: Math.round(color),
    twoColorPages: Math.round(twoColor),
    monoUnit: monoUnits.length ? median(monoUnits) : undefined,
    colorUnit: colorUnits.length ? median(colorUnits) : undefined,
    twoColorUnit: twoColorUnits.length ? median(twoColorUnits) : undefined,
    period: coveredPeriod(readings),
  };
}

/**
 * 読み取れた明細が何年何月から何年何月までを含むか。
 * 1機番あたりの月数を数え、2ヶ月以上あるときだけ「平均」として扱う。
 */
function coveredPeriod(readings: CounterReading[]): MonthlyAverage["period"] {
  const dated = readings.filter((r) => r.periodFrom || r.periodTo);
  if (dated.length < 2) return undefined;

  const froms = dated.map((r) => r.periodFrom ?? r.periodTo!).sort();
  const tos = dated.map((r) => r.periodTo ?? r.periodFrom!).sort();
  const from = froms[0];
  const to = tos[tos.length - 1];

  // 同じ機械の明細が何ヶ月ぶんあるか（複数機番なら1台あたりの月数）
  const bySerial = new Map<string, number>();
  for (const r of dated) {
    const key = r.serialNo ?? "-";
    bySerial.set(key, (bySerial.get(key) ?? 0) + monthsBetween(r.periodFrom, r.periodTo));
  }
  const months = Math.max(...bySerial.values());
  if (months < 2) return undefined;
  return { from, to, months };
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 100) / 100;
}
