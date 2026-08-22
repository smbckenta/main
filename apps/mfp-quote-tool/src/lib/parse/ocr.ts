import path from "node:path";
import { promises as fs } from "node:fs";
import { DATA_DIR } from "../store";

/**
 * 写真・スキャンPDFの文字起こし（OCR）。
 *
 * tesseract.js（WASM）を使うため、OS側にソフトを入れる必要がない。
 * 日本語・英語の学習データは data/tessdata に同梱しており、
 * インターネットに出られない環境でも動作する。
 */

const TESSDATA_DIR = path.join(DATA_DIR, "tessdata");

type TesseractWorker = Awaited<ReturnType<typeof createOcrWorker>>;

let workerPromise: Promise<TesseractWorker> | null = null;

async function createOcrWorker() {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker(["jpn", "eng"], 1, {
    langPath: TESSDATA_DIR,
    cachePath: TESSDATA_DIR,
    gzip: false,
    // 進捗ログは大量に出るため捨てる
    logger: () => {},
    errorHandler: () => {},
  });
  await worker.setParameters({
    // 4 = 段組みのある文書。請求書・予定表の表組みはこれが最も崩れにくい
    tessedit_pageseg_mode: "4" as never,
    preserve_interword_spaces: "1",
  });
  return worker;
}

/** ワーカーは起動が重いので使い回す */
async function getWorker(): Promise<TesseractWorker> {
  if (!workerPromise) workerPromise = createOcrWorker();
  try {
    return await workerPromise;
  } catch (err) {
    workerPromise = null;
    throw err;
  }
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise.catch(() => null);
  workerPromise = null;
  await worker?.terminate();
}

export class OcrUnavailableError extends Error {
  constructor(cause: unknown) {
    super(
      `OCRを実行できませんでした。日本語学習データ（data/tessdata/jpn.traineddata）が見つからない可能性があります。詳細: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
    this.name = "OcrUnavailableError";
  }
}

/** 学習データが同梱されているか */
export async function isOcrAvailable(): Promise<boolean> {
  try {
    await fs.access(path.join(TESSDATA_DIR, "jpn.traineddata"));
    return true;
  } catch {
    return false;
  }
}

/** 大津の方法で二値化のしきい値を求める */
function otsuThreshold(hist: number[], total: number): number {
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0;
  let wB = 0;
  let best = 0;
  let threshold = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const between = wB * wF * (sumB / wB - (sum - sumB) / wF) ** 2;
    if (between > best) {
      best = between;
      threshold = t;
    }
  }
  return threshold;
}

/**
 * 文字行の傾きを推定する。
 * 二値化した画像を候補角度ごとに回して「行ごとの黒画素数」の分散を見る。
 * 文字行が水平に揃うと分散が最大になるので、その角度が傾き。
 */
function estimateSkew(dark: Uint8Array, w: number, h: number): number {
  const score = (deg: number): number => {
    const rad = (deg * Math.PI) / 180;
    const tan = Math.tan(rad);
    const rows = new Float64Array(h);
    // 粗く走査すれば十分（4px間隔）
    for (let y = 0; y < h; y += 4) {
      for (let x = 0; x < w; x += 4) {
        if (!dark[y * w + x]) continue;
        const ry = Math.round(y - (x - w / 2) * tan);
        if (ry >= 0 && ry < h) rows[ry]++;
      }
    }
    let mean = 0;
    for (const v of rows) mean += v;
    mean /= h;
    let variance = 0;
    for (const v of rows) variance += (v - mean) ** 2;
    return variance;
  };

  let bestDeg = 0;
  let bestScore = -1;
  for (let deg = -6; deg <= 6; deg += 0.5) {
    const s = score(deg);
    if (s > bestScore) {
      bestScore = s;
      bestDeg = deg;
    }
  }
  return bestDeg;
}

/**
 * 写真向けの下ごしらえ。
 *  1. 長辺2400pxへ拡大
 *  2. グレースケール化と大津の二値化（影・色かぶりを消す）
 *  3. 文字行の傾きを推定して水平に起こす
 * スキャン済みの綺麗な画像はそのままの方が精度が高いので、呼び出し側で使い分ける。
 */
export async function preprocessImage(buf: Buffer): Promise<Buffer> {
  const { createCanvas, loadImage } = await import("@napi-rs/canvas");
  const image = await loadImage(buf);

  const longSide = Math.max(image.width, image.height);
  const scale = longSide > 0 ? Math.min(2400 / longSide, 3) : 1;
  const w0 = Math.max(1, Math.round(image.width * scale));
  const h0 = Math.max(1, Math.round(image.height * scale));

  const first = createCanvas(w0, h0);
  const fctx = first.getContext("2d");
  fctx.drawImage(image, 0, 0, w0, h0);

  // 用紙の領域を切り出す。机や床が写り込んだ写真では、
  // 背景を含めたまま処理すると傾き推定も二値化も背景に引きずられる。
  const box = paperBounds(fctx.getImageData(0, 0, w0, h0).data, w0, h0);
  const cw = box.x1 - box.x0;
  const ch = box.y1 - box.y0;
  const canvas = createCanvas(cw, ch);
  const ctx = canvas.getContext("2d");
  ctx.drawImage(first, box.x0, box.y0, cw, ch, 0, 0, cw, ch);

  // 切り出した用紙の中で、文字と紙地を分ける
  const data = ctx.getImageData(0, 0, cw, ch);
  const px = data.data;
  const gray = new Uint8Array(cw * ch);
  const hist = new Array(256).fill(0);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    gray[j] = g;
    hist[g]++;
  }
  const threshold = otsuThreshold(hist, cw * ch);
  const dark = new Uint8Array(cw * ch);
  for (let j = 0; j < gray.length; j++) dark[j] = gray[j] <= threshold ? 1 : 0;
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const v = dark[j] ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    px[i + 3] = 255;
  }
  ctx.putImageData(data, 0, 0);

  const skew = estimateSkew(dark, cw, ch);
  if (Math.abs(skew) < 0.25) return canvas.toBuffer("image/png");

  // 傾きを打ち消して描き直す（余白は白で埋める）
  const rotated = createCanvas(cw, ch);
  const rctx = rotated.getContext("2d");
  rctx.fillStyle = "#ffffff";
  rctx.fillRect(0, 0, cw, ch);
  rctx.translate(cw / 2, ch / 2);
  rctx.rotate((skew * Math.PI) / 180);
  rctx.translate(-cw / 2, -ch / 2);
  rctx.drawImage(canvas, 0, 0);
  return rotated.toBuffer("image/png");
}

/**
 * 写真に写った用紙の範囲を推定する。
 * 画像全体を明暗2つに分け、明るい側（＝紙）が写る範囲を、
 * 行・列ごとの割合から求める。背景が無い画像では画像全体を返す。
 */
function paperBounds(px: Uint8ClampedArray, w: number, h: number) {
  const hist = new Array(256).fill(0);
  const gray = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < px.length; i += 4, j++) {
    const g = Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]);
    gray[j] = g;
    hist[g]++;
  }
  const threshold = otsuThreshold(hist, w * h);

  const colBright = new Float64Array(w);
  const rowBright = new Float64Array(h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (gray[y * w + x] > threshold) {
        colBright[x]++;
        rowBright[y]++;
      }
    }
  }
  const span = (arr: Float64Array, size: number, limit: number) => {
    // その行・列の3割以上が明るければ「紙がある」とみなす
    const need = limit * 0.3;
    let start = 0;
    let end = size - 1;
    while (start < size && arr[start] < need) start++;
    while (end > start && arr[end] < need) end--;
    return [start, end] as const;
  };
  const [x0, x1] = span(colBright, w, h);
  const [y0, y1] = span(rowBright, h, w);

  const cw = x1 - x0;
  const ch = y1 - y0;
  // 紙が見つからない／小さすぎる場合は切り出さない
  if (cw < w * 0.2 || ch < h * 0.2) return { x0: 0, y0: 0, x1: w, y1: h };
  const mx = Math.round(cw * 0.01);
  const my = Math.round(ch * 0.01);
  return {
    x0: Math.max(0, x0 - mx),
    y0: Math.max(0, y0 - my),
    x1: Math.min(w, x1 + mx),
    y1: Math.min(h, y1 + my),
  };
}

/** HEIC（iPhoneの写真）をJPEGに変換する */
export async function heicToJpeg(buf: Buffer): Promise<Buffer> {
  const convert = (await import("heic-convert")).default;
  const out = await convert({ buffer: new Uint8Array(buf), format: "JPEG", quality: 0.92 });
  return Buffer.from(out);
}

export function isHeic(name: string, buf: Buffer): boolean {
  if (/\.(heic|heif)$/i.test(name)) return true;
  // ftyp ボックスの brand で判定
  const brand = buf.subarray(8, 12).toString("latin1");
  return ["heic", "heix", "hevc", "mif1", "heim"].includes(brand);
}

function toLines(text: string): string[] {
  return (text ?? "")
    .split(/\r?\n/)
    .map((l) => normalizeOcrNumbers(l.replace(/[ \t]+/g, " ").trim()))
    .filter(Boolean);
}

/**
 * OCR特有の数字の崩れを直す。
 *  - 「452, 180」のように桁区切りの後に空白が入る
 *  - 桁区切りのカンマがピリオドとして読まれる（3.009 → 3,009）
 * 小数点（単価 1.50 など）は2桁以下なのでそのまま残す。
 */
export function normalizeOcrNumbers(line: string): string {
  return line
    .replace(/(\d),\s+(?=\d{3}\b)/g, "$1,")
    .replace(/(\d)\.(?=\d{3}\b)/g, "$1,");
}

/**
 * 読み取り結果の使えそうさ。
 * 後段の解析が必要とする行——「区分＋数字が並ぶカウンター明細の行」と
 * 「回数＋日付＋金額が並ぶ支払予定表の行」——がいくつ取れたかで測る。
 */
function usefulness(lines: string[]): number {
  const numbersIn = (l: string) =>
    (l.match(/\d[\d,.]*/g) ?? []).filter((n) => n.replace(/\D/g, "").length >= 2).length;

  let score = 0;
  for (const line of lines) {
    const nums = numbersIn(line);
    if (nums >= 3 && /(モノクロ|白黒|カラー|ﾓﾉｸﾛ|ｶﾗｰ)/.test(line)) score += 20;
    else if (nums >= 3 && /^\s*\d{1,3}\s/.test(line)) score += 15;
    else if (nums >= 3) score += 8;
    else if (nums >= 1) score += 1;
  }
  return score;
}

/** 長辺を指定サイズに合わせて描き直す */
async function resized(buf: Buffer, longSide: number): Promise<Buffer | null> {
  try {
    const { createCanvas, loadImage } = await import("@napi-rs/canvas");
    const image = await loadImage(buf);
    const current = Math.max(image.width, image.height);
    // ほぼ同じ大きさなら作り直す意味がない
    if (Math.abs(current - longSide) / current < 0.08) return null;
    const scale = longSide / current;
    const w = Math.max(1, Math.round(image.width * scale));
    const h = Math.max(1, Math.round(image.height * scale));
    const canvas = createCanvas(w, h);
    canvas.getContext("2d").drawImage(image, 0, 0, w, h);
    return canvas.toBuffer("image/png");
  } catch {
    return null;
  }
}

/**
 * 画像1枚を文字起こしして行の配列で返す。
 *
 * 綺麗なスキャンは無加工が、写真は縮小や傾き補正＋二値化が有利で、
 * どれが当たるかは元画像次第。数通り試して「表として読めている」ものを採る。
 */
export async function ocrImageLines(buf: Buffer): Promise<string[]> {
  let worker: TesseractWorker;
  try {
    worker = await getWorker();
  } catch (err) {
    throw new OcrUnavailableError(err);
  }

  const read = async (image: Buffer) => toLines((await worker.recognize(image)).data.text);

  // まずは無加工（スキャン画像はこれで十分なことが多い）
  const capped = (await resized(buf, 3000)) ?? buf;
  let best = await read(capped);
  if (usefulness(best) >= 40) return best;

  // 解像度を変えると認識のかかり方が大きく変わるため、数通り試す
  for (const longSide of [1600, 1200, 2200]) {
    const image = await resized(buf, longSide);
    if (!image) continue;
    const lines = await read(image);
    if (usefulness(lines) > usefulness(best)) best = lines;
    if (usefulness(best) >= 40) return best;
  }

  const prepared = await preprocessImage(buf).catch(() => null);
  if (prepared) {
    const lines = await read(prepared);
    if (usefulness(lines) > usefulness(best)) best = lines;
  }
  return best;
}

/** PDFの1ページを画像に描き起こす（テキストを持たないスキャンPDF用） */
export async function renderPdfPage(pdfBuf: Buffer, pageNo: number, scale = 2): Promise<Buffer> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const { createCanvas } = await import("@napi-rs/canvas");

  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBuf), useSystemFonts: true });
  const doc = await task.promise;
  try {
    const page = await doc.getPage(pageNo);
    const viewport = page.getViewport({ scale });
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({
      // @napi-rs/canvas は browser の Canvas / 2Dコンテキスト互換
      canvas: canvas as unknown as HTMLCanvasElement,
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
    }).promise;
    return canvas.toBuffer("image/png");
  } finally {
    await task.destroy();
  }
}

/** PDFのページ数 */
export async function pdfPageCount(pdfBuf: Buffer): Promise<number> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const task = pdfjs.getDocument({ data: new Uint8Array(pdfBuf), useSystemFonts: true });
  const doc = await task.promise;
  const n = doc.numPages;
  await task.destroy();
  return n;
}
