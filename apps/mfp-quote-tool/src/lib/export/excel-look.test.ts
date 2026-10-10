import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { calcCurrent, calcProposal } from "../pricing";
import { calcFleet } from "../fleet";
import type { ChargeTier, CurrentChargeLine, Fleet, FleetSide, Proposal, Quote } from "../types";
import { renderCompareHtml, renderFleetCompareHtml, renderQuoteHtml } from "./html";

/**
 * 見積書・比較表の見た目が、元のExcel（お客様が長く使ってきた様式）から
 * ずれていないかを押さえる。
 *
 * 色・書体・罫線は「AIが作ったもの」に見せないための肝なので、
 * 数字が合っていても体裁が変わっていれば直す。
 */

const TIERS: ChargeTier[] = [{ from: 1, to: null, unit: 2.2 }];
const lines: CurrentChargeLine[] = [
  { name: "ブラックプリント", kind: "mono", pages: 4_761, tiers: TIERS },
];

const quote: Quote = {
  id: "q",
  title: "複合機入替のご提案",
  customerName: "ヤハタ木工有限会社",
  customerHonorific: "御中",
  quoteNo: "137240",
  quoteDate: "2026-08-22",
  area: "福岡",
  current: {
    makerText: "コニカミノルタ",
    modelText: "Bizhub C220",
    monthlyLease: 15_000,
    monoPages: 4_761,
    colorPages: 1_576,
    twoColorPages: 0,
    chargeLines: lines,
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

const q = { ...quote, proposals: [proposal] };
const current = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);

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
  pagesNote: "2023年12月度印刷枚数",
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

describe("元のExcelと同じ体裁", () => {
  it("書体はメイリオ（Windowsに必ず入っている、元のExcelと同じ書体）", () => {
    for (const html of [renderQuoteHtml(q, calc, DEFAULT_SETTINGS), renderCompareHtml(q, current, calc, DEFAULT_SETTINGS)]) {
      expect(html).toContain('"Meiryo UI", "メイリオ", "Meiryo"');
    }
  });

  it("見積書の表の見出しは薄緑、罫線は黒", () => {
    const html = renderQuoteHtml(q, calc, DEFAULT_SETTINGS);
    expect(html).toMatch(/--head-green: #ccffcc;/);
    expect(html).toMatch(/body\.quote \.grid thead th \{[^}]*background: var\(--head-green\)/);
    expect(html).toMatch(/\.grid th, \.grid td \{ border: 1px solid var\(--line\)/);
    expect(html).toMatch(/--line: #000;/);
  });

  it("見積書は「御　見　積　書」「月額リース料金」「お値引き」をExcelと同じ並びで出す", () => {
    const html = renderQuoteHtml(q, calc, DEFAULT_SETTINGS);
    expect(html).toContain("御　見　積　書");
    expect(html).toContain("下記の通り御見積申し上げます。何卒よろしくお願い致します。");
    expect(html).toContain('class="label">月額リース料金');
    // お値引きは赤字、金額は括弧書き
    expect(html).toMatch(/discount-row[^>]*>.*お値引き/s);
    expect(html).toMatch(/\(\d[\d,]*\)/);
    expect(html).toContain("【カウンター料金】");
    expect(html).toContain("【リースシミュレーション】");
  });

  it("見積書のカウンター単価は赤、リース料は橙のセルで出す", () => {
    const html = renderQuoteHtml(q, calc, DEFAULT_SETTINGS);
    expect(html).toContain('class="num unit-red"');
    expect(html).toContain('class="num lease-unit"');
    expect(html).toMatch(/\.lease-unit \{ background: #fabf8f; \}/);
  });

  it("比較表は題字と（現行➡提案）だけを置き、社名の帯は入れない", () => {
    const html = renderCompareHtml(q, current, calc, DEFAULT_SETTINGS);
    expect(html).toContain("比　較　表");
    expect(html).toContain("コニカミノルタ　➡　京セラ");
    // 元のExcelの比較表には自社の連絡先欄が無い
    expect(html).not.toContain("見積番号");
  });

  it("比較表の区分名の列は、スペックは薄緑・カウンターは薄灰（Excelと同じ）", () => {
    const html = renderCompareHtml(q, current, calc, DEFAULT_SETTINGS);
    expect(html).toMatch(/\.cmp tbody th \{[^}]*background: var\(--label-green\)/);
    expect(html).toMatch(/\.cmp tbody tr\.row-counter th \{ background: var\(--label-gray\); \}/);
    expect(html).toContain('class="row-counter"');
  });

  it("複数台比較表はExcelと同じ4ブロック（灰色の表頭・黒帯の合計・黄色の削減料金）", () => {
    const html = renderFleetCompareHtml({ ...q, fleet }, fleet, calcFleet(fleet, 0.1), DEFAULT_SETTINGS);
    expect(html).toContain("-  リ ー ス 料 金 詳 細 内 訳  -");
    expect(html).toContain("-  カ ウ ン タ ー 料 金 詳 細 内 訳　 比 較 -");
    expect(html).toContain("-  合 計  -");
    expect(html).toContain("-  ト ー タ ル 削 減 料 金  -");
    expect(html).toMatch(/body\.fleet \.grid thead th \{[^}]*background: #bfbfbf/);
    expect(html).toMatch(/body\.fleet \.grid tbody tr\.total-row td \{[^}]*background: #0d0d0d/);
    expect(html).toMatch(/\.band\.band-save \{ background: #ffff00; \}/);
    // 台ごとに消費税の行を立て、請求金額は税込
    expect(html).toContain("消費税（10％）");
  });

  it("複数台比較表は設置場所・メーカー・印刷速度をExcelと同じ欄に出す", () => {
    const html = renderFleetCompareHtml({ ...q, fleet }, fleet, calcFleet(fleet, 0.1), DEFAULT_SETTINGS);
    expect(html).toContain("<th>設置場所</th>");
    expect(html).toContain("<th>物件名</th>");
    expect(html).toContain("<th>提案機種</th>");
    expect(html).toContain("<th>月額リース料金</th>");
    expect(html).toContain("1分/26枚");
    expect(html).toContain("1分/35枚");
  });
});
