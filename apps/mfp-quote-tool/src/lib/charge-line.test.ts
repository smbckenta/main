import { describe, expect, it } from "vitest";
import { calcChargeLine, calcCurrent, calcProposal } from "./pricing";
import { renderCompareHtml, renderMultiCompareHtml } from "./export/html";
import { DEFAULT_SETTINGS } from "./defaults";
import type { CurrentChargeLine, Proposal, Quote } from "./types";

/**
 * 実物の明細（リコー MPC3003SP／2026年5月分／請求 9,937円）で検算する。
 * この方式は丸め方を1つ間違えるだけで明細と合わなくなるため、
 * 区分ごとの金額と合計の両方を突き合わせる。
 */
const mono: CurrentChargeLine = {
  name: "モノカラー総出力",
  kind: "mono",
  pages: 1_389,
  deductionRate: 0.02,
  tiers: [
    { from: 1, to: 1_000, unit: 3.0 },
    { from: 1_001, to: 2_000, unit: 2.6 },
  ],
  amount: 3_938,
};

const colorCopy: CurrentChargeLine = {
  name: "フルカラーコピー",
  kind: "color",
  pages: 53,
  deductionRate: 0.03,
  tiers: [{ from: 1, to: 1_000, unit: 16.8 }],
  amount: 856,
};

const colorPrint: CurrentChargeLine = {
  name: "フルカラープリント",
  kind: "color",
  pages: 382,
  deductionRate: 0.03,
  tiers: [{ from: 1, to: 1_000, unit: 13.9 }],
  amount: 5_143,
};

describe("逓減単価（パフォーマンスチャージ）の計算", () => {
  it("控除カウントは切り上げる", () => {
    // 382 × 3% = 11.46。四捨五入(11)では明細と合わない
    expect(calcChargeLine(colorPrint).deduction).toBe(12);
    expect(calcChargeLine(mono).deduction).toBe(28);
    expect(calcChargeLine(colorCopy).deduction).toBe(2);
  });

  it("段は上の帯から順に埋める", () => {
    const calc = calcChargeLine(mono);
    expect(calc.billablePages).toBe(1_361);
    expect(calc.bands.map((b) => b.pages)).toEqual([1_000, 361]);
    expect(calc.bands.map((b) => b.amount)).toEqual([3_000, 938]);
  });

  it("金額は帯ごとに切り捨てる（先に合計すると1円ずれる）", () => {
    // 361 × 2.6 = 938.6 → 938
    expect(calcChargeLine(mono).amount).toBe(3_938);
    // 51 × 16.8 = 856.8 → 856
    expect(calcChargeLine(colorCopy).amount).toBe(856);
    expect(calcChargeLine(colorPrint).amount).toBe(5_143);
  });

  it("明細に書かれた金額と一致する（差額0）", () => {
    for (const line of [mono, colorCopy, colorPrint]) {
      expect(calcChargeLine(line).amountDiff).toBe(0);
    }
  });

  it("実効単価は控除のぶん名目より安くなる", () => {
    expect(calcChargeLine(mono).effectiveUnit).toBe(2.84); // 名目 3.0円
    expect(calcChargeLine(colorCopy).effectiveUnit).toBe(16.15); // 名目 16.8円
    expect(calcChargeLine(colorPrint).effectiveUnit).toBe(13.46); // 名目 13.9円
  });

  it("上限のない帯は残り全部に適用する", () => {
    const calc = calcChargeLine({
      name: "モノクロ",
      kind: "mono",
      pages: 5_000,
      tiers: [
        { from: 1, to: 1_000, unit: 3.0 },
        { from: 1_001, to: null, unit: 2.0 },
      ],
    });
    expect(calc.bands.map((b) => b.pages)).toEqual([1_000, 4_000]);
    expect(calc.amount).toBe(3_000 + 8_000);
  });
});

describe("現行機の月間経費（逓減単価の明細がある場合）", () => {
  const quote = (): Quote => ({
    id: "q",
    title: "複合機入替のご提案",
    customerName: "ヤハタ木工有限会社",
    customerHonorific: "様",
    quoteNo: "137240",
    quoteDate: "2026-08-22",
    area: "福岡",
    current: {
      makerText: "リコー",
      modelText: "MPC3003SP",
      monthlyLease: 0,
      monoPages: 1_389,
      colorPages: 435,
      twoColorPages: 0,
      chargeLines: [mono, colorCopy, colorPrint],
      units: { mono: 0, color: 0, twoColor: 0, minCharge: 0 },
      maintenanceMonthly: 0,
    },
    proposals: [],
    createdAt: "",
    updatedAt: "",
  });

  it("カウンター請求額は明細の合計（9,937円）になる", () => {
    const calc = calcCurrent(quote(), 0.1);
    expect(calc.counter.total).toBe(9_937);
    expect(calc.chargeLines).toHaveLength(3);
  });

  it("3区分の内訳にもまとめ直す（フルカラーはコピーとプリントを合算）", () => {
    const calc = calcCurrent(quote(), 0.1);
    expect(calc.counter.monoAmount).toBe(3_938);
    expect(calc.counter.colorAmount).toBe(856 + 5_143);
  });

  it("総印刷枚数は区分の合計になる", () => {
    expect(calcCurrent(quote(), 0.1).totalPages).toBe(1_389 + 53 + 382);
  });

  it("明細が無い案件はこれまでどおり単価×枚数で計算する", () => {
    const q = quote();
    q.current.chargeLines = undefined;
    q.current.units = { mono: 1.2, color: 12, twoColor: 0, minCharge: 0 };
    const calc = calcCurrent(q, 0.1);
    expect(calc.chargeLines).toBeUndefined();
    expect(calc.counter.total).toBe(Math.round(1_389 * 1.2 + 435 * 12));
  });
});

describe("比較表への出し方", () => {
  const quote = (): Quote => ({
    id: "q",
    title: "複合機入替のご提案",
    customerName: "ヤハタ木工有限会社",
    customerHonorific: "様",
    quoteNo: "137240",
    quoteDate: "2026-08-22",
    area: "福岡",
    current: {
      makerText: "リコー",
      modelText: "MPC3003SP",
      monthlyLease: 12_000,
      monoPages: 1_389,
      colorPages: 435,
      twoColorPages: 0,
      chargeLines: [mono, colorCopy, colorPrint],
      units: { mono: 0, color: 0, twoColor: 0, minCharge: 0 },
      maintenanceMonthly: 0,
    },
    proposals: [],
    createdAt: "",
    updatedAt: "",
  });

  const proposal: Proposal = {
    id: "p1",
    maker: "KYOCERA",
    modelText: "TASKalfa 2554ci",
    qty: 1,
    items: [{ name: "本体", qty: 1, unit: "台", unitPrice: 1_180_000 }],
    cost: 380_000,
    pricingMode: "fromGp",
    grossProfitAmount: 300_000,
    leaseTerm: 72,
    counterOverridden: false,
    maintenanceMonthly: 0,
  };
  const makerNote = {
    counterMono: [0.4, 0.8] as [number, number],
    counterColor: [4, 8] as [number, number],
    minCharge: 2000,
  };

  const render = () => {
    const q = quote();
    q.proposals = [proposal];
    const current = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
    const calc = calcProposal(q, proposal, DEFAULT_SETTINGS, { makerNote });
    return { q, current, calc };
  };

  it("区分ごとに行が増え、段の内訳も出る", () => {
    const { q, current, calc } = render();
    const html = renderCompareHtml(q, current, calc, DEFAULT_SETTINGS);
    expect(html).toContain("モノカラー総出力");
    expect(html).toContain("フルカラーコピー");
    expect(html).toContain("フルカラープリント");
    // 段の内訳（1〜1,000枚 3円 / 1,001〜2,000枚 2.6円）
    expect(html).toContain("1〜1,000枚");
    expect(html).toContain("1,001〜2,000枚");
    // 控除と実効単価を併記する
    expect(html).toContain("控除 28枚");
    expect(html).toContain("実効 2.84円");
  });

  it("各社同時比較では、現状の単価は実効単価で並べる（名目や0円にしない）", () => {
    const { q, current, calc } = render();
    const html = renderMultiCompareHtml(q, current, [calc], DEFAULT_SETTINGS);
    expect(html).toContain("モノクロ単価（現状は実効）");
    expect(html).toContain("2.84円");
    // フルカラーはコピーとプリントを合算した実効単価 (856+5,143)÷435
    expect(html).toContain("13.79円");
    expect(html).not.toContain("<td class=\"num\">0円</td>");
  });
});
