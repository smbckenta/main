import { promises as fs } from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";

/**
 * 台帳につなぐための Apps Script を、そのまま貼れる形で用意する。
 *
 * 設定でつまずく原因は決まっていて、
 *   ・スプレッドシートIDを手で書き写し間違える
 *   ・スクリプトの TOKEN とツールの合言葉がずれる
 * の2つ。どちらも人が書き写すから起きるので、書き写しをなくす。
 */

/** 台帳のURL（またはID）から、スプレッドシートIDだけを取り出す */
export function extractSpreadsheetId(input: string): string {
  const s = input.trim();
  if (!s) return "";
  // https://docs.google.com/spreadsheets/d/<ID>/edit... の形
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  if (m) return m[1];
  // すでにIDだけが入っている場合
  return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : "";
}

/** 推測されにくい合言葉を作る（記号は使わない。貼り間違いを防ぐため） */
export const makeToken = (): string => randomBytes(18).toString("base64url");

/** 同梱しているスクリプトの雛形 */
const TEMPLATE_PATH = path.join(process.cwd(), "docs", "apps-script", "QuoteRegister.gs");

/**
 * スプレッドシートIDと合言葉を埋め込んだスクリプトを返す。
 * 利用者は「全選択してコピー → Apps Script に貼り付け」だけで済む。
 */
export async function buildSetupScript(spreadsheetId: string, token: string): Promise<string> {
  const template = await fs.readFile(TEMPLATE_PATH, "utf8");
  return template
    .replace(/var SPREADSHEET_ID = "[^"]*";/, `var SPREADSHEET_ID = "${spreadsheetId}";`)
    .replace(/var TOKEN = "[^"]*";/, `var TOKEN = "${token}";`);
}
