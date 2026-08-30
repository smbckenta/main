import { describe, expect, it } from "vitest";
import { calcCurrent, calcProposal } from "../pricing";
import { DEFAULT_SETTINGS } from "../defaults";
import type { ChargeTier, CurrentChargeLine, Proposal, Quote } from "../types";
import { compareRowCount, fitCompare, renderCompareHtml, renderMultiCompareHtml } from "./html";

/**
 * 比較表は「現状」と「提案」を並べて見比べるための紙なので、
 * 明細の区分が増えても1枚に収まらなければ役に立たない。
 */

const TIERS: ChargeTier[] = [
  { from: 1, to: 1000, unit: 3.0 },
  { from: 1001, to: 2000, unit: 2.6 },
  { from: 2001, to: null, unit: 2.2 },
];

const chargeLine = (i: number, bands: number): CurrentChargeLine => ({
  name: `区分${i + 1}`,
  kind: i % 2 === 0 ? "mono" : "color",
  pages: 1500,
  deductionRate: 0.02,
  tiers: TIERS.slice(0, bands),
  amount: undefined,
});

const quoteWith = (lines: CurrentChargeLine[]): Quote => ({
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
    monthlyLease: 15_000,
    monoPages: 1_500,
    colorPages: 900,
    twoColorPages: 0,
    chargeLines: lines.length ? lines : undefined,
    units: { mono: 3, color: 15, twoColor: 0, minCharge: 0 },
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

describe("比較表の行数の見積り", () => {
  it("明細が無ければ伸び縮みしない（ブラック・フルカラー・2色の3行で固定）", () => {
    expect(compareRowCount(calcCurrent(quoteWith([]), 0.1))).toBe(0);
    expect(fitCompare(0)).toBe(1);
  });

  it("段が1つの区分は1行、2つ以上ある区分は段の数だけ行が増える", () => {
    // 1,500枚（控除後1,470枚）は 1-1000 と 1001-2000 の2段に分かれる。
    // 段が分かれる区分は、見出し1行＋段2行の計3行になる
    const twoBands = { ...chargeLine(0, 3), pages: 1_500 };
    // 800枚は1段に収まるので、見出しの1行だけ
    const oneBand = { ...chargeLine(1, 3), pages: 800 };
    expect(compareRowCount(calcCurrent(quoteWith([oneBand, twoBands]), 0.1))).toBe(4);
  });
});

describe("行数に応じた縮小", () => {
  it("行が少なければ縮めない", () => {
    expect(fitCompare(0)).toBe(1);
    expect(fitCompare(1)).toBe(1);
  });

  it("行が増えるほど小さくなる", () => {
    expect(fitCompare(30)).toBeLessThan(fitCompare(10));
    expect(fitCompare(10)).toBeLessThan(1);
  });

  it("読めなくなる手前で止める", () => {
    expect(fitCompare(500)).toBe(0.5);
  });

  it("各社を横並びにした比較表は、列が増えるぶん少し余計に縮める", () => {
    expect(fitCompare(8, 5)).toBeLessThan(fitCompare(8, 1));
  });
});

describe("画面に出るHTML", () => {
  const q = quoteWith(Array.from({ length: 6 }, (_, i) => chargeLine(i, 3)));
  const current = calcCurrent(q, 0.1);
  const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);

  it("削減額を赤で出す指定が入っている", () => {
    const html = renderCompareHtml(q, current, calc, DEFAULT_SETTINGS);
    expect(html).toMatch(/\.save\s*\{[^}]*color:\s*#d0021b/);
    expect(html).toContain('class="save-total"');
  });

  it("行が多い比較表には縮小の指定が入る", () => {
    const html = renderCompareHtml(q, current, calc, DEFAULT_SETTINGS);
    expect(html).toContain('class="compare"');
    expect(html).toMatch(/body\.compare \{ --fit: 0\.\d+; \}/);
  });

  it("各社の比較表にも同じ仕組みが入る", () => {
    const html = renderMultiCompareHtml(q, current, [calc], DEFAULT_SETTINGS);
    expect(html).toContain('class="compare"');
    expect(html).toContain("--fit:");
  });
});
