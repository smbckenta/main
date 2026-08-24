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
  } satisfies AiStatus);
}
