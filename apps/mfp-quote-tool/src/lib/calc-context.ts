import { calcCurrent, calcProposal } from "./pricing";
import { deviceMap, findDeviceByModel, getPriceBook, getSettings } from "./store";
import type { CurrentCalc, ProposalCalc, Quote, Settings } from "./types";

export interface QuoteCalcResult {
  settings: Settings;
  current: CurrentCalc;
  proposals: ProposalCalc[];
}

/** 保存済みマスタを読み込んで案件全体を計算する（サーバー側専用） */
export async function calcQuoteAll(quote: Quote): Promise<QuoteCalcResult> {
  const [settings, book, devices] = await Promise.all([getSettings(), getPriceBook(), deviceMap()]);

  const currentDevice = quote.current.deviceId
    ? devices[quote.current.deviceId]
    : quote.current.modelText
      ? await findDeviceByModel(quote.current.modelText)
      : undefined;

  const proposals = await Promise.all(
    quote.proposals.map(async (p) => {
      const device = p.deviceId ? devices[p.deviceId] : await findDeviceByModel(p.modelText);
      const priceBook = p.priceBookId ? book.entries.find((e) => e.id === p.priceBookId) : undefined;
      return calcProposal(quote, p, settings, {
        device,
        currentDevice,
        priceBook,
        makerNote: book.makerNotes[p.maker],
      });
    }),
  );

  return {
    settings,
    current: calcCurrent(quote, settings.company.taxRate),
    proposals,
  };
}
