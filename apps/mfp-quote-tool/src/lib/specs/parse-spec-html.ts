import * as cheerio from "cheerio";
import type { DeviceSpec } from "../types";
import { parseNumber, toHalfWidth } from "../parse/normalize";

/** メーカー仕様ページの仕様表（ラベル→値） */
export type RawSpecTable = Record<string, string>;

/** HTMLから「ラベル: 値」形式の仕様表を抜き出す */
export function extractSpecTable(html: string): RawSpecTable {
  const $ = cheerio.load(html);
  const table: RawSpecTable = {};

  const put = (label: string, value: string) => {
    const l = toHalfWidth(label).replace(/\s+/g, "").replace(/[※*].*$/, "").trim();
    const v = toHalfWidth(value).replace(/\s+/g, " ").trim();
    if (!l || !v || l.length > 40 || v.length > 300) return;
    if (!table[l]) table[l] = v;
  };

  $("tr").each((_, tr) => {
    const cells = $(tr).children("th,td");
    if (cells.length >= 2) {
      const value = cells
        .slice(1)
        .map((_i, el) => $(el).text())
        .get()
        .join(" / ");
      put($(cells[0]).text(), value);
    }
  });

  $("dl").each((_, dl) => {
    const dts = $(dl).children("dt");
    const dds = $(dl).children("dd");
    dts.each((i, dt) => put($(dt).text(), $(dds[i]).text()));
  });

  return table;
}

const LABELS = {
  ppm: /(連続(コピー|印刷|複写)速度|印刷速度|コピー\/?プリント速度|出力速度|複写速度)/,
  firstCopy: /(ファーストコピー|ファーストプリント|1枚目)/,
  warmup: /(ウォームアップ|立ち上がり時間|準備時間|電源投入)/,
  paperSize: /(最大用紙サイズ|対応用紙サイズ|用紙サイズ|最大原稿サイズ)/,
  resolution: /(解像度)/,
  paperCapacity: /(給紙容量|用紙収容枚数|給紙トレイ)/,
  dimensions: /(外形寸法|本体寸法|大きさ)/,
  weight: /(質量|重量)/,
  power: /(消費電力)/,
  price: /(希望小売価格|標準価格|メーカー希望)/,
} as const;

/**
 * 用紙サイズの表記を消す。
 *
 * 仕様表の値は「A4ヨコ：25枚/分」のように用紙サイズから始まることが多い。
 * 先頭から数字を拾うと「A4」の4を速度として読んでしまうため、
 * 数字を探す前に必ず落とす（実際にこれで25枚機が4枚機として出ていた）。
 */
const stripPaperSize = (s: string): string =>
  s.replace(/\b(?:SRA|[AB])\s?[0-9](?:ノビ|ワイド)?\s*(?:タテ|ヨコ|縦|横|判|サイズ)?/gi, " ");

/** 単位（枚/分・秒など）が付いた数値だけを拾う */
function withUnit(text: string, unit: RegExp): number | undefined {
  const m = text.match(new RegExp(`([\\d.]+)\\s*(?:${unit.source})`));
  const n = m ? Number(m[1]) : undefined;
  return n !== undefined && Number.isFinite(n) ? n : undefined;
}

/** 速度の単位（枚/分・ページ/分・ppm） */
const SPEED_UNIT = /枚\s*[/／]\s*分|ページ\s*[/／]\s*分|面\s*[/／]\s*分|ppm/i;
/** 秒数の単位 */
const SECOND_UNIT = /秒/;

/**
 * "モノクロ 30枚/分、カラー 30枚/分" のような値から両方の数値を取り出す。
 *
 * 単位の付いた数値を最優先で拾う。単位が無い書き方のときだけ、
 * 用紙サイズを落としたうえで最初の数値を使う。
 */
function splitMonoColor(text: string, unit: RegExp): { mono?: number; color?: number } {
  const s = toHalfWidth(text);
  const pick = (label: RegExp): number | undefined => {
    // 「カラー：25枚/分」のように、区分名のあとに続く値
    const at = s.search(label);
    if (at < 0) return undefined;
    const after = stripPaperSize(s.slice(at));
    return withUnit(after, unit) ?? withUnit(after, /(?:)/);
  };

  const cleaned = stripPaperSize(s);
  const fallback = withUnit(cleaned, unit) ?? withUnit(cleaned, /(?:)/);
  return {
    mono: pick(/モノクロ|白黒|ブラック/) ?? fallback,
    color: pick(/フルカラー|カラー/) ?? fallback,
  };
}

/** ありえない値は読み違えとみなして捨てる（数字が出ているほうが誤解を招く） */
const inRange = (n: number | undefined, min: number, max: number): number | undefined =>
  n !== undefined && Number.isFinite(n) && n >= min && n <= max ? n : undefined;

/** 仕様表から比較表に使うスペックを組み立てる */
export function specFromTable(
  table: RawSpecTable,
): Partial<DeviceSpec> & { extra: Record<string, string> } {
  const spec: Partial<DeviceSpec> & { extra: Record<string, string> } = { extra: {} };
  const find = (re: RegExp): string | undefined => {
    const hit = Object.keys(table).find((label) => re.test(label));
    return hit ? table[hit] : undefined;
  };

  const ppm = find(LABELS.ppm);
  if (ppm) {
    const { mono, color } = splitMonoColor(ppm, SPEED_UNIT);
    // 複合機の速度は概ね10〜200枚/分。外れた値は読み違えとみなして捨てる
    spec.ppmMono = inRange(mono, 5, 250);
    spec.ppmColor = inRange(color, 5, 250);
    spec.extra["連続コピー速度"] = ppm;
  }

  const fc = find(LABELS.firstCopy);
  if (fc) {
    const { mono, color } = splitMonoColor(fc, SECOND_UNIT);
    spec.firstCopyMonoSec = inRange(mono, 0.5, 60);
    spec.firstCopyColorSec = inRange(color, 0.5, 60);
    spec.extra["ファーストコピータイム"] = fc;
  }

  const warm = find(LABELS.warmup);
  if (warm) {
    spec.warmupSec = inRange(withUnit(toHalfWidth(warm), SECOND_UNIT) ?? parseNumber(warm), 0.5, 600);
    spec.extra["ウォームアップタイム"] = warm;
  }

  const size = find(LABELS.paperSize);
  if (size) {
    spec.maxPaperSize = /A3ノビ|SRA3/.test(size) ? "A3ノビ" : /A3/.test(size) ? "A3" : "A4";
    spec.extra["最大用紙サイズ"] = size;
  }

  for (const [key, label] of [
    ["解像度", LABELS.resolution],
    ["給紙容量", LABELS.paperCapacity],
    ["外形寸法", LABELS.dimensions],
    ["質量", LABELS.weight],
    ["消費電力", LABELS.power],
    ["希望小売価格", LABELS.price],
  ] as const) {
    const v = find(label);
    if (v) spec.extra[key] = v;
  }

  if (spec.ppmColor !== undefined) spec.colorType = spec.ppmColor > 0 ? "color" : "mono";

  return spec;
}
