import { describe, expect, it } from "vitest";
import { registerContent, registerRow } from "./quote-register";
import { calcProposal } from "./pricing";
import { DEFAULT_SETTINGS } from "./defaults";
import type { Proposal, Quote } from "./types";

const quote = (): Quote => ({
  id: "q1",
  title: "複合機入替のご提案",
  customerName: "医療法人 志方医院",
  customerHonorific: "御中",
  quoteNo: "137240",
  quoteDate: "2026-08-22",
  area: "福岡",
  current: {
    makerText: "リコー",
    modelText: "IM C3500",
    monthlyLease: 21_800,
    remainingDebt: 218_000,
    monoPages: 4_350,
    colorPages: 1_035,
    twoColorPages: 0,
    units: { mono: 1.2, color: 12, twoColor: 0, minCharge: 0 },
    maintenanceMonthly: 0,
  },
  proposals: [],
  createdAt: "",
  updatedAt: "",
});

const proposal = (over: Partial<Proposal> = {}): Proposal => ({
  id: "p1",
  maker: "KYOCERA",
  quoteNo: "137240",
  modelText: "TASKalfa 3554ci",
  qty: 1,
  items: [{ name: "本体", qty: 1, unit: "台", unitPrice: 1_424_000 }],
  cost: 441_500,
  pricingMode: "fromGp",
  grossProfitAmount: 300_000,
  leaseTerm: 72,
  counterOverridden: false,
  maintenanceMonthly: 0,
  ...over,
});

const makerNote = { counterMono: [0.4, 0.8] as [number, number], counterColor: [4, 8] as [number, number], minCharge: 2000 };

describe("台帳（スプレッドシート）に書く内容", () => {
  it("型番・月額リース料と年数・カウンター単価を既存の書き方で並べる", () => {
    const q = quote();
    const calc = calcProposal(q, proposal(), DEFAULT_SETTINGS, { makerNote });
    // 例：TASKalfa 3554ci　25,200/6年　0.7/2.0/6.5/2,000
    expect(registerContent(calc)).toBe(
      `TASKalfa 3554ci　${calc.monthlyLease.toLocaleString("ja-JP")}/6年　0.65/2/6.5/2,000`,
    );
  });

  it("最低基本料金が無いメーカーは単価3つだけにする", () => {
    const calc = calcProposal(quote(), proposal({ maker: "SHARP" }), DEFAULT_SETTINGS, {
      makerNote: { counterMono: [0.5, 0.9], counterColor: [4.5, 8.5], minCharge: 0 },
    });
    expect(registerContent(calc).endsWith("/0")).toBe(false);
    expect(registerContent(calc).split("　")[2].split("/")).toHaveLength(3);
  });

  it("行は 見積書番号／顧客名／内容 の3列。番号は提案ごとの番号を使う", () => {
    const q = quote();
    const calc = calcProposal(q, proposal({ quoteNo: "137241" }), DEFAULT_SETTINGS, { makerNote });
    const row = registerRow(q, calc);
    expect(row[0]).toBe("137241");
    expect(row[1]).toBe("医療法人 志方医院");
    expect(row[2]).toContain("TASKalfa 3554ci");
  });
});

describe("旧リース残債精算の見せ方", () => {
  it("数量は残債の月数＋解約事務手数料の月数、単価は現行リース料の単月", () => {
    const calc = calcProposal(quote(), proposal(), DEFAULT_SETTINGS, { makerNote });
    // 残債 218,000 ÷ 月額 21,800 = 10ヶ月、＋解約事務手数料3ヶ月
    expect(calc.debtSettlement.remainingMonths).toBe(10);
    expect(calc.debtSettlement.totalMonths).toBe(13);
    expect(calc.debtSettlement.monthlyLease).toBe(21_800);
    expect(calc.debtSettlement.total).toBe(218_000 + 21_800 * 3);
  });

  it("残債が無ければ月数も0", () => {
    const q = quote();
    q.current.remainingDebt = 0;
    const calc = calcProposal(q, proposal(), DEFAULT_SETTINGS, { makerNote });
    expect(calc.debtSettlement.totalMonths).toBe(0);
    expect(calc.debtSettlement.total).toBe(0);
  });
});
