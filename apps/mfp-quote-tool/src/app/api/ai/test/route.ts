import Anthropic from "@anthropic-ai/sdk";
import { NextResponse } from "next/server";
import { checkApiKey } from "@/lib/ai/api-key";
import { resolveApiKey } from "@/lib/ai/document-ai";
import { getSettings } from "@/lib/store";

export const runtime = "nodejs";

export interface AiTestResult {
  ok: boolean;
  /** 実際に応答したモデル */
  model?: string;
  /** 失敗したときの、そのままの理由 */
  message: string;
  /** HTTPの状態（APIまで届いた場合） */
  status?: number;
}

/**
 * AI読み取りの接続テスト。
 *
 * 設定画面の「使えます」はキーが見つかったかどうかしか見ていない。
 * キーが古い・残高が無い・モデル名が違う、といった失敗は実際に呼んでみないと
 * 分からず、読み取り時に黙ってOCRへ落ちてしまう。ここで一度だけ本当に呼ぶ。
 */
export async function POST() {
  const settings = await getSettings();
  const model = settings.ai.model || "claude-opus-5";

  if (!settings.ai.enabled) {
    return NextResponse.json({
      ok: false,
      message: "設定で「AIで読み取る」が「使わない」になっています。",
    } satisfies AiTestResult);
  }

  const apiKey = await resolveApiKey(settings.ai);
  if (!apiKey) {
    return NextResponse.json({
      ok: false,
      message: "APIキーが見つかりません。設定画面のAPIキー欄に sk-ant-… を貼り付けて保存してください。",
    } satisfies AiTestResult);
  }

  // 形が明らかにおかしいキーは、問い合わせる前に止める。
  // 通信まで行くと理由が「401」としか出ず、貼り付けミスだと気づけない。
  const bad = checkApiKey(apiKey);
  if (bad) return NextResponse.json({ ok: false, message: bad } satisfies AiTestResult);

  try {
    const stream = new Anthropic({ apiKey, maxRetries: 1 }).messages.stream({
      model,
      max_tokens: 16,
      messages: [{ role: "user", content: "接続テストです。OKとだけ返してください。" }],
    });
    // 受け取り口を必ず用意しておく。これが無いと、通信が落ちたときの
    // エラーが誰にも拾われず、アプリごと落ちる（画面には Failed to fetch と出る）
    stream.on("error", () => {});
    const res = await stream.finalMessage();
    return NextResponse.json({ ok: true, model: res.model, message: "つながりました。AIで読み取れます。" } satisfies AiTestResult);
  } catch (err) {
    const status = err instanceof Anthropic.APIError ? err.status : undefined;
    return NextResponse.json({
      ok: false,
      status,
      model,
      message: hint(status, model, (err as Error).message),
    } satisfies AiTestResult);
  }
}

/** よくある失敗は、原因と直し方まで日本語で書く */
function hint(status: number | undefined, model: string, raw: string): string {
  if (status === 401) return `APIキーが受け付けられませんでした（401）。キーが古いか、貼り付け時に文字が欠けている可能性があります。Claude Consoleで新しいキーを発行し直してください。／${raw}`;
  if (status === 403) return `このAPIキーでは利用できませんでした（403）。／${raw}`;
  if (status === 404) return `モデル「${model}」が見つかりません（404）。設定画面の「モデル」を claude-opus-5 に戻してください。／${raw}`;
  if (status === 400 && /credit|balance/i.test(raw)) return `残高が足りません（400）。Claude Consoleでクレジットを追加してください。／${raw}`;
  if (status === 429) return `短時間に呼びすぎです（429）。少し待ってからもう一度お試しください。／${raw}`;
  if (status && status >= 500) return `Anthropic側で一時的な不具合が出ています（${status}）。少し待ってからもう一度お試しください。／${raw}`;
  if (/fetch failed|ENOTFOUND|ECONNREFUSED|certificate/i.test(raw)) {
    return `インターネットに出られませんでした。社内のネットワーク（プロキシ・ファイアウォール）で api.anthropic.com が塞がれていないかご確認ください。／${raw}`;
  }
  return raw;
}
