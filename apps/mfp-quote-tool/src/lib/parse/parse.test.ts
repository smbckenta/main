import { describe, expect, it } from "vitest";
import { parseCounter, toMonthlyAverage } from "./counter";
import { parseLease } from "./lease";
import { detectMaker, extractModelCandidates, parseJpDate, parseNumber, remainingMonths } from "./normalize";
import type { ExtractedDoc } from "./extract";

const doc = (lines: string[]): ExtractedDoc => ({
  name: "test.pdf",
  kind: "pdf",
  lines,
  text: lines.join("\n"),
  warnings: [],
});

describe("正規化", () => {
  it("全角数字・カンマ付き金額を数値にする", () => {
    expect(parseNumber("１２，３４５円")).toBe(12345);
    expect(parseNumber("¥1,650,000")).toBe(1650000);
    expect(parseNumber("0.7")).toBe(0.7);
  });

  it("和暦・西暦の日付を YYYY-MM-DD に揃える", () => {
    expect(parseJpDate("令和6年4月1日")).toBe("2024-04-01");
    expect(parseJpDate("R7.10.1")).toBe("2025-10-01");
    expect(parseJpDate("2026年4月30日")).toBe("2026-04-30");
    expect(parseJpDate("平成31年1月5日")).toBe("2019-01-05");
  });

  it("満了日までの残回数を求める", () => {
    expect(remainingMonths("2027-08-01", new Date("2026-08-22T00:00:00Z"))).toBe(12);
    expect(remainingMonths("2020-01-01", new Date("2026-08-22T00:00:00Z"))).toBe(0);
  });

  it("メーカーと型番を推定する", () => {
    expect(detectMaker("京セラ TASKalfa MZ2501ci")).toBe("KYOCERA");
    expect(detectMaker("bizhub C220 コニカミノルタ")).toBe("KONICA_MINOLTA");
    expect(detectMaker("RICOH IM C3000F")).toBe("RICOH");
    expect(extractModelCandidates("物件 TASKalfa MZ3501ci 本体")[0]).toContain("TASKALFA MZ3501CI");
  });
});

describe("印刷明細の読み取り", () => {
  it("前回指針・今回指針・枚数・単価・金額の並びを解釈する", () => {
    const readings = parseCounter(
      doc([
        "ご請求期間 2026年4月1日 ～ 2026年4月30日",
        "機番: ABC1234567",
        "機種： bizhub C220",
        "区分 前回指針 今回指針 使用枚数 単価 金額",
        "モノクロ 120,000 123,000 3,000 1.50 4,500",
        "フルカラー 50,000 52,000 2,000 15.00 30,000",
        "2色カラー 10,000 11,500 1,500 8.00 12,000",
        "ご請求金額合計 46,500",
      ]),
    );
    expect(readings).toHaveLength(1);
    const r = readings[0];
    expect(r.serialNo).toBe("ABC1234567");
    expect(r.monoPages).toBe(3000);
    expect(r.colorPages).toBe(2000);
    expect(r.twoColorPages).toBe(1500);
    expect(r.monoUnit).toBe(1.5);
    expect(r.colorUnit).toBe(15);
    expect(r.twoColorUnit).toBe(8);
    expect(r.amount).toBe(46_500);
    expect(r.confidence).toBeGreaterThan(0.7);
  });

  it("段階単価（チャージ枚数別）は加重平均単価にまとめる", () => {
    const readings = parseCounter(
      doc([
        "項目 チャージ枚数 単価 印刷枚数 金額",
        "モノクロ 1～1,000 1.20 1,000 枚 1,200",
        "モノクロ 1001～ 1.00 1,000 枚 1,000",
        "フルカラー 1～ 11.00 500 枚 5,500",
      ]),
    );
    const r = readings[0];
    expect(r.monoPages).toBe(2000);
    expect(r.monoUnit).toBe(1.1); // (1,200+1,000)/2,000
    expect(r.colorPages).toBe(500);
  });

  it("複数機番の明細は機械ごとに読み取る", () => {
    const readings = parseCounter(
      doc([
        "機番: AAA1111111",
        "モノクロ 2,000 1.00 2,000",
        "カラー 500 10.00 5,000",
        "機番: BBB2222222",
        "モノクロ 1,000 1.00 1,000",
        "カラー 300 10.00 3,000",
      ]),
    );
    expect(readings).toHaveLength(2);
    expect(readings[0].serialNo).toBe("AAA1111111");
    expect(readings[1].monoPages).toBe(1000);
  });

  it("3ヶ月分の明細から月間平均を出す", () => {
    const monthly = toMonthlyAverage([
      { periodFrom: "2026-01-01", periodTo: "2026-01-31", monoPages: 3000, colorPages: 2000, confidence: 1 },
      { periodFrom: "2026-02-01", periodTo: "2026-02-28", monoPages: 3300, colorPages: 1800, confidence: 1 },
      { periodFrom: "2026-03-01", periodTo: "2026-03-31", monoPages: 2700, colorPages: 2200, confidence: 1 },
    ]);
    expect(monthly.monoPages).toBe(3000);
    expect(monthly.colorPages).toBe(2000);
  });

  it("カウンター行が無ければ何も返さない", () => {
    expect(parseCounter(doc(["御請求書", "合計 12,345 円"]))).toHaveLength(0);
  });
});

describe("リース契約書の読み取り", () => {
  it("リース会社・月額・回数・開始日を読み取り、満了日を算出する", () => {
    const lease = parseLease(
      doc([
        "リース契約書",
        "賃貸人 株式会社アプラス",
        "契約番号： LS-2021-004567",
        "物件名： コニカミノルタ bizhub C220 一式",
        "月額リース料 15,000 円（税別）",
        "支払回数 60 回",
        "リース開始日 令和3年10月1日",
      ]),
    );
    expect(lease).not.toBeNull();
    expect(lease!.lessor).toBe("アプラス");
    expect(lease!.contractNo).toBe("LS-2021-004567");
    expect(lease!.monthlyFee).toBe(15_000);
    expect(lease!.term).toBe(60);
    expect(lease!.startDate).toBe("2021-10-01");
    expect(lease!.endDate).toBe("2026-10-01");
    expect(lease!.makerText).toBe("コニカミノルタ");
  });

  it("リース情報が無い書類では null を返す", () => {
    expect(parseLease(doc(["納品書", "商品 コピー用紙 A4 10箱"]))).toBeNull();
  });
});
