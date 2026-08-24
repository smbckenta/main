import { describe, expect, it } from "vitest";
import type { ExtractedDoc } from "./extract";
import { parseCounter } from "./counter";
import { parsePerformanceCharge } from "./performance-charge";

/**
 * 実物（リコー「サービス料金計算明細」ヤハタ木工有限会社様 2026年5月分）を
 * そのまま書き起こしたもの。合計 9,937円まで一致することを確かめる。
 */
const RICOH_LINES = [
  "サービス料金計算明細",
  "RICOH",
  "ページ 1 / 1",
  "2026年 5月31日",
  "ヤハタ木工有限会社 様",
  "下記の通りご請求申し上げます。",
  "ご請求金額 2026年5月 ご利用分",
  "（税抜き） 9，937円",
  "（株）かがし屋日田店",
  "80210129433/20260610/D81",
  "==================【ご利用サービス】==================",
  "ご利用サービス種別 ご利用金額",
  "パフォーマンスチャージ 9,937",
  "==================【ご契約情報】==================",
  "・トナー込み契約です。",
  "ＭＰＣ３００３ＳＰ 今回検針内容 前回検針内容 ご使用カウント",
  "機番：664971 5月31日 4月30日",
  "モノカラー総出力 267,304 カウント 265,915 カウント 1,389 カウント",
  "フルカラー総出力 ① 68,266 カウント 67,831 カウント 435 カウント",
  "フルカラーコピー （①-②） 6,965 カウント 6,912 カウント 53 カウント",
  "フルカラープリント ② 61,301 カウント 60,919 カウント 382 カウント",
  "==================【ご利用金額内訳】==================",
  "パフォーマンスチャージ 単価／金額 カウント／月／率 内訳金額",
  "モノカラー総出力 1,389カウント",
  "控除 2%の控除カウント 28カウント",
  "請求カウント 1,361カウント",
  "1- 1000 ／月 3.0円 1,000カウント 3,000円",
  "1001- 2000 ／月 2.6円 361カウント 938円",
  "フルカラーコピー 53カウント",
  "控除 3%の控除カウント 2カウント",
  "請求カウント 51カウント",
  "1- 1000 ／月 16.8円 51カウント 856円",
  "フルカラープリント 382カウント",
  "控除 3%の控除カウント 12カウント",
  "請求カウント 370カウント",
  "1- 1000 ／月 13.9円 370カウント 5,143円",
  "合計（税抜き） 9,937円",
];

const doc = (lines: string[]): ExtractedDoc => ({
  name: "複合機カウンター明細.jpg",
  kind: "image",
  ocrUsed: true,
  lines,
  text: lines.join("\n"),
  warnings: [],
});

describe("パフォーマンスチャージ明細（リコー）", () => {
  const [reading] = parsePerformanceCharge(doc(RICOH_LINES));

  it("区分を3つとも拾う（総出力の小計は取り込まない）", () => {
    expect(reading.chargeLines?.map((c) => c.name)).toEqual([
      "モノカラー総出力",
      "フルカラーコピー",
      "フルカラープリント",
    ]);
  });

  it("モノクロは1,389カウント・控除2%・2段の単価", () => {
    const mono = reading.chargeLines![0];
    expect(mono.kind).toBe("mono");
    expect(mono.pages).toBe(1389);
    expect(mono.deductionRate).toBe(0.02);
    expect(mono.tiers).toEqual([
      { from: 1, to: 1000, unit: 3.0 },
      { from: 1001, to: 2000, unit: 2.6 },
    ]);
    expect(mono.amount).toBe(3938);
  });

  it("フルカラーはコピーとプリントを分けて持つ（単価が違うため合算しない）", () => {
    const [, copy, print] = reading.chargeLines!;
    expect(copy.kind).toBe("color");
    expect(copy.pages).toBe(53);
    expect(copy.deductionRate).toBe(0.03);
    expect(copy.tiers).toEqual([{ from: 1, to: 1000, unit: 16.8 }]);
    expect(copy.amount).toBe(856);

    expect(print.kind).toBe("color");
    expect(print.pages).toBe(382);
    expect(print.deductionRate).toBe(0.03);
    expect(print.tiers).toEqual([{ from: 1, to: 1000, unit: 13.9 }]);
    expect(print.amount).toBe(5143);
  });

  it("画面に出る枚数・実効単価・合計が明細と合う", () => {
    expect(reading.monoPages).toBe(1389);
    expect(reading.colorPages).toBe(435); // 53 + 382
    expect(reading.twoColorPages).toBeUndefined();
    // 3,938円 ÷ 1,389枚
    expect(reading.monoUnit).toBeCloseTo(2.84, 2);
    // 5,999円 ÷ 435枚
    expect(reading.colorUnit).toBeCloseTo(13.79, 2);
    expect(reading.amount).toBe(9937);
  });

  it("内訳金額の合計が明細の合計と一致する", () => {
    const sum = reading.chargeLines!.reduce((s, c) => s + (c.amount ?? 0), 0);
    expect(sum).toBe(9937);
  });

  it("機種・機番・対象期間を拾う", () => {
    expect(reading.modelText).toBe("MPC3003SP");
    expect(reading.serialNo).toBe("664971");
    expect(reading.periodFrom).toBe("2026-05-01");
    expect(reading.periodTo).toBe("2026-05-31");
  });

  it("カウンター明細の読み取り全体からも同じ結果になる", () => {
    const [r] = parseCounter(doc(RICOH_LINES));
    expect(r.monoPages).toBe(1389);
    expect(r.colorPages).toBe(435);
    expect(r.amount).toBe(9937);
  });
});

describe("OCRの崩れに耐える", () => {
  it("全角の数字・記号でも読める", () => {
    const zenkaku = RICOH_LINES.map((l) =>
      l.replace(/[0-9]/g, (d) => String.fromCharCode(d.charCodeAt(0) + 0xfee0)).replace(/\//g, "／"),
    );
    const [r] = parsePerformanceCharge(doc(zenkaku));
    expect(r.monoPages).toBe(1389);
    expect(r.amount).toBe(9937);
  });

  it("【ご利用金額内訳】の見出しが読めなくても、指針の累計は取り込まない", () => {
    const noHeader = RICOH_LINES.filter((l) => !/ご利用金額内訳/.test(l));
    const [r] = parsePerformanceCharge(doc(noHeader));
    // 267,304 のような指針が枚数として混ざっていないこと
    expect(r.monoPages).toBe(1389);
    expect(r.colorPages).toBe(435);
    expect(r.amount).toBe(9937);
  });

  it("パフォーマンスチャージ様式でなければ手を出さない", () => {
    expect(parsePerformanceCharge(doc(["モノクロ 1,000枚 1.0円 1,000円"]))).toEqual([]);
  });
});

describe("読み取った明細が、そのまま現行のカウンター料金になる", () => {
  it("計算した合計が明細の 9,937円 と一致する", async () => {
    const { calcChargeLines } = await import("../pricing");
    const [reading] = parsePerformanceCharge(doc(RICOH_LINES));
    const total = calcChargeLines(reading.chargeLines!).reduce((s, l) => s + l.amount, 0);
    expect(total).toBe(9937);
  });
});

describe("OCRが行をつなげた・崩した場合", () => {
  it("区分名と控除が1行になっていても読める", () => {
    const merged = [
      "==================【ご利用金額内訳】==================",
      "モノカラー総出力 1,389カウント 控除 2%の控除カウント 28カウント 請求カウント 1,361カウント",
      "1- 1000 ／月 3.0円 1,000カウント 3,000円",
      "1001- 2000 ／月 2.6円 361カウント 938円",
      "合計（税抜き） 3,938円",
    ];
    const [r] = parsePerformanceCharge(doc(merged));
    const mono = r.chargeLines![0];
    expect(mono.name).toBe("モノカラー総出力");
    expect(mono.pages).toBe(1389);
    expect(mono.deductionRate).toBe(0.02);
  });

  it("「控除 2%」が読めなくても、請求カウントとの差から控除率を割り出す", () => {
    const noPercent = RICOH_LINES.filter((l) => !DEDUCTION_LINE.test(l));
    const [r] = parsePerformanceCharge(doc(noPercent));
    const [mono, copy, print] = r.chargeLines!;
    expect(mono.deductionRate).toBe(0.02); // 1,389 → 1,361
    expect(copy.deductionRate).toBe(0.03); // 53 → 51
    expect(print.deductionRate).toBe(0.03); // 382 → 370
  });

  it("控除率を割り出せた明細も、計算した合計が 9,937円 になる", async () => {
    const { calcChargeLines } = await import("../pricing");
    const noPercent = RICOH_LINES.filter((l) => !DEDUCTION_LINE.test(l));
    const [r] = parsePerformanceCharge(doc(noPercent));
    const total = calcChargeLines(r.chargeLines!).reduce((s, l) => s + l.amount, 0);
    expect(total).toBe(9937);
  });
});

const DEDUCTION_LINE = /控除\s*\d+(?:\.\d+)?\s*%/;
