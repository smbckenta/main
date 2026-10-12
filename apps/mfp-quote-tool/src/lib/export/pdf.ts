import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import type { Browser } from "playwright";

/**
 * HTML から PDF を生成する（Chromium のヘッドレス印刷を利用）。
 * 日本語フォントは実行環境のシステムフォントを使うため、
 * Windows なら游ゴシック / メイリオ、Linux なら IPAGothic 等が必要。
 */

let browserPromise: Promise<Browser> | null = null;

/**
 * Chromium の実行ファイルを探す。
 * Playwright 標準の場所に無い場合でも、PLAYWRIGHT_BROWSERS_PATH に既にある
 * Chromium（バージョン違いを含む）や、環境変数で指定されたパスを使えるようにする。
 */
function findChromium(): string | undefined {
  const explicit = process.env.MFP_CHROMIUM_PATH;
  if (explicit && existsSync(explicit)) return explicit;

  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (root && existsSync(root)) {
    const dirs = readdirSync(root)
      .filter((d) => d.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      for (const rel of ["chrome-linux/chrome", "chrome-win/chrome.exe", "chrome-mac/Chromium.app/Contents/MacOS/Chromium"]) {
        const candidate = path.join(root, dir, rel);
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return undefined;
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const executablePath = findChromium();
    browserPromise = import("playwright").then(({ chromium }) =>
      chromium.launch({
        ...(executablePath ? { executablePath } : {}),
        args: ["--no-sandbox", "--disable-dev-shm-usage"],
      }),
    );
  }
  try {
    const browser = await browserPromise;
    if (browser.isConnected()) return browser;
  } catch (err) {
    browserPromise = null;
    throw err;
  }
  browserPromise = null;
  return getBrowser();
}

export class PdfUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `PDF生成に失敗しました。Chromium が未インストールの可能性があります（npx playwright install chromium を実行してください）。詳細: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "PdfUnavailableError";
  }
}

export interface PdfPageOptions {
  /** 用紙サイズ。複数台比較表はA3 */
  format?: "A4" | "A3";
  /** 横向き（A3の複数台比較表で使う） */
  landscape?: boolean;
  /**
   * 何行あっても1枚に収める。
   * 比較表は「現状」と「提案」を並べて見るための紙なので、
   * 途中で切れて2枚目に続くと役に立たない。
   */
  fitOnePage?: boolean;
  /**
   * 余白（mm）。既定はA4たて 上下12・左右10、A3ヨコ 8。
   * 御見積書は元のExcelに合わせて左右18・上22にする。
   */
  marginMm?: { top?: number; side?: number };
  /**
   * 中身を収める高さ（mm）。省略すると紙の内寸いっぱい。
   *
   * 御見積書のように「紙の下のほうは空けておく」体裁の帳票で使う。
   * 元のExcelは上から215mmのところで終わり、残りは余白にしている。
   */
  contentHeightMm?: number;
}

/**
 * 御見積書の紙の取り方（元のExcelの実測）。
 *   左右の余白 17.5mm / 19.2mm → 18mm
 *   上の余白   21.9mm → 22mm
 *   中身の高さ 215mm（下はわざと空ける。元のExcelもここで終わっている）
 */
export const QUOTE_PAGE: PdfPageOptions = {
  fitOnePage: true,
  marginMm: { top: 22, side: 18 },
  contentHeightMm: 215,
};

/**
 * 複数台の御見積書の紙の取り方。
 *
 * 紙の余白は1台のときと同じだが、1枚に押し込むことはしない。
 * 台数ぶんの構成品をすべて載せるので、1枚に収めようとすると
 * 読めない大きさまで縮んでしまう。読める大きさを保ち、
 * あふれたぶんは2枚目へ送る（表の見出しは各ページでくり返す）。
 */
export const FLEET_QUOTE_PAGE: PdfPageOptions = {
  marginMm: { top: 22, side: 18 },
};

/** 用紙の内寸（mm）。余白を引く前の大きさ */
const PAPER_MM = { A4: { w: 210, h: 297 }, A3: { w: 297, h: 420 } };
const MM_TO_PX = 96 / 25.4;
/**
 * 縮小の下限。
 *
 * 元のExcelも台数が多い比較表は30%まで縮めて1枚に収めている。
 * 罫線（1px）だけは縮まないぶん、同じ中身でもHTMLのほうが少し背が高くなるので、
 * A3ヨコに16台を収められるところまで下限を下げてある。
 */
const MIN_FIT = 0.25;

/**
 * 中身が1枚に収まるまで --fit を下げる。
 *
 * 行数からの見積り（fitCompare / fitZoom）だけでは、機種名が折り返した、
 * 注記が長かった、といった中身の差で1〜2行ぶんはみ出すことがある。
 * 実際に描かせて測るのがいちばん確実なので、ここで詰め直す。
 *
 * 測るだけなので中身は作り直さない。--fit を変えて測り直すだけ。
 */
export async function fitToOnePage(page: import("playwright").Page, heightPx: number): Promise<void> {
  const measure = (fit: number) =>
    page.evaluate((f) => {
      document.body.style.setProperty("--fit", String(f));
      // 変更を反映させてから測る
      void document.body.offsetHeight;
      // html要素の高さは「画面の高さ」より小さくならないので、ここでは見ない。
      // 見てしまうと、どれだけ縮めても画面の高さが返り、下限まで縮んでしまう。
      return Math.max(
        document.body.scrollHeight,
        ...Array.from(document.body.children, (el) => (el as HTMLElement).getBoundingClientRect().bottom),
      );
    }, fit);

  if ((await measure(1)) <= heightPx) return;

  // 収まる最大の倍率を二分探索で探す（8回で1%以下の精度になる）
  let low = MIN_FIT;
  let high = 1;
  for (let i = 0; i < 8; i++) {
    const mid = (low + high) / 2;
    if ((await measure(mid)) <= heightPx) low = mid;
    else high = mid;
  }
  // 測り値の丸め誤差でぎりぎり溢れないよう、ほんの少しだけ小さくする
  await measure(Math.max(MIN_FIT, Math.floor(low * 1_000) / 1_000 - 0.002));
}

export async function htmlToPdf(html: string, opts: PdfPageOptions = {}): Promise<Buffer> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    throw new PdfUnavailableError(err);
  }

  const landscape = opts.landscape ?? false;
  const format = opts.format ?? "A4";
  // A3ヨコは余白を詰めないと1枚に収まらない
  const marginMm = opts.marginMm?.top ?? (landscape ? 8 : 12);
  const sideMm = opts.marginMm?.side ?? (landscape ? 8 : 10);
  const margin = {
    top: `${marginMm}mm`,
    right: `${sideMm}mm`,
    bottom: `${marginMm}mm`,
    left: `${sideMm}mm`,
  };

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
    if (opts.fitOnePage) {
      const paper = PAPER_MM[format];
      const [wMm, hMm] = landscape ? [paper.h, paper.w] : [paper.w, paper.h];
      // 印刷と同じ幅で描かせないと、折り返しが変わって測り値がずれる
      await page.emulateMedia({ media: "print" });
      // 画面の高さと、収めたい高さは同じ値にそろえる（丸めで食い違わせない）
      const pageHeightPx = Math.round((hMm - marginMm * 2) * MM_TO_PX);
      const heightPx = opts.contentHeightMm
        ? Math.min(pageHeightPx, Math.round(opts.contentHeightMm * MM_TO_PX))
        : pageHeightPx;
      await page.setViewportSize({
        width: Math.round((wMm - sideMm * 2) * MM_TO_PX),
        height: pageHeightPx,
      });
      await fitToOnePage(page, heightPx);
    }
    const pdf = await page.pdf({
      format: opts.format ?? "A4",
      landscape,
      printBackground: true,
      margin,
    });
    return Buffer.from(pdf);
  } finally {
    await context.close();
  }
}

/** 開発サーバー終了時にブラウザを閉じる */
export async function closePdfBrowser(): Promise<void> {
  if (!browserPromise) return;
  const browser = await browserPromise.catch(() => null);
  browserPromise = null;
  await browser?.close();
}
