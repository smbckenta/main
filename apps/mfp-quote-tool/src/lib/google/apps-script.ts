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

/** スクリプトの雛形に書いてある、書き換え忘れると分かる合言葉 */
const PLACEHOLDER_TOKEN = "ここを合言葉に書き換える";

/**
 * 入力されたウェブアプリのURLと合言葉を、通信する前に確かめる。
 *
 * ここでつまずく原因はほぼ決まっていて、たいていは
 * 「台帳スプレッドシートのURLを貼ってしまった」。
 * 通信してから「想定外の応答」と言われても何を直せばよいか分からないので、
 * 入力の時点で何がおかしいかを名指しで返す。
 */
export function checkAppsScriptInput(url: string, token: string): string | undefined {
  const u = url.trim();
  if (!u) {
    return "ウェブアプリのURLが未入力です。Apps Scriptの「デプロイ → ウェブアプリ」で表示されるURL（https://script.google.com/macros/s/.../exec）を貼ってください。";
  }
  if (/docs\.google\.com\/spreadsheets/.test(u)) {
    return "入力されているのは台帳スプレッドシートのURLです。台帳で「拡張機能 → Apps Script」を開き、「デプロイ → ウェブアプリ」で表示されるURL（https://script.google.com/macros/s/.../exec）に貼り替えてください。";
  }
  if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(u)) {
    return "ウェブアプリのURLが違うようです。https://script.google.com/macros/s/.../exec の形のURLを貼ってください。";
  }
  if (!/\/(exec|dev)$/.test(u.split("?")[0])) {
    return "URLの末尾が /exec になっていません。デプロイ画面の「ウェブアプリのURL」をそのまま貼ってください。";
  }
  if (/\/dev$/.test(u.split("?")[0])) {
    return "URLの末尾が /dev になっています。これは編集者だけが使えるテスト用のURLです。「デプロイ → デプロイを管理」から /exec で終わるURLを貼ってください。";
  }
  if (!token.trim()) {
    return "合言葉（TOKEN）が未入力です。スクリプトの先頭に書いた TOKEN と同じ文字列を入れてください。";
  }
  if (token.trim() === PLACEHOLDER_TOKEN) {
    return `合言葉が雛形のまま（${PLACEHOLDER_TOKEN}）です。スクリプトとツールの両方を、推測されにくい合言葉に書き換えてください。`;
  }
  return undefined;
}

async function post<T>(url: string, token: string, payload: Record<string, unknown>): Promise<T> {
  const problem = checkAppsScriptInput(url, token);
  if (problem) throw new AppsScriptError(problem);

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
    // JSONではないものが返ってきた。何が返ってきたかで原因を切り分ける
    throw new AppsScriptError(explainNonJson(text, res));
  }
  if (!res.ok || json.ok === false) {
    const detail = json.error ?? String(res.status);
    if (detail.includes("合言葉")) {
      throw new AppsScriptError(
        "合言葉（TOKEN）が一致しませんでした。スクリプトの先頭に書いた TOKEN と、ツールに入れた合言葉をそろえてください（書き換えたあとは、もう一度デプロイが必要です）。",
      );
    }
    if (detail.includes("シートが見つかりません")) {
      throw new AppsScriptError(
        `${detail}。台帳のシート見出し（タブ）の名前と、設定の「シート名」をそろえてください。`,
      );
    }
    throw new AppsScriptError(`台帳（Apps Script）でエラーになりました（${detail}）。`);
  }
  return json;
}

/** JSON以外が返ってきたときに、返ってきた中身から原因を言い当てる */
function explainNonJson(text: string, res: Response): string {
  const head = text.slice(0, 2_000);
  if (/accounts\.google\.com|ServiceLogin|ログイン/.test(head)) {
    return "台帳（Apps Script）がGoogleのログイン画面を返しました。デプロイの「アクセスできるユーザー」を「全員」にしてから、もう一度デプロイしてください。";
  }
  if (/スプレッドシート|Google Sheets|docs\.google\.com\/spreadsheets/.test(head)) {
    return "スプレッドシートの画面が返ってきました。ウェブアプリのURL欄には、Apps Scriptの「デプロイ → ウェブアプリ」で表示されるURL（https://script.google.com/macros/s/.../exec）を貼ってください。";
  }
  if (res.status === 404) {
    return "ウェブアプリが見つかりませんでした（404）。デプロイを作り直して、新しいURLを貼り直してください。";
  }
  if (res.status === 403) {
    return "ウェブアプリにアクセスできませんでした（403）。デプロイの「アクセスできるユーザー」を「全員」にしてください。";
  }
  return `台帳（Apps Script）から想定外の応答がありました（HTTP ${res.status}）。デプロイの「次のユーザーとして実行：自分」「アクセスできるユーザー：全員」をご確認ください。`;
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
