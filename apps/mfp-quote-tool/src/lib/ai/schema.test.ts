import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AiDocumentSchema, toCounterReadings, toLeaseReading, type AiDocument } from "./schema";

/** 未指定の項目をすべて null で埋めた土台 */
function doc(patch: Partial<AiDocument>): AiDocument {
  return {
    documentType: "unknown",
    makerText: null,
    modelText: null,
    lease: null,
    counters: [],
    transcript: [],
    notes: [],
    ...patch,
  };
}

const counter = (patch: Partial<AiDocument["counters"][number]>) => ({
  periodFrom: null,
  periodTo: null,
  modelText: null,
  serialNo: null,
  monoPages: null,
  colorPages: null,
  twoColorPages: null,
  monoUnit: null,
  colorUnit: null,
  twoColorUnit: null,
  amount: null,
  evidence: [],
  ...patch,
});

describe("AIの出力形式", () => {
  it("プロンプトに載せるJSONスキーマを生成できる（参照ではなく展開された形で）", () => {
    const schema = z.toJSONSchema(AiDocumentSchema, { reused: "inline" });
    const text = JSON.stringify(schema);
    // プロンプトに貼るので、$ref だと読み手（AI）が辿れない
    expect(text).not.toContain("$ref");
    expect(text).toContain("documentType");
    expect(text).toContain("remainingDebt");
    // 項目の説明が落ちていないこと
    expect(text).toContain("残債");
  });

  it("欠けた項目のあるJSONは受け取らない", () => {
    expect(AiDocumentSchema.safeParse({ documentType: "counter" }).success).toBe(false);
  });
});

describe("リース契約書の読み取り結果の取り込み", () => {
  it("金額・回数・日付を取り込み、確度を高く扱う", () => {
    const reading = toLeaseReading(
      doc({
        documentType: "schedule",
        lease: {
          lessor: "リコーリース株式会社",
          contractNo: "1234-5678",
          monthlyFee: 23_500,
          term: 60,
          startDate: "2021-04-01",
          endDate: "2026-03-31",
          itemText: "デジタル複合機",
          makerText: "京セラ",
          modelText: "TASKalfa 3554ci",
          remainingTerm: 8,
          remainingDebt: 188_000,
          evidence: ["月額リース料 23,500円"],
        },
      }),
    );
    expect(reading?.monthlyFee).toBe(23_500);
    expect(reading?.term).toBe(60);
    expect(reading?.endDate).toBe("2026-03-31");
    expect(reading?.remainingDebt).toBe(188_000);
    expect(reading?.confidence).toBeGreaterThan(0.9);
  });

  it("読めなかった項目（null）と、日付として不正な文字列は取り込まない", () => {
    const reading = toLeaseReading(
      doc({
        lease: {
          lessor: null,
          contractNo: null,
          monthlyFee: 18_000,
          term: null,
          startDate: "令和3年4月1日",
          endDate: null,
          itemText: null,
          makerText: null,
          modelText: null,
          remainingTerm: null,
          remainingDebt: 0,
          evidence: [],
        },
      }),
    );
    expect(reading?.startDate).toBeUndefined();
    expect(reading?.remainingDebt).toBeUndefined();
    expect(reading?.term).toBeUndefined();
    expect(reading?.monthlyFee).toBe(18_000);
  });

  it("リース情報が無い書類は undefined", () => {
    expect(toLeaseReading(doc({ documentType: "counter" }))).toBeUndefined();
  });
});

describe("カウンター明細の読み取り結果の取り込み", () => {
  it("期間ごとの明細をそのまま件数分取り込む", () => {
    const readings = toCounterReadings(
      doc({
        documentType: "counter",
        modelText: "TASKalfa 3554ci",
        counters: [
          counter({
            periodFrom: "2025-03-01",
            periodTo: "2025-03-31",
            monoPages: 4_200,
            colorPages: 1_100,
            monoUnit: 1.2,
            colorUnit: 12,
            amount: 18_240,
          }),
          counter({ periodFrom: "2025-04-01", periodTo: "2025-04-30", monoPages: 3_800, colorPages: 900 }),
        ],
      }),
    );
    expect(readings).toHaveLength(2);
    expect(readings[0].modelText).toBe("TASKalfa 3554ci");
    expect(readings[0].monoUnit).toBe(1.2);
    expect(readings[1].monoPages).toBe(3_800);
  });

  it("枚数も金額も読めていない行は捨てる", () => {
    const readings = toCounterReadings(
      doc({ counters: [counter({ periodFrom: "2025-03-01", monoUnit: 1.2 })] }),
    );
    expect(readings).toHaveLength(0);
  });

  it("単価としてありえない値は取り込まない（金額を単価欄に読んだ場合）", () => {
    const readings = toCounterReadings(doc({ counters: [counter({ monoPages: 1_000, monoUnit: 18_240 })] }));
    expect(readings[0].monoUnit).toBeUndefined();
    expect(readings[0].monoPages).toBe(1_000);
  });
});
