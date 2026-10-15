import { NextResponse } from "next/server";
import { buildSetupScript, extractSpreadsheetId, makeToken } from "@/lib/google/setup-script";

export const runtime = "nodejs";

/**
 * 台帳につなぐためのApps Scriptを、貼るだけの形で作って返す。
 * スプレッドシートIDと合言葉を埋め込んであるので、書き写しは要らない。
 */
export async function POST(req: Request) {
  const { spreadsheet } = (await req.json().catch(() => ({}))) as { spreadsheet?: string };
  const spreadsheetId = extractSpreadsheetId(spreadsheet ?? "");
  if (!spreadsheetId) {
    return NextResponse.json(
      {
        error:
          "台帳のURLが読み取れませんでした。ブラウザで台帳を開いたときのURL（https://docs.google.com/spreadsheets/d/…）をそのまま貼ってください。",
      },
      { status: 400 },
    );
  }

  const token = makeToken();
  try {
    return NextResponse.json({ spreadsheetId, token, script: await buildSetupScript(spreadsheetId, token) });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
