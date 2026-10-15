import { describe, expect, it } from "vitest";
import { mergeChargeLines } from "./ingest";
import { pagesAverageNote } from "./labels";
import { toMonthlyAverage } from "./parse/counter";
import type { CounterReading } from "./types";

/**
 * 明細の期間と、表に並べる「1ヶ月あたり」の基準をそろえる。
 *
 * カウンター請求は3ヶ月に1度まとめて来ることがある。
 * 月間印刷枚数（monoPages ほか）は明細の期間で割って月平均にしているので、
 * カウンター料金の内訳（chargeLines）だけ期間ぶんの枚数のままにすると、
 * 同じ表の左（現行）が3ヶ月ぶん・右（提案）が1ヶ月ぶんになる。
 * 現行のカウンター料金が3倍に見え、削減額もそのぶん大きく出てしまう。
 *
 * 実際に、2023/12/10〜2024/03/10（3ヶ月ぶん）の明細1枚で作った比較表が
 * この形になっていた。基準がずれていても画面は正しく動くので、ここで止める。
 */

/** シャープ BP-60C26（2023/12/10〜2024/03/10・3ヶ月ぶんで1枚） */
const quarterly: CounterReading = {
  serialNo: "25050035",
  periodFrom: "2023-12-10",
  periodTo: "2024-03-10",
  monoPages: 6_501,
  colorPages: 3_899,
  twoColorPages: 465,
  chargeLines: [
    {
      name: "モノクロ",
      kind: "mono",
      pages: 6_501,
      deductionRate: 0.01,
      deductionPages: 65,
      tiers: [{ from: 1, to: null, unit: 1.0 }],
      amount: 6_436,
    },
    {
      name: "フルカラー",
      kind: "color",
      pages: 3_899,
      deductionRate: 0.01,
      deductionPages: 38,
      tiers: [{ from: 1, to: null, unit: 10.0 }],
      amount: 38_610,
    },
    {
      name: "2色カラー",
      kind: "twoColor",
      pages: 465,
      tiers: [{ from: 1, to: null, unit: 5.0 }],
      amount: 2_325,
    },
  ],
  confidence: 0.9,
};

/** 1ヶ月ぶんの明細 */
const monthly: CounterReading = {
  ...quarterly,
  periodFrom: "2024-02-10",
  periodTo: "2024-03-10",
  chargeLines: quarterly.chargeLines!.map((l) => ({ ...l })),
};

describe("1枚の明細が数ヶ月ぶんをまとめている場合", () => {
  it("内訳の枚数も1ヶ月あたりに直す（月間印刷枚数と基準をそろえる）", () => {
    const lines = mergeChargeLines([quarterly])!;
    expect(lines.map((l) => l.pages)).toEqual([2_167, 1_300, 155]);

    // 月間印刷枚数のほうも同じ期間で割られている
    const avg = toMonthlyAverage([quarterly]);
    expect(avg.monoPages).toBe(2_167);
    expect(avg.colorPages).toBe(1_300);
    expect(avg.twoColorPages).toBe(155);
  });

  it("割った後の枚数とは対応しない「明細の金額」「控除カウント」は落とす", () => {
    const lines = mergeChargeLines([quarterly])!;
    for (const line of lines) {
      expect(line.amount).toBeUndefined();
      expect(line.deductionPages).toBeUndefined();
    }
    // 控除率は残す（割った後の枚数から計算し直せるように）
    expect(lines[0].deductionRate).toBe(0.01);
  });

  it("平均にしたことが表に出る（注記が付く）", () => {
    const avg = toMonthlyAverage([quarterly]);
    expect(avg.period).toEqual({ from: "2023-12-10", to: "2024-03-10", months: 3 });
    expect(pagesAverageNote({ pagesPeriod: avg.period })).toBe("（2023/12-2024/03平均印刷枚数）");
  });
});

describe("1ヶ月ぶんの明細1枚", () => {
  it("明細どおりに使う（金額も控除カウントも残して検算できるようにする）", () => {
    const lines = mergeChargeLines([monthly])!;
    expect(lines.map((l) => l.pages)).toEqual([6_501, 3_899, 465]);
    expect(lines[0].amount).toBe(6_436);
    expect(lines[0].deductionPages).toBe(65);
  });

  it("平均ではないので注記は付けない", () => {
    expect(pagesAverageNote({ pagesPeriod: toMonthlyAverage([monthly]).period })).toBe("");
  });
});

describe("複数枚の明細", () => {
  it("読み込んだ月数で割る（枚数の多い月に引っ張られない）", () => {
    const feb: CounterReading = {
      ...monthly,
      periodFrom: "2024-01-10",
      periodTo: "2024-02-10",
      chargeLines: monthly.chargeLines!.map((l) => ({ ...l, pages: l.pages * 3 })),
    };
    const lines = mergeChargeLines([feb, monthly])!;
    // (6,501 + 19,503) ÷ 2ヶ月 = 13,002
    expect(lines[0].pages).toBe(13_002);
    expect(lines[0].amount).toBeUndefined();
  });
});
