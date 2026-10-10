import { beforeAll, describe, expect, it } from "vitest";
import { fitToOnePage, htmlToPdf, PdfUnavailableError } from "./pdf";

/**
 * 1枚に収めるための縮小（fitToOnePage）が、必要以上に縮めていないか。
 *
 * かつて html 要素の高さを測っていたため、どれだけ縮めても「画面の高さ」が
 * 返ってきて、A4の帳票がすべて下限（最小の字）まで縮んでいた。
 * 紙に出すまで気づけない不具合なので、ここで押さえておく。
 */

const A4_HEIGHT_PX = Math.round((297 - 24) * (96 / 25.4));
const A4_WIDTH_PX = Math.round((210 - 20) * (96 / 25.4));

/** 高さを px で指定した、中身だけの紙 */
const sheet = (contentPx: number) =>
  `<!doctype html><html><head><meta charset="utf-8"><style>
    body { margin: 0; }
    .box { height: calc(${contentPx}px * var(--fit, 1)); background: #eee; }
  </style></head><body><div class="box"></div></body></html>`;

/** Chromium が無い環境（開発機によっては未インストール）では飛ばす */
let chromiumAvailable = true;

beforeAll(async () => {
  try {
    await htmlToPdf("<p>x</p>");
  } catch (err) {
    if (err instanceof PdfUnavailableError) chromiumAvailable = false;
    else throw err;
  }
}, 90_000);

/** Playwright の Chromium を、htmlToPdf と同じ探し方で起動する */
async function launch() {
  const { chromium } = await import("playwright");
  const { existsSync, readdirSync } = await import("node:fs");
  const path = await import("node:path");
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  let executablePath: string | undefined;
  if (root && existsSync(root)) {
    for (const dir of readdirSync(root).filter((d) => d.startsWith("chromium-"))) {
      const candidate = path.join(root, dir, "chrome-linux/chrome");
      if (existsSync(candidate)) executablePath = candidate;
    }
  }
  return chromium.launch({
    ...(executablePath ? { executablePath } : {}),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
}

/** fitToOnePage を通したあとの倍率と、そのときの中身の高さ */
async function fitOf(contentPx: number): Promise<{ fit: number; height: number }> {
  const browser = await launch();
  try {
    const page = await browser.newPage();
    await page.setContent(sheet(contentPx), { waitUntil: "load" });
    await page.emulateMedia({ media: "print" });
    await page.setViewportSize({ width: A4_WIDTH_PX, height: A4_HEIGHT_PX });
    await fitToOnePage(page, A4_HEIGHT_PX);
    return await page.evaluate(() => ({
      fit: Number(document.body.style.getPropertyValue("--fit") || 1),
      height: document.body.scrollHeight,
    }));
  } finally {
    await browser.close();
  }
}

describe("1枚に収める縮小", () => {
  it("はじめから収まっている紙は縮めない", async () => {
    if (!chromiumAvailable) return;
    const { fit } = await fitOf(A4_HEIGHT_PX - 100);
    expect(fit).toBe(1);
  }, 60_000);

  it("はみ出した紙は、収まる範囲でいちばん大きい倍率にする", async () => {
    if (!chromiumAvailable) return;
    // 1.25倍の高さ → 0.8倍まで縮めれば収まる。下限まで縮めてはいけない
    const { fit, height } = await fitOf(Math.round(A4_HEIGHT_PX * 1.25));
    expect(height).toBeLessThanOrEqual(A4_HEIGHT_PX);
    expect(fit).toBeGreaterThan(0.75);
    expect(fit).toBeLessThan(1);
  }, 60_000);

  it("倍以上はみ出していても、下限より上なら読める大きさを残す", async () => {
    if (!chromiumAvailable) return;
    const { fit, height } = await fitOf(A4_HEIGHT_PX * 2);
    expect(height).toBeLessThanOrEqual(A4_HEIGHT_PX);
    expect(fit).toBeGreaterThan(0.45);
  }, 60_000);
});
