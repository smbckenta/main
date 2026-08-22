import ExcelJS from "exceljs";
import { heicToJpeg, isHeic, ocrImageLines, pdfPageCount, renderPdfPage } from "./ocr";

/** OCRにかけるページ数の上限（1ページ数秒かかるため） */
const MAX_OCR_PAGES = 4;
/** これ未満の文字数しか取れないPDFは、スキャン画像とみなしてOCRに回す */
const TEXT_LAYER_MIN_CHARS = 60;

export interface ExtractedDoc {
  /** ファイル名 */
  name: string;
  kind: "pdf" | "excel" | "csv" | "text" | "image" | "unknown";
  /** OCR（写真・スキャンPDFの文字起こし）を使ったか */
  ocrUsed?: boolean;
  /** 行単位のテキスト（PDFは座標から行を再構成したもの） */
  lines: string[];
  /** 表として読めた場合のセル配列（Excel/CSV） */
  rows?: (string | number | null)[][];
  /** 全文 */
  text: string;
  warnings: string[];
}

function detectKind(name: string, mime?: string): ExtractedDoc["kind"] {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  if (ext === "pdf" || mime === "application/pdf") return "pdf";
  if (["xlsx", "xlsm", "xls"].includes(ext)) return "excel";
  if (["csv", "tsv"].includes(ext)) return "csv";
  if (["txt", "text"].includes(ext)) return "text";
  if (["jpg", "jpeg", "png", "webp", "gif", "bmp", "tif", "tiff", "heic", "heif"].includes(ext)) return "image";
  if (mime?.startsWith("image/")) return "image";
  return "unknown";
}

/** PDFのテキストを座標から行単位に組み立てて抽出する */
async function extractPdf(buf: Buffer): Promise<{ lines: string[]; warnings: string[] }> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buf),
    useSystemFonts: true,
  });
  const doc = await loadingTask.promise;

  const lines: string[] = [];
  const warnings: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    // y座標が近いものを1行としてまとめ、x座標順に連結する
    const buckets = new Map<number, { x: number; s: string }[]>();
    for (const item of content.items) {
      const it = item as { str?: string; transform?: number[] };
      if (!it.str || !it.transform) continue;
      const x = it.transform[4];
      const y = Math.round(it.transform[5] / 3) * 3; // 3pt単位に丸めて同一行とみなす
      const arr = buckets.get(y) ?? [];
      arr.push({ x, s: it.str });
      buckets.set(y, arr);
    }
    const sorted = [...buckets.entries()].sort((a, b) => b[0] - a[0]);
    for (const [, items] of sorted) {
      const line = items
        .sort((a, b) => a.x - b.x)
        .map((i) => i.s)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (line) lines.push(line);
    }
    if (p === 1 && lines.length === 0) {
      warnings.push(
        "PDFからテキストを取得できませんでした。スキャン画像のPDFの可能性があります（OCR未対応のため手入力してください）。",
      );
    }
  }
  await loadingTask.destroy();
  return { lines, warnings };
}

async function extractExcel(buf: Buffer): Promise<{ lines: string[]; rows: (string | number | null)[][] }> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const rows: (string | number | null)[][] = [];
  wb.eachSheet((sheet) => {
    sheet.eachRow((row) => {
      const values = Array.isArray(row.values) ? row.values.slice(1) : [];
      rows.push(
        values.map((v) => {
          if (v === null || v === undefined) return null;
          if (typeof v === "number" || typeof v === "string") return v;
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          const rich = v as { text?: string; result?: unknown };
          if (typeof rich.text === "string") return rich.text;
          if (rich.result !== undefined) return String(rich.result);
          return String(v);
        }),
      );
    });
  });
  const lines = rows.map((r) => r.map((c) => (c === null ? "" : String(c))).join(" ").trim()).filter(Boolean);
  return { lines, rows };
}

function extractCsv(buf: Buffer): { lines: string[]; rows: (string | number | null)[][] } {
  const text = decodeText(buf);
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const sep = text.includes("\t") ? "\t" : ",";
  const rows = lines.map((l) => splitCsvLine(l, sep));
  return { lines, rows };
}

function splitCsvLine(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** UTF-8で読めない場合はShift_JISとして読み直す（国内の帳票CSV対策） */
function decodeText(buf: Buffer): string {
  const utf8 = buf.toString("utf8");
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("shift_jis").decode(buf);
  } catch {
    return utf8;
  }
}

/** 画像（写真・スクリーンショット）を文字起こしする */
async function extractImage(name: string, buf: Buffer): Promise<{ lines: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  let source = buf;
  if (isHeic(name, buf)) {
    try {
      source = await heicToJpeg(buf);
    } catch (err) {
      return {
        lines: [],
        warnings: [`${name}: HEIC形式の変換に失敗しました (${(err as Error).message})。JPEGで保存し直してお試しください。`],
      };
    }
  }
  const lines = await ocrImageLines(source);
  if (!lines.length) {
    warnings.push(`${name}: 写真から文字を読み取れませんでした。明るい場所で、書類が画面いっぱいになるよう正面から撮り直してください。`);
  }
  return { lines, warnings };
}

/** テキストを持たないスキャンPDFを、ページ画像に描き起こしてOCRする */
async function ocrPdf(name: string, buf: Buffer): Promise<{ lines: string[]; warnings: string[] }> {
  const warnings: string[] = [];
  const lines: string[] = [];
  const total = await pdfPageCount(buf);
  const pages = Math.min(total, MAX_OCR_PAGES);
  for (let p = 1; p <= pages; p++) {
    const png = await renderPdfPage(buf, p);
    lines.push(...(await ocrImageLines(png)));
  }
  if (total > pages) {
    warnings.push(`${name}: ${total}ページのうち先頭${pages}ページのみ読み取りました。`);
  }
  if (!lines.length) {
    warnings.push(`${name}: スキャンPDFから文字を読み取れませんでした。解像度を上げて取り込み直してください。`);
  }
  return { lines, warnings };
}

export async function extractDocument(
  name: string,
  buf: Buffer,
  mime?: string,
): Promise<ExtractedDoc> {
  const kind = detectKind(name, mime);
  const warnings: string[] = [];
  let lines: string[] = [];
  let rows: (string | number | null)[][] | undefined;
  let ocrUsed = false;

  try {
    if (kind === "image") {
      const r = await extractImage(name, buf);
      lines = r.lines;
      warnings.push(...r.warnings);
      ocrUsed = true;
    } else if (kind === "pdf") {
      const r = await extractPdf(buf);
      lines = r.lines;
      // 文字が取れない＝スキャン画像のPDF。ページを画像化してOCRに回す
      if (lines.join("").length < TEXT_LAYER_MIN_CHARS) {
        const o = await ocrPdf(name, buf);
        if (o.lines.length) {
          lines = o.lines;
          ocrUsed = true;
        }
        warnings.push(...o.warnings);
      } else {
        warnings.push(...r.warnings);
      }
    } else if (kind === "excel") {
      const r = await extractExcel(buf);
      lines = r.lines;
      rows = r.rows;
    } else if (kind === "csv") {
      const r = extractCsv(buf);
      lines = r.lines;
      rows = r.rows;
    } else if (kind === "text") {
      lines = decodeText(buf).split(/\r?\n/).filter((l) => l.trim());
    } else {
      warnings.push(
        `${name}: 対応していない形式です（PDF / 写真・画像 / Excel / CSV / テキストに対応）。`,
      );
    }
  } catch (err) {
    warnings.push(`${name}: 解析に失敗しました (${(err as Error).message})`);
  }

  return { name, kind, ocrUsed, lines, rows, text: lines.join("\n"), warnings };
}
