import type { LeaseReading } from "../types";
import type { ExtractedDoc } from "./extract";
import {
  addMonths,
  detectMaker,
  extractModelCandidates,
  parseJpDate,
  parseNumber,
  remainingMonths,
  toHalfWidth,
} from "./normalize";
import { MAKER_LABELS } from "../types";

const LESSORS = [
  "アプラス",
  "三菱HCキャピタル",
  "東京センチュリー",
  "オリックス",
  "芙蓉総合リース",
  "JA三井リース",
  "NECキャピタルソリューション",
  "リコーリース",
  "みずほリース",
  "NTTファイナンス",
  "日立キャピタル",
  "富士通リース",
  "西日本リース",
  "セイコーリース",
  "エヌ・ティ・ティ・ファイナンス",
];

/** リース契約書から契約条件を読み取る */
export function parseLease(doc: ExtractedDoc): LeaseReading | null {
  const lines = doc.lines.map((l) => toHalfWidth(l));
  if (!lines.length) return null;

  const reading: LeaseReading = { confidence: 0, evidence: [] };
  const evidence: string[] = [];
  let score = 0;

  const joined = lines.join("\n");

  // リース会社
  const lessor = LESSORS.find((name) => joined.includes(name));
  if (lessor) {
    reading.lessor = lessor;
    score += 1;
  } else {
    const m = joined.match(/(?:賃貸人|リース会社|貸主)\s*[:：]?\s*(\S{3,30})/);
    if (m) {
      reading.lessor = m[1];
      score += 0.5;
    }
  }

  for (const line of lines) {
    // 契約番号
    if (!reading.contractNo) {
      const m = line.match(/(?:契約番号|契約No\.?|物件番号|お客様番号)\s*[:：]?\s*([A-Z0-9-]{4,})/i);
      if (m) {
        reading.contractNo = m[1];
        evidence.push(line);
        score += 0.5;
      }
    }

    // 月額リース料
    if (!reading.monthlyFee) {
      const m = line.match(
        /(?:月額リース料|リース料\s*\(?月額\)?|月額料金|毎月のお支払[額い]?|月額)\s*[:：]?\s*[¥\\]?\s*([\d,]+)/,
      );
      if (m) {
        const v = parseNumber(m[1]);
        if (v && v >= 1000) {
          reading.monthlyFee = v;
          evidence.push(line);
          score += 1;
        }
      }
    }

    // 支払回数 / リース期間
    if (!reading.term) {
      const m = line.match(/(?:支払回数|リース期間|期間|回数)\s*[:：]?\s*(\d{1,3})\s*(?:回|ヶ月|カ月|か月|ヵ月|月)/);
      if (m) {
        const v = Number(m[1]);
        if (v >= 12 && v <= 120) {
          reading.term = v;
          evidence.push(line);
          score += 1;
        }
      }
    }

    // 開始日
    if (!reading.startDate && /(リース開始日|開始日|検収日|契約日|リース開始)/.test(line)) {
      const d = parseJpDate(line);
      if (d) {
        reading.startDate = d;
        evidence.push(line);
        score += 0.5;
      }
    }

    // 満了日
    if (!reading.endDate && /(満了日|終了日|リース期日|期間満了)/.test(line)) {
      const d = parseJpDate(line);
      if (d) {
        reading.endDate = d;
        evidence.push(line);
        score += 0.5;
      }
    }

    // 物件
    if (!reading.itemText) {
      const m = line.match(/(?:物件名|物件の?表示|品名|機種名?)\s*[:：]?\s*(.{3,60})/);
      if (m) {
        reading.itemText = m[1].trim();
        evidence.push(line);
        score += 0.5;
      }
    }
  }

  // 物件表記からメーカー・型番を推定する
  const modelSource = `${reading.itemText ?? ""}\n${joined}`;
  const maker = detectMaker(modelSource);
  if (maker) reading.makerText = MAKER_LABELS[maker];
  const models = extractModelCandidates(modelSource);
  if (models.length) reading.modelText = models[0];

  // 満了日が無ければ 開始日 + 回数 から算出
  if (!reading.endDate && reading.startDate && reading.term) {
    reading.endDate = addMonths(reading.startDate, reading.term);
  }
  if (reading.endDate) reading.remainingTerm = remainingMonths(reading.endDate);

  if (!reading.monthlyFee && !reading.term) return null;

  reading.evidence = evidence;
  reading.confidence = Math.min(1, score / 3);
  return reading;
}
