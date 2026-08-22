import * as cheerio from "cheerio";
import type { DeviceSpec, Maker } from "../types";
import { MAKER_LABELS } from "../types";
import { detectMaker } from "../parse/normalize";
import { findDeviceByModel, upsertDevice } from "../store";
import { extractSpecTable, specFromTable } from "./parse-spec-html";

/** メーカー公式サイトのドメイン（検索を公式に限定するため） */
const MAKER_SITES: Record<Maker, string[]> = {
  KYOCERA: ["kyoceradocumentsolutions.co.jp"],
  TOSHIBA: ["toshibatec.co.jp"],
  FUJIFILM: ["fujifilm.com", "fujifilm.co.jp"],
  SHARP: ["jp.sharp", "sharp.co.jp"],
  RICOH: ["ricoh.co.jp"],
  CANON: ["canon.jp"],
  KONICA_MINOLTA: ["konicaminolta.jp"],
  OTHER: [],
};

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchText(url: string, timeoutMs = 12_000): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, "Accept-Language": "ja,en;q=0.8" },
    });
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** DuckDuckGo(HTML版)で公式サイト内の仕様ページを検索する */
async function searchSpecPages(maker: Maker, model: string): Promise<string[]> {
  const sites = MAKER_SITES[maker] ?? [];
  const siteQuery = sites.map((s) => `site:${s}`).join(" OR ");
  const query = `${MAKER_LABELS[maker] ?? ""} ${model} 仕様 ${siteQuery}`.trim();
  const html = await fetchText(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  if (!html) return [];

  const $ = cheerio.load(html);
  const urls: string[] = [];
  $("a.result__a, a.result__url").each((_, a) => {
    const href = $(a).attr("href");
    if (!href) return;
    const m = href.match(/uddg=([^&]+)/); // DuckDuckGoのリダイレクトURL
    const url = m ? decodeURIComponent(m[1]) : href;
    if (/^https?:\/\//.test(url) && !urls.includes(url)) urls.push(url);
  });

  const score = (u: string) =>
    (sites.some((s) => u.includes(s)) ? 4 : 0) +
    (/(spec|仕様|specification)/i.test(u) ? 2 : 0) +
    (/(mfp|copier|printer|product)/i.test(u) ? 1 : 0);
  return urls.sort((a, b) => score(b) - score(a)).slice(0, 5);
}

export interface LookupResult {
  device?: DeviceSpec;
  url?: string;
  /** local: DBヒット / web: インターネット取得 / miss: 取得失敗 */
  origin: "local" | "web" | "miss";
  message?: string;
  rawTable?: RawTable;
}

type RawTable = Record<string, string>;

/**
 * 機種スペックを取得する。
 *  1. ローカルDB（毎回インターネットに出ないためのキャッシュ）
 *  2. メーカー公式サイトの仕様ページ
 * 取得できたものはDBに保存し、次回以降はローカルヒットになる。
 */
export async function lookupSpec(
  model: string,
  makerHint?: Maker,
  options: { forceRefresh?: boolean } = {},
): Promise<LookupResult> {
  const cleanModel = model.trim();
  if (!cleanModel) return { origin: "miss", message: "型番が空です。" };

  if (!options.forceRefresh) {
    const cached = await findDeviceByModel(cleanModel);
    if (cached) return { device: cached, origin: "local", url: cached.source.url };
  }

  const maker = makerHint ?? detectMaker(cleanModel) ?? "OTHER";
  const urls = await searchSpecPages(maker, cleanModel);
  if (!urls.length) {
    return {
      origin: "miss",
      message: "仕様ページを見つけられませんでした。機種DB画面から手入力で登録してください。",
    };
  }

  for (const url of urls) {
    const html = await fetchText(url);
    if (!html) continue;
    const table = extractSpecTable(html);
    if (Object.keys(table).length < 4) continue;
    const partial = specFromTable(table);
    // 比較表に必要な速度系が1つも取れないページは仕様表ではないと判断する
    if (!partial.ppmColor && !partial.ppmMono && !partial.warmupSec) continue;

    const device = await upsertDevice({
      maker,
      makerText: MAKER_LABELS[maker],
      model: cleanModel,
      ...partial,
      source: { method: "web", url, fetchedAt: new Date().toISOString() },
    });
    return { device, url, origin: "web", rawTable: table };
  }

  return {
    origin: "miss",
    message:
      "仕様ページは見つかりましたが、仕様表を読み取れませんでした。機種DB画面から手入力で登録してください。",
  };
}
