import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { calcCurrent, calcProposal } from "../pricing";
import { calcFleet } from "../fleet";
import type { Fleet, FleetSide, Proposal, Quote } from "../types";
import {
  renderCompareHtml,
  renderFleetCompareHtml,
  renderMultiCompareHtml,
  renderProposalDocHtml,
  renderQuoteHtml,
} from "./html";

/**
 * ロゴと角印をどの帳票に載せるか。
 *
 * 見積書・各社同時比較表・複数台比較表・ご提案書には載せる。
 * 複合機1台の比較表だけは、元のExcelと同じく題字だけの紙にする
 * （ご提案時は見積書と一緒にお渡しするので、二重に社名が出ない）。
 */

const LOGO = "data:image/png;base64,LOGO";
const SEAL = "data:image/png;base64,SEAL";

const quote: Quote = {
  id: "q",
  title: "複合機入替のご提案",
  customerName: "ヤハタ木工有限会社",
  customerHonorific: "御中",
  quoteNo: "137240",
  quoteDate: "2026-10-10",
  area: "福岡",
  current: {
    makerText: "コニカミノルタ",
    modelText: "bizhub C220",
    monthlyLease: 15_000,
    monoPages: 4_761,
    colorPages: 1_576,
    twoColorPages: 0,
    units: { mono: 2.42, color: 14.3, twoColor: 0, minCharge: 0 },
    maintenanceMonthly: 0,
  },
  proposals: [],
  createdAt: "",
  updatedAt: "",
};

const proposal: Proposal = {
  id: "p1",
  maker: "KYOCERA",
  modelText: "TASKalfa MZ2501ci",
  qty: 1,
  items: [{ name: "本体", qty: 1, unit: "台", unitPrice: 1_424_000 }],
  cost: 380_000,
  pricingMode: "fromGp",
  grossProfitAmount: 300_000,
  leaseTerm: 72,
  counterOverridden: false,
  maintenanceMonthly: 0,
};

const side = (over: Partial<FleetSide> = {}): FleetSide => ({
  makerText: "シャープ",
  modelText: "MX2661",
  ppm: 26,
  monthlyLease: 31_900,
  minCharge: 0,
  maintenanceMonthly: 0,
  lines: [{ name: "モノクロ", kind: "mono", pages: 2_738, tiers: [{ from: 1, to: null, unit: 2.0 }] }],
  ...over,
});
const fleet: Fleet = {
  enabled: true,
  pagesNote: "2026年9月度印刷枚数",
  leaseTerm: 72,
  units: [
    {
      id: "u1",
      location: "本社",
      current: side(),
      proposal: side({ makerText: "京セラ", modelText: "TASKalfa3554ci", ppm: 35, monthlyLease: 26_800 }),
    },
  ],
};

const q = { ...quote, proposals: [proposal] };
const current = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);

const docs: Record<string, (logo?: string, seal?: string) => string> = {
  見積書: (logo, seal) => renderQuoteHtml(q, calc, DEFAULT_SETTINGS, logo, seal),
  各社同時比較表: (logo, seal) => renderMultiCompareHtml(q, current, [calc], DEFAULT_SETTINGS, logo, seal),
  複数台比較表: (logo, seal) =>
    renderFleetCompareHtml({ ...q, fleet }, fleet, calcFleet(fleet, 0.1), DEFAULT_SETTINGS, logo, seal),
  ご提案書: (logo, seal) => renderProposalDocHtml(q, current, calc, DEFAULT_SETTINGS, { byOption: {} }, logo, seal),
};

describe("ロゴと角印", () => {
  for (const [name, render] of Object.entries(docs)) {
    it(`${name}にロゴと角印が入る`, () => {
      const html = render(LOGO, SEAL);
      expect(html, "ロゴ").toContain(LOGO);
      expect(html, "角印").toContain(SEAL);
    });

    it(`${name}は画像が未登録でも出せる`, () => {
      const html = render();
      // 画像が無いときは社名の文字で代わりにし、空の枠は残さない
      expect(html).not.toContain("<img class=\"seal\"");
      expect(html).toContain("株式会社Life Yokusuru");
    });
  }

  it("複合機1台の比較表には載せない（題字だけの紙にする）", () => {
    const html = renderCompareHtml(q, current, calc, DEFAULT_SETTINGS, LOGO, SEAL);
    expect(html).not.toContain(LOGO);
    expect(html).not.toContain(SEAL);
    expect(html).toContain("比　較　表");
  });
});
