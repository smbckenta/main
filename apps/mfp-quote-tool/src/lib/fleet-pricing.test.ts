import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import {
  autoSelectProposals,
  calcFleet,
  calcUnitLease,
  pickEntryForUnit,
  requiredPpm,
  syncProposalPages,
} from "./fleet";
import { calcProposal } from "./pricing";
import type { CurrentChargeLine, Fleet, FleetSide, FleetUnit, PriceBook, Proposal, Quote } from "./types";

/**
 * 複数台の1台ごとにも、1台だけの案件と同じやり方で
 * 仕切＋GP からリース料を出せるようにした。計算式がずれていないかを確かめる。
 */

const line = (name: string, kind: CurrentChargeLine["kind"], pages: number, unit: number, deductionRate?: number): CurrentChargeLine => ({
  name,
  kind,
  pages,
  deductionRate,
  tiers: [{ from: 1, to: null, unit }],
});

const side = (over: Partial<FleetSide> = {}): FleetSide => ({
  makerText: "リコー",
  modelText: "IM C3500F",
  monthlyLease: 0,
  minCharge: 0,
  maintenanceMonthly: 0,
  lines: [],
  ...over,
});

const unit = (over: Partial<FleetUnit> = {}): FleetUnit => ({
  id: "u1",
  location: "本社",
  current: side({ lines: [line("モノクロ", "mono", 1_389, 2.84, 0.02), line("カラー", "color", 435, 13.79, 0.03)] }),
  proposal: side({ makerText: "", modelText: "", lines: [] }),
  ...over,
});

describe("1台ぶんのリース料の計算", () => {
  const settings = DEFAULT_SETTINGS;

  it("仕切＋GP：本体価格 × リース料率を切り上げる", () => {
    const calc = calcUnitLease({ mode: "fromGp", cost: 380_000, grossProfitAmount: 300_000 }, 72, settings);
    expect(calc.bodyPrice).toBe(680_000);
    expect(calc.sellingTotal).toBe(680_000);
    expect(calc.grossProfit).toBe(300_000);
    expect(calc.monthlyLease).toBe(
      Math.ceil((680_000 * calc.leaseRate) / (settings.leaseRoundUnit || 1)) * (settings.leaseRoundUnit || 1),
    );
  });

  it("粗利率：仕切 ÷ (1 − 率)", () => {
    const calc = calcUnitLease({ mode: "fromMargin", cost: 350_000, marginRate: 0.3 }, 72, settings);
    expect(calc.bodyPrice).toBe(500_000);
    expect(calc.marginRate).toBeCloseTo(0.3, 3);
  });

  it("本体価格を直接入力：その額がそのまま本体価格になる", () => {
    const calc = calcUnitLease({ mode: "fromPrice", cost: 380_000, bodyPrice: 720_000 }, 72, settings);
    expect(calc.bodyPrice).toBe(720_000);
    expect(calc.grossProfit).toBe(340_000);
  });

  it("目標月額から逆算：指定した月額どおりに出る（切り上げで100円高くならない）", () => {
    const calc = calcUnitLease({ mode: "fromLease", cost: 380_000, targetMonthlyLease: 12_400 }, 72, settings);
    expect(calc.monthlyLease).toBe(12_400);
  });

  it("オプションの上乗せは値引きせずそのまま販売額計に足す", () => {
    const calc = calcUnitLease(
      { mode: "fromGp", cost: 380_000, grossProfitAmount: 300_000, addOnTotal: 50_000 },
      72,
      settings,
    );
    expect(calc.sellingTotal).toBe(730_000);
    expect(calc.grossProfit).toBe(350_000);
  });

  it("1台だけの案件（提案の作成）と同じ月額になる", () => {
    const quote: Quote = {
      id: "q",
      title: "",
      customerName: "テスト",
      customerHonorific: "様",
      quoteNo: "1",
      quoteDate: "2026-08-30",
      area: "福岡",
      current: {
        makerText: "",
        modelText: "",
        monthlyLease: 0,
        monoPages: 0,
        colorPages: 0,
        twoColorPages: 0,
        units: { mono: 0, color: 0, twoColor: 0, minCharge: 0 },
        maintenanceMonthly: 0,
      },
      proposals: [],
      createdAt: "",
      updatedAt: "",
    };
    const proposal: Proposal = {
      id: "p",
      maker: "KYOCERA",
      modelText: "TASKalfa",
      qty: 1,
      items: [],
      cost: 380_000,
      pricingMode: "fromGp",
      grossProfitAmount: 300_000,
      leaseTerm: 72,
      counterOverridden: false,
      maintenanceMonthly: 0,
    };
    const single = calcProposal({ ...quote, proposals: [proposal] }, proposal, settings);
    const fleetSide = calcUnitLease({ mode: "fromGp", cost: 380_000, grossProfitAmount: 300_000 }, 72, settings);
    expect(fleetSide.monthlyLease).toBe(single.monthlyLease);
  });
});

describe("提案の印刷枚数は現状と同じ（控除前）", () => {
  it("現行の枚数をそのまま写す。控除は引かない", () => {
    const u = unit();
    const proposal = side({ lines: [line("モノクロ", "mono", 0, 0.5), line("カラー", "color", 0, 5)] });
    const synced = syncProposalPages(u.current, proposal);
    // 控除後（1,361枚・422枚）ではなく、控除前の 1,389枚・435枚
    expect(synced.lines.map((l) => l.pages)).toEqual([1_389, 435]);
  });

  it("現行がフルカラーを2区分に分けていても、提案が1区分なら合計して入れる", () => {
    const current = side({
      lines: [
        line("モノカラー総出力", "mono", 1_389, 2.84, 0.02),
        line("フルカラーコピー", "color", 53, 16.8, 0.03),
        line("フルカラープリント", "color", 382, 13.9, 0.03),
      ],
    });
    const proposal = side({ lines: [line("モノクロ", "mono", 0, 0.5), line("カラー", "color", 0, 5)] });
    expect(syncProposalPages(current, proposal).lines.map((l) => l.pages)).toEqual([1_389, 435]);
  });

  it("提案側に区分が無ければ何もしない", () => {
    expect(syncProposalPages(unit().current, side({ lines: [] })).lines).toEqual([]);
  });

  it("比較表の計算でも、提案側は控除前の枚数で計算される", () => {
    const fleet: Fleet = {
      enabled: true,
      leaseTerm: 72,
      units: [
        {
          ...unit(),
          proposal: side({ lines: [line("モノクロ", "mono", 0, 0.5), line("カラー", "color", 0, 5)] }),
        },
      ],
    };
    const calc = calcFleet(fleet, 0.1, DEFAULT_SETTINGS);
    const p = calc.units[0].proposal;
    expect(p.lines.map((l) => l.pages)).toEqual([1_389, 435]);
    expect(p.deductedPages).toBe(0);
    // 1,389 × 0.5 + 435 × 5 = 694 + 2,175
    expect(p.meteredSubtotal).toBe(694 + 2_175);
  });
});

describe("台ごとの機種の自動選定", () => {
  const book: PriceBook = {
    version: "test",
    source: "test",
    entries: [
      { id: "k25", maker: "KYOCERA", model: "MZ2501ci", category: "A3カラー", gradePpm: 25, listPrice: 1_000_000, cost: 300_000, items: [] },
      { id: "k35", maker: "KYOCERA", model: "MZ3501ci", category: "A3カラー", gradePpm: 35, listPrice: 1_200_000, cost: 380_000, items: [] },
      { id: "k60", maker: "KYOCERA", model: "MZ6001ci", category: "A3カラー", gradePpm: 60, listPrice: 1_800_000, cost: 520_000, items: [] },
    ],
    makerNotes: {},
  };

  it("現行の印刷速度と同等以上でいちばん近い機種を選ぶ", () => {
    expect(pickEntryForUnit(book.entries, "KYOCERA", 35)?.model).toBe("MZ3501ci");
    expect(pickEntryForUnit(book.entries, "KYOCERA", 36)?.model).toBe("MZ6001ci");
    expect(pickEntryForUnit(book.entries, "KYOCERA", 25)?.model).toBe("MZ2501ci");
  });

  it("要る速度は現行機の速度と、その台の枚数から見た速度の大きいほう", () => {
    const fast = unit({ current: side({ ppm: 45, lines: [line("モノクロ", "mono", 100, 1)] }) });
    expect(requiredPpm(fast, DEFAULT_SETTINGS)).toBe(45);
  });

  it("台数ぶん自動で入る。全台の合計枚数から1台だけを選ぶのではない", () => {
    const fleet: Fleet = {
      enabled: true,
      leaseTerm: 72,
      units: [
        unit({ id: "a", location: "本社", current: side({ ppm: 35, lines: [line("モノクロ", "mono", 1_000, 3)] }) }),
        unit({ id: "b", location: "直方店", current: side({ ppm: 25, lines: [line("モノクロ", "mono", 300, 3)] }) }),
      ],
    };
    const out = autoSelectProposals(fleet, "KYOCERA", book, DEFAULT_SETTINGS);
    expect(out.units.map((u) => u.proposal.modelText)).toEqual(["MZ3501ci", "MZ2501ci"]);
    expect(out.units.every((u) => u.proposal.makerText === "京セラ")).toBe(true);
  });

  it("自動選定した台は、仕切＋GPでリース料が出る", () => {
    const fleet: Fleet = { enabled: true, leaseTerm: 72, units: [unit({ current: side({ ppm: 35, lines: [line("モノクロ", "mono", 1_000, 3)] }) })] };
    const out = autoSelectProposals(fleet, "KYOCERA", book, DEFAULT_SETTINGS);
    const pricing = out.units[0].proposal.pricing!;
    expect(pricing.mode).toBe("fromGp");
    expect(pricing.cost).toBe(380_000);

    const calc = calcFleet(out, 0.1, DEFAULT_SETTINGS);
    expect(calc.units[0].proposal.monthlyLease).toBeGreaterThan(0);
    expect(calc.units[0].proposal.monthlyLease).toBe(
      calcUnitLease(pricing, 72, DEFAULT_SETTINGS).monthlyLease,
    );
  });

  it("自動選定でも提案の枚数は現行と同じ（控除前）になる", () => {
    const fleet: Fleet = { enabled: true, leaseTerm: 72, units: [unit()] };
    const calc = calcFleet(autoSelectProposals(fleet, "KYOCERA", book, DEFAULT_SETTINGS), 0.1, DEFAULT_SETTINGS);
    expect(calc.units[0].proposal.lines.map((l) => l.pages)).toEqual([1_389, 435]);
    expect(calc.units[0].proposal.deductedPages).toBe(0);
  });

  it("仕切表にそのメーカーが無ければ、その台はそのまま残す", () => {
    const fleet: Fleet = { enabled: true, leaseTerm: 72, units: [unit()] };
    const out = autoSelectProposals(fleet, "SHARP", book, DEFAULT_SETTINGS);
    expect(out.units[0].proposal.modelText).toBe("");
  });
});

describe("決め方を使わない台", () => {
  it("手入力の月額リース料をそのまま使う", () => {
    const fleet: Fleet = {
      enabled: true,
      leaseTerm: 72,
      units: [unit({ proposal: side({ monthlyLease: 11_000, lines: [] }) })],
    };
    expect(calcFleet(fleet, 0.1, DEFAULT_SETTINGS).units[0].proposal.monthlyLease).toBe(11_000);
  });
});

describe("提案のカウンター単価", () => {
  const book: PriceBook = {
    version: "test",
    source: "test",
    entries: [
      { id: "k35", maker: "KYOCERA", model: "MZ3501ci", category: "A3カラー", gradePpm: 35, listPrice: 1_200_000, cost: 380_000, items: [] },
    ],
    makerNotes: {},
  };

  it("現行の単価をそのまま残さず、提案の単価に入れ替える", () => {
    // 現行と同じ単価のままだと、比べても削減が出ない
    const fleet: Fleet = { enabled: true, leaseTerm: 72, units: [unit()] };
    const out = autoSelectProposals(fleet, "KYOCERA", book, DEFAULT_SETTINGS, {
      counterUnits: { u1: { mono: 0.5, color: 5, twoColor: 0 } },
    });
    const lines = out.units[0].proposal.lines;
    expect(lines.map((l) => l.tiers[0].unit)).toEqual([0.5, 5]);
    // 枚数は現行のまま（控除前）
    expect(lines.map((l) => l.pages)).toEqual([1_389, 435]);
    // 控除は提案側に持ち込まない
    expect(lines.every((l) => l.deductionRate === undefined)).toBe(true);
  });

  it("機種DBから引いた現行機の速度を、同等以上の判定に使う", () => {
    // 枚数は少ないが、現行が35枚機なら35枚機以上を選ぶ
    const small = unit({ current: side({ lines: [line("モノクロ", "mono", 200, 3)] }) });
    expect(requiredPpm(small, DEFAULT_SETTINGS)).toBeLessThan(35);
    expect(requiredPpm(small, DEFAULT_SETTINGS, 35)).toBe(35);
  });
});
