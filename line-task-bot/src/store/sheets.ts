/**
 * Google スプレッドシートを薄い行ストアとして扱うためのラッパ。
 *
 * 規模の前提: 1 グループあたり数百〜数千行。全行読み込みで足りる範囲を想定している。
 * これを超える運用になったら Firestore などへ差し替える（呼び出し側は repo 経由なので影響は限定的）。
 */

import { google, type sheets_v4 } from "googleapis";
import { getGoogleAuth } from "../google/auth.js";
import { config } from "../config.js";

let cached: sheets_v4.Sheets | null = null;

export function getSheetsApi(): sheets_v4.Sheets {
  if (!cached) {
    cached = google.sheets({ version: "v4", auth: getGoogleAuth() });
  }
  return cached;
}

/** ヘッダー行を除いたデータ行を返す。行番号は 1 始まり（ヘッダーが 1 行目）。 */
export async function readRows(
  sheetName: string,
): Promise<{ rowNumber: number; values: string[] }[]> {
  const sheets = getSheetsApi();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${sheetName}!A2:Z`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const values = response.data.values ?? [];
  return values.map((row, index) => ({
    rowNumber: index + 2,
    values: (row as unknown[]).map((cell) =>
      cell === null || cell === undefined ? "" : String(cell),
    ),
  }));
}

export async function appendRows(
  sheetName: string,
  rows: string[][],
): Promise<void> {
  if (rows.length === 0) return;
  const sheets = getSheetsApi();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${sheetName}!A:Z`,
    valueInputOption: "RAW",
    insertDataOption: "INSERT_ROWS",
    requestBody: { values: rows },
  });
}

/** 行番号を指定して 1 行まるごと置き換える。 */
export async function updateRow(
  sheetName: string,
  rowNumber: number,
  values: string[],
): Promise<void> {
  const sheets = getSheetsApi();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${sheetName}!A${rowNumber}`,
    valueInputOption: "RAW",
    requestBody: { values: [values] },
  });
}

/** 複数行の更新を 1 リクエストにまとめる。API クォータ節約のため。 */
export async function updateRows(
  sheetName: string,
  updates: { rowNumber: number; values: string[] }[],
): Promise<void> {
  if (updates.length === 0) return;
  const sheets = getSheetsApi();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.sheets.spreadsheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: updates.map((update) => ({
        range: `${sheetName}!A${update.rowNumber}`,
        values: [update.values],
      })),
    },
  });
}

/** 指定シートが無ければヘッダー付きで作成する。冪等。 */
export async function ensureSheet(
  sheetName: string,
  header: string[],
): Promise<void> {
  const sheets = getSheetsApi();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.sheets.spreadsheetId,
  });
  const exists = (meta.data.sheets ?? []).some(
    (sheet) => sheet.properties?.title === sheetName,
  );

  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.sheets.spreadsheetId,
      requestBody: {
        requests: [{ addSheet: { properties: { title: sheetName } } }],
      },
    });
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.sheets.spreadsheetId,
    range: `${sheetName}!A1`,
    valueInputOption: "RAW",
    requestBody: { values: [header] },
  });
}

/** 行の欠けたセルを埋め、固定長の配列として扱えるようにする。 */
export function cell(values: string[], index: number): string {
  return values[index] ?? "";
}
