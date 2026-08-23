import { calcFleet, hasFleet } from "./fleet";
import { loadPhotos } from "./photos";
import type { DocPhotos } from "./export/html";
import { calcCurrent, calcProposal } from "./pricing";
import { findServiceArea } from "./service-area";
import { deviceMap, findDeviceByModel, getPriceBook, getSettings } from "./store";
import type { CurrentCalc, FleetCalc, ProposalCalc, Quote, ServiceArea, Settings } from "./types";

export interface QuoteCalcResult {
  settings: Settings;
  current: CurrentCalc;
  proposals: ProposalCalc[];
  /** 複数台比較表の計算結果（複数台の案件のみ） */
  fleet?: FleetCalc;
  /** 選択された保守対応エリア（京セラ担当エリア表） */
  serviceArea?: ServiceArea;
}

/** 保存済みマスタを読み込んで案件全体を計算する（サーバー側専用） */
export async function calcQuoteAll(quote: Quote): Promise<QuoteCalcResult> {
  const [settings, book, devices, serviceArea] = await Promise.all([
    getSettings(),
    getPriceBook(),
    deviceMap(),
    findServiceArea(quote.serviceArea?.pref, quote.serviceArea?.city),
  ]);

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
        // 収録しているのは京セラの担当エリア表のため、単価判定に反映するのは京セラのみ
        serviceRank: p.maker === "KYOCERA" ? serviceArea?.rank : undefined,
        island: p.maker === "KYOCERA" ? serviceArea?.island : undefined,
      });
    }),
  );

  return {
    settings,
    current: calcCurrent(quote, settings.company.taxRate),
    proposals,
    fleet: hasFleet(quote.fleet) ? calcFleet(quote.fleet, settings.company.taxRate) : undefined,
    serviceArea,
  };
}


/**
 * 提案資料に載せる写真を data URI で読み込む。
 * 現行機の写真は、案件で指定があればそちら、無ければ機種DBのものを使う。
 */
export async function loadDocPhotos(quote: Quote, calc: ProposalCalc): Promise<DocPhotos> {
  const currentFile = quote.proposalDoc?.currentPhoto ?? calc.currentDevice?.photo;
  const optionFiles = calc.options.map((o) => o.option.photo);
  const map = await loadPhotos([currentFile, calc.device?.photo, ...optionFiles]);
  return {
    current: currentFile ? map[currentFile] : undefined,
    proposal: calc.device?.photo ? map[calc.device.photo] : undefined,
    byOption: map,
  };
}
