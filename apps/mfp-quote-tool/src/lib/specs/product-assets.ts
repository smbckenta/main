import * as cheerio from "cheerio";
import type { DeviceOption } from "../types";
import { parseNumber, toHalfWidth } from "../parse/normalize";
import { newOptionId } from "../proposal-doc";

/**
 * メーカーの製品ページから、提案資料に使う写真とオプション一覧を取り出す。
 *
 * ページの作りはメーカーごとにばらばらなので、必ず取れる前提では作らない。
 * 取れなかった場合は画面から手で登録できるようにしてあり、ここは
 * 「取れたら手間が省ける」程度の位置づけ。
 */

/** 相対URLを絶対URLに直す。直せないものは捨てる */
function absolute(src: string | undefined, baseUrl: string): string | undefined {
  if (!src) return undefined;
  try {
    const url = new URL(src, baseUrl);
    return /^https?:$/.test(url.protocol) ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

/** アイコン・ロゴ・バナーなど、製品写真ではない画像を弾く */
const NOT_PRODUCT = /(logo|icon|banner|btn|button|arrow|bullet|spacer|common|header|footer|sns|share)/i;

/**
 * 製品写真のURLを選ぶ。
 * og:image（メーカーがSNS用に指定した代表画像）が最も確実なので優先する。
 */
export function extractProductImage(html: string, baseUrl: string): string | undefined {
  const $ = cheerio.load(html);

  const og =
    $('meta[property="og:image"]').attr("content") ?? $('meta[name="og:image"]').attr("content");
  const ogUrl = absolute(og, baseUrl);
  if (ogUrl && !NOT_PRODUCT.test(ogUrl)) return ogUrl;

  // og:image が無いページでは、製品写真らしい img を探す
  const candidates: { url: string; score: number }[] = [];
  $("img").each((_, img) => {
    const src = $(img).attr("src") ?? $(img).attr("data-src");
    const url = absolute(src, baseUrl);
    if (!url || NOT_PRODUCT.test(url)) return;
    const alt = $(img).attr("alt") ?? "";
    const width = Number($(img).attr("width")) || 0;
    const height = Number($(img).attr("height")) || 0;
    let score = 0;
    if (/(product|item|main|hero|photo|goods)/i.test(url)) score += 3;
    if (/(複合機|プリンター|本体|外観)/.test(alt)) score += 3;
    if (width >= 200 || height >= 200) score += 2;
    if (/\.(jpe?g|png|webp)(\?|$)/i.test(url)) score += 1;
    if (score > 0) candidates.push({ url, score });
  });

  return candidates.sort((a, b) => b.score - a.score)[0]?.url;
}

/** オプションの分類（メーカーの見出しから拾う） */
const CATEGORY_HINTS: [RegExp, string][] = [
  [/(フィニッシャー|ステープル|中綴じ|パンチ|折り)/, "フィニッシャー"],
  [/(給紙|カセット|デッキ|ペーパーフィーダー|大容量)/, "給紙"],
  [/(原稿送り|ADF|自動原稿)/, "原稿送り"],
  [/(セキュリティ|認証|ICカード|データ保護|上書き消去)/, "セキュリティ"],
  [/(FAX|ファクス|ファックス)/, "FAX"],
  [/(メモリー|ハードディスク|SSD|増設)/, "拡張"],
  [/(キャビネット|台|デスク|スタンド)/, "設置台"],
];

function categoryOf(text: string): string | undefined {
  return CATEGORY_HINTS.find(([re]) => re.test(text))?.[1];
}

/** 「¥123,000」「123,000円」から金額を取り出す（税込表記は税抜に直さない） */
function priceOf(text: string): number | undefined {
  const s = toHalfWidth(text);
  const m = s.match(/(?:¥|￥)?\s*([\d,]{4,12})\s*円?/);
  if (!m) return undefined;
  const value = parseNumber(m[1]);
  // オプションとして現実的な範囲だけ採用する（型番や年号を金額と読まないため）
  return value !== undefined && value >= 1_000 && value <= 5_000_000 ? value : undefined;
}

/** 型番らしい文字列（英数字とハイフンの並び） */
function modelCodeOf(text: string): string | undefined {
  const m = toHalfWidth(text).match(/\b([A-Z][A-Z0-9]*(?:[-–][A-Z0-9]+){1,3})\b/);
  return m ? m[1] : undefined;
}

/**
 * オプション一覧の表を読み取る。
 *
 * 「品名・型番・希望小売価格」が並んだ表を探し、金額の入っている行だけを拾う。
 * 金額が無い行は、注記や見出しであることがほとんど。
 */
export function extractOptions(html: string, baseUrl: string): DeviceOption[] {
  const $ = cheerio.load(html);
  const options: DeviceOption[] = [];
  const seen = new Set<string>();

  $("table").each((_, table) => {
    // その表の直前の見出しを分類の手がかりにする
    const heading = $(table).prevAll("h2,h3,h4,caption").first().text();

    $(table)
      .find("tr")
      .each((_, tr) => {
        const cells = $(tr)
          .children("th,td")
          .map((_i, el) => $(el).text().replace(/\s+/g, " ").trim())
          .get();
        if (cells.length < 2) return;

        const price = cells.map(priceOf).find((p) => p !== undefined);
        if (price === undefined) return;

        // 金額でも型番でもない、いちばん長いセルを品名とみなす
        const name = cells
          .filter((c) => priceOf(c) === undefined)
          .sort((a, b) => b.length - a.length)[0]
          ?.slice(0, 60);
        if (!name || name.length < 2) return;

        const key = `${name}/${price}`;
        if (seen.has(key)) return;
        seen.add(key);

        const photo = absolute($(tr).find("img").attr("src"), baseUrl);
        options.push({
          id: newOptionId(),
          name,
          modelCode: cells.map(modelCodeOf).find(Boolean),
          listPrice: price,
          category: categoryOf(`${heading} ${name}`),
          // 写真はこの時点ではURL。保存したらファイル名に置き換える
          photo,
        });
      });
  });

  return options.slice(0, 40);
}
