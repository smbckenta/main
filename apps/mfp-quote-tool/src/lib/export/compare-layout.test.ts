import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { calcCurrent, calcProposal } from "../pricing";
import type { ChargeTier, CurrentChargeLine, DeviceSpec, Proposal, Quote } from "../types";
import { renderCompareHtml } from "./html";

/**
 * 比較表の体裁（A4たて1枚・お客様の前で開いて説明する紙）。
 * 既存Excelの様式に合わせてあるので、崩れていないかを押さえておく。
 */

const TIERS: ChargeTier[] = [
  { from: 1, to: 1_000, unit: 3.0 },
  { from: 1_001, to: 2_000, unit: 2.6 },
];
const lines: CurrentChargeLine[] = [
  { name: "モノカラー総出力", kind: "mono", pages: 1_389, deductionRate: 0.02, tiers: TIERS, amount: 3_938 },
  { name: "フルカラープリント", kind: "color", pages: 382, deductionRate: 0.03, tiers: [{ from: 1, to: 1_000, unit: 13.9 }], amount: 5_143 },
];
const spec = (model: string, over: Partial<DeviceSpec> = {}): DeviceSpec => ({
  id: model, maker: "RICOH", model, source: { method: "manual" }, updatedAt: "", ...over,
});
const quote: Quote = {
  id: "q", title: "複合機入替のご提案", customerName: "ヤハタ木工有限会社", customerHonorific: "様",
  quoteNo: "137247", quoteDate: "2026-09-19", area: "福岡",
  current: {
    makerText: "リコー", modelText: "MPC3003SP", monthlyLease: 15_000, monoPages: 1_389,
    colorPages: 382, twoColorPages: 0, chargeLines: lines,
    units: { mono: 0, color: 0, twoColor: 0, minCharge: 0 }, maintenanceMonthly: 0,
  },
  proposals: [], createdAt: "", updatedAt: "",
};
const proposal: Proposal = {
  id: "p1", maker: "KYOCERA", modelText: "TASKalfa 2554ci", qty: 1,
  items: [{ name: "本体", qty: 1, unit: "台", unitPrice: 1_180_000 }], cost: 380_000,
  pricingMode: "fromGp", grossProfitAmount: 300_000, leaseTerm: 72,
  counterOverridden: false, maintenanceMonthly: 0,
};

const render = (opts: { specs?: boolean } = {}) => {
  const q = { ...quote, proposals: [proposal] };
  const current = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
  const calc = calcProposal(q, proposal, DEFAULT_SETTINGS, {
    currentDevice: opts.specs ? spec("MPC3003SP", { warmupSec: 19, ppmMono: 30, ppmColor: 30 }) : undefined,
    device: opts.specs ? spec("TASKalfa 2554ci", { maker: "KYOCERA", warmupSec: 20, ppmMono: 25, ppmColor: 25 }) : undefined,
  });
  return renderCompareHtml(q, current, calc, DEFAULT_SETTINGS);
};

describe("比較表の体裁", () => {
  it("区分ごとに、帯の単価と金額を並べる", () => {
    const html = render();
    // 単価は明細と同じ「3.0」の書き方
    expect(html).toContain(">3.0</span>円");
    expect(html).toContain(">2.6</span>円");
    expect(html).toContain("モノカラー総出力：1〜1,000枚");
    expect(html).toContain("モノカラー総出力：1,001〜2,000枚");
  });

  it("控除は独立した行で引き、各行の合計が明細の請求額と一致する", () => {
    const html = render();
    // 1,000×3.0 ＋ 389×2.6 − 28×2.6 = 3,000 ＋ 1,011 − 73 = 3,938
    expect(html).toContain(">3,000<");
    expect(html).toContain(">1,010<");
    expect(html).toContain(">−72<".replace("−", "-"));
    // 明細の合計（3,938 ＋ 5,143 ＝ 9,081）
    expect(html).toContain(">9,081<");
  });

  it("スペックが分かっている項目だけ行を出す", () => {
    expect(render()).not.toContain("ウォームタイム");
    expect(render({ specs: true })).toContain("ウォームタイム");
  });

  it("カウンター削減額を黄色地の赤字で出す", () => {
    const html = render();
    expect(html).toContain('class="save-label">カウンター削減額');
    expect(html).toContain('class="save-value"');
    expect(html).toMatch(/\.save-value \{[^}]*background: #ffff00/);
  });

  it("合計合算削減金額を3段で大きく出す", () => {
    const html = render();
    expect(html).toContain("合計合算削減金額　（単月）");
    expect(html).toContain("合計合算削減金額　（年間）");
    expect(html).toContain("合計合算削減金額　（6年間）");
    expect(html).toMatch(/\.save-summary td\.num \{[^}]*font-size: 1\.62em/);
  });

  it("年間売上高に換算した効果を、左の一言と並べて出す", () => {
    const html = render();
    expect(html).toContain("年間売上高に換算したコスト削減効果");
    expect(html).toContain("右記程度の「売上高が増加した」");
    expect(html).toContain('class="rate-20"');
  });

  it("控除があることと、提案側には無いことを注記する", () => {
    const html = render();
    // 率は明細のとおり（枚数から割り戻さない）
    expect(html).toContain("モノカラー総出力 2%（▲28枚）");
    expect(html).toContain("ご提案する複合機には控除がございません");
  });
});
