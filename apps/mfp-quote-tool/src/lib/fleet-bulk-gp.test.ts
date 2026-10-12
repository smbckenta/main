import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import { applyGrossProfitToAll, calcFleet, isPriceable, totalGrossProfit } from "./fleet";
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
