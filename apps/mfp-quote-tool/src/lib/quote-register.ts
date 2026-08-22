import type { ProposalCalc, Quote, QuoteRegisterSettings } from "./types";
import { listQuotes } from "./store";
import { appendRows, readRegister, updateRow, type RegisterState } from "./google/sheets";
import { readServiceAccountKey } from "./google/service-account";

/**
 * 見積書番号の台帳（Googleスプレッドシート「見積書」シート）との連携。
 *
 * 運用に合わせて、番号は「提案（機種）1件につき1つ」消費する。
 * 台帳には 見積書番号／顧客名／内容 の3列を書き込む。
 * 鍵ファイルが無い環境でも使えるよう、番号の採番は手元のデータでも行う。
 */

/** 台帳の「内容」欄。既存の書き方（3554ci　12,000/6年　0.7/2.0/7.0）に合わせる */
export function registerContent(calc: ProposalCalc): string {
  const p = calc.proposal;
  const u = calc.units;
  const years = Math.round(p.leaseTerm / 12);
  const unit = (v: number) => String(Number(v.toFixed(2)));
  const counter = [unit(u.mono), unit(u.twoColor), unit(u.color)].join("/");
  const minCharge = u.minCharge > 0 ? `/${u.minCharge.toLocaleString("ja-JP")}` : "";
  return `${p.modelText}　${calc.monthlyLease.toLocaleString("ja-JP")}/${years}年　${counter}${minCharge}`;
}

/** 台帳に書く1行 */
export function registerRow(quote: Quote, calc: ProposalCalc): [string, string, string] {
  return [
    String(calc.proposal.quoteNo ?? quote.quoteNo),
    quote.customerName,
    registerContent(calc),
  ];
}

export function isRegisterReady(settings: QuoteRegisterSettings): boolean {
  return Boolean(settings.enabled && settings.spreadsheetId && settings.sheetName);
}

/** 手元に保存済みの案件から、使用済みの最大番号を求める */
export async function localMaxNumber(): Promise<number> {
  const quotes = await listQuotes();
  let max = 0;
  for (const q of quotes) {
    for (const value of [q.quoteNo, ...q.proposals.map((p) => p.quoteNo)]) {
      const n = Number(String(value ?? "").replace(/[^0-9]/g, ""));
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

export interface Allocation {
  numbers: string[];
  /** 台帳（スプレッドシート）から採番できたか */
  fromSheet: boolean;
  warning?: string;
}

/**
 * 見積書番号を必要な数だけ確保する。
 * 台帳が使える場合は台帳の最大番号の続きから、使えない場合は手元の最大番号の続きから。
 */
export async function allocateQuoteNumbers(
  count: number,
  settings: QuoteRegisterSettings,
): Promise<Allocation> {
  const local = await localMaxNumber();
  const floor = Math.max(local, settings.startNumber - 1);

  if (isRegisterReady(settings) && (await readServiceAccountKey())) {
    try {
      const state = await readRegister(settings.spreadsheetId, settings.sheetName);
      const base = Math.max(state.maxNumber, floor);
      return { numbers: seq(base, count), fromSheet: true };
    } catch (err) {
      return {
        numbers: seq(floor, count),
        fromSheet: false,
        warning: `台帳から採番できませんでした（${(err as Error).message}）。手元の番号の続きを使います。`,
      };
    }
  }
  return { numbers: seq(floor, count), fromSheet: false };
}

const seq = (base: number, count: number): string[] =>
  Array.from({ length: count }, (_, i) => String(base + 1 + i));

export interface SyncResult {
  /** 台帳へ書き込めた行数 */
  written: number;
  /** 画面に表示する（手で貼り付ける用の）行 */
  rows: [string, string, string][];
  warning?: string;
}

/**
 * 台帳へ反映する。
 * 同じ番号の行があれば内容を書き換え、無ければ追記する。
 * 鍵が無い・設定が空の場合は、貼り付け用の行だけを返す。
 */
export async function syncRegister(
  quote: Quote,
  calcs: ProposalCalc[],
  settings: QuoteRegisterSettings,
): Promise<SyncResult> {
  const rows = calcs.map((c) => registerRow(quote, c));
  if (!rows.length) return { written: 0, rows };

  if (!isRegisterReady(settings)) {
    return { written: 0, rows, warning: "台帳への自動転記は未設定です。下の行をコピーして貼り付けてください。" };
  }
  if (!(await readServiceAccountKey())) {
    return {
      written: 0,
      rows,
      warning:
        "Googleの鍵ファイル（google-service-account.json）が見つかりません。下の行をコピーして貼り付けてください。",
    };
  }

  try {
    const state: RegisterState = await readRegister(settings.spreadsheetId, settings.sheetName);
    const toAppend: [string, string, string][] = [];
    let written = 0;
    for (const row of rows) {
      const rowNumber = state.rowByNumber.get(Number(row[0]));
      if (rowNumber) {
        await updateRow(settings.spreadsheetId, settings.sheetName, rowNumber, row);
        written++;
      } else {
        toAppend.push(row);
      }
    }
    if (toAppend.length) {
      await appendRows(settings.spreadsheetId, settings.sheetName, toAppend);
      written += toAppend.length;
    }
    return { written, rows };
  } catch (err) {
    return { written: 0, rows, warning: (err as Error).message };
  }
}
