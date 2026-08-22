import { getAccessToken } from "./service-account";

/**
 * Google スプレッドシートの読み書き（必要な操作だけの薄いラッパー）。
 * 見積書番号の台帳シートに、番号・顧客名・内容の行を追記／更新する。
 */

/** 動作確認用に差し替えられるようにしている（通常は既定のまま） */
const API = process.env.GOOGLE_SHEETS_API ?? "https://sheets.googleapis.com/v4/spreadsheets";

export class SheetsError extends Error {}

type Cell = string | number;

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const json = (await res.json()) as T & { error?: { message?: string; status?: string } };
  if (!res.ok) {
    throw new SheetsError(
      `スプレッドシートにアクセスできませんでした（${json.error?.message ?? res.status}）。共有設定（サービスアカウントを編集者に追加）をご確認ください。`,
    );
  }
  return json;
}

/** A1形式の範囲。シート名に空白や記号が入っても壊れないよう引用する */
export function a1(sheetName: string, range: string): string {
  return encodeURIComponent(`'${sheetName.replace(/'/g, "''")}'!${range}`);
}

export async function getValues(
  spreadsheetId: string,
  sheetName: string,
  range: string,
): Promise<Cell[][]> {
  const json = await call<{ values?: Cell[][] }>(`${API}/${spreadsheetId}/values/${a1(sheetName, range)}`);
  return json.values ?? [];
}

/** 最終行の下に行を追記する */
export async function appendRows(
  spreadsheetId: string,
  sheetName: string,
  rows: Cell[][],
): Promise<void> {
  await call(
    `${API}/${spreadsheetId}/values/${a1(sheetName, "A:C")}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    { method: "POST", body: JSON.stringify({ values: rows }) },
  );
}

/** 指定した行（1始まり）を書き換える */
export async function updateRow(
  spreadsheetId: string,
  sheetName: string,
  rowNumber: number,
  values: Cell[],
): Promise<void> {
  await call(
    `${API}/${spreadsheetId}/values/${a1(sheetName, `A${rowNumber}:C${rowNumber}`)}?valueInputOption=USER_ENTERED`,
    { method: "PUT", body: JSON.stringify({ values: [values] }) },
  );
}

export interface RegisterState {
  /** 台帳に入っている見積書番号の最大値 */
  maxNumber: number;
  /** 見積書番号 → 行番号（1始まり） */
  rowByNumber: Map<number, number>;
}

/** A列（見積書番号）を読み、最大値と行位置を把握する */
export async function readRegister(spreadsheetId: string, sheetName: string): Promise<RegisterState> {
  const values = await getValues(spreadsheetId, sheetName, "A1:A100000");
  const rowByNumber = new Map<number, number>();
  let maxNumber = 0;
  values.forEach((row, i) => {
    const n = Number(String(row?.[0] ?? "").replace(/[^0-9]/g, ""));
    if (!Number.isFinite(n) || n <= 0) return;
    rowByNumber.set(n, i + 1);
    if (n > maxNumber) maxNumber = n;
  });
  return { maxNumber, rowByNumber };
}
