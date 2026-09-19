import { describe, expect, it } from "vitest";
import { calcCurrent, calcProposal } from "./pricing";
import { calcFleet } from "./fleet";
import { renderCompareHtml, renderFleetCompareHtml, renderMultiCompareHtml } from "./export/html";
import { DEFAULT_SETTINGS } from "./defaults";
import type { CurrentChargeLine, Fleet, FleetSide, Proposal, Quote } from "./types";

/**
 * 現行のリース料金が分からない案件は、カウンター料金だけで比べる。
 *
 * リース明細をお預かりできていないのに、現行のリース料を0円として扱うと、
 * 提案のリース料がまるごと「増額」に見えたり、逆に現行を安く見せたりして、
 * 比較そのものが成り立たなくなる。両側ともリース料を外して比べる。
 */

const TAX = DEFAULT_SETTINGS.company.taxRate;

const quote = (patch: Partial<Quote["current"]> = {}): Quote => ({
  id: "q",
  title: "複合機入替のご提案",
  customerName: "テスト商事",
  customerHonorific: "御中",
  quoteNo: "137240",
  quoteDate: "2026-08-23",
  area: "福岡",
  current: {
    makerText: "リコー",
    modelText: "MPC3003SP",
    monthlyLease: 0,
    leaseUnknown: true,
    monoPages: 4_000,
    colorPages: 1_000,
    twoColorPages: 0,
    units: { mono: 1.5, color: 12, twoColor: 0, minCharge: 0 },
    maintenanceMonthly: 0,
    ...patch,
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
  counterOverridden: true,
  units: { mono: 0.7, color: 7, twoColor: 0, minCharge: 0 },
  maintenanceMonthly: 0,
};

describe("リース料金が不明な案件", () => {
  it("現行のリース料は比較に入れない", () => {
    const calc = calcCurrent(quote(), TAX);
    expect(calc.leaseUnknown).toBe(true);
    expect(calc.monthlyLease).toBe(0);
    // 4,000枚×1.5円 ＋ 1,000枚×12円 ＝ 18,000円
    expect(calc.counter.total).toBe(18_000);
    expect(calc.comparable).toBe(19_800); // 税込
  });

  it("提案側もリース料を外して比べる", () => {
    const q = quote();
    q.proposals = [proposal];
    const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);
    expect(calc.counterOnly).toBe(true);
    // 4,000枚×0.7円 ＋ 1,000枚×7円 ＝ 9,800円
    expect(calc.counter.total).toBe(9_800);
    expect(calc.comparable).toBe(10_780);
    expect(calc.diffMonthly).toBe(10_780 - 19_800);
    // 提案の月額リース料そのものは、これまでどおり見積書に出す
    expect(calc.monthlyLease).toBeGreaterThan(0);
  });

  it("提案のリース料は削減額に混ざらない", () => {
    const q = quote();
    q.proposals = [proposal];
    const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);
    // リース料込みの月間経費とは別の数字になっている
    expect(calc.monthlyTotal).toBeGreaterThan(calc.comparable);
    expect(calc.diffMonthly).toBe(calc.comparable - calcCurrent(q, TAX).comparable);
  });

  it("リース料金が分かっている案件は、これまでどおりリース込みで比べる", () => {
    const q = quote({ leaseUnknown: false, monthlyLease: 20_000 });
    q.proposals = [proposal];
    const current = calcCurrent(q, TAX);
    const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);
    expect(current.leaseUnknown).toBe(false);
    expect(current.comparable).toBe(current.monthlyTotal);
    expect(calc.counterOnly).toBe(false);
    expect(calc.comparable).toBe(calc.monthlyTotal);
    expect(calc.diffMonthly).toBe(calc.monthlyTotal - current.monthlyTotal);
  });

  it("リース満了で本当に0円の案件とは区別する", () => {
    // leaseUnknown を立てていなければ、0円はそのまま0円として比較に入る
    const q = quote({ leaseUnknown: false, monthlyLease: 0 });
    expect(calcCurrent(q, TAX).leaseUnknown).toBe(false);
    expect(calcProposal(q, proposal, DEFAULT_SETTINGS).counterOnly).toBe(false);
  });
});

describe("リース料金が不明な案件の帳票", () => {
  const render = () => {
    const q = quote();
    q.proposals = [proposal];
    return {
      q,
      current: calcCurrent(q, TAX),
      calc: calcProposal(q, proposal, DEFAULT_SETTINGS),
    };
  };

  it("比較表はリース料を「不明」と書き、カウンターだけで比べている旨を注記する", () => {
    const { q, current, calc } = render();
    const html = renderCompareHtml(q, current, calc, DEFAULT_SETTINGS);
    expect(html).toContain("－（不明）");
    expect(html).toContain("カウンター月間経費");
    expect(html).toContain("カウンター料金のみ");
    // リース込みの行は出さない
    expect(html).not.toContain("ランニングコスト ①+②");
  });

  it("各社同時比較にも同じ注記を出す", () => {
    const { q, current, calc } = render();
    const html = renderMultiCompareHtml(q, current, [calc], DEFAULT_SETTINGS);
    expect(html).toContain("月額リース料（参考）");
    expect(html).toContain("カウンター月間経費（税込）");
    expect(html).toContain("カウンター料金のみ");
  });

  it("リース料金が分かっている案件には注記を出さない", () => {
    const q = quote({ leaseUnknown: false, monthlyLease: 20_000 });
    q.proposals = [proposal];
    const html = renderCompareHtml(q, calcCurrent(q, TAX), calcProposal(q, proposal, DEFAULT_SETTINGS), DEFAULT_SETTINGS);
    expect(html).not.toContain("カウンター料金のみ");
    expect(html).toContain("ランニングコスト ①+②");
  });
});

describe("複数台比較表でリース料金が不明な場合", () => {
  const line = (name: string, kind: CurrentChargeLine["kind"], pages: number, unit: number): CurrentChargeLine => ({
    name,
    kind,
    pages,
    tiers: [{ from: 1, to: null, unit }],
  });
  const side = (p: Partial<FleetSide>): FleetSide => ({
    makerText: "",
    modelText: "",
    monthlyLease: 0,
    lines: [],
    minCharge: 0,
    maintenanceMonthly: 0,
    ...p,
  });
  const fleet: Fleet = {
    enabled: true,
    leaseTerm: 72,
    leaseUnknown: true,
    units: [
      {
        id: "u1",
        location: "本社",
        current: side({
          makerText: "リコー",
          modelText: "MPC3003SP",
          monthlyLease: 0,
          lines: [line("モノクロ", "mono", 4_000, 1.5), line("カラー", "color", 1_000, 12)],
        }),
        proposal: side({
          makerText: "京セラ",
          modelText: "TASKalfa 2554ci",
          monthlyLease: 15_000,
          lines: [line("モノクロ", "mono", 4_000, 0.7), line("カラー", "color", 1_000, 7)],
        }),
      },
    ],
  };

  it("合計はカウンター料金だけになる（リース料を含めない）", () => {
    const calc = calcFleet(fleet, TAX);
    expect(calc.leaseUnknown).toBe(true);
    expect(calc.current.monthly).toBe(calc.current.counterSubtotal);
    expect(calc.proposal.monthly).toBe(calc.proposal.counterSubtotal);
    // 提案側にリース料が入っていても、合計には乗らない
    expect(calc.proposal.leaseTotal).toBeGreaterThan(0);
    expect(calc.diffMonthly).toBe(calc.proposal.counterSubtotal - calc.current.counterSubtotal);
  });

  it("リース料金の内訳ブロックを出さず、理由を注記する", () => {
    const calc = calcFleet(fleet, TAX);
    const html = renderFleetCompareHtml(
      {
        id: "q", title: "", customerName: "テスト商事", customerHonorific: "御中",
        quoteNo: "1", quoteDate: "2026-08-23", area: "福岡",
        current: {
          makerText: "", modelText: "", monthlyLease: 0, monoPages: 0, colorPages: 0, twoColorPages: 0,
          units: { mono: 0, color: 0, twoColor: 0, minCharge: 0 }, maintenanceMonthly: 0,
        },
        proposals: [], fleet, createdAt: "", updatedAt: "",
      },
      fleet,
      calc,
      DEFAULT_SETTINGS,
    );
    expect(html).not.toContain("リ ー ス 料 金 詳 細 内 訳");
    expect(html).toContain("カ ウ ン タ ー 料 金 詳 細 内 訳 比 較");
    expect(html).toContain("カウンター料金 （単月）");
    expect(html).toContain("カウンター料金のみ");
  });

  it("リース料金が分かっていれば、これまでどおり内訳を出す", () => {
    const calc = calcFleet({ ...fleet, leaseUnknown: false }, TAX);
    expect(calc.current.monthly).toBe(calc.current.leaseTotal + calc.current.counterSubtotal);
  });
});
