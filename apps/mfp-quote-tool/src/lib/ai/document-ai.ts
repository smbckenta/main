import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { ROLE_LABELS, type DocRole } from "../doc-roles";
import {
  heicToJpeg,
  imageSize,
  isHeic,
  pdfPageCount,
  renderPdfPage,
  resizeImage,
  splitTall,
} from "../parse/ocr";
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

/**
 * 写真・画像をAPIに渡すブロックを作る。
 *
 * 大きな写真は、全体を1枚渡したうえで上下に割ったものも渡す。
 * A4の明細を1枚に縮めると単価や控除カウントの小さな数字がつぶれるため、
 * 「全体で構造をつかみ、分割で細部を読む」形にする。
 */
async function imageBlocks(name: string, buf: Buffer): Promise<Anthropic.ContentBlockParam[]> {
  const whole = await toImageBlock(name, buf);
  const size = await imageSize(buf);
  // 縮小しても十分な大きさが残る写真だけ分割する（小さい画像は割っても情報が増えない）
  const longSide = size ? Math.max(size.width, size.height) : 0;
  if (longSide < IMAGE_LONG_SIDE * 1.6) return [whole];

  const parts = await splitTall(buf, 2);
  if (parts.length < 2) return [whole];

  const blocks: Anthropic.ContentBlockParam[] = [
    { type: "text", text: `${name}：まず全体、そのあと上半分・下半分を拡大したものを渡します。` },
    whole,
  ];
  for (const [i, part] of parts.entries()) {
    blocks.push({ type: "text", text: i === 0 ? "上半分（拡大）" : "下半分（拡大）" });
    blocks.push(await toImageBlock(`${name}#${i + 1}`, part));
  }
  return blocks;
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
    blocks.push(...(await imageBlocks(`${name}#${p}`, png)));
  }
  if (total > pages) {
    notes.push(`${name}: ${total}ページのうち先頭${pages}ページのみAIで読み取りました（設定の「AIに渡す最大ページ数」で変更できます）。`);
  }
  return { blocks, notes };
}

/** プロンプトに載せる出力形式（検証に使うスキーマからそのまま生成する） */
const SCHEMA_TEXT = JSON.stringify(z.toJSONSchema(AiDocumentSchema, { reused: "inline" }), null, 1);

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
- 「1－ 1000 ／月 3.0円」「1001－ 2000 ／月 2.6円」のように枚数の帯ごとに単価が違う明細（パフォーマンスチャージ）は、
  区分ごとに chargeLines を作り、帯を tiers に並べる。「控除 3%の控除カウント」があれば deductionPercent に 3 を入れる。
  フルカラーが「コピー」と「プリント」に分かれて単価が違う場合は、別々の chargeLines にする（合算しない）。
  この形式では monoPages / colorPages などにも枚数を入れたうえで、chargeLines にも内訳を入れる。
- 印刷枚数そのものが一律で差し引かれる控除（「ミスプリント1%控除」「2%控除」）があれば、
  counters の deductionPercent にその率を入れる。控除は必ず拾うこと。
- 支払予定表の残債（remainingDebt）は、本日以降で最初に到来する支払回の「残高（未経過リース料）」。書類に「残債」「一括精算額」の記載があればその金額を使う。
- 読み取れない項目は推測せず null にする。数字を作らない。
- evidence には、その値の根拠になった書類上の行をそのまま（読み取れた文字のまま）入れる。
- transcript には書類本文を上から順に書き起こす。表は1行1レコード、列は半角スペース区切り。最大80行（長い書類は数字が入っている行を優先する）。
  金額・枚数・単価の入った行を必ず含める。ここが長くなりすぎて出力が切れるくらいなら、transcript を削ってでも counters と lease を完全に埋める。

パフォーマンスチャージ明細（リコー等）の読み方
この形式は取りこぼしが起きやすいので、次の手順で必ず全部を拾ってください。

1.【ご契約情報】の表から、区分ごとの「今回検針内容」「前回検針内容」「ご使用カウント」を読む。
   例）モノカラー総出力 267,304 / 265,915 / 1,389
       フルカラー総出力① 68,266 / 67,831 / 435
       フルカラーコピー（①−②） 6,965 / 6,912 / 53
       フルカラープリント② 61,301 / 60,919 / 382
   「フルカラー総出力」は内訳（コピー＋プリント）の合計なので、chargeLines には入れない。
2.【ご利用金額内訳】の表から、区分ごとに次を読む。
   ・控除 N%の控除カウント → deductionPercent に N
   ・請求カウント
   ・帯（「1－ 1000／月」「1001－ 2000／月」）ごとの単価と、その帯のカウント・内訳金額
   例）モノカラー総出力：控除2%（28カウント）、請求1,361、1-1000が3.0円で3,000円、
       1001-2000が2.6円で938円
3. 区分は明細に出てくる順にすべて作る。金額の書かれた行を1つも飛ばさない。
4. 最後の「合計（税抜き）」を counters の amount に入れる。
   各区分の内訳金額を足した額と一致するか、自分で確かめてから返す。
   合わない場合は notes にその旨と、どの区分が怪しいかを書く。

出力の形式
次のJSON Schemaに従うJSONオブジェクトだけを出力してください。
説明・前置き・あとがき・コードフェンス（\`\`\`）は一切付けず、{ で始まり } で終わる本文だけを返します。
${SCHEMA_TEXT}`;

/**
 * 応答からJSONを取り出す。
 * 前置きやコードフェンスが付いた場合に備えて、最初の { から最後の } までを拾う。
 */
function safeJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return undefined;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function textOf(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

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
    blocks = await imageBlocks(input.name, input.buffer);
  }

  const today = (input.today ?? new Date()).toISOString().slice(0, 10);
  const hint =
    input.role && input.role !== "unknown"
      ? `この書類は「${ROLE_LABELS[input.role]}」として預かったものです。\n`
      : "";

  const userText = `${hint}ファイル名: ${input.name}\n本日の日付: ${today}\nこの書類を読み取ってください。`;
  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: [...blocks, { type: "text", text: userText }] },
  ];

  // 構造化出力（サーバ側で形式を強制する機能）は、この項目数だと
  // 「compiled grammar is too large」で弾かれるため、
  // JSONで返させて手元で検証する。崩れていれば理由を伝えて1度だけ引き直す。
  let parsed: AiDocument | undefined;
  let inputTokens = 0;
  let outputTokens = 0;
  let model = input.ai.model || "claude-opus-5";
  let lastError = "";

  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    // 必ずストリーミングで受け取る。
    // 出力上限を大きく取ると、SDKが「10分を超える可能性がある」と判断して
    // 送信前に例外を投げる（＝APIに届かないまま失敗し、黙ってOCRに落ちる）。
    // 明細を最後まで書き切らせたいので上限は下げず、受け取り方を変える。
    const response: Anthropic.Message = await client.messages
      .stream({
        model: input.ai.model || "claude-opus-5",
        max_tokens: 32000,
        // Opus 5 は考えながら答える。明細の桁合わせはここが効く。
        thinking: { type: "adaptive" },
        system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
        messages,
      })
      .finalMessage();
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    model = response.model;

    if (response.stop_reason === "refusal") {
      throw new Error(`AIが読み取りを中断しました（${response.stop_details?.category ?? "理由不明"}）。`);
    }
    const body = textOf(response);
    if (response.stop_reason === "max_tokens") {
      lastError = "出力が長すぎて途中で切れました。transcript は空の配列にしてください。";
    } else {
      const json = safeJson(body);
      if (json === undefined) {
        lastError = "応答にJSONが含まれていませんでした。";
      } else {
        const result = AiDocumentSchema.safeParse(json);
        if (result.success) {
          parsed = result.data;
          break;
        }
        lastError = result.error.issues
        .slice(0, 10)
          .map((i) => `${i.path.join(".") || "(全体)"}: ${i.message}`)
          .join(" / ");
      }
    }
    messages.push(
      { role: "assistant", content: body.slice(0, 2000) || "(空の応答)" },
      {
        role: "user",
        content: `前回の出力を取り込めませんでした（${lastError}）。JSON Schemaに従うJSONオブジェクトだけを、もう一度出力してください。`,
      },
    );
  }

  if (!parsed) throw new Error(`AIの応答を解析できませんでした（${lastError}）。`);

  if (notes.length) parsed.notes = [...notes, ...parsed.notes];

  return { document: parsed, model, inputTokens, outputTokens };
}

/** 概算利用料（Claude Opus 5: 入力$5 / 出力$25 per 1Mトークン） */
export function estimateUsd(inputTokens: number, outputTokens: number): number {
  return (inputTokens * 5 + outputTokens * 25) / 1_000_000;
}
