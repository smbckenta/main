import { NextResponse } from "next/server";
import { checkApiKey, maskApiKey } from "@/lib/ai/api-key";
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

  const keyWarning = key ? checkApiKey(key) : undefined;
  // 形のおかしいキーで「使えます」と出すと、読み取り時に黙ってOCRへ落ちる。
  // 使えない状態として扱う。
  const ready = Boolean(settings.ai.enabled && key && !keyWarning);
  const baseMessage = !settings.ai.enabled
    ? "設定で「AIで読み取る」が「使わない」になっています。PDF・写真は文字起こし（OCR）で読み取ります。"
    : key
      ? {
          settings: "設定画面に入力されたAPIキーを使います。",
          env: "環境変数 ANTHROPIC_API_KEY のAPIキーを使います。",
          file: `保存先の api-key.txt のAPIキーを使います。`,
          none: "",
        }[source]
      : "APIキーが見つかりません。このままではPDF・写真は文字起こし（OCR）で読み取るため、カウンター明細の読み取り精度が大きく落ちます。";
  const message = keyWarning ?? baseMessage;

  return NextResponse.json({
    ready,
    enabled: settings.ai.enabled,
    source,
    model: settings.ai.model,
    dataDir: DATA_DIR,
    message,
    keyHint: key ? maskApiKey(key) : undefined,
    keyWarning,
  } satisfies AiStatus);
}
