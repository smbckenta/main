import type { CounterReading } from "../types";
import type { ExtractedDoc } from "./extract";
import { toHalfWidth } from "./normalize";

/**
 * 販売店（大塚商会など）の請求書・内訳書からの読み取り。
 *
 * メーカー直の明細と違い、この様式は「設置場所ごとに1ブロック」で並ぶ。
 * 枚数や単価は載っておらず、載っているのは
 *   ・設置場所（本社／北部九州工事課／ゆめソーラー直方店 …）
 *   ・機種と機番（RICOH IM C3500F ／ IMC3500 630088）
 *   ・パフォーマンスチャージ（カウンター料金）の金額
 *   ・たよれーる等の月額保守料金
 * の4つ。複数台比較表は台ごとに1行なので、この4つが揃えば
 * 「何台あって、どこに置いてあって、いくら払っているか」までは組める。
 *
 * 枚数・単価はメーカーの明細（パフォーマンスチャージ明細）側にあるので、
 * そちらを一緒に読み込めば機番で突き合わせて埋まる。
 */

/** 「パフォーマンスチャージ（株式会社リコーの代行請求）」 */
const CHARGE = /パフォーマンス\s*チャージ|カウンター料金|カウンタ料金/;
/** 「たよれーる（保守契約）料金」「保守料金」 */
const MAINTENANCE = /保守契約|保守料金|メンテナンス料/;
/** 「■課税対象合計 630円 消費税等 10%」「■2025/ 2 1,553円 消費税等 10%」 */
const TAXABLE = /■\s*(?:課税対象合計|\d{4}\/\s*\d{1,2})\s*([\d,]+)\s*円/;
/** 機種のあとに続く機番（「IMC3500 630088」） */
const MODEL_AND_SERIAL = /\b((?:RICOH|IM|IMC|MP|MPC|DSC|LP|TASKalfa|bizhub|DocuCentre|Apeos)[A-Za-z0-9 -]*?)\s+(\d{6,})\b/i;
/** 明細ではない行（宛名・振込案内など）を落とす */
const SKIP = /請求書|内訳書|インボイス|お客様コード|お問合せ|登録番号|自動振替|口座振替|消費税区分|ページ|合計|小計/;

/** 設置場所らしい語尾。会社名や住所と取り違えないための手がかり */
const LOCATION_TAIL =
  /(本社|本店|支社|支店|営業所|事業所|工場|工事課|事務所|センター|店|課|部|室|校|館|寮|クリニック|病院)$/;

const num = (s: string): number => Number(s.replace(/,/g, "")) || 0;

interface Block {
  location: string;
  modelText?: string;
  serialNo?: string;
  makerText?: string;
  /** カウンター料金（税抜） */
  charge: number;
  /** 月額保守料金（税抜） */
  maintenance: number;
  /** 保守料金の品名を読んだ直後か（金額は次の行に来る） */
  pendingMaintenance?: boolean;
  evidence: string[];
}

const MAKER_WORDS: [RegExp, string][] = [
  [/リコー|RICOH/i, "リコー"],
  [/キヤノン|キャノン|CANON/i, "キヤノン"],
  [/京セラ|KYOCERA|TASKalfa/i, "京セラ"],
  [/シャープ|SHARP/i, "シャープ"],
  [/コニカ|KONICA|bizhub/i, "コニカミノルタ"],
  [/富士フイルム|FUJIFILM|ゼロックス|XEROX|DocuCentre|Apeos/i, "富士フイルム"],
  [/東芝|TOSHIBA/i, "東芝"],
];

function makerOf(text: string): string | undefined {
  for (const [re, name] of MAKER_WORDS) if (re.test(text)) return name;
  return undefined;
}

/** その行が設置場所の見出しか */
function locationOf(line: string): string | undefined {
  const s = line.trim();
  if (!s || s.length > 24 || SKIP.test(s)) return undefined;
  // 数字・記号だけの行、金額の入った行は設置場所ではない
  if (/[\d０-９]/.test(s) && !/^[^\d]+$/.test(s)) return undefined;
  if (/[：:（(]/.test(s)) return undefined;
  return LOCATION_TAIL.test(s) ? s : undefined;
}

/**
 * この書類が販売店の請求書・内訳書かどうか。
 * 設置場所ごとにパフォーマンスチャージが並ぶ形だけを対象にする。
 */
export function isDealerInvoice(lines: string[]): boolean {
  const text = lines.map(toHalfWidth).join("\n");
  if (!CHARGE.test(text)) return false;
  // メーカー直の明細（枚数と帯の単価が載る）はこちらでは扱わない
  if (/控除\s*\d+(?:\.\d+)?\s*%/.test(text)) return false;
  return /内訳書|請求書|代行請求/.test(text);
}

/**
 * 設置場所ごとのブロックに切り分ける。
 *
 * 伝票は「設置場所 → 契約書No. → 品名 → 金額」の順に並ぶので、
 * 設置場所の行が出てくるたびに新しいブロックを起こし、
 * 直後に出てくる機種・金額をそのブロックのものとして拾う。
 */
function toBlocks(lines: string[]): Block[] {
  const blocks: Block[] = [];
  const byLocation = new Map<string, Block>();
  let block: Block | undefined;
  /** 直前の行が「パフォーマンスチャージ」だったか（金額が次の行に来るため） */
  let inCharge = false;

  for (const raw of lines) {
    const line = toHalfWidth(raw).trim();
    if (!line) continue;

    const location = locationOf(line);
    if (location) {
      // 同じ設置場所が何度も出てくるので、1つにまとめる
      block = byLocation.get(location);
      if (!block) {
        block = { location, charge: 0, maintenance: 0, evidence: [] };
        byLocation.set(location, block);
        blocks.push(block);
      }
      inCharge = false;
      continue;
    }
    if (!block) continue;

    const model = line.match(MODEL_AND_SERIAL);
    if (model) {
      block.modelText ??= model[1].trim();
      block.serialNo ??= model[2];
      block.makerText ??= makerOf(line);
      block.evidence.push(line);
    } else if (!block.modelText) {
      // 機番が別行にある様式（「RICOH IM C3500F」だけの行）
      const maker = makerOf(line);
      if (maker && /[A-Za-z]\s*-?\s*[A-Za-z0-9]*\d/.test(line)) {
        block.modelText = line.replace(/^(RICOH|CANON|KYOCERA|SHARP|TOSHIBA)\s+/i, "").trim();
        block.makerText = maker;
        block.evidence.push(line);
      }
    }

    if (CHARGE.test(line)) {
      inCharge = true;
      block.evidence.push(line);
      // 「パフォーマンスチャージ … 630」と同じ行に金額がある様式
      const same = line.match(/([\d,]+)\s*$/);
      if (same) {
        block.charge += num(same[1]);
        inCharge = false;
      }
      continue;
    }

    const taxable = line.match(TAXABLE);
    if (taxable) {
      const amount = num(taxable[1]);
      if (inCharge) block.charge += amount;
      else if (block.pendingMaintenance) block.maintenance += amount;
      block.pendingMaintenance = false;
      inCharge = false;
      block.evidence.push(line);
      continue;
    }

    if (MAINTENANCE.test(line)) {
      block.pendingMaintenance = true;
      block.evidence.push(line);
    }
  }

  return blocks;
}

/**
 * 販売店の請求書から、台ごとの読み取り結果を作る。
 * この様式でなければ空配列を返す。
 */
export function parseDealerInvoice(doc: ExtractedDoc): CounterReading[] {
  const lines = doc.lines.filter((l) => l.trim());
  if (!lines.length || !isDealerInvoice(lines)) return [];

  return toBlocks(lines)
    // 金額も機種も拾えなかったブロックは、設置場所を拾い間違えた可能性が高い
    .filter((b) => b.charge > 0 || b.modelText)
    .map((b) => ({
      location: b.location,
      modelText: b.modelText,
      serialNo: b.serialNo,
      makerText: b.makerText,
      amount: b.charge || undefined,
      maintenanceMonthly: b.maintenance || undefined,
      confidence: b.modelText && b.charge ? 0.75 : 0.5,
      evidence: b.evidence.slice(0, 10),
    }));
}
