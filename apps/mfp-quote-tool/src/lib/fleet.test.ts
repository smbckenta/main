import { describe, expect, it } from "vitest";
import { calcFleet, calcFleetSide, copySide, hasFleet } from "./fleet";
import { fitZoom, renderFleetCompareHtml } from "./export/html";
import { DEFAULT_SETTINGS } from "./defaults";
import type { CurrentChargeLine, Fleet, FleetSide, FleetUnit } from "./types";

/**
 * 実際に運用しているA3ヨコの複数台比較表（学校法人・16台／見積番号136984）から
 * 代表的な4台を抜き出して検算する。
 *
 * 金額は帯ごとに切り捨てるため（リコーのパフォーマンスチャージ明細に合わせた丸め）、
 * 端数を丸めないExcelとは1台あたり最大1円ずれる。合計への影響はないが、
 * どちらの値なのかが後から分かるようテストにも書き残しておく。
 */

const TAX = 0.1;

const line = (
  name: string,
  kind: CurrentChargeLine["kind"],
  pages: number,
  unit: number,
  to: number | null = null,
): CurrentChargeLine => ({ name, kind, pages, tiers: [{ from: 1, to, unit }] });

const side = (patch: Partial<FleetSide>): FleetSide => ({
  makerText: "",
  modelText: "",
  monthlyLease: 0,
  lines: [],
  minCharge: 0,
  maintenanceMonthly: 0,
  ...patch,
});

/** 1台目：モノクロのみ。カウンターが最低基本料金を下回る */
const unit1: FleetUnit = {
  id: "u1",
  location: "水戸経理専門学校（1号館職員室）",
  current: side({
    makerText: "キャノン",
    modelText: "IR-ADV 4525F",
    ppm: 25,
    note: "A3モノクロ複合機",
    lines: [line("モノクロ", "mono", 266, 1.3)],
    minCharge: 1430,
  }),
  proposal: side({
    makerText: "キャノン",
    modelText: "IR-ADV 4525F",
    ppm: 25,
    lines: [line("モノクロ", "mono", 266, 1.3, 4000)],
    minCharge: 1430,
  }),
};

/** 4台目：キヤノン → 京セラへ入替。モノクロ＋カラー */
const unit4: FleetUnit = {
  id: "u4",
  location: "水戸ビューティカレッジ（9号館職員室）",
  current: side({
    makerText: "キャノン",
    modelText: "IR-ADV C5235",
    ppm: 35,
    lines: [line("モノクロ", "mono", 4_761, 2.42), line("カラー", "color", 1_576, 14.3)],
  }),
  proposal: side({
    makerText: "京セラ",
    modelText: "TASKalfaMZ3501ci",
    ppm: 35,
    monthlyLease: 11_000,
    lines: [line("モノクロ", "mono", 4_761, 0.46), line("カラー", "color", 1_576, 4.6)],
  }),
};

/** 7台目：理想科学。カウンターとは別に月額保守料金がかかる（入替なし） */
const unit7: FleetUnit = {
  id: "u7",
  location: "水戸経理専門学校（1号館職員室）",
  current: side({
    makerText: "理想科学",
    modelText: "ORPHIS FT5230",
    ppm: 120,
    note: "A4高速インクジェット FAXなし",
    lines: [line("モノクロ", "mono", 23_100, 0.55), line("カラー", "color", 0, 1.44)],
    maintenanceMonthly: 15_666,
  }),
  proposal: side({
    makerText: "理想科学",
    modelText: "ORPHIS FT5230",
    ppm: 120,
    lines: [line("モノクロ", "mono", 23_100, 0.55), line("カラー", "color", 0, 1.44)],
    maintenanceMonthly: 15_666,
  }),
};

/** 16台目：レンタル（現行にリース料がある唯一の台） */
const unit16: FleetUnit = {
  id: "u16",
  location: "11号館経理課",
  current: side({
    makerText: "シャープ",
    modelText: "MX-2650FN",
    ppm: 26,
    note: "レンタル",
    monthlyLease: 24_500,
    lines: [line("モノクロ", "mono", 791, 3), line("カラー", "color", 0, 18)],
  }),
  proposal: side({
    makerText: "京セラ",
    modelText: "TASKalfaMZ2501ci",
    ppm: 25,
    monthlyLease: 10_000,
    lines: [line("モノクロ", "mono", 791, 0.46), line("カラー", "color", 0, 4.6)],
  }),
};

const fleet: Fleet = {
  enabled: true,
  pagesNote: "2023年-2024年印刷枚数",
  leaseTerm: 72,
  units: [unit1, unit4, unit7, unit16],
};

describe("複数台比較表：1台ぶんの請求金額", () => {
  it("最低基本料金を下回る月は、その額に置き換える（加算しない）", () => {
    const calc = calcFleetSide(unit1.current, TAX);
    expect(calc.meteredSubtotal).toBe(345); // 266枚 × 1.3円
    expect(calc.minChargeApplied).toBe(true);
    expect(calc.counterBeforeTax).toBe(1_430);
    expect(calc.counterTax).toBe(143);
    expect(calc.counterTotal).toBe(1_573); // 明細どおり
  });

  it("月額保守料金はカウンターとは別に加算する（最低基本料金と違う扱い）", () => {
    const calc = calcFleetSide(unit7.current, TAX);
    expect(calc.meteredSubtotal).toBe(12_705); // 23,100枚 × 0.55円
    expect(calc.maintenanceMonthly).toBe(15_666);
    expect(calc.counterBeforeTax).toBe(28_371);
    expect(calc.counterTotal).toBe(31_208); // 明細どおり
  });

  it("区分ごとに単価×枚数を足し上げ、消費税を乗せる", () => {
    const calc = calcFleetSide(unit4.current, TAX);
    // 4,761枚×2.42円 ＋ 1,576枚×14.3円（帯ごと切り捨て）
    expect(calc.lines.map((l) => l.amount)).toEqual([11_521, 22_536]);
    expect(calc.counterBeforeTax).toBe(34_057);
    expect(calc.counterTotal).toBe(37_463); // Excel（丸めなし）では 37,464
    expect(calc.minChargeApplied).toBe(false);
  });

  it("チャージ枚数の帯（1-4000 など）を入れても、帯の中なら金額は変わらない", () => {
    expect(calcFleetSide(unit1.proposal, TAX).meteredSubtotal).toBe(345);
  });
});

describe("複数台比較表：全台の合計", () => {
  const calc = calcFleet(fleet, TAX);

  it("リース料金は台数ぶんを合計し、消費税を乗せる", () => {
    // 現行でリース料があるのは16台目（レンタル 24,500円）だけ
    expect(calc.current.leaseMonthly).toBe(24_500);
    expect(calc.current.leaseTax).toBe(2_450);
    expect(calc.current.leaseTotal).toBe(26_950);
    // 提案は 11,000 + 10,000
    expect(calc.proposal.leaseMonthly).toBe(21_000);
    expect(calc.proposal.leaseTotal).toBe(23_100);
  });

  it("カウンター料金 小計は、台ごとの請求金額（税込）の合計", () => {
    expect(calc.current.counterSubtotal).toBe(1_573 + 37_463 + 31_208 + 2_610);
    expect(calc.proposal.counterSubtotal).toBe(1_573 + 10_383 + 31_208 + 399);
  });

  it("合計金額 = リース料金 合計 ＋ カウンター料金 小計", () => {
    expect(calc.current.monthly).toBe(26_950 + 72_854);
    expect(calc.proposal.monthly).toBe(23_100 + 43_563);
  });

  it("年間・リース年数ぶんは単月から伸ばす", () => {
    expect(calc.current.yearly).toBe(calc.current.monthly * 12);
    expect(calc.current.longTerm).toBe(calc.current.monthly * 72);
    expect(calc.leaseYears).toBe(6);
  });

  it("削減額はマイナスが削減。単月・年間・リース年数ぶんの3段で出す", () => {
    expect(calc.diffMonthly).toBe(66_663 - 99_804);
    expect(calc.diffYearly).toBe(calc.diffMonthly * 12);
    expect(calc.diffLeaseTerm).toBe(calc.diffMonthly * 72);
    expect(calc.diffMonthly).toBeLessThan(0);
  });

  it("リース年数を変えると、合計も削減もその年数に合わせる", () => {
    const five = calcFleet({ ...fleet, leaseTerm: 60 }, TAX);
    expect(five.leaseYears).toBe(5);
    expect(five.current.longTerm).toBe(five.current.monthly * 60);
    expect(five.diffLeaseTerm).toBe(five.diffMonthly * 60);

    const seven = calcFleet({ ...fleet, leaseTerm: 84 }, TAX);
    expect(seven.leaseYears).toBe(7);
    expect(seven.diffLeaseTerm).toBe(seven.diffMonthly * 84);
    // 単月と年間はリース年数によらず同じ
    expect(seven.diffMonthly).toBe(five.diffMonthly);
    expect(seven.diffYearly).toBe(five.diffYearly);
  });

  it("削減率は現行の合計金額に対する割合", () => {
    expect(calc.reductionRate).toBeCloseTo(-33_141 / 99_804, 6);
  });

  it("通し番号は入力順に振る", () => {
    expect(calc.units.map((u) => u.no)).toEqual([1, 2, 3, 4]);
    expect(calc.units[0].unit.location).toBe("水戸経理専門学校（1号館職員室）");
  });
});

describe("入替しない台の入力", () => {
  it("現行をそのまま写せる（写した先を変えても元は変わらない）", () => {
    const copied = copySide(unit4.current);
    copied.lines[0].pages = 1;
    copied.lines[0].tiers[0].unit = 99;
    expect(unit4.current.lines[0].pages).toBe(4_761);
    expect(unit4.current.lines[0].tiers[0].unit).toBe(2.42);
  });

  it("現行のまま据え置くと、その台の差額は0になる", () => {
    const calc = calcFleet({ ...fleet, units: [unit7] }, TAX);
    expect(calc.diffMonthly).toBe(0);
    expect(calc.reductionRate).toBe(0);
  });
});

describe("複数台比較表を出せるか", () => {
  it("台が1件も無ければ出さない", () => {
    expect(hasFleet(undefined)).toBe(false);
    expect(hasFleet({ ...fleet, units: [] })).toBe(false);
    expect(hasFleet({ ...fleet, enabled: false })).toBe(false);
    expect(hasFleet(fleet)).toBe(true);
  });
});

describe("A3ヨコの複数台比較表（HTML）", () => {
  const calc = calcFleet(fleet, TAX);
  const html = renderFleetCompareHtml(
    {
      id: "q",
      title: "複合機入替のご提案",
      customerName: "学校法人テスト学園",
      customerHonorific: "御中",
      quoteNo: "136984",
      quoteDate: "2026-08-22",
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
      fleet,
      createdAt: "",
      updatedAt: "",
    },
    fleet,
    calc,
    DEFAULT_SETTINGS,
  );

  it("A3ヨコで組む", () => {
    expect(html).toContain("size: A3 landscape");
    expect(html).toContain('<body class="fleet">');
  });

  it("4つのブロックをこの順に並べる", () => {
    const order = ["リ ー ス 料 金 詳 細 内 訳", "カ ウ ン タ ー 料 金 詳 細 内 訳 比 較", "合 計", "ト ー タ ル 削 減 料 金"];
    let at = -1;
    for (const title of order) {
      const found = html.indexOf(title);
      expect(found, title).toBeGreaterThan(at);
      at = found;
    }
  });

  it("台ごとに設置場所・現行機・提案機を並べる", () => {
    expect(html).toContain("水戸ビューティカレッジ（9号館職員室）");
    expect(html).toContain("IR-ADV C5235");
    expect(html).toContain("TASKalfaMZ3501ci");
    expect(html).toContain("11号館経理課");
  });

  it("見出しに現行メーカーと提案メーカーを並べる", () => {
    expect(html).toContain("キャノン・理想科学・シャープ 複合機");
    expect(html).toContain("キャノン・京セラ・理想科学 複合機");
    expect(html).toContain("全4台");
  });

  it("最低基本料金・月額保守料金の行を出す", () => {
    expect(html).toContain("最低基本料金");
    expect(html).toContain("月額保守料金");
  });

  it("消費税は行を増やさず、請求金額の欄に併記する（A3一枚に収めるため）", () => {
    // 1台目：税抜1,430＋税143＝1,573
    expect(html).toContain("税抜 1,430＋税 143");
  });

  it("集計期間を見出しに添える", () => {
    expect(html).toContain("2023年-2024年印刷枚数");
  });

  it("合計と削減額を出す", () => {
    expect(html).toContain("カウンター料金 小計");
    expect(html).toContain("合計金額 （6年間）");
    expect(html).toContain("合計合算削減金額 （6年間）");
    expect(html).toContain("削減率");
    // 提案のほうが安いので、削減は▲表示になる
    expect(html).toContain("▲33,141");
  });
});

describe("控除がある台の複数台比較表", () => {
  /** 現行に2%控除、提案には控除なし */
  const deducted: FleetUnit = {
    id: "d1",
    location: "本社",
    current: side({
      makerText: "リコー",
      modelText: "MPC3003SP",
      lines: [
        { ...line("モノクロ", "mono", 1_000, 1), deductionRate: 0.02 },
        { ...line("カラー", "color", 1_000, 10), deductionRate: 0.02 },
      ],
    }),
    proposal: side({
      makerText: "京セラ",
      modelText: "TASKalfa 2554ci",
      lines: [line("モノクロ", "mono", 1_000, 0.5), line("カラー", "color", 1_000, 5)],
    }),
  };
  const calc = calcFleet({ ...fleet, units: [deducted] }, TAX);

  it("現行は控除後の枚数、提案は実枚数で計算する", () => {
    expect(calc.units[0].current.meteredSubtotal).toBe(980 + 9_800);
    expect(calc.units[0].current.deductedPages).toBe(40);
    expect(calc.units[0].proposal.meteredSubtotal).toBe(500 + 5_000);
    expect(calc.units[0].proposal.deductedPages).toBe(0);
  });

  it("控除があることを表にも書く", () => {
    const html = renderFleetCompareHtml(
      {
        id: "q", title: "", customerName: "テスト商事", customerHonorific: "御中",
        quoteNo: "1", quoteDate: "2026-08-22", area: "福岡",
        current: {
          makerText: "", modelText: "", monthlyLease: 0, monoPages: 0, colorPages: 0, twoColorPages: 0,
          units: { mono: 0, color: 0, twoColor: 0, minCharge: 0 }, maintenanceMonthly: 0,
        },
        proposals: [], createdAt: "", updatedAt: "",
      },
      fleet,
      calc,
      DEFAULT_SETTINGS,
    );
    expect(html).toContain("1,000枚−控除20枚");
    expect(html).toContain("980枚");
    expect(html).toContain("ご提案する複合機には控除がないため");
  });
});

describe("A3ヨコ1枚に収めるための縮小率", () => {
  it("行数が少ないうちは縮めない", () => {
    expect(fitZoom(0)).toBe(1);
    expect(fitZoom(35)).toBe(1);
  });

  it("行数が増えるほど小さくする", () => {
    const a = fitZoom(50);
    const b = fitZoom(70);
    expect(a).toBeLessThan(1);
    expect(b).toBeLessThan(a);
  });

  it("読めなくなる手前で止める（それ以上は2枚に分ける）", () => {
    expect(fitZoom(10_000)).toBe(0.45);
  });
});
