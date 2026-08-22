import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { ROLE_LABELS, type DocRole } from "../doc-roles";
import { heicToJpeg, isHeic, pdfPageCount, renderPdfPage, resizeImage } from "../parse/ocr";
import type { AiSettings } from "../types";
import { AiDocumentSchema, type AiDocument } from "./schema";

/**
 * AI（Claude）による書類の読み取り。
 *
 * スキャンPDFや写真は、文字起こし（OCR）だけでは表の行が崩れて読めないことが多い。
 * ここではPDF・画像をそのままClaudeに渡し、書類の意味を踏まえて
 * 「どの数字が枚数で、どの数字が単価か」まで判断させる。
 */

/** 1リクエストに載せられる画像の推奨サイズ（長辺） */
const IMAGE_LONG_SIDE = 1568;
/** PDFをそのまま渡せる上限（APIの32MB制限に対する安全側の値） */
const MAX_PDF_BYTES = 20 * 1024 * 1024;

const MEDIA_TYPES = {
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
} as const;

type MediaType = (typeof MEDIA_TYPES)[keyof typeof MEDIA_TYPES];

export interface AiAnalysisResult {
  document: AiDocument;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export class AiUnavailableError extends Error {}

/** 保存先に置いておけるAPIキーのファイル（start.bat が作る） */
const KEY_FILE = "api-key.txt";

/**
 * APIキーの置き場所は3通り。上から順に探す。
 *  1. 設定画面で入力したキー（settings.json）
 *  2. 環境変数 ANTHROPIC_API_KEY
 *  3. データ保存先の api-key.txt（start.bat の初回起動時に作られる）
 */
export async function resolveApiKey(ai?: AiSettings): Promise<string> {
  const direct = (ai?.apiKey?.trim() || process.env.ANTHROPIC_API_KEY || "").trim();
  if (direct) return direct;
  try {
    const { promises: fs } = await import("node:fs");
    const path = await import("node:path");
    const { DATA_DIR } = await import("../store");
    return (await fs.readFile(path.join(DATA_DIR, KEY_FILE), "utf8")).trim();
  } catch {
    return "";
  }
}

export async function isAiReady(ai?: AiSettings): Promise<boolean> {
  if (!ai?.enabled) return false;
  return Boolean(await resolveApiKey(ai));
}

/** 画像形式をマジックナンバーから判定する（拡張子が当てにならないため） */
function detectMediaType(buf: Buffer): MediaType | undefined {
  if (buf.subarray(0, 8).toString("latin1").startsWith("\x89PNG")) return MEDIA_TYPES.png;
  if (buf[0] === 0xff && buf[1] === 0xd8) return MEDIA_TYPES.jpeg;
  if (buf.subarray(0, 3).toString("latin1") === "GIF") return MEDIA_TYPES.gif;
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") {
    return MEDIA_TYPES.webp;
  }
  return undefined;
}

/** アップロードされた画像を、APIに渡せる形式・大きさに整える */
async function toImageBlock(name: string, buf: Buffer): Promise<Anthropic.ImageBlockParam> {
  let source = buf;
  if (isHeic(name, source)) source = await heicToJpeg(source);

  let media = detectMediaType(source);
  if (!media) {
    // TIFF・BMPなどはPNGに描き直す
    const png = await resizeImage(source, IMAGE_LONG_SIDE, { force: true });
    if (!png) throw new Error(`${name}: 対応していない画像形式です。JPEGまたはPNGで保存し直してください。`);
    source = png;
    media = MEDIA_TYPES.png;
  } else {
    const smaller = await resizeImage(source, IMAGE_LONG_SIDE);
    if (smaller) {
      source = smaller;
      media = MEDIA_TYPES.png;
    }
  }

  return {
    type: "image",
    source: { type: "base64", media_type: media, data: source.toString("base64") },
  };
}

/** PDFはそのまま渡す。大きすぎる・ページが多すぎる場合は先頭ページを画像化する */
async function pdfBlocks(
  name: string,
  buf: Buffer,
  maxPages: number,
): Promise<{ blocks: Anthropic.ContentBlockParam[]; notes: string[] }> {
  const notes: string[] = [];
  const total = await pdfPageCount(buf).catch(() => 0);

  if (buf.length <= MAX_PDF_BYTES && total && total <= maxPages) {
    return {
      blocks: [
        {
          type: "document",
          source: { type: "base64", media_type: "application/pdf", data: buf.toString("base64") },
          title: name,
        },
      ],
      notes,
    };
  }

  const pages = Math.min(total || maxPages, maxPages);
  const blocks: Anthropic.ContentBlockParam[] = [];
  for (let p = 1; p <= pages; p++) {
    const png = await renderPdfPage(buf, p, 2);
    blocks.push(await toImageBlock(`${name}#${p}`, png));
  }
  if (total > pages) {
    notes.push(`${name}: ${total}ページのうち先頭${pages}ページのみAIで読み取りました（設定の「AIに渡す最大ページ数」で変更できます）。`);
  }
  return { blocks, notes };
}

const SYSTEM_PROMPT = `あなたは複合機（コピー機・プリンター）を扱う販売会社で、お客様からお預かりした書類を読み取る担当者です。
渡される書類は次のいずれかです。
- リース契約書
- リース支払予定表（返済予定表・償還予定表・支払明細表）
- 印刷明細書／カウンター明細（メーカーや販売店が発行する検針票・請求明細）

書類の隅々まで読み、指定のJSON形式で書き起こしてください。スキャンや写真で文字がつぶれている場合も、表の罫線・桁位置・前後の行から判断してください。

読み取りの決まり
- 金額・単価は税抜の数値（円）で返す。カンマ・「¥」・全角数字・空白は取り除く。
- 税込金額しか書かれていない項目は税抜に換算せず null にし、notes にその旨を書く。
- 日付は西暦の YYYY-MM-DD 形式。和暦（令和・平成・昭和）は西暦に直す。
- 印刷枚数は「今回指針 − 前回指針」。枚数欄と指針欄の両方がある場合は枚数欄を優先し、食い違う場合は notes に書く。
- 明細に複数の期間（複数月）が並んでいる場合は、期間ごとに counters を1件ずつ作る。合計行は counters に入れない。
- モノクロ＝白黒・BK・ブラック・単色、フルカラー＝カラー・フルカラー・4色、2色カラー＝2色・ツインカラー として扱う。
- 単価は1枚あたりの金額。「モノクロ 12,345枚 × 0.8円 = 9,876円」のような行では、枚数・単価・金額をそれぞれ対応する項目に入れる。
- 支払予定表の残債（remainingDebt）は、本日以降で最初に到来する支払回の「残高（未経過リース料）」。書類に「残債」「一括精算額」の記載があればその金額を使う。
- 読み取れない項目は推測せず null にする。数字を作らない。
- evidence には、その値の根拠になった書類上の行をそのまま（読み取れた文字のまま）入れる。
- transcript には書類本文を上から順に書き起こす。表は1行1レコード、列は半角スペース区切り。最大300行。`;

export interface AnalyzeInput {
  name: string;
  buffer: Buffer;
  /** extractDocument が判定した形式 */
  kind: "pdf" | "image";
  /** 画面で指定された書類の種類（指定があればヒントとして渡す） */
  role?: DocRole;
  ai: AiSettings;
  /** 残債の基準日（既定は本日）。テスト用 */
  today?: Date;
}

/** 1ファイルをAIに読み取らせる */
export async function analyzeDocumentWithAi(input: AnalyzeInput): Promise<AiAnalysisResult> {
  const apiKey = await resolveApiKey(input.ai);
  if (!apiKey) throw new AiUnavailableError("APIキーが設定されていません。");

  const client = new Anthropic({ apiKey, maxRetries: 2 });
  const maxPages = Math.max(1, Math.min(input.ai.maxPages || 20, 100));

  const notes: string[] = [];
  let blocks: Anthropic.ContentBlockParam[];
  if (input.kind === "pdf") {
    const r = await pdfBlocks(input.name, input.buffer, maxPages);
    blocks = r.blocks;
    notes.push(...r.notes);
  } else {
    blocks = [await toImageBlock(input.name, input.buffer)];
  }

  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  const hint =
    input.role && input.role !== "unknown"
      ? `この書類は「${ROLE_LABELS[input.role]}」として預かったものです。\n`
      : "";

  const response = await client.messages.parse({
    model: input.ai.model || "claude-opus-5",
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          ...blocks,
          {
            type: "text",
            text: `${hint}ファイル名: ${input.name}\n本日の日付: ${today}\nこの書類を読み取ってください。`,
          },
        ],
      },
    ],
    output_config: { format: zodOutputFormat(AiDocumentSchema) },
  });

  if (response.stop_reason === "refusal") {
    throw new Error(`AIが読み取りを中断しました（${response.stop_details?.category ?? "理由不明"}）。`);
  }
  const parsed = response.parsed_output;
  if (!parsed) throw new Error("AIの応答を解析できませんでした。");

  if (notes.length) parsed.notes = [...notes, ...parsed.notes];

  return {
    document: parsed,
    model: response.model,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  };
}

/** 概算利用料（Claude Opus 5: 入力$5 / 出力$25 per 1Mトークン） */
export function estimateUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 5 + outputTokens * 25) / 1_000_000;
}
