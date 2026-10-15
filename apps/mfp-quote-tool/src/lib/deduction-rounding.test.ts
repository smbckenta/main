import { describe, expect, it } from "vitest";
import { calcChargeLine, calcChargeLines } from "./pricing";
import type { CurrentChargeLine } from "./types";

/**
 * 控除カウントの端数の扱い。
 *
 * 一律に切り上げていたため、シャープの明細で請求額が11円足りなくなった。
 * 実物の明細を並べると、丸め方はメーカーによって逆になっている。
 *
 *   リコー  （MPC3003SP）  1,389枚の2% = 27.78 → 28枚（切り上げ）
 *   シャープ（BP-60C26）   3,899枚の1% = 38.99 → 38枚（切り捨て）
 *
 * 片方に合わせれば必ずもう片方がずれるので、率から丸め方を決めない。
 * 明細に書いてある枚数、無ければ明細に書いてある金額に合わせる。
 *
 * ここがずれると、画面もPDFも正しく動いたまま現行の請求額だけが変わり、
 * 削減額の説明がお客様の請求書と合わなくなる。
 */

/* ── シャープ BP-60C26（2023/12/10〜2024/03/10・小計 47,371円） ──
 * モノクロ      40,292 − 33,791 = 6,501枚、枚数控除(1.00%) 65枚、6,436枚 × 1.00円 = 6,436円
 * フルカラー    24,573 − 20,674 = 3,899枚、枚数控除(1.00%) 38枚、3,861枚 × 10.00円 = 38,610円
 * 2色カラー      2,129 −  1,664 =   465枚、控除なし、       465枚 ×  5.00円 =  2,325円
 */
const sharp = {
  mono: {
    name: "モノクロ",
    kind: "mono",
    pages: 6_501,
    deductionRate: 0.01,
    tiers: [{ from: 1, to: null, unit: 1.0 }],
    amount: 6_436,
  },
  color: {
    name: "フルカラー",
    kind: "color",
    pages: 3_899,
    deductionRate: 0.01,
    tiers: [{ from: 1, to: null, unit: 10.0 }],
    amount: 38_610,
  },
  twoColor: {
    name: "2色カラー",
    kind: "twoColor",
    pages: 465,
    tiers: [{ from: 1, to: null, unit: 5.0 }],
    amount: 2_325,
  },
} satisfies Record<string, CurrentChargeLine>;

/* ── リコー MPC3003SP（2026年5月分）。こちらは切り上げでないと合わない ── */
const ricohMono: CurrentChargeLine = {
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

describe("明細に控除カウントが書いてある場合", () => {
  it("その枚数をそのまま使う（率から計算し直さない）", () => {
    const calc = calcChargeLine({ ...sharp.mono, deductionPages: 65 });
    expect(calc.deduction).toBe(65);
    expect(calc.deductionBasis).toBe("listed");
    expect(calc.billablePages).toBe(6_436);
    expect(calc.amount).toBe(6_436);
  });

  it("率が書かれていなくても、枚数だけで引ける", () => {
    const calc = calcChargeLine({ ...sharp.color, deductionRate: undefined, deductionPages: 38 });
    expect(calc.deduction).toBe(38);
    expect(calc.amount).toBe(38_610);
  });

  it("カウントより多い控除は読み違いとして無視する（マイナス請求にしない）", () => {
    const calc = calcChargeLine({ ...sharp.twoColor, deductionPages: 9_999 });
    expect(calc.billablePages).toBe(0);
    expect(calc.amount).toBe(0);
  });
});

describe("率しか分からないが、明細に金額が書いてある場合", () => {
  it("シャープは切り捨てでないと合わない（38.99 → 38枚）", () => {
    const calc = calcChargeLine(sharp.color);
    expect(calc.deduction).toBe(38); // 切り上げなら39枚で38,600円になってしまう
    expect(calc.deductionBasis).toBe("amount");
    expect(calc.amount).toBe(38_610);
    expect(calc.amountDiff).toBe(0);
  });

  it("リコーは切り上げでないと合わない（27.78 → 28枚）", () => {
    const calc = calcChargeLine(ricohMono);
    expect(calc.deduction).toBe(28); // 切り捨てなら27枚で金額がずれる
    expect(calc.amount).toBe(3_938);
    expect(calc.amountDiff).toBe(0);
  });

  it("どの枚数でも金額に合わない場合は切り上げのまま（勝手に合わせ込まない）", () => {
    // 金額だけ読み違えている明細。±1枚の範囲では合わないので既定に戻す
    const calc = calcChargeLine({ ...sharp.color, amount: 12_345 });
    expect(calc.deduction).toBe(39);
    expect(calc.deductionBasis).toBe("ceil");
    expect(calc.amountDiff).not.toBe(0); // 画面に「明細と合わない」と出る
  });
});

describe("シャープ BP-60C26 の明細（小計 47,371円）", () => {
  const lines = [sharp.mono, sharp.color, sharp.twoColor];

  it("区分ごとの金額が明細どおり", () => {
    expect(calcChargeLines(lines).map((l) => l.amount)).toEqual([6_436, 38_610, 2_325]);
  });

  it("カウンター請求合計が明細の小計と1円まで一致する", () => {
    const total = calcChargeLines(lines).reduce((sum, l) => sum + l.amount, 0);
    expect(total).toBe(47_371);
  });

  it("切り上げていた頃の47,360円には戻らない", () => {
    const total = calcChargeLines(lines).reduce((sum, l) => sum + l.amount, 0);
    expect(total).not.toBe(47_360);
  });

  it("控除の無い区分には控除を掛けない（2色カラーは465枚のまま）", () => {
    const calc = calcChargeLine(sharp.twoColor);
    expect(calc.deduction).toBe(0);
    expect(calc.deductionBasis).toBe("none");
    expect(calc.amount).toBe(2_325);
  });
});
