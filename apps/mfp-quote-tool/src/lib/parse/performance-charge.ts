import type { ChargeTier, CounterReading, CurrentChargeLine } from "../types";
import type { ExtractedDoc } from "./extract";
import { toHalfWidth } from "./normalize";

/**
 * パフォーマンスチャージ明細（リコー系）の読み取り。
 *
 * この様式は1行に数字が並ばない。区分名の下に「控除」「請求カウント」
 * 「1- 1000 ／月」の帯が段になって続く、縦に伸びる表になっている。
 * 行ごとに数値を解釈する汎用の読み取りでは、どうしても拾いきれない。
 *
 *   モノカラー総出力                    1,389カウント
 *    控除 2%の控除カウント                 28カウント
 *    請求カウント                       1,361カウント
 *      1-  1000 ／月    3.0円          1,000カウント   3,000円
 *   1001-  2000 ／月    2.6円            361カウント     938円
 *
 * AIが使えないときでもこの様式だけは確実に読めるようにしておく。
 * カウンター明細はほぼこの形で来るため、ここが崩れると見積全体が狂う。
 */

/**
 * 区分名として認める見出し。上から順に当てる。
 * リコーは白黒を「モノカラー」と書く。「カラー」で先に当ててしまうと
 * 白黒の枚数がフルカラーに混ざるため、モノクロの判定を先に置く。
 */
const CATEGORIES: { re: RegExp; kind: CurrentChargeLine["kind"] }[] = [
  { re: /(2色|２色|ツインカラー|デュアルカラー)/, kind: "twoColor" },
  { re: /(モノカラー|モノクロ|ﾓﾉｸﾛ|白黒|ブラック|BK)/i, kind: "mono" },
  { re: /(フルカラー|ﾌﾙｶﾗｰ|カラー|ｶﾗｰ)/, kind: "color" },
];

/** 「控除 2%の控除カウント」 */
const DEDUCTION = /控除\s*(\d+(?:\.\d+)?)\s*%/;
/** 「請求カウント」 */
const BILLABLE = /請求\s*カ\s*ウ\s*ン\s*ト|請求ｶｳﾝﾄ/;
/** 「   1-   1000 ／月」「1001- 2000 /月」。上限なしの帯は「2001- ／月」 */
const TIER = /(\d[\d,]*)\s*[-~〜]\s*(\d[\d,]*)?\s*[/／]\s*月/;
/** 「合計（税抜き）  9,937円」 */
const TOTAL = /合計\s*[（(]?\s*税抜/;
/** 見出し・小計として読み飛ばす行 */
const SKIP = /(ご利用サービス|ご利用金額内訳|ご契約情報|ご請求金額|単価\s*[/／]\s*金額|サービス料金計算明細|ページ)/;

const num = (s: string | undefined): number | undefined => {
  if (!s) return undefined;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : undefined;
};

/** 「1,389カウント」の形で書かれた数だけを拾う（金額と取り違えないため） */
function counts(line: string): number[] {
  return [...line.matchAll(/(\d[\d,]*)\s*(?:カウント|ｶｳﾝﾄ|枚)/g)]
    .map((m) => num(m[1]))
    .filter((n): n is number => n !== undefined);
}

/** 「3,000円」の形で書かれた金額 */
function yens(line: string): number[] {
  return [...line.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*円/g)]
    .map((m) => num(m[1]))
    .filter((n): n is number => n !== undefined);
}

function kindOf(line: string): CurrentChargeLine["kind"] | undefined {
  for (const c of CATEGORIES) if (c.re.test(line)) return c.kind;
  return undefined;
}

interface Block {
  name: string;
  kind: CurrentChargeLine["kind"];
  pages?: number;
  deductionPercent?: number;
  billable?: number;
  tiers: (ChargeTier & { count?: number; amount?: number })[];
  lines: string[];
}

/**
 * この明細がパフォーマンスチャージ様式かどうか。
 * 「控除 N%の控除カウント」か「N- M ／月」の帯があれば、この様式とみなす。
 */
export function isPerformanceCharge(lines: string[]): boolean {
  const text = lines.map(toHalfWidth).join("\n");
  if (/パフォーマンスチャージ/.test(text)) return true;
  return DEDUCTION.test(text) && TIER.test(text);
}

/**
 * 【ご利用金額内訳】以降だけを見る。
 * 【ご契約情報】にも同じ区分名と数字が並んでいて、そちらは
 * 検針の指針（累計値）なので、混ぜると桁が跳ね上がる。
 */
function amountSection(lines: string[]): string[] {
  const start = lines.findIndex((l) => /ご利用金額内訳/.test(l));
  return start >= 0 ? lines.slice(start + 1) : lines;
}

/**
 * 控除率と請求カウントを拾う。
 * OCRは行を結合したり分割したりするので、区分の見出し行にも同じ処理をかける。
 */
function applyExtras(block: Block, line: string): void {
  const deduction = line.match(DEDUCTION);
  if (deduction) {
    block.deductionPercent = num(deduction[1]);
    block.lines.push(line);
  }
  if (BILLABLE.test(line)) {
    // 「請求カウント 1,361カウント」。見出しと同居する場合は最後のカウントを取る
    const after = counts(line.slice(line.search(BILLABLE)))[0];
    if (after !== undefined) block.billable = after;
    block.lines.push(line);
  }
}

function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let block: Block | undefined;

  for (const raw of lines) {
    const line = toHalfWidth(raw).trim();
    if (!line) continue;
    if (TOTAL.test(line)) break;
    if (SKIP.test(line)) continue;

    const tier = line.match(TIER);
    if (tier && block) {
      // 帯の行：単価は最初の「円」、内訳金額は最後の「円」
      const money = yens(line);
      const unit = money[0];
      const amount = money.length > 1 ? money[money.length - 1] : undefined;
      if (unit !== undefined && unit > 0) {
        block.tiers.push({
          from: num(tier[1]) ?? 1,
          to: num(tier[2]) ?? null,
          unit,
          count: counts(line)[0],
          amount,
        });
        block.lines.push(line);
      }
      continue;
    }

    const kind = kindOf(line);
    if (!kind) {
      // 区分名の無い行は、直前の区分の続き（控除・請求カウント）として扱う
      if (block) applyExtras(block, line);
      continue;
    }

    // OCRが行をつなげてしまうことがあるので、区分名は数字・「控除」の手前で切る
    const name = line
      .split(/控除|請求|\d/)[0]
      .replace(/[①-⑳()（）]/g, "")
      .trim();
    block = { name: name || line, kind, pages: counts(line)[0], tiers: [], lines: [line] };
    blocks.push(block);
    // 「モノカラー総出力 1,389カウント 控除 2%…」と1行に収まっている場合に備える
    applyExtras(block, line);
  }

  return blocks;
}

/**
 * 控除前のカウントと請求カウントの差から、ありうる控除率（%）を挙げる。
 * 控除カウントは切り上げなので、率はひとつに定まらないことがある。
 * 例）53カウントで控除2 → 2%でも3%でも切り上げれば2になる。
 */
function candidatePercents(pages: number, billable: number | undefined): number[] {
  if (billable === undefined || billable >= pages || pages <= 0) return [];
  const deduction = pages - billable;
  const out: number[] = [];
  for (let p = 1; p <= 20; p++) if (Math.ceil((pages * p) / 100) === deduction) out.push(p);
  if (out.length) return out;
  for (let p = 0.5; p <= 20; p += 0.5) if (Math.ceil((pages * p) / 100) === deduction) out.push(p);
  return out;
}

/**
 * 「控除 2%」の行が読めなかった区分の控除率を、他の区分から補う。
 *
 * 明細では区分ごとに率が決まっていて、同じ色の区分（フルカラーのコピーと
 * プリントなど）は同じ率になっている。率がひとつに絞れない区分は、
 * 絞れている同じ色の区分に合わせる。
 * 控除を落とすと現行の料金を高く見積もり、削減額を過大に見せてしまう。
 */
function fillDeductions(blocks: Block[]): void {
  const candidates = new Map<Block, number[]>();
  for (const b of blocks) {
    if (b.deductionPercent !== undefined) continue;
    const pages = b.pages ?? b.billable;
    if (pages === undefined) continue;
    const list = candidatePercents(pages, b.billable);
    if (list.length) candidates.set(b, list);
  }
  if (!candidates.size) return;

  // ひとつに絞れた区分の率（読み取れている率も含む）
  const settled = (kind?: Block["kind"]) => {
    const out: number[] = [];
    for (const b of blocks) {
      if (kind && b.kind !== kind) continue;
      if (b.deductionPercent !== undefined) out.push(b.deductionPercent);
      else {
        const list = candidates.get(b);
        if (list?.length === 1) out.push(list[0]);
      }
    }
    return out;
  };

  for (const [block, list] of candidates) {
    if (list.length === 1) {
      block.deductionPercent = list[0];
      continue;
    }
    const sameKind = list.find((p) => settled(block.kind).includes(p));
    block.deductionPercent = sameKind ?? list.find((p) => settled().includes(p)) ?? list[0];
  }
}

/**
 * 読み取れた区分から、計算に使える明細行を作る。
 * 帯（単価）が1つも無い区分は捨てる。金額の書かれていない見出しや、
 * 【ご契約情報】側の指針行を取り込んでしまわないための歯止め。
 */
function toChargeLines(blocks: Block[]): CurrentChargeLine[] {
  const out: CurrentChargeLine[] = [];
  for (const b of blocks) {
    if (!b.tiers.length) continue;

    // 見出しにカウントが無い様式もある。その場合は帯のカウント合計＋控除分から戻す
    const tierCount = b.tiers.reduce((s, t) => s + (t.count ?? 0), 0);
    const billable = b.billable ?? (tierCount || undefined);
    const pages = b.pages ?? billable;
    if (!pages) continue;

    const percent = b.deductionPercent;
    const rate = percent !== undefined && percent > 0 && percent <= 20 ? percent / 100 : undefined;

    const amount = b.tiers.reduce((s, t) => s + (t.amount ?? 0), 0);
    out.push({
      name: b.name,
      kind: b.kind,
      pages,
      deductionRate: rate,
      tiers: b.tiers
        .map((t) => ({ from: t.from, to: t.to, unit: t.unit }))
        .sort((a, b2) => a.from - b2.from),
      amount: amount > 0 ? amount : undefined,
    });
  }
  return out;
}

/** 「2026年5月 ご利用分」から対象期間（その月まるごと）を求める */
function period(lines: string[]): { from?: string; to?: string } {
  for (const raw of lines) {
    const m = toHalfWidth(raw).match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*ご利用分/);
    if (!m) continue;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12) continue;
    const last = new Date(Date.UTC(y, mo, 0)).getUTCDate();
    const p = (n: number) => String(n).padStart(2, "0");
    return { from: `${y}-${p(mo)}-01`, to: `${y}-${p(mo)}-${p(last)}` };
  }
  return {};
}

/** 機種・機番。「MPC3003SP」「機番：664971」の形で並ぶ */
function machine(lines: string[]): { modelText?: string; serialNo?: string } {
  let modelText: string | undefined;
  let serialNo: string | undefined;
  for (const raw of lines) {
    const line = toHalfWidth(raw).trim();
    const s = line.match(/(?:機番|機械番号|製造番号)\s*[:：]?\s*([A-Z0-9-]{5,})/i);
    if (s && !serialNo) serialNo = s[1];
    if (!modelText) {
      // 「MPC3003SP」のような、英字と数字が続く型番だけの並び
      const m = line.match(/\b((?:MP|IM|IMC|MPC|DSC|LP)[\s-]?C?\d{3,4}[A-Z]{0,3})\b/);
      if (m) modelText = m[1].replace(/\s/g, "");
    }
  }
  return { modelText, serialNo };
}

/**
 * パフォーマンスチャージ明細を読み取る。
 * この様式でなければ空配列を返し、呼び出し側は従来の読み取りに進む。
 */
export function parsePerformanceCharge(doc: ExtractedDoc): CounterReading[] {
  const lines = doc.lines.filter((l) => l.trim());
  if (!lines.length || !isPerformanceCharge(lines)) return [];

  const blocks = toBlocks(amountSection(lines));
  fillDeductions(blocks);
  const chargeLines = toChargeLines(blocks);
  if (!chargeLines.length) return [];

  const sum = (kind: CurrentChargeLine["kind"]) =>
    chargeLines.filter((c) => c.kind === kind).reduce((s, c) => s + c.pages, 0);
  const money = (kind: CurrentChargeLine["kind"]) =>
    chargeLines.filter((c) => c.kind === kind).reduce((s, c) => s + (c.amount ?? 0), 0);

  /** 控除と段階単価をならした実効単価（枚数×単価＝明細の金額になる） */
  const unit = (kind: CurrentChargeLine["kind"]) => {
    const pages = sum(kind);
    const amount = money(kind);
    if (!pages || !amount) return undefined;
    return Math.round((amount / pages) * 100) / 100;
  };

  const total = totalOf(lines) ?? (chargeLines.reduce((s, c) => s + (c.amount ?? 0), 0) || undefined);
  const { from, to } = period(lines);
  const { modelText, serialNo } = machine(lines);

  return [
    {
      modelText,
      serialNo,
      periodFrom: from,
      periodTo: to,
      monoPages: sum("mono") || undefined,
      colorPages: sum("color") || undefined,
      twoColorPages: sum("twoColor") || undefined,
      monoUnit: unit("mono"),
      colorUnit: unit("color"),
      twoColorUnit: unit("twoColor"),
      amount: total,
      chargeLines,
      confidence: 0.85,
      evidence: chargeLines.flatMap((c) => c.name),
    },
  ];
}

/** 「合計（税抜き） 9,937円」。検算に使うので明細に書かれた額を優先する */
function totalOf(lines: string[]): number | undefined {
  for (const raw of lines) {
    const line = toHalfWidth(raw);
    if (!TOTAL.test(line)) continue;
    const money = yens(line);
    if (money.length) return money[money.length - 1];
  }
  // 「ご請求金額（税抜き） 9,937円」だけが読めた場合
  for (const raw of lines) {
    const line = toHalfWidth(raw);
    if (!/ご請求金額|ご利用金額/.test(line)) continue;
    const money = yens(line).filter((n) => n >= 100);
    if (money.length) return money[0];
  }
  return undefined;
}
