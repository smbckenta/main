import type ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../defaults";
import { calcCurrent, calcProposal } from "../pricing";
import type { Proposal, Quote } from "../types";
import { addMultiCompareSheet, addQuoteSheet, newWorkbook } from "./excel";

/**
 * Excelでも削減額は赤字で出す。
 * 値は普通の数値のままで、書式（[Red]）だけで色を付けている。
 * 値を文字列にしてしまうと合計が取れなくなるため。
 */

const quote: Quote = {
  id: "q",
  title: "複合機入替のご提案",
  customerName: "ヤハタ木工有限会社",
  customerHonorific: "様",
  quoteNo: "137240",
  quoteDate: "2026-08-28",
  area: "福岡",
  current: {
    makerText: "リコー",
    modelText: "MPC3003SP",
    monthlyLease: 15_000,
    monoPages: 1_389,
    colorPages: 435,
    twoColorPages: 0,
    units: { mono: 3, color: 15, twoColor: 0, minCharge: 0 },
    maintenanceMonthly: 0,
  },
  proposals: [],
  createdAt: "",
  updatedAt: "",
};

const proposal: Proposal = {
  id: "p1",
  maker: "KYOCERA",
  modelText: "TASKalfa 2554ci",
  qty: 1,
  items: [{ name: "本体", qty: 1, unit: "台", unitPrice: 1_180_000 }],
  cost: 380_000,
  pricingMode: "fromGp",
  grossProfitAmount: 300_000,
  leaseTerm: 72,
  counterOverridden: false,
  maintenanceMonthly: 0,
};

/** シート全体から、指定した見出しの行を探す */
function findRow(sheet: ExcelJS.Worksheet, label: string): ExcelJS.Row | undefined {
  let found: ExcelJS.Row | undefined;
  sheet.eachRow((row) => {
    if (found) return;
    for (let c = 1; c <= 8; c++) {
      if (String(row.getCell(c).value ?? "").includes(label)) {
        found = row;
        return;
      }
    }
  });
  return found;
}

/** その行にある「赤字の削減額」書式のセル */
const redCells = (row: ExcelJS.Row): ExcelJS.Cell[] => {
  const out: ExcelJS.Cell[] = [];
  for (let c = 1; c <= 10; c++) {
    const cell = row.getCell(c);
    if (typeof cell.numFmt === "string" && cell.numFmt.includes("[Red]")) out.push(cell);
  }
  return out;
};

describe("Excelの削減額", () => {
  const q = { ...quote, proposals: [proposal] };
  const current = calcCurrent(q, DEFAULT_SETTINGS.company.taxRate);
  const calc = calcProposal(q, proposal, DEFAULT_SETTINGS);

  it("比較表の合計合算削減金額が赤字書式になる", () => {
    const wb = newWorkbook("テスト");
    const sheet = addQuoteSheet(wb, q, current, calc, DEFAULT_SETTINGS);
    for (const label of ["合計合算削減金額　（単月）", "合計合算削減金額　（年間）"]) {
      const row = findRow(sheet, label);
      expect(row, label).toBeDefined();
      const cells = redCells(row!);
      expect(cells.length, label).toBe(1);
      expect(cells[0].value).toBe(label.includes("単月") ? calc.diffMonthly : calc.diffYearly);
    }
  });

  it("月間経費の削減額も赤字書式になる", () => {
    const wb = newWorkbook("テスト");
    const sheet = addQuoteSheet(wb, q, current, calc, DEFAULT_SETTINGS);
    const row = findRow(sheet, "月間経費");
    expect(redCells(row!).map((c) => c.value)).toEqual([calc.diffMonthly]);
  });

  it("各社を横並びにした比較表は、メーカーの数だけ赤字のセルが並ぶ", () => {
    const wb = newWorkbook("テスト");
    const sheet = addMultiCompareSheet(wb, q, current, [calc, calc, calc]);
    const row = findRow(sheet, "削減額（単月）");
    expect(redCells(row!)).toHaveLength(3);
  });

  it("赤くするのは書式だけで、値は数値のまま（合計が取れる）", () => {
    const wb = newWorkbook("テスト");
    const sheet = addQuoteSheet(wb, q, current, calc, DEFAULT_SETTINGS);
    const cell = redCells(findRow(sheet, "合計合算削減金額　（単月）")!)[0];
    expect(typeof cell.value).toBe("number");
  });
});
