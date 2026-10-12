import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { applyGrossProfitToAll, calcFleet } from "../fleet";
import type { Fleet, FleetSide, FleetUnit, PriceBook, Quote, QuoteItem } from "../types";
import { renderFleetQuoteHtml } from "./html";

/**
 * 複数台の御見積書。
 *
 * これまでは1台ぶんの見積書しか出せず、3台の案件でも1台ぶんの金額しか
 * 紙に載らなかった。台数ぶんを1枚にまとめて、設置場所ごとの内訳が
 * 読み取れるようにする。
 */

/** 仕切表のひな型（本体・原稿送り装置・ＦＡＸ・給紙段・設置工事費） */
const bookItems = (model: string): QuoteItem[] => [
  { name: `${model}　本体`, qty: 1, unit: "台", unitPrice: 1_424_000 },
  { name: "両画面原稿送り装置", qty: 1, unit: "台", unitPrice: 130_000 },
  { name: "ＦＡＸキット", qty: 1, unit: "台", unitPrice: 170_000 },
  { name: "600枚*2段ペーパーフィーダー", qty: 1, unit: "台", unitPrice: 160_000 },
  { name: "設置工事費", qty: 1, unit: "式", unitPrice: 53_000 },
];

const BOOK: PriceBook = {
  version: "test",
  source: "test",
  makerNotes: {},
  entries: ["mz2501ci", "mz3501ci", "mz4001ci"].map((id, i) => ({
    id,
    maker: "KYOCERA" as const,
    model: `TASKalfa ${id.toUpperCase()}`,
    category: "A3カラー",
    gradePpm: 25,
    listPrice: 1_937_000,
    cost: [455_800, 498_900, 616_100][i],
    items: bookItems(`TASKalfa ${id.toUpperCase()}`),
  })),
};

const proposalSide = (model: string, cost: number, addOn = 0, bookId?: string): FleetSide => ({
  makerText: "京セラ",
  modelText: model,
  ppm: 25,
  monthlyLease: 0,
  lines: [
    { name: "白黒モード", kind: "mono", pages: 3_000, tiers: [{ from: 1, to: null, unit: 0.7 }] },
    { name: "フルカラー", kind: "color", pages: 1_200, tiers: [{ from: 1, to: null, unit: 7 }] },
  ],
  minCharge: 900,
  maintenanceMonthly: 0,
  pricing: { mode: "fromGp", priceBookId: bookId, cost, grossProfitAmount: 0, addOnTotal: addOn },
});

const currentSide = (model: string): FleetSide => ({
  makerText: "シャープ",
  modelText: model,
  monthlyLease: 15_000,
  lines: [
    { name: "白黒モード", kind: "mono", pages: 3_000, tiers: [{ from: 1, to: null, unit: 1.2 }] },
    { name: "フルカラー", kind: "color", pages: 1_200, tiers: [{ from: 1, to: null, unit: 12 }] },
  ],
  minCharge: 0,
  maintenanceMonthly: 0,
});

const unit = (
  id: string,
  location: string,
  model: string,
  cost?: number,
  addOn = 0,
  bookId?: string,
): FleetUnit => ({
  id,
  location,
  current: currentSide("MX-2650FN"),
  proposal: cost === undefined ? currentSide("MX-2650FN") : proposalSide(model, cost, addOn, bookId),
});

const fleet: Fleet = {
  enabled: true,
  leaseTerm: 72,
  units: [
    unit("a", "本社2階 事務所", "TASKalfa MZ2501ci", 455_800, 0, "mz2501ci"),
    unit("b", "久留米支店", "TASKalfa MZ3501ci", 498_900, 0, "mz3501ci"),
    unit("c", "博多営業所", "TASKalfa MZ4001ci", 616_100, 0, "mz4001ci"),
  ],
};

const quote: Quote = {
  id: "q",
  title: "複合機入替のご提案",
  customerName: "ヤハタ木工有限会社",
  customerHonorific: "御中",
  quoteNo: "137240",
  quoteDate: "2026-10-12",
  area: "福岡",
  current: {
    makerText: "シャープ",
    modelText: "MX-2650FN",
    monthlyLease: 15_000,
    monoPages: 3_000,
    colorPages: 1_200,
    twoColorPages: 0,
    units: { mono: 1.2, color: 12, twoColor: 0, minCharge: 0 },
    maintenanceMonthly: 0,
  },
  proposals: [],
  createdAt: "",
  updatedAt: "",
};

const render = (f: Fleet) =>
  renderFleetQuoteHtml(
    { ...quote, fleet: f },
    f,
    calcFleet(f, DEFAULT_SETTINGS.company.taxRate, DEFAULT_SETTINGS),
    DEFAULT_SETTINGS,
    BOOK,
  );

describe("複数台の御見積書", () => {
  const { fleet: priced } = applyGrossProfitToAll(fleet, {
    mode: "fromGp",
    grossProfitAmount: 300_000,
  });
  const html = render(priced);

  it("設置場所ごとに小見出しを立てて、全台ぶんを載せる", () => {
    expect(html).toContain("本社2階 事務所");
    expect(html).toContain("久留米支店");
    expect(html).toContain("博多営業所");
    expect(html).toContain("TASKalfa MZ2501ci");
    expect(html).toContain("TASKalfa MZ3501ci");
    expect(html).toContain("TASKalfa MZ4001ci");
  });

  it("物件名に台数が出る", () => {
    expect(html).toContain("複合機　入替一式（3台）");
  });

  it("台ごとに構成一式をすべて並べる（仕切表のひな型をそのまま）", () => {
    // 仕切価格は通常構成を含んだ額。見積書には構成品がすべて出る
    for (const name of [
      "両画面原稿送り装置",
      "ＦＡＸキット",
      "600枚*2段ペーパーフィーダー",
      "設置工事費",
    ]) {
      expect(html, name).toContain(name);
    }
    // 3台ぶんなので、同じ品目が3回ずつ出る
    expect(html.split("ＦＡＸキット").length - 1).toBe(3);
  });

  it("台ごとに 小計・お値引き・販売額計 を出す", () => {
    expect(html.split(">小計<").length - 1).toBe(3);
    expect(html.split(">お値引き<").length - 1).toBe(3);
    // 1台ぶんの小計は構成一式の定価合計
    expect(html).toContain((1_937_000).toLocaleString("ja-JP"));
    // 1台ぶんの販売額計 = 仕切 + GP
    expect(html).toContain((455_800 + 300_000).toLocaleString("ja-JP"));
  });

  it("最後に全台の 本体合計・お値引き計・販売額計 を出す", () => {
    const list = 1_937_000 * 3;
    const selling = 455_800 + 300_000 + (498_900 + 300_000) + (616_100 + 300_000);
    expect(html).toContain("本体合計（3台）");
    expect(html).toContain("お値引き計");
    expect(html).toContain("販売額計（3台）");
    expect(html).toContain(list.toLocaleString("ja-JP"));
    expect(html).toContain(selling.toLocaleString("ja-JP"));
    expect(html).toContain((list - selling).toLocaleString("ja-JP"));
  });

  it("通常構成以外の追加オプションがあるときだけ、別の行を立てる", () => {
    expect(html).not.toContain("追加オプション");
    const extra: Fleet = {
      ...priced,
      units: priced.units.map((u, i) =>
        i === 0
          ? { ...u, proposal: { ...u.proposal, pricing: { ...u.proposal.pricing!, addOnTotal: 80_000 } } }
          : u,
      ),
    };
    const out = render(extra);
    expect(out).toContain("追加オプション");
    expect(out.split("追加オプション").length - 1).toBe(1);
  });

  it("仕切表に無い台は、機種名ひとつにまとめる（空欄を残さない）", () => {
    const noBook: Fleet = {
      ...priced,
      units: [
        {
          ...priced.units[0],
          proposal: {
            ...priced.units[0].proposal,
            pricing: { ...priced.units[0].proposal.pricing!, priceBookId: undefined },
          },
        },
      ],
    };
    const out = render(noBook);
    expect(out).toContain("TASKalfa MZ2501ci　一式");
    expect(out).not.toContain("ＦＡＸキット");
  });

  it("月額リース料金は3台ぶんの合計", () => {
    const calc = calcFleet(priced, DEFAULT_SETTINGS.company.taxRate, DEFAULT_SETTINGS);
    expect(calc.proposal.leaseMonthly).toBeGreaterThan(0);
    expect(html).toContain(calc.proposal.leaseMonthly.toLocaleString("ja-JP"));
  });

  it("カウンター単価が全台同じなら、表は1つにまとめる", () => {
    // 台ごとの見出しを立てず、区分の行だけを出す
    expect(html).not.toContain("【No.1・2・3");
    expect(html).toContain("白黒モード");
    expect(html).toContain("フルカラー");
  });

  it("カウンター単価が違う台があれば、分けて出す", () => {
    const mixed: Fleet = {
      ...priced,
      units: priced.units.map((u, i) =>
        i === 2
          ? {
              ...u,
              proposal: {
                ...u.proposal,
                lines: u.proposal.lines.map((l) => ({
                  ...l,
                  tiers: [{ from: 1, to: null, unit: l.kind === "mono" ? 0.9 : 9 }],
                })),
              },
            }
          : u,
      ),
    };
    const out = render(mixed);
    expect(out).toContain("【No.1・2");
    expect(out).toContain("【No.3");
  });

  it("据え置く台は機器明細に出さず、そのことを注記する", () => {
    const withKeep: Fleet = {
      ...priced,
      units: [...priced.units, unit("d", "倉庫", "MX-2650FN")],
    };
    const out = render(withKeep);
    expect(out).toContain("販売額計（3台）");
    expect(out).toContain("本見積の機器明細には含めておりません");
    expect(out).toContain("倉庫");
  });

  it("リースシミュレーションは台数ぶんの合計で出す", () => {
    expect(html).toContain("3台合計");
    expect(html).toContain("本見積の条件");
  });
});
