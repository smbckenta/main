import { NextResponse } from "next/server";
import { resolveApiKey } from "@/lib/ai/document-ai";
import { getSettings, DATA_DIR } from "@/lib/store";

export const runtime = "nodejs";

export interface AiStatus {
  /** 実際にAIで読み取れる状態か */
  ready: boolean;
  /** 設定で「AIで読み取る」がONか */
  enabled: boolean;
  /** APIキーがどこで見つかったか */
  source: "settings" | "env" | "file" | "none";
  model: string;
  /** api-key.txt を置く場所（画面で案内する） */
  dataDir: string;
  message: string;
  /** 伏せ字にしたAPIキー。貼り付けが途中で切れていないか目で確かめるため */
  keyHint?: string;
  /** キーの形がおかしい場合の注意書き */
  keyWarning?: string;
}

/**
 * 貼り付けミスは「見た目では分からない」のが厄介なので、
 * 頭と尻尾だけ見せて長さを添える。
 * キー全体は絶対に返さない（画面のソースに残ってしまう）。
 */
function maskKey(key: string): string {
  if (key.length <= 16) return `${key.slice(0, 4)}…（${key.length}文字）`;
  return `${key.slice(0, 12)}…${key.slice(-4)}（${key.length}文字）`;
}

/** キーの形から、よくある貼り付けミスを見つける */
function checkKey(key: string): string | undefined {
  if (/\s/.test(key)) return "APIキーの途中に空白や改行が入っています。貼り付け直してください。";
  if (!key.startsWith("sk-ant-")) return "APIキーが「sk-ant-」で始まっていません。別の文字列を貼り付けている可能性があります。";
  if (key.length < 90) return "APIキーが短すぎます。貼り付けが途中で切れている可能性があります。";
  return undefined;
}

/**
 * AI読み取りが使える状態かを返す。
 *
 * キーが無いと黙ってOCRに切り替わり、読み取り精度が落ちたことに
 * 気づけない。画面で常に状態が見えるようにするための口。
 */
export async function GET() {
  const settings = await getSettings();
  const fromSettings = settings.ai.apiKey?.trim();
  const fromEnv = process.env.ANTHROPIC_API_KEY?.trim();
  const key = await resolveApiKey(settings.ai);

  const source: AiStatus["source"] = fromSettings
    ? "settings"
    : fromEnv
      ? "env"
      : key
        ? "file"
        : "none";

  const ready = Boolean(settings.ai.enabled && key);
  const message = !settings.ai.enabled
    ? "設定で「AIで読み取る」が「使わない」になっています。PDF・写真は文字起こし（OCR）で読み取ります。"
    : key
      ? {
          settings: "設定画面に入力されたAPIキーを使います。",
          env: "環境変数 ANTHROPIC_API_KEY のAPIキーを使います。",
          file: `保存先の api-key.txt のAPIキーを使います。`,
          none: "",
        }[source]
      : "APIキーが見つかりません。このままではPDF・写真は文字起こし（OCR）で読み取るため、カウンター明細の読み取り精度が大きく落ちます。";

  return NextResponse.json({
    ready,
    enabled: settings.ai.enabled,
    source,
    model: settings.ai.model,
    dataDir: DATA_DIR,
    message,
    keyHint: key ? maskKey(key) : undefined,
    keyWarning: key ? checkKey(key) : undefined,
  } satisfies AiStatus);
}
