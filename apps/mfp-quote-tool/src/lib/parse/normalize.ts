import type { Maker } from "../types";

/** 全角英数字・記号を半角に変換 */
export function toHalfWidth(s: string): string {
  return s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/－|―|ー(?=\d)/g, "-")
    .replace(/，/g, ",")
    .replace(/．/g, ".")
    .replace(/％/g, "%")
    .replace(/￥/g, "¥")
    .replace(/　/g, " ");
}

/** "1,234円" "1234枚" "¥12,345" などから数値を取り出す */
export function parseNumber(input: string | number | undefined | null): number | undefined {
  if (input === undefined || input === null) return undefined;
  if (typeof input === "number") return Number.isFinite(input) ? input : undefined;
  const s = toHalfWidth(String(input)).replace(/[¥,\s]/g, "");
  const m = s.match(/-?\d+(?:\.\d+)?/);
  if (!m) return undefined;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * 濁点・半濁点を落としたカタカナのキー。
 * OCRは「プ」と「ブ」のような濁点の違いを取り違えやすいため、
 * 会社名などの照合はこのキーで行う（アプラス／アブラス → アフラス）。
 */
export function kanaKey(s: string): string {
  const DAKUTEN: Record<string, string> = {
    ガ: "カ", ギ: "キ", グ: "ク", ゲ: "ケ", ゴ: "コ",
    ザ: "サ", ジ: "シ", ズ: "ス", ゼ: "セ", ゾ: "ソ",
    ダ: "タ", ヂ: "チ", ヅ: "ツ", デ: "テ", ド: "ト",
    バ: "ハ", ビ: "ヒ", ブ: "フ", ベ: "ヘ", ボ: "ホ",
    パ: "ハ", ピ: "ヒ", プ: "フ", ペ: "ヘ", ポ: "ホ",
    ヴ: "ウ",
  };
  return toHalfWidth(s)
    .replace(/[ァ-ヴ]/g, (c) => DAKUTEN[c] ?? c)
    .replace(/[\s・]/g, "");
}

const ERA_OFFSET: Record<string, number> = { 令和: 2018, 平成: 1988, 昭和: 1925, R: 2018, H: 1988, S: 1925 };

/** 和暦・西暦の混在した日付表記を YYYY-MM-DD に正規化する */
export function parseJpDate(input: string | undefined | null): string | undefined {
  if (!input) return undefined;
  const s = toHalfWidth(String(input)).trim();

  // 令和6年4月1日 / R6.4.1 / R6/4/1
  const era = s.match(/(令和|平成|昭和|[RHS])\s*(\d{1,2}|元)\s*[年./-]\s*(\d{1,2})\s*[月./-]\s*(\d{1,2})?/);
  if (era) {
    const base = ERA_OFFSET[era[1]];
    const yy = era[2] === "元" ? 1 : Number(era[2]);
    const y = base + yy;
    const m = Number(era[3]);
    const d = era[4] ? Number(era[4]) : 1;
    return fmt(y, m, d);
  }

  // 2024年4月1日 / 2024/4/1 / 2024-04-01
  const ad = s.match(/(\d{4})\s*[年./-]\s*(\d{1,2})\s*(?:[月./-]\s*(\d{1,2}))?/);
  if (ad) return fmt(Number(ad[1]), Number(ad[2]), ad[3] ? Number(ad[3]) : 1);

  return undefined;
}

function fmt(y: number, m: number, d: number): string | undefined {
  if (m < 1 || m > 12 || d < 1 || d > 31) return undefined;
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 開始日と回数から満了日を求める */
export function addMonths(dateStr: string, months: number): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
}

/** 満了日までの残回数（月） */
export function remainingMonths(endDate: string, from = new Date()): number {
  const [y, m] = endDate.split("-").map(Number);
  const diff = (y - from.getFullYear()) * 12 + (m - (from.getMonth() + 1));
  return Math.max(0, diff);
}

const MAKER_PATTERNS: { maker: Maker; patterns: RegExp[] }[] = [
  { maker: "RICOH", patterns: [/ricoh/i, /リコー/, /\bIM\s?C?\d{3,4}/i, /\bMP\s?C?\d{3,4}/i, /imagio/i] },
  {
    maker: "CANON",
    patterns: [/canon/i, /キヤノン/, /キャノン/, /imageRUNNER/i, /iR-?ADV/i, /Satera/i],
  },
  {
    maker: "FUJIFILM",
    patterns: [
      /fujifilm/i, /富士フイルム/, /富士ゼロックス/, /fuji\s?xerox/i, /xerox/i,
      /ApeosPort/i, /DocuCentre/i, /Apeos\b/i, /DocuPrint/i,
    ],
  },
  { maker: "KONICA_MINOLTA", patterns: [/konica/i, /minolta/i, /コニカ/, /ミノルタ/, /bizhub/i] },
  { maker: "SHARP", patterns: [/sharp/i, /シャープ/, /\bMX-\s?[A-Z]?\d{3,4}/i, /BP-\s?\d{2,4}/i] },
  { maker: "KYOCERA", patterns: [/kyocera/i, /京セラ/, /TASKalfa/i, /ECOSYS/i] },
  { maker: "TOSHIBA", patterns: [/toshiba/i, /東芝/, /e-?STUDIO/i] },
];

/** 文字列からメーカーを推定する */
export function detectMaker(text: string): Maker | undefined {
  const s = toHalfWidth(text);
  for (const { maker, patterns } of MAKER_PATTERNS) {
    if (patterns.some((p) => p.test(s))) return maker;
  }
  return undefined;
}

/** 主要メーカーの型番パターン */
const MODEL_PATTERNS: RegExp[] = [
  /IM\s?C?\s?\d{3,4}[A-Z]{0,3}/gi, // リコー IM C3010F
  /MP\s?C?\s?\d{3,4}[A-Z]{0,3}/gi, // リコー MP C3004
  /(?:imageRUNNER\s+ADVANCE\s+DX\s+|iR-?ADV\s+)C?\d{3,4}[A-Z]?/gi, // キヤノン
  /ApeosPort(?:\s+Print)?\s*-?\s*(?:VII|VI|V)?\s*C?\d{3,4}[A-Z]?/gi, // 富士フイルム
  /DocuCentre\s*-?\s*(?:VII|VI|V)?\s*C?\d{3,4}[A-Z]?/gi,
  /Apeos\s*C?\d{3,4}[A-Z]?/gi,
  /TASKalfa\s*(?:MZ|MA)?\s?\d{3,4}[a-z+]{0,4}/gi, // 京セラ TASKalfa MZ2501ci
  /bizhub\s+(?:PRO\s+)?C?\d{3,4}[a-z]{0,3}/gi, // コニカミノルタ bizhub C360i
  /MX-\s?[A-Z]?\d{3,4}[A-Z]{0,3}/gi, // シャープ MX-3161
  /BP-\s?[A-Z]?\d{2,4}[A-Z]{0,3}/gi, // シャープ BP-70C31
  /TASKalfa\s+\d{3,4}[a-z]{0,3}/gi, // 京セラ
  /e-?STUDIO\s?\d{3,4}[A-Z]{0,3}/gi, // 東芝
];

/** テキストから型番候補を抽出（出現回数の多い順） */
export function extractModelCandidates(text: string): string[] {
  const s = toHalfWidth(text);
  const counts = new Map<string, number>();
  for (const p of MODEL_PATTERNS) {
    for (const m of s.matchAll(p)) {
      const model = m[0].replace(/\s+/g, " ").trim().toUpperCase();
      counts.set(model, (counts.get(model) ?? 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m);
}
