import { extractDocument } from "./parse/extract";
import { parseCounter, toMonthlyAverage } from "./parse/counter";
import { parseLease } from "./parse/lease";
import { looksLikeSchedule, parseSchedule } from "./parse/schedule";
import { detectMaker, extractModelCandidates } from "./parse/normalize";
import type { DocRole } from "./doc-roles";
import type { CounterReading, CurrentMachine, LeaseReading, Maker } from "./types";
import { MAKER_LABELS } from "./types";

export type { DocRole } from "./doc-roles";

export interface IngestedFile {
  name: string;
  kind: string;
  role: DocRole;
  /** 写真・スキャンPDFをOCRで読み取ったか */
  ocrUsed?: boolean;
  /** 読み取れたテキスト行数（確認用） */
  lineCount: number;
  parsedAt: string;
}

export interface IngestResult {
  files: IngestedFile[];
  lease: LeaseReading[];
  counter: CounterReading[];
  /** 読み取り結果から組み立てた現行機情報 */
  current: CurrentMachine;
  warnings: string[];
  /** 型番候補（画面で選ばせる） */
  modelCandidates: string[];
  makerGuess?: Maker;
}

const LEASE_HINTS = /(リース|賃貸借|物件|月額リース料|支払回数|検収|リース期間|賃貸人)/;
const COUNTER_HINTS = /(カウンター|検針|印刷枚数|使用枚数|モノクロ|フルカラー|指針|明細)/;

/** 書類の種類を推定する */
function classify(doc: { text: string }, fileName: string): DocRole {
  const target = `${fileName}\n${doc.text}`;
  if (/(支払予定表|返済予定表|償還予定表|支払明細表)/.test(target)) return "schedule";
  const leaseScore = (target.match(new RegExp(LEASE_HINTS, "g")) ?? []).length;
  const counterScore = (target.match(new RegExp(COUNTER_HINTS, "g")) ?? []).length;
  if (leaseScore === 0 && counterScore === 0) return "unknown";
  return leaseScore > counterScore ? "lease" : "counter";
}

/**
 * 契約書と支払予定表など、複数の書類から読めた項目を1つにまとめる。
 * 同じ項目は確度の高い書類の値を優先し、片方にしか無い項目は補い合う。
 */
function mergeLeaseReadings(readings: LeaseReading[]): LeaseReading | undefined {
  if (!readings.length) return undefined;
  const sorted = [...readings].sort((a, b) => b.confidence - a.confidence);
  const merged: LeaseReading = { ...sorted[0] };
  for (const r of sorted.slice(1)) {
    for (const key of Object.keys(r) as (keyof LeaseReading)[]) {
      if (key === "confidence" || key === "evidence") continue;
      if (merged[key] === undefined || merged[key] === "") {
        (merged as unknown as Record<string, unknown>)[key] = r[key];
      }
    }
    merged.evidence = [...(merged.evidence ?? []), ...(r.evidence ?? [])];
  }
  merged.confidence = Math.max(...readings.map((r) => r.confidence));
  return merged;
}

/** アップロードされた資料をまとめて解析し、現行機情報を組み立てる */
export async function ingestDocuments(
  inputs: { name: string; buffer: Buffer; mime?: string; role?: DocRole }[],
): Promise<IngestResult> {
  const files: IngestedFile[] = [];
  const leaseReadings: LeaseReading[] = [];
  const counterReadings: CounterReading[] = [];
  const warnings: string[] = [];
  const modelCandidates: string[] = [];
  let makerGuess: Maker | undefined;

  for (const input of inputs) {
    const doc = await extractDocument(input.name, input.buffer, input.mime);
    warnings.push(...doc.warnings);

    const role = input.role && input.role !== "unknown" ? input.role : classify(doc, input.name);
    files.push({
      name: doc.name,
      kind: doc.kind,
      role,
      ocrUsed: doc.ocrUsed,
      lineCount: doc.lines.length,
      parsedAt: new Date().toISOString(),
    });

    if (!doc.lines.length) continue;

    for (const m of extractModelCandidates(doc.text)) {
      if (!modelCandidates.includes(m)) modelCandidates.push(m);
    }
    makerGuess ??= detectMaker(doc.text);

    if (role === "schedule" || ((role === "lease" || role === "unknown") && looksLikeSchedule(doc))) {
      const schedule = parseSchedule(doc);
      if (schedule) leaseReadings.push(schedule);
      else if (role === "schedule") {
        warnings.push(`${doc.name}: 支払予定表として読み取れる表が見つかりませんでした。`);
      }
    }
    if (role === "lease" || role === "unknown") {
      const lease = parseLease(doc);
      if (lease) leaseReadings.push(lease);
    }
    if (role === "counter" || role === "unknown") {
      const readings = parseCounter(doc);
      counterReadings.push(...readings);
      if (role === "counter" && !readings.length) {
        warnings.push(`${doc.name}: カウンター明細として読み取れる行が見つかりませんでした。`);
      }
    }
  }

  const monthly = toMonthlyAverage(counterReadings);
  const bestLease = mergeLeaseReadings(leaseReadings);

  const modelText =
    counterReadings.find((r) => r.modelText)?.modelText ??
    bestLease?.modelText ??
    modelCandidates[0] ??
    "";

  const current: CurrentMachine = {
    makerText: bestLease?.makerText ?? (makerGuess ? MAKER_LABELS[makerGuess] : ""),
    modelText,
    monthlyLease: bestLease?.monthlyFee ?? 0,
    leaseTerm: bestLease?.term,
    leaseStart: bestLease?.startDate,
    leaseEnd: bestLease?.endDate,
    remainingDebt: bestLease?.remainingDebt,
    monoPages: monthly.monoPages,
    colorPages: monthly.colorPages,
    twoColorPages: monthly.twoColorPages,
    units: {
      mono: monthly.monoUnit ?? 0,
      color: monthly.colorUnit ?? 0,
      twoColor: monthly.twoColorUnit ?? 0,
      minCharge: 0,
    },
    maintenanceMonthly: 0,
  };

  if (!bestLease)
    warnings.push("リース契約書・支払予定表から契約条件を読み取れませんでした。手入力してください。");
  if (!counterReadings.length)
    warnings.push("印刷明細から枚数を読み取れませんでした。手入力してください。");

  return {
    files,
    lease: leaseReadings,
    counter: counterReadings,
    current,
    warnings,
    modelCandidates,
    makerGuess,
  };
}
