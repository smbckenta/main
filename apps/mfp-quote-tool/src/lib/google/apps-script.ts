import { toRegisterState, type RegisterState } from "./sheets";

/**
 * Google Apps Script のウェブアプリ経由でスプレッドシートを読み書きする。
 *
 * サービスアカウント（Google Cloud）を用意しなくても、
 * スプレッドシートに小さなスクリプトを貼ってデプロイするだけで使える。
 * スクリプト本体は docs/apps-script/QuoteRegister.gs。
 */

export class AppsScriptError extends Error {}

type Row = [string, string, string];

async function post<T>(url: string, token: string, payload: Record<string, unknown>): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      // Apps Script はリダイレクトを挟むため追従する
      redirect: "follow",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify({ token, ...payload }),
    });
  } catch (err) {
    throw new AppsScriptError(`台帳（Apps Script）に接続できませんでした（${(err as Error).message}）。`);
  }
  const text = await res.text();
  let json: { ok?: boolean; error?: string } & T;
  try {
    json = JSON.parse(text);
  } catch {
    // ログイン画面のHTMLが返ってきた場合など
    throw new AppsScriptError(
      "台帳（Apps Script）から想定外の応答がありました。デプロイの「アクセスできるユーザー」を「全員」にしてください。",
    );
  }
  if (!res.ok || json.ok === false) {
    throw new AppsScriptError(`台帳（Apps Script）でエラーになりました（${json.error ?? res.status}）。`);
  }
  return json;
}

export async function readRegisterViaAppsScript(
  url: string,
  token: string,
  sheetName: string,
): Promise<RegisterState> {
  const json = await post<{ values?: (string | number)[][] }>(url, token, { action: "read", sheetName });
  return toRegisterState(json.values ?? []);
}

/** 番号の行に顧客名・内容を書き込む（行が無ければ最終行に追記される） */
export async function writeRowsViaAppsScript(
  url: string,
  token: string,
  sheetName: string,
  rows: Row[],
): Promise<number> {
  const json = await post<{ written?: number }>(url, token, { action: "write", sheetName, rows });
  return json.written ?? 0;
}
