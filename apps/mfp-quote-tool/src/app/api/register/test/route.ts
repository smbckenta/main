import { NextResponse } from "next/server";
import { getSettings } from "@/lib/store";
import { readRegisterViaAppsScript } from "@/lib/google/apps-script";
import { readRegister } from "@/lib/google/sheets";
import { readServiceAccountKey } from "@/lib/google/service-account";
import { localMaxNumber } from "@/lib/quote-register";
import type { QuoteRegisterSettings } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * サービスアカウント鍵の状態を返す。
 * 鍵を置いたあと、どのメールアドレスをスプレッドシートに共有すればよいかを画面に出すために使う。
 */
export async function GET() {
  const key = await readServiceAccountKey();
  return NextResponse.json({ hasKey: Boolean(key), email: key?.client_email ?? null });
}

/**
 * 台帳（スプレッドシート）につながるかを確かめる。
 * 設定画面で入力した内容をそのまま試せるよう、保存前でも受け付ける。
 */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Partial<QuoteRegisterSettings>;
  const saved = await getSettings();
  const settings: QuoteRegisterSettings = { ...saved.quoteRegister, ...body };

  try {
    const state =
      settings.mode === "appsScript"
        ? await readRegisterViaAppsScript(settings.webAppUrl, settings.webAppToken, settings.sheetName)
        : await (async () => {
            const key = await readServiceAccountKey();
            if (!key) {
              throw new Error(
                "鍵ファイル（google-service-account.json）がデータの保存先にありません。",
              );
            }
            return readRegister(settings.spreadsheetId, settings.sheetName);
          })();

    const floor = Math.max(await localMaxNumber(), settings.startNumber - 1);
    const next = state.vacantNumbers.filter((n) => n > floor).slice(0, 3);

    return NextResponse.json({
      ok: true,
      sheetName: settings.sheetName,
      rows: state.rowByNumber.size,
      maxNumber: state.maxNumber,
      vacantCount: state.vacantNumbers.length,
      nextNumbers: next.map(String),
      serviceAccountEmail: settings.mode === "serviceAccount" ? (await readServiceAccountKey())?.client_email : undefined,
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: (err as Error).message }, { status: 200 });
  }
}
