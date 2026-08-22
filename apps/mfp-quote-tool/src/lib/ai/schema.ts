import { z } from "zod";
import type { CounterReading, CurrentChargeLine, LeaseReading } from "../types";

/**
 * AI（Claude）に書類を読み取らせるときの出力形式と、その結果を
 * 既存の読み取り結果（LeaseReading / CounterReading）へ変換する処理。
 *
 * SDKを読み込まないため、テストから直接呼び出せる。
 */

/**
 * 読めなかった項目は推測させず null で返させる。
 * 項目ごとに新しいスキーマを作る（使い回すとJSONスキーマ側で説明文が落ちる）。
 */
const text = (description: string) => z.string().nullable().describe(description);
const num = (description: string) => z.number().nullable().describe(description);
const lines = (description: string) => z.array(z.string()).describe(description);

/** 逓減単価（パフォーマンスチャージ）の1段 */
const AiChargeTierSchema = z.object({
  from: z.number().describe("この帯の下限枚数（1ヶ月あたり）"),
  to: num("この帯の上限枚数。上限なしは null"),
  unit: z.number().describe("この帯の単価（円/枚）"),
});

/** 明細の区分1行（モノクロ／フルカラーコピー／フルカラープリント など） */
const AiChargeLineSchema = z.object({
  name: z.string().describe("明細に書かれている区分名（例: モノカラー総出力、フルカラープリント）"),
  kind: z
    .enum(["mono", "color", "twoColor", "other"])
    .describe("モノクロ=mono / フルカラー=color / 2色カラー=twoColor / それ以外=other"),
  pages: z.number().describe("この区分の月間カウント（控除前）"),
  deductionPercent: num("控除率（%）。「控除 3%の控除カウント」なら 3。無ければ null"),
  tiers: z.array(AiChargeTierSchema).describe("段階単価。一律単価なら1段だけ入れる"),
  amount: num("明細に書かれているこの区分の金額（円・税抜）"),
});

export const AiCounterSchema = z.object({
  periodFrom: text("この明細の対象期間の開始日（YYYY-MM-DD）"),
  periodTo: text("この明細の対象期間の終了日（YYYY-MM-DD）"),
  modelText: text("機種名・型番"),
  serialNo: text("製造番号・機番"),
  monoPages: num("モノクロ（白黒）の印刷枚数"),
  colorPages: num("フルカラーの印刷枚数"),
  twoColorPages: num("2色カラーの印刷枚数"),
  monoUnit: num("モノクロのカウンター単価（円・税抜）"),
  colorUnit: num("フルカラーのカウンター単価（円・税抜）"),
  twoColorUnit: num("2色カラーのカウンター単価（円・税抜）"),
  amount: num("この期間のカウンター料金合計（円・税抜）"),
  chargeLines: z
    .array(AiChargeLineSchema)
    .describe("段階単価（パフォーマンスチャージ）の明細。段や控除が無い明細では空配列にする"),
  evidence: lines("根拠になった書類上の行"),
});

export const AiLeaseSchema = z.object({
  lessor: text("リース会社（賃貸人）名"),
  contractNo: text("契約番号"),
  monthlyFee: num("月額リース料（円・税抜）"),
  term: num("支払回数（ヶ月）"),
  startDate: text("リース開始日（YYYY-MM-DD）"),
  endDate: text("リース満了日（YYYY-MM-DD）"),
  itemText: text("物件名（リース対象物の表記）"),
  makerText: text("メーカー名"),
  modelText: text("機種名・型番"),
  remainingTerm: num("残りの支払回数"),
  remainingDebt: num("残債（未経過リース料の残高・円・税抜）"),
  evidence: lines("根拠になった書類上の行"),
});

export const AiDocumentSchema = z.object({
  documentType: z
    .enum(["lease", "schedule", "counter", "unknown"])
    .describe("lease=リース契約書 / schedule=リース支払予定表 / counter=印刷明細（カウンター明細）"),
  makerText: text("書類から分かるメーカー名"),
  modelText: text("書類から分かる機種名・型番"),
  lease: AiLeaseSchema.nullable().describe("リース契約書・支払予定表から読めた内容"),
  counters: z.array(AiCounterSchema).describe("印刷明細から読めた期間ごとの内容（新しい順・古い順は問わない）"),
  transcript: lines("書類本文の書き起こし（1行1レコード）"),
  notes: lines("読み取れなかった箇所・判断に迷った箇所"),
});

export type AiDocument = z.infer<typeof AiDocumentSchema>;

/** 0以下・異常値を除いた正の数だけ採用する */
function positive(value: number | null, max = 1_000_000_000): number | undefined {
  if (value === null || !Number.isFinite(value) || value <= 0 || value > max) return undefined;
  return value;
}

function pages(value: number | null): number | undefined {
  const n = positive(value);
  return n === undefined ? undefined : Math.round(n);
}

function trimmed(value: string | null): string | undefined {
  const s = value?.trim();
  return s ? s : undefined;
}

/** YYYY-MM-DD だけを通す（YYYY-MM は月初として扱う） */
function isoDate(value: string | null): string | undefined {
  const s = value?.trim();
  if (!s) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}$/.test(s)) return `${s}-01`;
  return undefined;
}

export function toLeaseReading(doc: AiDocument): LeaseReading | undefined {
  const lease = doc.lease;
  if (!lease) return undefined;

  const monthlyFee = positive(lease.monthlyFee, 10_000_000);
  const term = positive(lease.term, 120);
  const startDate = isoDate(lease.startDate);
  const endDate = isoDate(lease.endDate);
  const reading: LeaseReading = {
    lessor: trimmed(lease.lessor),
    contractNo: trimmed(lease.contractNo),
    monthlyFee,
    term: term && term >= 12 ? Math.round(term) : undefined,
    startDate,
    endDate,
    itemText: trimmed(lease.itemText),
    makerText: trimmed(lease.makerText) ?? trimmed(doc.makerText),
    modelText: trimmed(lease.modelText) ?? trimmed(doc.modelText),
    remainingTerm: pages(lease.remainingTerm),
    remainingDebt: positive(lease.remainingDebt),
    // AIは表全体を見て判断できるため、行単位の正規表現より確度を高く扱う
    confidence: monthlyFee ? (term || endDate ? 0.95 : 0.8) : 0.6,
    evidence: lease.evidence.filter(Boolean).slice(0, 20),
  };
  // 何も読めていない場合は結果に含めない
  const hasValue = Object.entries(reading).some(
    ([k, v]) => k !== "confidence" && k !== "evidence" && v !== undefined,
  );
  return hasValue ? reading : undefined;
}

/** AIが読んだ段階単価の明細を、計算に使える形に直す */
function toChargeLines(
  input: AiDocument["counters"][number]["chargeLines"],
): CurrentChargeLine[] | undefined {
  const out: CurrentChargeLine[] = [];
  for (const line of input ?? []) {
    const pages = pages_(line.pages);
    const tiers = (line.tiers ?? [])
      .filter((t) => t.unit > 0 && t.from >= 0)
      .map((t) => ({ from: Math.round(t.from), to: t.to === null ? null : Math.round(t.to), unit: t.unit }))
      .sort((a, b) => a.from - b.from);
    if (pages === undefined || !tiers.length || !line.name?.trim()) continue;
    const percent = line.deductionPercent;
    out.push({
      name: line.name.trim(),
      kind: line.kind,
      pages,
      // 控除率は「3」（%）で来る。0〜20%の範囲だけ採用する
      deductionRate: percent !== null && percent > 0 && percent <= 20 ? percent / 100 : undefined,
      tiers,
      amount: positive(line.amount),
    });
  }
  return out.length ? out : undefined;
}

const pages_ = pages;

export function toCounterReadings(doc: AiDocument): CounterReading[] {
  const out: CounterReading[] = [];
  for (const c of doc.counters) {
    const reading: CounterReading = {
      modelText: trimmed(c.modelText) ?? trimmed(doc.modelText),
      serialNo: trimmed(c.serialNo),
      periodFrom: isoDate(c.periodFrom),
      periodTo: isoDate(c.periodTo),
      monoPages: pages(c.monoPages),
      colorPages: pages(c.colorPages),
      twoColorPages: pages(c.twoColorPages),
      monoUnit: positive(c.monoUnit, 100),
      colorUnit: positive(c.colorUnit, 100),
      twoColorUnit: positive(c.twoColorUnit, 100),
      amount: positive(c.amount),
      chargeLines: toChargeLines(c.chargeLines),
      confidence: 0.9,
      evidence: c.evidence.filter(Boolean).slice(0, 20),
    };
    // 枚数も金額も読めていない行は捨てる
    if (
      reading.monoPages === undefined &&
      reading.colorPages === undefined &&
      reading.twoColorPages === undefined &&
      reading.amount === undefined &&
      !reading.chargeLines
    ) {
      continue;
    }
    out.push(reading);
  }
  return out;
}
