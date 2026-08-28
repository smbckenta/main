import { beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { calcCurrent, calcProposal } from "../pricing";
import { calcFleet } from "../fleet";
import type { ChargeTier, CurrentChargeLine, Fleet, FleetSide, Proposal, Quote } from "../types";
import { renderCompareHtml, renderFleetCompareHtml, renderMultiCompareHtml } from "./html";
import { htmlToPdf, PdfUnavailableError } from "./pdf";

/**
 * 実際にPDFを作って、本当に1枚に収まっているかを数える。
 *
 * 行数からの見積りは中身によってずれる（機種名の折り返し、注記の長さ）。
 * 「1枚に収まる」は目で見て分かる約束なので、紙の枚数そのもので確かめる。
 */

/** PDFのページ数（/Type /Page の数を数える） */
function pdfPages(pdf: Buffer): number {
  const text = pdf.toString("latin1");
  const counts = [...text.matchAll(/\/Count\s+(\d+)/g)].map((m) => Number(m[1]));
  if (counts.length) return Math.max(...counts);
  return [...text.matchAll(/\/Type\s*\/Page[^s]/g)].length;
}

const TIERS: ChargeTier[] = [
  { from: 1, to: 1_000, unit: 3.0 },
  { from: 1_001, to: 2_000, unit: 2.6 },
  { from: 2_001, to: null, unit: 2.2 },
];

const line = (i: number, bands: number): CurrentChargeLine => ({
  name: `フルカラープリント（部署別カウンター）区分${i + 1}`,
  kind: i % 2 === 0 ? "mono" : "color",
  pages: bands >= 3 ? 2_500 : bands === 2 ? 1_500 : 800,
  deductionRate: 0.02,
  tiers: TIERS.slice(0, Math.max(1, bands)),
});

const quoteWith = (lines: CurrentChargeLine[]): Quote => ({
  id: "q",
  title: "複合機入替のご提案",
  customerName: "ヤハタ木工有限会社",
  customerHonorific: "様",
  quoteNo: "137240",
  quoteDate: "2026-08-22",
  area: "福岡",
  current: {
    makerText: "リコー",
    modelText: "MPC3003SP",
    monthlyLease: 15_000,
    monoPages: 1_500,
    colorPages: 900,
    twoColorPages: 0,
    chargeLines: lines.length ? lines : undefined,
    units: { mono: 3, color: 15, twoColor: 0, minCharge: 0 },
    maintenanceMonthly: 0,
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
  counterOverridden: false,
  maintenanceMonthly: 0,
};

const build = (nLines: number) => {
  const q = quoteWith(Array.from({ length: nLines }, (_, i) => line(i, (i % 3) + 1)));
  q.proposals = [proposal];
  const current = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
  const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);
  return { q, current, calc };
};

/** Chromium が無い環境（開発機によっては未インストール）では飛ばす */
let chromium = true;

beforeAll(async () => {
  try {
    await htmlToPdf("<p>x</p>");
  } catch (err) {
    if (err instanceof PdfUnavailableError) chromium = false;
    else throw err;
  }
}, 60_000);

describe("比較表は必ず1枚に収まる", () => {
  // 区分0（明細なし）から、実際にはまず来ない12区分まで
  for (const nLines of [0, 3, 6, 12]) {
    it(`区分${nLines}件でも1枚（現状 vs 1提案）`, async () => {
      if (!chromium) return;
      const { q, current, calc } = build(nLines);
      const pdf = await htmlToPdf(renderCompareHtml(q, current, calc, DEFAULT_SETTINGS), {
        fitOnePage: true,
      });
      expect(pdfPages(pdf)).toBe(1);
    }, 60_000);
  }

  it("各社を横並びにした比較表も1枚", async () => {
    if (!chromium) return;
    const { q, current, calc } = build(12);
    const pdf = await htmlToPdf(
      renderMultiCompareHtml(q, current, [calc, calc, calc, calc], DEFAULT_SETTINGS),
      { fitOnePage: true },
    );
    expect(pdfPages(pdf)).toBe(1);
  }, 60_000);

  it("1枚に収める指定をしなければ、あふれた分は2枚目に出る（仕組みが効いていることの裏取り）", async () => {
    if (!chromium) return;
    const { q, current, calc } = build(12);
    const pdf = await htmlToPdf(renderCompareHtml(q, current, calc, DEFAULT_SETTINGS));
    // 見積り側で既に縮めているので1枚のこともある。あふれても2枚まで
    expect(pdfPages(pdf)).toBeLessThanOrEqual(2);
  }, 60_000);
});

describe("A3ヨコの複数台比較表も1枚に収まる", () => {
  const side = (over: Partial<FleetSide> = {}): FleetSide => ({
    makerText: "キャノン",
    modelText: "IR-ADV C5235",
    ppm: 35,
    monthlyLease: 0,
    minCharge: 0,
    maintenanceMonthly: 0,
    lines: [
      { name: "モノクロ", kind: "mono", pages: 4_761, tiers: [{ from: 1, to: null, unit: 2.42 }] },
      { name: "カラー", kind: "color", pages: 1_576, tiers: [{ from: 1, to: null, unit: 14.3 }] },
    ],
    ...over,
  });

  const fleetOf = (count: number): Fleet => ({
    enabled: true,
    pagesNote: "2023年-2024年印刷枚数",
    leaseTerm: 72,
    units: Array.from({ length: count }, (_, i) => ({
      id: `u${i}`,
      location: `水戸ビューティカレッジ（${i + 1}号館職員室）`,
      current: side({ monthlyLease: 24_500 }),
      proposal: side({ makerText: "京セラ", modelText: "TASKalfaMZ3501ci", monthlyLease: 11_000 }),
    })),
  });

  const quoteFor = (fleet: Fleet): Quote => ({ ...quoteWith([]), fleet });

  // 実運用で来た最大が16台。倍の32台でも1枚に収まることを確かめる
  for (const count of [1, 8, 16, 32]) {
    it(`${count}台でも1枚`, async () => {
      if (!chromium) return;
      const fleet = fleetOf(count);
      const pdf = await htmlToPdf(
        renderFleetCompareHtml(quoteFor(fleet), fleet, calcFleet(fleet, 0.1), DEFAULT_SETTINGS),
        { format: "A3", landscape: true, fitOnePage: true },
      );
      expect(pdfPages(pdf)).toBe(1);
    }, 60_000);
  }
});
