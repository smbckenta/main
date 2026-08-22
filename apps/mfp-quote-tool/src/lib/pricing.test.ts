import { describe, expect, it } from "vitest";
import {
  autoCounterUnits,
  calcCounter,
  calcCurrent,
  calcProposal,
  calcPtf,
  leaseRateOf,
  pickTier,
  recommendEntry,
  recommendGrade,
} from "./pricing";
import { DEFAULT_SETTINGS } from "./defaults";
import type { PriceBookEntry, Proposal, Quote, Settings } from "./types";

const settings: Settings = structuredClone(DEFAULT_SETTINGS);

function makeQuote(overrides: Partial<Quote["current"]> = {}): Quote {
  return {
    id: "q1",
    title: "テスト",
    customerName: "テスト株式会社",
    customerHonorific: "御中",
    quoteNo: "136001",
    quoteDate: "2026-08-22",
    area: "福岡",
    current: {
      makerText: "コニカミノルタ",
      modelText: "bizhub C220",
      monthlyLease: 15000,
      monoPages: 3000,
      colorPages: 2000,
      twoColorPages: 1500,
      units: { mono: 1.5, color: 15, twoColor: 8, minCharge: 0 },
      maintenanceMonthly: 0,
      ...overrides,
    },
    proposals: [],
    createdAt: "",
    updatedAt: "",
  };
}

function makeProposal(overrides: Partial<Proposal> = {}): Proposal {
  return {
    id: "p1",
    maker: "KYOCERA",
    modelText: "TASKalfa MZ2501ci",
    qty: 1,
    items: [
      { name: "本体", qty: 1, unit: "台", unitPrice: 1_424_000 },
      { name: "両画面原稿送り装置", qty: 1, unit: "台", unitPrice: 130_000 },
      { name: "ＦＡＸキット", qty: 1, unit: "台", unitPrice: 170_000 },
      { name: "600枚*2段ペーパーフィーダー", qty: 1, unit: "台", unitPrice: 160_000 },
      { name: "設置工事費", qty: 1, unit: "式", unitPrice: 53_000 },
    ],
    cost: 441_500,
    pricingMode: "fromLease",
    targetMonthlyLease: 12_800,
    leaseTerm: 72,
    counterOverridden: true,
    units: { mono: 0.7, color: 7, twoColor: 2, minCharge: 900 },
    maintenanceMonthly: 0,
    ...overrides,
  };
}

describe("リース料率", () => {
  it("既存Excelと同じ料率を返す（5年1.95% / 6年1.66% / 7年1.45%）", () => {
    expect(leaseRateOf(60, settings.leaseRates)).toBe(0.0195);
    expect(leaseRateOf(72, settings.leaseRates)).toBe(0.0166);
    expect(leaseRateOf(84, settings.leaseRates)).toBe(0.0145);
  });

  it("料率表にない回数は最も近い回数の料率を使う", () => {
    expect(leaseRateOf(66, settings.leaseRates)).toBe(0.0195);
  });
});

describe("販売額の逆算", () => {
  it("月額リース料12,800円・6年 → 販売額計 約771,100円（既存Excelの 12800/1.66% と一致）", () => {
    const quote = makeQuote();
    const calc = calcProposal(quote, makeProposal(), settings);
    expect(calc.sellingTotal).toBe(771_100); // 771,084.34 を100円単位に丸め
    expect(calc.listTotal).toBe(1_937_000);
    expect(calc.discount).toBe(771_100 - 1_937_000);
  });

  it("5年・7年の月額もリースシミュレーションとして併記できる", () => {
    const calc = calcProposal(makeQuote(), makeProposal(), settings);
    expect(calc.leaseByTerm[60]).toBe(Math.round(771_100 * 0.0195));
    expect(calc.leaseByTerm[84]).toBe(Math.round(771_100 * 0.0145));
  });

  it("仕切＋粗利率モードでは 仕切 ÷ (1 - 率) になる", () => {
    const calc = calcProposal(
      makeQuote(),
      makeProposal({ pricingMode: "fromMargin", marginRate: 0.3 }),
      settings,
    );
    expect(calc.sellingTotal).toBe(Math.round(441_500 / 0.7 / 100) * 100);
    expect(calc.grossProfit).toBe(calc.sellingTotal - 441_500);
  });
});

describe("カウンター料金", () => {
  it("枚数×単価を積み上げる", () => {
    const result = calcCounter(
      { mono: 0.7, color: 7, twoColor: 2, minCharge: 900 },
      { monoPages: 3000, colorPages: 2000, twoColorPages: 1500 },
    );
    expect(result.monoAmount).toBe(2100);
    expect(result.colorAmount).toBe(14_000);
    expect(result.twoColorAmount).toBe(3000);
    expect(result.total).toBe(19_100); // 既存Excelの提案側カウンター合計と一致
  });

  it("合計が最低基本料金を下回る場合は最低基本料金を請求する", () => {
    const result = calcCounter(
      { mono: 0.7, color: 7, twoColor: 2, minCharge: 900 },
      { monoPages: 100, colorPages: 10, twoColorPages: 0 },
    );
    expect(result.minChargeApplied).toBe(true);
    expect(result.total).toBe(900);
  });

  it("現行の月間経費は リース+カウンター+保守 に消費税を加えた額", () => {
    const current = calcCurrent(makeQuote(), 0.1);
    expect(current.counter.total).toBe(46_500);
    expect(current.monthlyTotal).toBe(67_650); // 既存Excelの現状 月間経費と一致
  });
});

describe("カウンター単価の自動判定", () => {
  it("カラー枚数2,000枚なら 0.6円 / 6.0円 の段になる", () => {
    const tier = pickTier(settings.counterTiersByColorVolume, 2000);
    expect(tier).toMatchObject({ mono: 0.6, color: 6.0 });
  });

  it("メーカーの交渉レンジ内に収める（東芝はモノクロ下限0.8円）", () => {
    const units = autoCounterUnits(settings, makeQuote(), "TOSHIBA", {
      counterMono: [0.8, 1.5],
      counterColor: [7.0, 9.5],
    });
    expect(units.mono).toBe(0.8);
    expect(units.color).toBe(7.0);
  });

  it("僻地エリアはレンジ上限側の単価になる", () => {
    const remoteSettings = structuredClone(settings);
    const quote = makeQuote();
    quote.area = "離島・僻地";
    const units = autoCounterUnits(remoteSettings, quote, "KYOCERA", {
      counterMono: [0.4, 0.8],
      counterColor: [4.0, 8.0],
    });
    expect(units.mono).toBe(0.8);
    expect(units.color).toBe(8.0);
  });

  it("2色カラーはカラー単価の係数で算出する", () => {
    const units = autoCounterUnits(settings, makeQuote(), "KYOCERA", {
      counterMono: [0.4, 0.8],
      counterColor: [4.0, 8.0],
    });
    expect(units.twoColor).toBeCloseTo(units.color * settings.twoColorRatio, 2);
  });
});

describe("機種グレードの推奨", () => {
  it("研修資料の枚数区分どおりに判定する", () => {
    expect(recommendGrade(settings, 2500)).toBe(25);
    expect(recommendGrade(settings, 6500)).toBe(35);
    expect(recommendGrade(settings, 9000)).toBe(40);
    expect(recommendGrade(settings, 16_000)).toBe(50);
    expect(recommendGrade(settings, 21_000)).toBe(60);
    expect(recommendGrade(settings, 40_000)).toBe(70);
  });

  it("推奨速度以上で最も近い機種を仕切表から選ぶ", () => {
    const entries: PriceBookEntry[] = [
      { id: "a", maker: "KYOCERA", model: "MZ2501ci", category: "A3カラー", gradePpm: 25, listPrice: 1, cost: 1, items: [] },
      { id: "b", maker: "KYOCERA", model: "MZ3501ci", category: "A3カラー", gradePpm: 35, listPrice: 1, cost: 1, items: [] },
      { id: "c", maker: "KYOCERA", model: "MZ4001ci", category: "A3カラー", gradePpm: 40, listPrice: 1, cost: 1, items: [] },
    ];
    expect(recommendEntry(entries, "KYOCERA", 35)?.id).toBe("b");
    expect(recommendEntry(entries, "KYOCERA", 26)?.id).toBe("b");
    expect(recommendEntry(entries, "KYOCERA", 100)?.id).toBe("c");
  });
});

describe("PTF", () => {
  it("粗利益に対する率で算出し、端数を丸める", () => {
    expect(
      calcPtf(
        { base: "grossProfit", rate: 0.2, fixed: 0, counter: { enabled: false, rate: 0, months: 0 }, cap: 0, roundUnit: 1000 },
        { grossProfit: 329_600, sellingTotal: 771_100, monthlyCounter: 19_100 },
      ),
    ).toBe(66_000);
  });

  it("上限額を超えないこと", () => {
    expect(
      calcPtf(
        { base: "sellingPrice", rate: 0.5, fixed: 0, counter: { enabled: false, rate: 0, months: 0 }, cap: 100_000, roundUnit: 1 },
        { grossProfit: 0, sellingTotal: 1_000_000, monthlyCounter: 0 },
      ),
    ).toBe(100_000);
  });

  it("カウンター報酬を加算できる", () => {
    expect(
      calcPtf(
        { base: "fixed", rate: 0, fixed: 10_000, counter: { enabled: true, rate: 0.1, months: 60 }, cap: 0, roundUnit: 1 },
        { grossProfit: 0, sellingTotal: 0, monthlyCounter: 19_100 },
      ),
    ).toBe(10_000 + 19_100 * 0.1 * 60);
  });
});

describe("削減額", () => {
  it("現行と提案の月間経費の差を単月・年間・6年で出す", () => {
    const quote = makeQuote();
    const calc = calcProposal(quote, makeProposal(), settings);
    const current = calcCurrent(quote, 0.1);
    expect(calc.diffMonthly).toBe(calc.monthlyTotal - current.monthlyTotal);
    expect(calc.diffYearly).toBe(calc.diffMonthly * 12);
    expect(calc.diffSixYears).toBe(calc.diffMonthly * 72);
    expect(calc.diffMonthly).toBeLessThan(0); // 削減提案になっている
  });
});
