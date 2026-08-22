import { autoCounterUnits, recommendEntry, recommendGrade } from "./pricing";
import { findDeviceByModel, getPriceBook, getSettings, newId } from "./store";
import { lookupSpec } from "./specs/lookup";
import type { LeaseTerm, Maker, PriceBookEntry, Proposal, Quote } from "./types";

export interface BuildProposalOptions {
  /** 仕切表の機種を明示指定する場合 */
  priceBookId?: string;
  leaseTerm?: LeaseTerm;
  /** インターネットからスペックを取りに行くか */
  fetchSpec?: boolean;
}

/**
 * メーカーを指定して提案を1件組み立てる。
 *  - 月間印刷枚数から〇〇枚機を判定し、仕切表から機種を選ぶ
 *  - 見積明細は仕切表のひな型を使う
 *  - カウンター単価はエリア×印刷量から自動判定
 */
export async function buildProposal(
  quote: Quote,
  maker: Maker,
  options: BuildProposalOptions = {},
): Promise<{ proposal: Proposal; entry?: PriceBookEntry; specFetched: boolean; message?: string }> {
  const [settings, book] = await Promise.all([getSettings(), getPriceBook()]);
  const totalPages = quote.current.monoPages + quote.current.colorPages + quote.current.twoColorPages;
  const targetPpm = recommendGrade(settings, totalPages);

  const entry = options.priceBookId
    ? book.entries.find((e) => e.id === options.priceBookId)
    : recommendEntry(book.entries, maker, targetPpm);

  if (!entry) {
    return {
      proposal: emptyProposal(maker, options.leaseTerm),
      specFetched: false,
      message: `${maker} の機種が仕切表に登録されていません。仕切表画面から登録してください。`,
    };
  }

  // スペックはDB優先、無ければ（指定時のみ）インターネット取得
  let device = await findDeviceByModel(entry.model);
  let specFetched = false;
  if (!device && options.fetchSpec) {
    const result = await lookupSpec(entry.model, maker);
    device = result.device;
    specFetched = result.origin === "web";
  }

  const units = autoCounterUnits(settings, quote, maker, book.makerNotes[maker]);
  const items = entry.items.length
    ? entry.items.map((i) => ({ ...i }))
    : [{ name: `${entry.model}　一式`, qty: 1, unit: "式", unitPrice: entry.listPrice }];

  const proposal: Proposal = {
    id: newId(),
    maker,
    priceBookId: entry.id,
    modelText: entry.model,
    deviceId: device?.id,
    qty: 1,
    items,
    cost: entry.cost,
    // 既定は「仕切＋GP」。GPの初期値は既定の粗利率から逆算した額を入れておく
    pricingMode: "fromGp",
    grossProfitAmount: Math.round(
      (entry.cost / (1 - Math.min(Math.max(settings.defaultMarginRate, 0), 0.95)) - entry.cost) / 1000,
    ) * 1000,
    marginRate: settings.defaultMarginRate,
    leaseTerm: options.leaseTerm ?? 72,
    units,
    counterOverridden: false,
    maintenanceMonthly: 0,
  };

  return { proposal, entry, specFetched };
}

function emptyProposal(maker: Maker, leaseTerm?: LeaseTerm): Proposal {
  return {
    id: newId(),
    maker,
    modelText: "",
    qty: 1,
    items: [],
    pricingMode: "fromMargin",
    leaseTerm: leaseTerm ?? 72,
    counterOverridden: false,
    maintenanceMonthly: 0,
  };
}
