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

/** "モノクロ 30枚/分、カラー 30枚/分" のような値から両方の数値を取り出す */
function splitMonoColor(text: string): { mono?: number; color?: number } {
  const s = toHalfWidth(text);
  const color = s.match(/(?:フルカラー|カラー)[^0-9]{0,8}([\d.]+)/);
  const mono = s.match(/(?:モノクロ|白黒|ブラック)[^0-9]{0,8}([\d.]+)/);
  const any = s.match(/([\d.]+)/);
  const fallback = any ? Number(any[1]) : undefined;
  return {
    mono: mono ? Number(mono[1]) : fallback,
    color: color ? Number(color[1]) : fallback,
  };
}

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
    const { mono, color } = splitMonoColor(ppm);
    spec.ppmMono = mono;
    spec.ppmColor = color;
    spec.extra["連続コピー速度"] = ppm;
  }

  const fc = find(LABELS.firstCopy);
  if (fc) {
    const { mono, color } = splitMonoColor(fc);
    spec.firstCopyMonoSec = mono;
    spec.firstCopyColorSec = color;
    spec.extra["ファーストコピータイム"] = fc;
  }

  const warm = find(LABELS.warmup);
  if (warm) {
    spec.warmupSec = parseNumber(warm);
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
