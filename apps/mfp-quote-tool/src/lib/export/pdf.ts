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
}

export async function htmlToPdf(html: string, opts: PdfPageOptions = {}): Promise<Buffer> {
  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch (err) {
    throw new PdfUnavailableError(err);
  }

  const landscape = opts.landscape ?? false;
  // A3ヨコは余白を詰めないと1枚に収まらない
  const margin = landscape
    ? { top: "8mm", right: "8mm", bottom: "8mm", left: "8mm" }
    : { top: "12mm", right: "10mm", bottom: "12mm", left: "10mm" };

  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.setContent(html, { waitUntil: "load" });
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
