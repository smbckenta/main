import { describe, expect, it } from "vitest";
import { calcCounter, calcCurrent, calcProposal, deductPages } from "./pricing";
import { renderCompareHtml, renderMultiCompareHtml } from "./export/html";
import { DEFAULT_SETTINGS } from "./defaults";
import type { Proposal, Quote } from "./types";

/**
 * ミスプリント控除（「1%控除」「2%控除」）の扱い。
 *
 * リコー・キヤノン等の現行契約では印刷枚数そのものが一律で差し引かれるが、
 * 当社の提案にはこの控除が無い。控除を提案側にも掛けてしまうと
 * 提案が実際より安く見え、導入後に「話が違う」となるため、
 * 控除は現行の計算にだけ効かせる。
 */

const quote = (): Quote => ({
  id: "q",
  title: "複合機入替のご提案",
  customerName: "テスト商事",
  customerHonorific: "御中",
  quoteNo: "137240",
  quoteDate: "2026-08-22",
  area: "福岡",
  current: {
    makerText: "リコー",
    modelText: "MPC3003SP",
    monthlyLease: 0,
    monoPages: 1_000,
    colorPages: 1_000,
    twoColorPages: 0,
    deductionRate: 0.02,
    units: { mono: 1, color: 10, twoColor: 0, minCharge: 0 },
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
  // 単価は自動判定に任せず、例示どおり モノクロ0.5円／カラー5.0円 で比較する
  counterOverridden: true,
  units: { mono: 0.5, color: 5, twoColor: 0, minCharge: 0 },
  maintenanceMonthly: 0,
};

describe("控除後の請求枚数", () => {
  it("控除カウントは切り上げる（1,000枚の2%は20枚）", () => {
    expect(deductPages(1_000, 0.02)).toEqual({ billable: 980, deduction: 20 });
    // 端数は切り上げ。382枚の3%は11.46枚 → 12枚
    expect(deductPages(382, 0.03)).toEqual({ billable: 370, deduction: 12 });
  });

  it("控除が無ければ枚数はそのまま", () => {
    expect(deductPages(1_000)).toEqual({ billable: 1_000, deduction: 0 });
    expect(deductPages(1_000, 0)).toEqual({ billable: 1_000, deduction: 0 });
  });
});

describe("控除ありの現行と、控除なしの提案を比べる", () => {
  it("現行は控除後の枚数で計算する（モノクロ980枚・カラー980枚）", () => {
    const calc = calcCurrent(quote(), DEFAULT_SETTINGS.company.taxRate);
    expect(calc.counter.monoAmount).toBe(980); // 980枚 × 1円
    expect(calc.counter.colorAmount).toBe(9_800); // 980枚 × 10円
    expect(calc.counter.total).toBe(10_780);
    expect(calc.counter.deduction).toMatchObject({ rate: 0.02, mono: 20, color: 20, total: 40 });
  });

  it("提案は控除なしの実枚数で計算する（1,000枚のまま）", () => {
    const q = quote();
    q.proposals = [proposal];
    const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);
    expect(calc.counter.monoAmount).toBe(500); // 1,000枚 × 0.5円
    expect(calc.counter.colorAmount).toBe(5_000); // 1,000枚 × 5円
    expect(calc.counter.total).toBe(5_500);
    // 提案側に控除の内訳は付かない
    expect(calc.counter.deduction).toBeUndefined();
  });

  it("控除を提案側にも掛けてしまっていないこと（5,390円にならない）", () => {
    const q = quote();
    q.proposals = [proposal];
    const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);
    expect(calc.counter.total).not.toBe(5_390); // 980枚で計算した場合の額
  });

  it("控除が無い現行なら、現行も実枚数のまま", () => {
    const q = quote();
    q.current.deductionRate = undefined;
    const calc = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
    expect(calc.counter.total).toBe(11_000); // 1,000×1 + 1,000×10
    expect(calc.counter.deduction).toBeUndefined();
  });
});

describe("控除の書き方（比較表）", () => {
  const render = () => {
    const q = quote();
    q.proposals = [proposal];
    const current = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
    const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);
    return { q, current, calc };
  };

  it("比較表に、現行だけ控除がかかっている旨を書く", () => {
    const { q, current, calc } = render();
    const html = renderCompareHtml(q, current, calc, DEFAULT_SETTINGS);
    expect(html).toContain("控除（2%）");
    expect(html).toContain("ブラック 980枚");
    expect(html).toContain("ご提案する複合機には控除がございません");
  });

  it("各社同時比較にも同じ注記を出す", () => {
    const { q, current, calc } = render();
    const html = renderMultiCompareHtml(q, current, [calc], DEFAULT_SETTINGS);
    expect(html).toContain("控除（2%・▲40枚）");
    expect(html).toContain("提案には控除がない");
  });

  it("控除が無い案件には注記を出さない", () => {
    const { q, calc } = render();
    q.current.deductionRate = undefined;
    const current = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
    expect(renderCompareHtml(q, current, calc, DEFAULT_SETTINGS)).not.toContain("控除");
  });
});
