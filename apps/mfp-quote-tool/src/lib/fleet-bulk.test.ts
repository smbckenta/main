import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import {
  applyCommonTerms,
  applyGrossProfitToAll,
  calcFleet,
  isEmptyTerms,
  isPriceable,
  isReplaced,
  totalGrossProfit,
} from "./fleet";
import type { Fleet, FleetSide, FleetUnit } from "./types";

/**
 * 全台の粗利をまとめて決める。
 *
 * 台数が多い案件で1台ずつ同じ数字を入れ直すのは、手間なだけでなく
 * 1台だけ入れ忘れたときに気づけない。まとめて当てて、
 * 何台に当たったかを返す。
 */

const side = (model: string, cost?: number): FleetSide => ({
  makerText: "京セラ",
  modelText: model,
  monthlyLease: 0,
  lines: [{ name: "モノクロ", kind: "mono", pages: 1_000, tiers: [{ from: 1, to: null, unit: 1 }] }],
  minCharge: 0,
  maintenanceMonthly: 0,
  ...(cost === undefined ? {} : { pricing: { mode: "fromGp" as const, cost, grossProfitAmount: 0 } }),
});

const unit = (id: string, location: string, cost?: number): FleetUnit => ({
  id,
  location,
  current: side("MX-2650FN"),
  proposal: side("TASKalfa MZ2501ci", cost),
});

const fleetOf = (units: FleetUnit[]): Fleet => ({ enabled: true, leaseTerm: 72, units });

describe("全台の粗利をまとめて決める", () => {
  it("仕切価格が入っている台だけに当たる", () => {
    const fleet = fleetOf([
      unit("a", "本社", 455_800),
      unit("b", "久留米支店", 498_900),
      // 据え置く台（仕切価格なし）には当てない
      unit("c", "倉庫"),
    ]);
    expect(fleet.units.map(isPriceable)).toEqual([true, true, false]);

    const result = applyGrossProfitToAll(fleet, { mode: "fromGp", grossProfitAmount: 300_000 });
    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(1);
    expect(result.fleet.units.map((u) => u.proposal.pricing?.grossProfitAmount)).toEqual([
      300_000,
      300_000,
      undefined,
    ]);
  });

  it("仕切価格はそのまま。粗利だけを入れ替える", () => {
    const fleet = fleetOf([unit("a", "本社", 455_800)]);
    const result = applyGrossProfitToAll(fleet, { mode: "fromGp", grossProfitAmount: 250_000 });
    expect(result.fleet.units[0].proposal.pricing?.cost).toBe(455_800);
    expect(result.fleet.units[0].proposal.pricing?.mode).toBe("fromGp");
  });

  it("粗利率でもまとめて当てられる", () => {
    const fleet = fleetOf([unit("a", "本社", 400_000), unit("b", "支店", 500_000)]);
    const result = applyGrossProfitToAll(fleet, { mode: "fromMargin", marginRate: 0.4 });
    expect(result.applied).toBe(2);
    for (const u of result.fleet.units) {
      expect(u.proposal.pricing?.mode).toBe("fromMargin");
      expect(u.proposal.pricing?.marginRate).toBe(0.4);
    }
  });

  it("桁違いの入力で壊れない（マイナスは0、粗利率は95%まで）", () => {
    const fleet = fleetOf([unit("a", "本社", 400_000)]);
    expect(
      applyGrossProfitToAll(fleet, { mode: "fromGp", grossProfitAmount: -50_000 }).fleet.units[0]
        .proposal.pricing?.grossProfitAmount,
    ).toBe(0);
    expect(
      applyGrossProfitToAll(fleet, { mode: "fromMargin", marginRate: 3 }).fleet.units[0].proposal
        .pricing?.marginRate,
    ).toBe(0.95);
  });

  it("当てたあとの粗利合計が、1台当たり×台数になる", () => {
    const fleet = fleetOf([
      unit("a", "本社", 455_800),
      unit("b", "久留米支店", 498_900),
      unit("c", "博多営業所", 616_100),
    ]);
    const { fleet: applied } = applyGrossProfitToAll(fleet, {
      mode: "fromGp",
      grossProfitAmount: 300_000,
    });
    const calc = calcFleet(applied, DEFAULT_SETTINGS.company.taxRate, DEFAULT_SETTINGS);
    expect(totalGrossProfit(calc)).toBe(900_000);
  });

  it("元の案件は書き換えない（やり直せるように）", () => {
    const fleet = fleetOf([unit("a", "本社", 455_800)]);
    applyGrossProfitToAll(fleet, { mode: "fromGp", grossProfitAmount: 300_000 });
    expect(fleet.units[0].proposal.pricing?.grossProfitAmount).toBe(0);
  });
});

describe("全台に同じ条件をまとめて入れる", () => {
  /** 据え置く台（提案側が現行の写し）を1台混ぜた案件 */
  const mixed = () =>
    fleetOf([
      unit("a", "本社", 455_800),
      unit("b", "久留米支店", 498_900),
      {
        id: "c",
        location: "倉庫",
        current: side("MX-2650FN"),
        // 据え置き：機種も現行のまま、仕切価格なし
        proposal: side("MX-2650FN"),
      },
    ]);

  it("入れ替える台と、据え置く台を見分ける", () => {
    expect(mixed().units.map(isReplaced)).toEqual([true, true, false]);
  });

  it("カウンター単価と最低基本料金を全台に入れる", () => {
    const result = applyCommonTerms(mixed(), {
      unitPrices: { mono: 0.7, color: 7 },
      minCharge: 900,
    });
    expect(result.applied).toBe(2);
    expect(result.skipped).toBe(1);

    for (const u of result.fleet.units.slice(0, 2)) {
      expect(u.proposal.lines.map((l) => l.tiers[0].unit)).toEqual([0.7]);
      expect(u.proposal.minCharge).toBe(900);
    }
    // 据え置く台は現行の契約のまま
    expect(result.fleet.units[2].proposal.minCharge).toBe(0);
    expect(result.fleet.units[2].proposal.lines[0].tiers[0].unit).toBe(1);
  });

  it("空のままの欄は触らない", () => {
    const before = applyCommonTerms(mixed(), { minCharge: 900 }).fleet;
    // 単価は指定していないので、元のまま
    expect(before.units[0].proposal.lines[0].tiers[0].unit).toBe(1);
    expect(before.units[0].proposal.minCharge).toBe(900);

    // 粗利だけを入れ直しても、単価と基本料金は動かない
    const after = applyCommonTerms(before, {
      grossProfit: { mode: "fromGp", grossProfitAmount: 250_000 },
    });
    expect(after.fleet.units[0].proposal.minCharge).toBe(900);
    expect(after.fleet.units[0].proposal.pricing?.grossProfitAmount).toBe(250_000);
  });

  it("単価は段を1本にそろえる（当社の提案は一律単価）", () => {
    const tiered = fleetOf([
      {
        ...unit("a", "本社", 455_800),
        proposal: {
          ...side("TASKalfa MZ2501ci", 455_800),
          lines: [
            {
              name: "モノクロ",
              kind: "mono" as const,
              pages: 1_000,
              tiers: [
                { from: 1, to: 1_000, unit: 3 },
                { from: 1_001, to: null, unit: 2 },
              ],
            },
          ],
        },
      },
    ]);
    const out = applyCommonTerms(tiered, { unitPrices: { mono: 0.8 } });
    expect(out.fleet.units[0].proposal.lines[0].tiers).toEqual([{ from: 1, to: null, unit: 0.8 }]);
  });

  it("粗利は仕切価格が入っている台だけに入る", () => {
    // 機種は変わるが、月額リース料を手入力した台（仕切価格なし）
    const handPriced = fleetOf([
      {
        id: "a",
        location: "本社",
        current: side("MX-2650FN"),
        proposal: { ...side("TASKalfa MZ2501ci"), monthlyLease: 12_000 },
      },
    ]);
    const out = applyCommonTerms(handPriced, {
      unitPrices: { mono: 0.7 },
      grossProfit: { mode: "fromGp", grossProfitAmount: 300_000 },
    });
    // 単価は入るが、粗利の決め方は作られない
    expect(out.applied).toBe(1);
    expect(out.fleet.units[0].proposal.lines[0].tiers[0].unit).toBe(0.7);
    expect(out.fleet.units[0].proposal.pricing).toBeUndefined();
  });

  it("何も指定していなければ、入れるものが無いと分かる", () => {
    expect(isEmptyTerms({})).toBe(true);
    expect(isEmptyTerms({ unitPrices: { mono: undefined } })).toBe(true);
    expect(isEmptyTerms({ unitPrices: { mono: 0.7 } })).toBe(false);
    expect(isEmptyTerms({ minCharge: 0 })).toBe(false);
    expect(isEmptyTerms({ grossProfit: { mode: "fromGp", grossProfitAmount: 0 } })).toBe(false);
  });

  it("全台同じ単価にすれば、見積書は1通にまとまる", async () => {
    const { counterGroups } = await import("./fleet");
    const spread = applyCommonTerms(mixed(), { unitPrices: { mono: 0.7 }, minCharge: 900 }).fleet;
    const replaced = spread.units.filter(isReplaced);
    expect(counterGroups(replaced)).toHaveLength(1);
  });

  it("元の案件は書き換えない（やり直せるように）", () => {
    const f = mixed();
    applyCommonTerms(f, { unitPrices: { mono: 0.7 }, minCharge: 900 });
    expect(f.units[0].proposal.minCharge).toBe(0);
    expect(f.units[0].proposal.lines[0].tiers[0].unit).toBe(1);
  });
});
