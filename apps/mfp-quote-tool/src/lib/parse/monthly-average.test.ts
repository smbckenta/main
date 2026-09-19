import { describe, expect, it } from "vitest";
import { toMonthlyAverage } from "./counter";
import { pagesAverageNote } from "../labels";
import type { CounterReading } from "../types";

const month = (m: number, mono: number, color: number): CounterReading => ({
  serialNo: "W7M1234567",
  periodFrom: `2025-0${m}-01`,
  periodTo: `2025-0${m}-28`,
  monoPages: mono,
  colorPages: color,
  monoUnit: 1.2,
  colorUnit: 12,
  confidence: 0.9,
});

describe("複数月のカウンター明細の平均", () => {
  it("読み込んだ月数で割って月間平均にする", () => {
    const avg = toMonthlyAverage([
      month(1, 4_100, 1_010),
      month(2, 4_200, 1_020),
      month(3, 4_300, 1_030),
      month(4, 4_400, 1_040),
    ]);
    expect(avg.monoPages).toBe(4_250);
    expect(avg.colorPages).toBe(1_025);
    expect(avg.period).toEqual({ from: "2025-01-01", to: "2025-04-28", months: 4 });
  });

  it("集計期間を「（2025/01-2025/04平均印刷枚数）」として注記する", () => {
    const avg = toMonthlyAverage([month(1, 4_100, 1_010), month(2, 4_200, 1_020), month(3, 4_300, 1_030), month(4, 4_400, 1_040)]);
    expect(pagesAverageNote({ pagesPeriod: avg.period })).toBe("（2025/01-2025/04平均印刷枚数）");
  });

  it("1ヶ月分だけなら平均の注記は付けない", () => {
    const avg = toMonthlyAverage([month(3, 4_300, 1_030)]);
    expect(avg.monoPages).toBe(4_300);
    expect(avg.period).toBeUndefined();
    expect(pagesAverageNote({ pagesPeriod: avg.period })).toBe("");
  });

  it("複数台ぶんは合算し、期間は1台あたりの月数で数える", () => {
    const other = (m: number): CounterReading => ({ ...month(m, 1_000, 100), serialNo: "ZZ9876543" });
    const avg = toMonthlyAverage([month(1, 4_000, 1_000), month(2, 4_000, 1_000), other(1), other(2)]);
    expect(avg.monoPages).toBe(5_000);
    expect(avg.period?.months).toBe(2);
  });

  it("同じ明細を2回読み込んでも二重計上しない", () => {
    const avg = toMonthlyAverage([month(1, 4_000, 1_000), month(1, 4_000, 1_000), month(2, 4_400, 1_100)]);
    expect(avg.monoPages).toBe(4_200);
    expect(avg.period?.months).toBe(2);
  });
});
