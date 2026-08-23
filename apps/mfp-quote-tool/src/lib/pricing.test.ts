import { describe, expect, it } from "vitest";
import {
  autoCounterUnits,
  calcCounter,
  calcCurrent,
  calcProposal,
  calcPtf,
  ceilTo,
  leaseRateOf,
  pickTier,
  recommendEntry,
  recommendGrade,
  serviceWarningOf,
} from "./pricing";
import { DEFAULT_SETTINGS } from "./defaults";
import { renderCompareHtml } from "./export/html";
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
    // 月額リース料は100円単位で切り上げる
    expect(calc.leaseByTerm[60]).toBe(ceilTo(771_100 * 0.0195, 100));
    expect(calc.leaseByTerm[84]).toBe(ceilTo(771_100 * 0.0145, 100));
    expect(calc.leaseByTerm[60]).toBe(15_100);
  });

  it("仕切＋GPモードでは 本体価格 = 仕切価格 + GP（端数処理なし）", () => {
    const calc = calcProposal(
      makeQuote(),
      makeProposal({ pricingMode: "fromGp", grossProfitAmount: 250_000 }),
      settings,
    );
    expect(calc.sellingBase).toBe(441_500 + 250_000);
    expect(calc.grossProfit).toBe(250_000);
    expect(calc.ptf).toBe(Math.round((441_500 + 250_000) * 0.1));
  });

  it("仕切＋GPモードでも、オプションの上乗せ分は販売額計にだけ加わる", () => {
    const calc = calcProposal(
      makeQuote(),
      makeProposal({
        pricingMode: "fromGp",
        grossProfitAmount: 200_000,
        items: [
          { name: "本体", qty: 1, unit: "台", unitPrice: 1_424_000 },
          { name: "フィニッシャー", qty: 1, unit: "台", unitPrice: 330_000, ptfExempt: true },
        ],
      }),
      settings,
    );
    expect(calc.sellingBase).toBe(641_500);
    expect(calc.sellingTotal).toBe(641_500 + 330_000);
    expect(calc.ptf).toBe(64_150);
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

  it("京セラの2色カラーは2.0円（メーカー別の指定を優先する）", () => {
    const units = autoCounterUnits(settings, makeQuote(), "KYOCERA", {
      counterMono: [0.4, 0.8],
      counterColor: [4.0, 8.0],
    });
    expect(units.twoColor).toBe(2.0);
  });

  it("メーカー別の指定が無い場合はカラー単価の係数で算出する", () => {
    const units = autoCounterUnits(settings, makeQuote(), "SHARP", {
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
  const rule = (over: Partial<Parameters<typeof calcPtf>[0]> = {}) => ({
    base: "bodyPrice" as const,
    rate: 0.1,
    secondRate: 0.02,
    fixed: 0,
    counter: { enabled: false, rate: 0, months: 0 },
    cap: 0,
    roundUnit: 1,
    ...over,
  });

  it("本体価格の10%（既定）", () => {
    expect(
      calcPtf(rule(), { grossProfit: 300_000, sellingTotal: 900_000, sellingBase: 771_100, monthlyCounter: 19_100 })
        .total,
    ).toBe(77_110);
  });

  it("代理店が2社の場合は 10% と 2% を別々に払い出す", () => {
    const ptf = calcPtf(rule(), {
      grossProfit: 300_000,
      sellingTotal: 900_000,
      sellingBase: 771_100,
      monthlyCounter: 19_100,
      twoAgencies: true,
    });
    expect(ptf.primary).toBe(77_110);
    expect(ptf.second).toBe(15_422);
    expect(ptf.total).toBe(92_532);
  });

  it("代理店2社ぶんのPTFはNPから引かれる", () => {
    const base = calcProposal(makeQuote(), makeProposal({ pricingMode: "fromGp", grossProfitAmount: 200_000 }), settings);
    const two = calcProposal(
      makeQuote(),
      makeProposal({ pricingMode: "fromGp", grossProfitAmount: 200_000, twoAgencies: true }),
      settings,
    );
    expect(two.ptfBreakdown.second).toBe(Math.round(base.sellingBase * 0.02));
    expect(two.ptf).toBe(base.ptf + two.ptfBreakdown.second);
    expect(two.netProfit).toBe(base.netProfit - two.ptfBreakdown.second);
  });

  it("オプション・追加PC設定の上乗せ分には料率を適用しない", () => {
    const quote = makeQuote();
    const withOptions = calcProposal(
      quote,
      makeProposal({
        pricingMode: "fromMargin",
        marginRate: 0.3,
        items: [
          { name: "本体", qty: 1, unit: "台", unitPrice: 1_424_000 },
          { name: "4,000枚フィニッシャー", qty: 1, unit: "台", unitPrice: 330_000, ptfExempt: true },
          { name: "ICカードリーダー", qty: 1, unit: "台", unitPrice: 30_000, ptfExempt: true },
          { name: "PC設定追加（3台）", qty: 3, unit: "台", unitPrice: 5_000, ptfExempt: true },
        ],
      }),
      settings,
    );
    const bodyOnly = Math.round(441_500 / 0.7 / 100) * 100;
    expect(withOptions.sellingBase).toBe(bodyOnly);
    expect(withOptions.addOnTotal).toBe(330_000 + 30_000 + 15_000);
    expect(withOptions.sellingTotal).toBe(bodyOnly + 375_000);
    // PTFは本体価格分のみ
    expect(withOptions.ptf).toBe(Math.round(bodyOnly * 0.1));
  });

  it("目標月額から逆算する場合も、上乗せ分を除いた本体価格がPTFの対象になる", () => {
    const calc = calcProposal(
      makeQuote(),
      makeProposal({
        pricingMode: "fromLease",
        targetMonthlyLease: 12_800,
        items: [
          { name: "本体", qty: 1, unit: "台", unitPrice: 1_424_000 },
          { name: "フィニッシャー", qty: 1, unit: "台", unitPrice: 330_000, ptfExempt: true },
        ],
      }),
      settings,
    );
    expect(calc.sellingTotal).toBe(calc.sellingBase + 330_000);
    expect(calc.ptf).toBe(Math.round(calc.sellingBase * 0.1));
  });

  it("上限額を超えないこと", () => {
    expect(
      calcPtf(rule({ base: "sellingPrice", rate: 0.5, cap: 100_000 }), {
        grossProfit: 0,
        sellingTotal: 1_000_000,
        sellingBase: 1_000_000,
        monthlyCounter: 0,
      }).total,
    ).toBe(100_000);
  });

  it("カウンター報酬を加算できる", () => {
    expect(
      calcPtf(rule({ base: "fixed", rate: 0, fixed: 10_000, counter: { enabled: true, rate: 0.1, months: 60 } }), {
        grossProfit: 0,
        sellingTotal: 0,
        sellingBase: 0,
        monthlyCounter: 19_100,
      }).total,
    ).toBe(10_000 + 19_100 * 0.1 * 60);
  });
});

describe("保守対応エリア", () => {
  const kyocera = { counterMono: [0.4, 0.8] as [number, number], counterColor: [4.0, 8.0] as [number, number], minCharge: 2000 };

  it("ランクS/Aは印刷枚数が少なくてもモノクロ0.7円・カラー7.0円までの単価を出せる", () => {
    const quote = makeQuote({ monoPages: 200, colorPages: 100, twoColorPages: 0 });
    // 枚数が少ないと単価表では 0.7 / 7.0。レンジ上限に振れずに基準単価に収まること
    for (const rank of ["S", "A"] as const) {
      const units = autoCounterUnits(settings, quote, "KYOCERA", kyocera, undefined, rank);
      expect(units.mono).toBe(0.7);
      expect(units.color).toBe(7.0);
    }
  });

  it("ランクB/Cはメーカーレンジの上限側になる（提案が難しいエリア）", () => {
    const quote = makeQuote({ monoPages: 200, colorPages: 100, twoColorPages: 0 });
    for (const rank of ["B", "C"] as const) {
      const units = autoCounterUnits(settings, quote, "KYOCERA", kyocera, undefined, rank);
      expect(units.mono).toBe(0.8);
      expect(units.color).toBe(8.0);
    }
  });

  it("ランクB以下・離島は注意文を返す", () => {
    expect(serviceWarningOf("S")).toBeUndefined();
    expect(serviceWarningOf("B")).toContain("翌日対応");
    expect(serviceWarningOf("C")).toContain("提案が難しい");
    expect(serviceWarningOf("D")).toContain("対応不可");
    expect(serviceWarningOf("A", "離島A")).toContain("離島A");
  });

  it("最低基本料金はメーカー設定を優先する（京セラ2,000円・東芝1,500円）", () => {
    const quote = makeQuote();
    expect(autoCounterUnits(settings, quote, "KYOCERA", kyocera).minCharge).toBe(2000);
    expect(
      autoCounterUnits(settings, quote, "TOSHIBA", {
        counterMono: [0.8, 1.5],
        counterColor: [7.0, 9.5],
        minCharge: 1500,
      }).minCharge,
    ).toBe(1500);
    // 指定のないメーカーは都度入力（既定0円）
    expect(
      autoCounterUnits(settings, quote, "SHARP", {
        counterMono: [0.5, 1.2],
        counterColor: [5.0, 12.0],
        minCharge: null,
      }).minCharge,
    ).toBe(0);
  });
});

describe("削減額", () => {
  it("現行と提案の月間経費の差を、単月・年間・リース期間ぶんで出す", () => {
    const quote = makeQuote();
    const calc = calcProposal(quote, makeProposal(), settings);
    const current = calcCurrent(quote, 0.1);
    expect(calc.diffMonthly).toBe(calc.monthlyTotal - current.monthlyTotal);
    expect(calc.diffYearly).toBe(calc.diffMonthly * 12);
    // 既定は6年リースなので6年間ぶん
    expect(calc.leaseYears).toBe(6);
    expect(calc.diffLeaseTerm).toBe(calc.diffMonthly * 72);
    expect(calc.diffMonthly).toBeLessThan(0); // 削減提案になっている
  });

  it("リース年数を変えると、最後の1行もその年数に合わせる", () => {
    const quote = makeQuote();
    for (const [term, years] of [
      [60, 5],
      [72, 6],
      [84, 7],
    ] as const) {
      const calc = calcProposal(quote, makeProposal({ leaseTerm: term }), settings);
      expect(calc.leaseYears).toBe(years);
      expect(calc.diffLeaseTerm).toBe(calc.diffMonthly * term);
    }
  });

  it("比較表の見出しもリース年数に合わせる（5年リースなら5年間）", () => {
    const quote = makeQuote();
    quote.proposals = [makeProposal({ leaseTerm: 60 })];
    const current = calcCurrent(quote, settings.company.taxRate);
    const calc = calcProposal(quote, quote.proposals[0], settings);
    const html = renderCompareHtml(quote, current, calc, settings);
    expect(html).toContain("合計合算削減金額　（5年間）");
    expect(html).not.toContain("（6年間）");
  });
});

describe("旧リースの残債精算", () => {
  const quoteWithDebt = () => {
    const q = makeQuote();
    q.current.remainingDebt = 390_000;
    q.current.monthlyLease = 15_000;
    return q;
  };

  it("残債＋現行リース料3ヶ月分を見積金額に含める", () => {
    const calc = calcProposal(
      quoteWithDebt(),
      makeProposal({ pricingMode: "fromGp", grossProfitAmount: 200_000 }),
      settings,
    );
    expect(calc.debtSettlement.remainingDebt).toBe(390_000);
    expect(calc.debtSettlement.cancellationFee).toBe(45_000); // 15,000 × 3ヶ月
    expect(calc.debtSettlement.total).toBe(435_000);
    expect(calc.sellingBase).toBe(441_500 + 200_000);
    expect(calc.sellingTotal).toBe(441_500 + 200_000 + 435_000);
  });

  it("残債精算分はPTFの対象にしない", () => {
    const calc = calcProposal(
      quoteWithDebt(),
      makeProposal({ pricingMode: "fromGp", grossProfitAmount: 200_000 }),
      settings,
    );
    expect(calc.ptf).toBe(Math.round(calc.sellingBase * 0.1));
  });

  it("残債がなければ何も上乗せしない", () => {
    const calc = calcProposal(makeQuote(), makeProposal({ pricingMode: "fromGp", grossProfitAmount: 200_000 }), settings);
    expect(calc.debtSettlement.total).toBe(0);
    expect(calc.sellingTotal).toBe(calc.sellingBase);
  });

  it("月額リース料は残債精算を含めた金額から計算する", () => {
    const calc = calcProposal(
      quoteWithDebt(),
      makeProposal({ pricingMode: "fromGp", grossProfitAmount: 200_000, leaseTerm: 72 }),
      settings,
    );
    expect(calc.monthlyLease).toBe(ceilTo(calc.sellingTotal * 0.0166, 100));
  });

  it("設定で無効にすれば従来どおり上乗せしない", () => {
    const off = structuredClone(settings);
    off.debtSettlement.includeInQuote = false;
    const calc = calcProposal(quoteWithDebt(), makeProposal({ pricingMode: "fromGp", grossProfitAmount: 200_000 }), off);
    expect(calc.debtSettlement.total).toBe(0);
  });
});

describe("残債精算とGPの関係", () => {
  it("残債精算は立替なのでGP・NPに含めない", () => {
    const q = makeQuote();
    q.current.remainingDebt = 390_000;
    const calc = calcProposal(q, makeProposal({ pricingMode: "fromGp", grossProfitAmount: 200_000 }), settings);
    expect(calc.sellingTotal).toBe(441_500 + 200_000 + 435_000);
    expect(calc.grossProfit).toBe(200_000); // 残債435,000は粗利にならない
    expect(calc.netProfit).toBe(200_000 - calc.ptf);
  });
});

describe("本体価格を直接入力する", () => {
  it("入れた額がそのまま本体価格になる（端数処理しない）", () => {
    const calc = calcProposal(
      makeQuote(),
      makeProposal({ pricingMode: "fromPrice", bodyPrice: 1_234_567 }),
      settings,
    );
    expect(calc.sellingBase).toBe(1_234_567);
    expect(calc.sellingTotal).toBe(1_234_567);
  });

  it("オプション（PTF対象外）は本体価格に加算して販売額計になる", () => {
    const proposal = makeProposal({
      pricingMode: "fromPrice",
      bodyPrice: 1_000_000,
      items: [
        { name: "本体", qty: 1, unit: "台", unitPrice: 1_500_000 },
        { name: "フィニッシャー", qty: 1, unit: "台", unitPrice: 200_000, ptfExempt: true },
      ],
    });
    const calc = calcProposal(makeQuote(), proposal, settings);
    expect(calc.sellingBase).toBe(1_000_000);
    expect(calc.addOnTotal).toBe(200_000);
    expect(calc.sellingTotal).toBe(1_200_000);
    // PTFは本体価格にだけ掛かる（オプションぶんには掛からない）
    expect(calc.ptf).toBe(100_000); // 1,000,000 × 10%
  });

  it("GPは 本体価格 ＋ オプション − 仕切価格 になる", () => {
    const calc = calcProposal(
      makeQuote(),
      makeProposal({ pricingMode: "fromPrice", bodyPrice: 900_000, cost: 400_000 }),
      settings,
    );
    expect(calc.grossProfit).toBe(500_000);
  });

  it("月額リース料は入れた本体価格から計算する", () => {
    const calc = calcProposal(
      makeQuote(),
      makeProposal({ pricingMode: "fromPrice", bodyPrice: 1_000_000 }),
      settings,
    );
    expect(calc.monthlyLease).toBe(
      ceilTo(1_000_000 * settings.leaseRates["72"], settings.leaseRoundUnit),
    );
  });

  it("古い案件（sellingTotal に入っている）もそのまま読める", () => {
    const proposal = { ...makeProposal({ pricingMode: "fromPrice" }), sellingTotal: 800_000 };
    expect(calcProposal(makeQuote(), proposal, settings).sellingBase).toBe(800_000);
  });
});
