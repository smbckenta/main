import * as cheerio from "cheerio";
import type { DeviceOption, DeviceSpec, Maker } from "../types";
import { MAKER_LABELS } from "../types";
import { detectMaker } from "../parse/normalize";
import { findDeviceByModel, upsertDevice } from "../store";
import { extractSpecTable, specFromTable } from "./parse-spec-html";
import { extractOptions, extractProductImage } from "./product-assets";
import { savePhoto } from "../photos";

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

/** 画像を取ってきて保存する。失敗しても本体の処理は止めない */
async function fetchPhoto(url: string | undefined, timeoutMs = 12_000): Promise<string | undefined> {
  if (!url) return undefined;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": UA } });
    if (!res.ok) return undefined;
    const type = res.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return undefined;
    const buffer = Buffer.from(await res.arrayBuffer());
    return await savePhoto(buffer);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

/** DuckDuckGo(HTML版)で公式サイト内の仕様ページを検索する */
async function searchSpecPages(maker: Maker, model: string, keyword = "仕様"): Promise<string[]> {
  const sites = MAKER_SITES[maker] ?? [];
  const siteQuery = sites.map((s) => `site:${s}`).join(" OR ");
  const query = `${MAKER_LABELS[maker] ?? ""} ${model} ${keyword} ${siteQuery}`.trim();
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

    // 提案資料に使う製品写真も、同じページから拾えるなら取っておく
    const photo = await fetchPhoto(extractProductImage(html, url));

    const device = await upsertDevice({
      maker,
      makerText: MAKER_LABELS[maker],
      model: cleanModel,
      ...partial,
      ...(photo ? { photo } : {}),
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


export interface OptionLookupResult {
  options: DeviceOption[];
  url?: string;
  message?: string;
}

/**
 * 機種のオプション一覧をメーカーサイトから取得する。
 *
 * 取れた分は機種DBに保存し、提案資料の「オプションのご紹介」に使う。
 * ページの作りはメーカーごとに違うため、取れないことも珍しくない。
 * その場合は機種DB画面から手で足してもらう。
 */
export async function lookupOptions(model: string, makerHint?: Maker): Promise<OptionLookupResult> {
  const cleanModel = model.trim();
  if (!cleanModel) return { options: [], message: "型番が空です。" };

  const maker = makerHint ?? detectMaker(cleanModel) ?? "OTHER";
  const urls = [
    ...(await searchSpecPages(maker, cleanModel, "オプション 希望小売価格")),
    ...(await searchSpecPages(maker, cleanModel, "オプション")),
  ].filter((u, i, all) => all.indexOf(u) === i);

  for (const url of urls) {
    const html = await fetchText(url);
    if (!html) continue;
    const found = extractOptions(html, url);
    if (found.length < 2) continue;

    // 表の中に写真があれば取り込む（無いほうが多い）
    const options: DeviceOption[] = [];
    for (const option of found) {
      const photo = option.photo?.startsWith("http") ? await fetchPhoto(option.photo) : option.photo;
      options.push({ ...option, photo });
    }

    const device = await findDeviceByModel(cleanModel);
    if (device) await upsertDevice({ ...device, options });
    return { options, url };
  }

  return {
    options: [],
    message:
      "オプション一覧のページを読み取れませんでした。機種DB画面から手で登録してください。",
  };
}

export interface PhotoLookupResult {
  /** 保存された写真のファイル名（photos/ の中） */
  photo?: string;
  url?: string;
  /** local: すでにDBにあった / web: インターネット取得 / miss: 取得失敗 */
  origin: "local" | "web" | "miss";
  message?: string;
}

/**
 * 機種の筐体写真を用意する。
 *
 * 仕様表の取得（lookupSpec）のついででも写真は拾っているが、
 * 仕様表を読み取れなかった機種は写真も入らないままになる。
 * 提案資料に写真が要るのはどの機種も同じなので、写真だけを探す道を用意する。
 *
 * いちどDBに入れた写真は使い回す。同じ機種で何度もインターネットに出ると
 * 時間もかかるし、メーカーのサイトにも負担をかけるため、
 * forceRefresh を指定しない限り取りに行かない。
 */
export async function lookupPhoto(
  model: string,
  makerHint?: Maker,
  options: { forceRefresh?: boolean } = {},
): Promise<PhotoLookupResult> {
  const cleanModel = model.trim();
  if (!cleanModel) return { origin: "miss", message: "型番が空です。" };

  const cached = await findDeviceByModel(cleanModel);
  if (cached?.photo && !options.forceRefresh) {
    return { photo: cached.photo, origin: "local", url: cached.source.url };
  }

  const maker = makerHint ?? cached?.maker ?? detectMaker(cleanModel) ?? "OTHER";
  // 製品ページ（写真が載っているページ）を優先して探す。
  // 仕様ページは表ばかりで写真が無いことがある
  const urls = [
    ...(await searchSpecPages(maker, cleanModel, "複合機 製品")),
    ...(await searchSpecPages(maker, cleanModel, "仕様")),
  ].filter((u, i, all) => all.indexOf(u) === i);

  for (const url of urls) {
    const html = await fetchText(url);
    if (!html) continue;
    const photo = await fetchPhoto(extractProductImage(html, url));
    if (!photo) continue;

    // 取れた写真は必ずDBに残す。次からはインターネットに出ない
    await upsertDevice({
      ...(cached ?? {
        maker,
        makerText: MAKER_LABELS[maker],
        model: cleanModel,
      }),
      model: cleanModel,
      photo,
      source: cached?.source ?? { method: "web", url, fetchedAt: new Date().toISOString() },
    });
    return { photo, url, origin: "web" };
  }

  return {
    origin: "miss",
    message:
      "メーカーのサイトから写真を見つけられませんでした。機種DB画面から手で登録してください。",
  };
}
