import { describe, expect, it } from "vitest";
import { calcOptions, groupOptions, optionMonthlyLease } from "./proposal-doc";
import { calcCurrent, calcProposal } from "./pricing";
import { renderProposalDocHtml } from "./export/html";
import { DEFAULT_SETTINGS } from "./defaults";
import type { DeviceOption, DeviceSpec, Proposal, Quote } from "./types";

/**
 * 提案資料（写真入りのご提案書）。
 *
 * オプションは、お客様には「付けた場合に月々いくら増えるか」だけを見せる。
 * 定価も販売額も資料には出さない。
 */

const TAX = DEFAULT_SETTINGS.company.taxRate;

const option = (name: string, listPrice: number, patch: Partial<DeviceOption> = {}): DeviceOption => ({
  id: `o-${name}`,
  name,
  listPrice,
  ...patch,
});

const device: DeviceSpec = {
  id: "d1",
  maker: "KYOCERA",
  makerText: "京セラ",
  model: "TASKalfa 2554ci",
  ppmMono: 25,
  ppmColor: 25,
  firstCopyColorSec: 8.5,
  warmupSec: 18,
  maxPaperSize: "A3",
  photo: "aaaa1111.jpg",
  options: [
    option("両画面原稿送り装置", 130_000, { modelCode: "DP-7160", category: "原稿送り", photo: "bbbb2222.jpg" }),
    option("600枚×2段ペーパーフィーダー", 160_000, { category: "給紙" }),
    option("ID Printing Kit-L", 80_000, { category: "セキュリティ", description: "ICカードで利用者を認証します" }),
  ],
  source: { method: "manual" },
  updatedAt: "",
};

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
  units: { mono: 0.7, color: 7, twoColor: 2, minCharge: 2_000 },
  maintenanceMonthly: 0,
};

const quote = (): Quote => ({
  id: "q",
  title: "複合機入替のご提案",
  customerName: "テスト商事",
  customerHonorific: "御中",
  quoteNo: "137240",
  quoteDate: "2026-08-23",
  area: "福岡",
  staffName: "小坂 ケビン 絢太",
  current: {
    makerText: "リコー",
    modelText: "MPC3003SP",
    monthlyLease: 20_000,
    monoPages: 4_000,
    colorPages: 1_000,
    twoColorPages: 0,
    units: { mono: 1.5, color: 12, twoColor: 0, minCharge: 0 },
    maintenanceMonthly: 0,
  },
  proposals: [proposal],
  proposalDoc: {
    issues: ["朝の混雑時に印刷待ちが出ている", "カラーの単価が高い"],
  },
  createdAt: "",
  updatedAt: "",
});

describe("オプションを付けた場合の月額リース料", () => {
  it("定価の8掛けにリース料率を掛け、100円単位で切り上げる", () => {
    // 130,000 × 0.8 = 104,000 → × 0.0166 = 1,726.4 → 1,800
    expect(optionMonthlyLease(130_000, 72, DEFAULT_SETTINGS)).toEqual({
      price: 104_000,
      monthlyLeaseAdd: 1_800,
    });
  });

  it("リース年数を変えると月額も変わる", () => {
    const five = optionMonthlyLease(130_000, 60, DEFAULT_SETTINGS);
    const seven = optionMonthlyLease(130_000, 84, DEFAULT_SETTINGS);
    // 5年のほうが回数が少ないぶん月額は高い
    expect(five.monthlyLeaseAdd).toBeGreaterThan(seven.monthlyLeaseAdd);
    expect(five.price).toBe(seven.price);
  });

  it("掛け率は設定で変えられる", () => {
    const settings = {
      ...DEFAULT_SETTINGS,
      proposalDoc: { ...DEFAULT_SETTINGS.proposalDoc, optionPriceRate: 1 },
    };
    expect(optionMonthlyLease(130_000, 72, settings).price).toBe(130_000);
  });
});

describe("提案資料に載せるオプションの選択", () => {
  it("未選択のときは機種のオプションをすべて載せる", () => {
    const calc = calcOptions(proposal, device, DEFAULT_SETTINGS);
    expect(calc.map((o) => o.option.name)).toEqual([
      "両画面原稿送り装置",
      "600枚×2段ペーパーフィーダー",
      "ID Printing Kit-L",
    ]);
  });

  it("選んだものだけを、機種DBの並び順のまま載せる", () => {
    const calc = calcOptions(
      { ...proposal, optionIds: ["o-ID Printing Kit-L", "o-両画面原稿送り装置"] },
      device,
      DEFAULT_SETTINGS,
    );
    expect(calc.map((o) => o.option.name)).toEqual(["両画面原稿送り装置", "ID Printing Kit-L"]);
  });

  it("機種DBに無い機種ならオプションは空", () => {
    expect(calcOptions(proposal, undefined, DEFAULT_SETTINGS)).toEqual([]);
  });

  it("分類ごとにまとめる（分類なしは「オプション」）", () => {
    const groups = groupOptions(calcOptions(proposal, device, DEFAULT_SETTINGS));
    expect(groups.map((g) => g.category)).toEqual(["原稿送り", "給紙", "セキュリティ"]);
  });
});

describe("提案資料の中身", () => {
  const render = (photos = { current: "data:image/png;base64,AA", proposal: "data:image/png;base64,BB", byOption: {} }) => {
    const q = quote();
    const current = calcCurrent(q, TAX);
    const calc = calcProposal(q, proposal, DEFAULT_SETTINGS, { device });
    return renderProposalDocHtml(q, current, calc, DEFAULT_SETTINGS, photos);
  };

  it("表紙・現状とご提案・オプション・導入効果の4部で構成する", () => {
    const html = render();
    for (const heading of [
      "複合機 導入のご提案",
      "現状のご利用状況と、ご提案",
      "オプションのご紹介",
      "導入後の月々のご負担",
    ]) {
      expect(html, heading).toContain(heading);
    }
  });

  it("現行機と提案機の写真を載せる", () => {
    const html = render();
    expect(html).toContain("data:image/png;base64,AA");
    expect(html).toContain("data:image/png;base64,BB");
  });

  it("写真が無くても体裁を崩さない（枠だけ出す）", () => {
    const html = render({ current: undefined as unknown as string, proposal: undefined as unknown as string, byOption: {} });
    expect(html).toContain("写真未登録");
  });

  it("オプションは月額の上乗せ額だけを載せ、定価は載せない", () => {
    const html = render();
    expect(html).toContain("両画面原稿送り装置");
    expect(html).toContain("+1,800");
    // 定価も、8掛けした販売額も出さない
    expect(html).not.toContain("130,000");
    expect(html).not.toContain("104,000");
    expect(html).not.toContain("160,000");
    expect(html).not.toContain("80,000");
  });

  it("現状の課題を載せる", () => {
    expect(render()).toContain("朝の混雑時に印刷待ちが出ている");
  });

  it("月々の負担と削減額を載せる", () => {
    const html = render();
    expect(html).toContain("現在の月間経費（税込）");
    expect(html).toContain("月々の削減額");
  });
});
