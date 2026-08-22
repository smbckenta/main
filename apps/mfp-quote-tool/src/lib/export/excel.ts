import ExcelJS from "exceljs";
import type { CurrentCalc, Fleet, FleetCalc, FleetSideCalc, ProposalCalc, Quote, Settings } from "../types";
import { MAKER_LABELS } from "../types";
import { pagesAverageNote } from "../labels";

/**
 * 既存の御見積書・比較表と同じ並びの Excel を生成する。
 * 1シートに「御見積書 → カウンター料金 → リースシミュレーション → 比較表」を縦に並べる、
 * という現行運用のレイアウトをそのまま踏襲している。
 */

const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin" },
  left: { style: "thin" },
  bottom: { style: "thin" },
  right: { style: "thin" },
};
const HEADER_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFE8EEF5" },
};
const SUM_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF4F4F4" },
};
const YEN = "#,##0";
const UNIT = "0.00";

function jpDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

interface RowOptions {
  bold?: boolean;
  fill?: ExcelJS.Fill;
  border?: boolean;
  numFmt?: string;
  align?: ("left" | "center" | "right" | undefined)[];
}

/** A列を空けて B列から値を並べる（既存Excelの見た目に合わせる） */
function putRow(
  sheet: ExcelJS.Worksheet,
  rowNo: number,
  values: (string | number | null)[],
  opts: RowOptions = {},
): ExcelJS.Row {
  const row = sheet.getRow(rowNo);
  values.forEach((v, i) => {
    const cell = row.getCell(i + 2);
    if (v !== null) cell.value = v;
    if (opts.bold) cell.font = { bold: true };
    if (opts.fill) cell.fill = opts.fill;
    if (opts.border) cell.border = THIN;
    if (typeof v === "number" && opts.numFmt) cell.numFmt = opts.numFmt;
    const align = opts.align?.[i];
    if (align) cell.alignment = { horizontal: align, vertical: "middle" };
  });
  return row;
}

function setupSheet(sheet: ExcelJS.Worksheet) {
  sheet.columns = [
    { width: 3 }, // A
    { width: 5 }, // B: No
    { width: 34 }, // C: 品名
    { width: 8 }, // D: 数量
    { width: 6 }, // E: 単位
    { width: 14 }, // F: 単価
    { width: 14 }, // G: 金額
    { width: 20 }, // H: 備考
    { width: 16 }, // I
  ];
  sheet.pageSetup = {
    paperSize: 9, // A4
    orientation: "portrait",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.3, footer: 0.3 },
  };
}

/** 見積書＋比較表の1メーカー分シートを作る */
/** ロゴ画像をシート左上に貼る（ExcelJSはPNG/JPEGのみ） */
export function putLogo(
  wb: ExcelJS.Workbook,
  sheet: ExcelJS.Worksheet,
  logo?: { buffer: Buffer; mime: string; raster: boolean },
): void {
  if (!logo?.raster) return;
  const id = wb.addImage({
    buffer: logo.buffer as unknown as ExcelJS.Buffer,
    extension: logo.mime === "image/png" ? "png" : "jpeg",
  });
  sheet.addImage(id, { tl: { col: 6.7, row: 0.1 }, ext: { width: 210, height: 46 } });
}

export function addQuoteSheet(
  wb: ExcelJS.Workbook,
  quote: Quote,
  current: CurrentCalc,
  calc: ProposalCalc,
  settings: Settings,
): ExcelJS.Worksheet {
  const maker = MAKER_LABELS[calc.proposal.maker];
  const sheet = wb.addWorksheet(maker.slice(0, 30));
  setupSheet(sheet);
  const c = settings.company;
  let r = 1;

  // ── ヘッダー
  putRow(sheet, r, [`${quote.customerName}　${quote.customerHonorific}`], { bold: true });
  sheet.getRow(r).getCell(8).value = jpDate(quote.quoteDate);
  r++;
  sheet.getRow(r).getCell(8).value = `見積書番号：${calc.proposal.quoteNo ?? quote.quoteNo}`;
  r += 1;

  const title = putRow(sheet, r, ["御　見　積　書"]);
  title.getCell(2).font = { size: 18, bold: true };
  sheet.mergeCells(r, 2, r, 8);
  title.getCell(2).alignment = { horizontal: "center" };
  r += 2;

  putRow(sheet, r, ["下記の通り御見積申し上げます。何卒よろしくお願い致します。"]);
  r += 2;

  const subject = `${calc.proposal.modelText}${calc.priceBook ? `　（${calc.priceBook.gradePpm}枚機）` : ""}`;
  const headerRows: [string, string][] = [
    ["物件名", subject],
    ["納入場所", "別途お打ち合わせ"],
    ["御受渡期日", "別途お打ち合わせ"],
    ["御支払条件", "別途お打ち合わせ"],
    ["有効期限", c.validityText],
    ...(quote.staffName ? ([["担当者", quote.staffName]] as [string, string][]) : []),
  ];
  const companyLines = [
    c.name,
    c.representative ?? "",
    c.tel ? `TEL ${c.tel}` : "",
    c.fax ? `FAX ${c.fax}` : "",
    ...(c.offices?.length
      ? c.offices.map((o) => `${o.name}　${o.address}`)
      : [c.branchNote ?? "", c.address ?? ""]),
    c.areaNote ?? "",
  ];
  headerRows.forEach(([label, value], i) => {
    const row = sheet.getRow(r + i);
    row.getCell(2).value = label;
    row.getCell(3).value = `：${value}`;
    row.getCell(8).value = companyLines[i] ?? "";
    if (i === 0) row.getCell(8).font = { bold: true, size: 12 };
  });
  // 会社情報が5行を超える分
  for (let i = headerRows.length; i < companyLines.length; i++) {
    sheet.getRow(r + i).getCell(8).value = companyLines[i];
  }
  r += Math.max(headerRows.length, companyLines.length) + 1;

  // ── 月額リース料金
  const leaseRow = putRow(sheet, r, [
    "月額リース料金",
    null,
    calc.monthlyLease,
    null,
    `（税別・${calc.proposal.leaseTerm}回払い）`,
  ]);
  leaseRow.getCell(2).font = { bold: true, size: 12 };
  leaseRow.getCell(4).font = { bold: true, size: 14 };
  leaseRow.getCell(4).numFmt = YEN;
  r += 2;

  // ── 見積明細
  putRow(sheet, r, ["No", "メーカー　品　名　型　番", "数量", "", "単　価", "金　額", "備考"], {
    bold: true,
    fill: HEADER_FILL,
    border: true,
    align: ["center", "center", "center", "center", "center", "center", "center"],
  });
  r++;

  const groupLabel = calc.priceBook
    ? `【${maker}　${calc.priceBook.category}複合機】`
    : `【${maker}複合機】`;
  putRow(sheet, r, ["", groupLabel, "", "", "", "", ""], { border: true });
  r++;

  calc.proposal.items.forEach((item, i) => {
    putRow(
      sheet,
      r++,
      [i + 1, item.name, item.qty, item.unit, item.unitPrice, item.qty * item.unitPrice, ""],
      { border: true, numFmt: YEN, align: ["center", undefined, "center", "center"] },
    );
  });

  putRow(sheet, r++, ["", "本体合計", "", "", "", calc.listTotal, ""], {
    border: true,
    bold: true,
    fill: SUM_FILL,
    numFmt: YEN,
  });
  putRow(sheet, r++, ["", "お値引き", "", "", "▲", calc.discount, ""], {
    border: true,
    numFmt: YEN,
    align: [undefined, undefined, undefined, undefined, "center"],
  });
  if (calc.debtSettlement.total > 0) {
    putRow(
      sheet,
      r++,
      [
        "",
        "旧リース残債精算",
        calc.debtSettlement.totalMonths,
        "カ月",
        calc.debtSettlement.monthlyLease,
        calc.debtSettlement.total,
        `残債${calc.debtSettlement.remainingMonths}カ月＋解約事務手数料${calc.debtSettlement.months}カ月`,
      ],
      { border: true, numFmt: YEN },
    );
  }
  putRow(sheet, r++, ["", "販売額計", "", "", "", calc.sellingTotal, ""], {
    border: true,
    bold: true,
    fill: SUM_FILL,
    numFmt: YEN,
  });
  r++;

  // ── カウンター料金
  putRow(sheet, r++, ["【カウンター料金】"], { bold: true });
  putRow(sheet, r++, ["No", "品　　名", "数量", "", "単　価", "備考", ""], {
    bold: true,
    fill: HEADER_FILL,
    border: true,
    align: ["center", "center", "center", "center", "center", "center"],
  });
  const u = calc.units;
  const counterLines: [number, string, number][] = [
    [1, "■白黒モード　　１枚〜", u.mono],
    [2, "■2色カラーコピー　１枚〜", u.twoColor],
    [3, "■フルカラー　　１枚〜", u.color],
  ];
  for (const [no, name, unit] of counterLines) {
    putRow(sheet, r++, [no, name, 1, "枚", unit, "", ""], {
      border: true,
      numFmt: UNIT,
      align: ["center", undefined, "center", "center"],
    });
  }
  putRow(sheet, r++, [4, "■最低基本料金", 1, "ヶ月", u.minCharge, "", ""], {
    border: true,
    numFmt: YEN,
    align: ["center", undefined, "center", "center"],
  });
  r++;

  // ── リースシミュレーション
  putRow(sheet, r++, ["【リースシミュレーション】"], { bold: true });
  putRow(sheet, r++, ["No", "品　　名", "数量", "", "単　価", "金　額", "備考"], {
    bold: true,
    fill: HEADER_FILL,
    border: true,
    align: ["center", "center", "center", "center", "center", "center", "center"],
  });
  Object.entries(settings.leaseRates)
    .map(([term, rate]) => ({ term: Number(term), rate }))
    .sort((a, b) => a.term - b.term)
    .forEach((l, i) => {
      const monthly = calc.leaseByTerm[l.term] ?? 0;
      putRow(
        sheet,
        r++,
        [
          i + 1,
          `リース料金(${Math.round(l.term / 12)}年リース)`,
          l.term,
          "ヶ月",
          monthly,
          monthly * l.term,
          l.term === calc.proposal.leaseTerm ? "本見積の条件" : "",
        ],
        { border: true, numFmt: YEN, align: ["center", undefined, "center", "center"] },
      );
    });
  r++;

  putRow(sheet, r++, ["※　この御見積書の金額は「税抜」となっております。"]);
  putRow(sheet, r++, [
    `※　PC設定台数は${calc.proposal.maker === "KYOCERA" || calc.proposal.maker === "TOSHIBA" ? 5 : 1}台目まで無料となり、以降は5,000円/台の費用が発生いたします。`,
  ]);
  if (calc.proposal.note) putRow(sheet, r++, [`※　${calc.proposal.note}`]);
  r += 2;

  // ── 比較表
  addCompareBlock(sheet, r, quote, current, calc);
  return sheet;
}

/** 比較表ブロック（現状 vs 提案） */
function addCompareBlock(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  quote: Quote,
  current: CurrentCalc,
  calc: ProposalCalc,
): number {
  let r = startRow;
  const cm = quote.current;
  const maker = MAKER_LABELS[calc.proposal.maker];

  const title = putRow(sheet, r, ["比　較　表"]);
  title.getCell(2).font = { size: 14, bold: true };
  sheet.mergeCells(r, 2, r, 8);
  title.getCell(2).alignment = { horizontal: "center" };
  r += 1;
  putRow(sheet, r++, [`（　${cm.makerText || "現行"}　➡　${maker}　）`], {
    align: ["center"],
  });
  r++;

  putRow(sheet, r++, [`　　月間印刷枚数${pagesAverageNote(cm)}`], { bold: true });
  putRow(sheet, r++, ["ブラック", cm.monoPages, "枚"], { numFmt: YEN });
  putRow(sheet, r++, ["フルカラー", cm.colorPages, "枚"], { numFmt: YEN });
  putRow(sheet, r++, ["2色カラー", cm.twoColorPages, "枚"], { numFmt: YEN });
  r++;

  putRow(sheet, r++, ["", "現状利用状況", "導入提案予測", "削減額"], {
    bold: true,
    fill: HEADER_FILL,
    border: true,
    align: ["center", "center", "center", "center"],
  });

  const cd = calc.currentDevice;
  const d = calc.device;
  const specRow = (label: string, left: unknown, right: unknown, unit: string) => {
    putRow(
      sheet,
      r++,
      [
        label,
        left === undefined || left === null ? "－" : `${left}${unit}`,
        right === undefined || right === null ? "－" : `${right}${unit}`,
        "",
      ],
      { border: true, align: [undefined, "center", "center", "right"] },
    );
  };

  putRow(sheet, r++, ["　　メーカー", cm.makerText || "－", maker, ""], { border: true });
  putRow(sheet, r++, ["　　機種", cm.modelText || "－", calc.proposal.modelText, ""], { border: true });
  specRow("　　ウォームタイム", cd?.warmupSec, d?.warmupSec, "秒以下");
  specRow("　　ファーストコピー（モノクロ）", cd?.firstCopyMonoSec, d?.firstCopyMonoSec, "秒");
  specRow("　　ファーストコピー（カラー）", cd?.firstCopyColorSec, d?.firstCopyColorSec, "秒");
  specRow("　　連続コピー速度（モノクロ）", cd?.ppmMono, d?.ppmMono, "枚/分");
  specRow("　　連続コピー速度（カラー）", cd?.ppmColor, d?.ppmColor, "枚/分");

  putRow(sheet, r++, ["　　リース料　①", current.monthlyLease, calc.monthlyLease, calc.monthlyLease - current.monthlyLease], {
    border: true,
    numFmt: YEN,
  });

  const counterRow = (
    label: string,
    leftUnit: number,
    leftAmount: number,
    rightUnit: number,
    rightAmount: number,
  ) => {
    putRow(
      sheet,
      r++,
      [
        label,
        `単価：${leftUnit}円　${leftAmount.toLocaleString("ja-JP")}`,
        `単価：${rightUnit}円　${rightAmount.toLocaleString("ja-JP")}`,
        rightAmount - leftAmount,
      ],
      { border: true, numFmt: YEN, align: [undefined, "right", "right", "right"] },
    );
  };
  if (current.chargeLines?.length) {
    // 逓減単価（段階単価）の明細は、区分ごと・段ごとに行を増やして内訳を見せる
    const shown = new Set<string>();
    for (const line of current.chargeLines) {
      const first = !shown.has(line.kind);
      shown.add(line.kind);
      const rightUnit =
        line.kind === "mono" ? calc.units.mono : line.kind === "twoColor" ? calc.units.twoColor : calc.units.color;
      const rightAmount =
        line.kind === "mono"
          ? calc.counter.monoAmount
          : line.kind === "twoColor"
            ? calc.counter.twoColorAmount
            : calc.counter.colorAmount;
      putRow(
        sheet,
        r++,
        [
          `　　${line.name}（${line.pages.toLocaleString("ja-JP")}枚${
            line.deduction > 0 ? ` 控除${line.deduction.toLocaleString("ja-JP")}枚` : ""
          } 実効${line.effectiveUnit}円）`,
          line.amount,
          first ? `単価：${rightUnit}円　${rightAmount.toLocaleString("ja-JP")}` : "",
          "",
        ],
        { border: true, numFmt: YEN, align: [undefined, "right", "right", "right"] },
      );
      if (line.bands.length > 1) {
        for (const band of line.bands) {
          putRow(
            sheet,
            r++,
            [`　　　${band.label}　${band.unit}円`, `${band.pages.toLocaleString("ja-JP")}枚　${band.amount.toLocaleString("ja-JP")}`, "", ""],
            { border: true, align: [undefined, "right"] },
          );
        }
      }
    }
  } else {
    counterRow("　　ブラック", cm.units.mono, current.counter.monoAmount, calc.units.mono, calc.counter.monoAmount);
    counterRow("　　フルカラー", cm.units.color, current.counter.colorAmount, calc.units.color, calc.counter.colorAmount);
    counterRow("　　2色カラー", cm.units.twoColor, current.counter.twoColorAmount, calc.units.twoColor, calc.counter.twoColorAmount);
  }

  putRow(sheet, r++, ["　　最低基本料金", cm.units.minCharge, calc.units.minCharge, ""], {
    border: true,
    numFmt: YEN,
  });
  putRow(
    sheet,
    r++,
    ["　　カウンター請求合計　②", current.counter.total, calc.counter.total, calc.counter.total - current.counter.total],
    { border: true, numFmt: YEN, bold: true },
  );
  putRow(
    sheet,
    r++,
    [
      "　　ランニングコスト ①+②",
      current.monthlyLease + current.counter.total,
      calc.monthlyLease + calc.counter.total,
      calc.monthlyLease + calc.counter.total - current.monthlyLease - current.counter.total,
    ],
    { border: true, numFmt: YEN },
  );
  putRow(sheet, r++, ["　　保守料金", current.maintenanceMonthly, calc.maintenanceMonthly, ""], {
    border: true,
    numFmt: YEN,
  });
  putRow(sheet, r++, ["　　消費税", current.tax, calc.runningTax, ""], { border: true, numFmt: YEN });
  putRow(sheet, r++, ["　　　月間経費", current.monthlyTotal, calc.monthlyTotal, calc.diffMonthly], {
    border: true,
    numFmt: YEN,
    bold: true,
    fill: SUM_FILL,
  });
  r++;

  putRow(sheet, r++, ["合計合算削減金額　（単月）", "", calc.diffMonthly], { numFmt: YEN, bold: true });
  putRow(sheet, r++, ["合計合算削減金額　（年間）", "", calc.diffYearly], { numFmt: YEN, bold: true });
  putRow(sheet, r++, [`合計合算削減金額　（${calc.leaseYears}年間）`, "", calc.diffLeaseTerm], { numFmt: YEN, bold: true });
  r++;

  const save = Math.max(0, -calc.diffYearly);
  if (save > 0) {
    putRow(sheet, r++, ["年間売上高に換算したコスト削減効果"], { bold: true });
    putRow(sheet, r++, ["利益率", "20%", "10%", "5%"], {
      border: true,
      fill: HEADER_FILL,
      align: [undefined, "center", "center", "center"],
    });
    putRow(sheet, r++, ["年間売上高", save * 5, save * 10, save * 20], { border: true, numFmt: YEN });
    putRow(sheet, r++, ["上記程度の「売上高が増加した」ことと同等の効果が得られます。"]);
  }
  return r;
}

/** 各社を横並びにした比較表シート */
export function addMultiCompareSheet(
  wb: ExcelJS.Workbook,
  quote: Quote,
  current: CurrentCalc,
  calcs: ProposalCalc[],
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet("比較表（各社）");
  sheet.columns = [
    { width: 3 },
    { width: 26 },
    { width: 18 },
    ...calcs.map(() => ({ width: 18 })),
  ];
  let r = 1;
  putRow(sheet, r++, ["複合機 比較表（各社同時比較）"], { bold: true });
  putRow(sheet, r++, [`${quote.customerName}　${quote.customerHonorific}`]);
  putRow(sheet, r++, [
    `月間印刷枚数${pagesAverageNote(quote.current)}：ブラック ${quote.current.monoPages.toLocaleString()}枚 / フルカラー ${quote.current.colorPages.toLocaleString()}枚 / 2色カラー ${quote.current.twoColorPages.toLocaleString()}枚`,
  ]);
  r++;

  const header = ["", "現状利用状況", ...calcs.map((c) => MAKER_LABELS[c.proposal.maker])];
  putRow(sheet, r++, header, { bold: true, fill: HEADER_FILL, border: true, align: header.map(() => "center" as const) });

  const row = (label: string, left: string | number, values: (string | number)[], numFmt?: string) =>
    putRow(sheet, r++, [label, left, ...values], { border: true, numFmt });

  row("機種", quote.current.modelText || "－", calcs.map((c) => c.proposal.modelText));
  row("連続コピー速度（カラー）", val(calcs[0]?.currentDevice?.ppmColor, "枚/分"), calcs.map((c) => val(c.device?.ppmColor, "枚/分")));
  row("ファーストコピー（カラー）", val(calcs[0]?.currentDevice?.firstCopyColorSec, "秒"), calcs.map((c) => val(c.device?.firstCopyColorSec, "秒")));
  row("販売額計（税抜）", "－", calcs.map((c) => c.sellingTotal), YEN);
  row("リース回数", quote.current.leaseTerm ? `${quote.current.leaseTerm}回` : "－", calcs.map((c) => `${c.proposal.leaseTerm}回`));
  row("月額リース料", current.monthlyLease, calcs.map((c) => c.monthlyLease), YEN);
  // 現状が段階単価の明細の場合は実効単価（金額÷枚数）を並べる
  const tiered = Boolean(current.chargeLines?.length);
  const currentUnit = (kind: "mono" | "color"): number => {
    const lines = current.chargeLines?.filter((l) => (kind === "mono" ? l.kind === "mono" : l.kind !== "mono")) ?? [];
    if (!lines.length) return kind === "mono" ? quote.current.units.mono : quote.current.units.color;
    const pages = lines.reduce((sum, l) => sum + l.pages, 0);
    const amount = lines.reduce((sum, l) => sum + l.amount, 0);
    return pages > 0 ? Math.round((amount / pages) * 100) / 100 : 0;
  };
  row(tiered ? "モノクロ単価（現状は実効）" : "モノクロ単価", currentUnit("mono"), calcs.map((c) => c.units.mono), UNIT);
  row(tiered ? "フルカラー単価（現状は実効）" : "フルカラー単価", currentUnit("color"), calcs.map((c) => c.units.color), UNIT);
  row("カウンター請求合計", current.counter.total, calcs.map((c) => c.counter.total), YEN);
  row("月間経費（税込）", current.monthlyTotal, calcs.map((c) => c.monthlyTotal), YEN);
  row("削減額（単月）", "－", calcs.map((c) => c.diffMonthly), YEN);
  row("削減額（年間）", "－", calcs.map((c) => c.diffYearly), YEN);
  const years = [...new Set(calcs.map((c) => c.leaseYears))].join("・");
  row(`削減額（${years}年間＝リース期間）`, "－", calcs.map((c) => c.diffLeaseTerm), YEN);

  return sheet;
}

const val = (v: number | undefined, unit: string): string => (v === undefined ? "－" : `${v}${unit}`);

/** 収益管理（仕切・GP・PTF・NP）シート — 社内確認用 */
export function addProfitSheet(wb: ExcelJS.Workbook, calcs: ProposalCalc[]): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet("収益（社内用）");
  sheet.columns = [
    { width: 3 },
    { width: 16 },
    { width: 26 },
    { width: 14 },
    { width: 14 },
    { width: 18 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 14 },
    { width: 10 },
  ];
  let r = 1;
  putRow(sheet, r++, ["収益シミュレーション（社外提出不可）"], { bold: true });
  r++;
  putRow(
    sheet,
    r++,
    [
      "メーカー",
      "機種",
      "仕切価格",
      "本体価格",
      "上乗せ(PTF対象外)",
      "販売額計",
      "GP",
      "PTF",
      "PTF(1社目)",
      "PTF(2社目)",
      "NP",
      "粗利率",
    ],
    { bold: true, fill: HEADER_FILL, border: true, align: Array(12).fill("center") },
  );
  for (const c of calcs) {
    putRow(
      sheet,
      r++,
      [
        MAKER_LABELS[c.proposal.maker],
        c.proposal.modelText,
        c.cost,
        c.sellingBase,
        c.addOnTotal,
        c.sellingTotal,
        c.grossProfit,
        c.ptf,
        c.ptfBreakdown.primary,
        c.ptfBreakdown.second,
        c.netProfit,
        c.sellingTotal > 0 ? c.grossProfit / c.sellingTotal : 0,
      ],
      { border: true, numFmt: YEN },
    );
    sheet.getRow(r - 1).getCell(13).numFmt = "0.0%";
  }
  r++;
  putRow(sheet, r++, ["※PTFは本体価格に料率を適用します。オプション・追加PC設定の上乗せ分は対象外です。"]);
  putRow(sheet, r++, ["※代理店が2社の案件は、1社目・2社目それぞれの払い出し額を内訳に記載しています。"]);
  return sheet;
}

/** ワークブックをバッファに書き出す */
export async function workbookToBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  const data = await wb.xlsx.writeBuffer();
  return Buffer.from(data);
}

export function newWorkbook(creator: string): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = creator;
  wb.created = new Date();
  return wb;
}

/* ---------------- A3ヨコ 複数台比較表 ---------------- */

/** A3の用紙コード。ExcelJSの PaperSize 列挙にA3が無いので数値で持つ */
const A3_PAPER_SIZE = 8 as unknown as ExcelJS.PaperSize;

const FLEET_HEAD_CURRENT: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF46586B" },
};
const FLEET_HEAD_PROPOSAL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FF1F4E79" },
};
const FLEET_UNIT_FILL: ExcelJS.Fill = {
  type: "pattern",
  pattern: "solid",
  fgColor: { argb: "FFF2F6FA" },
};

/** A列から順に値を並べる（複数台比較表は横に広いのでA列から使う） */
function putFleetRow(
  sheet: ExcelJS.Worksheet,
  rowNo: number,
  values: (string | number | null)[],
  opts: RowOptions & { skipBorder?: number[] } = {},
): ExcelJS.Row {
  const row = sheet.getRow(rowNo);
  values.forEach((v, i) => {
    const cell = row.getCell(i + 1);
    if (v !== null) cell.value = v;
    if (opts.bold) cell.font = { bold: true };
    if (opts.fill) cell.fill = opts.fill;
    if (opts.border && !opts.skipBorder?.includes(i)) cell.border = THIN;
    if (typeof v === "number" && opts.numFmt) cell.numFmt = opts.numFmt;
    const align = opts.align?.[i];
    if (align) cell.alignment = { horizontal: align, vertical: "middle" };
  });
  return row;
}

/** 見出し帯（- リ ー ス 料 金 詳 細 内 訳 - など） */
function fleetBand(sheet: ExcelJS.Worksheet, rowNo: number, title: string): void {
  const cell = sheet.getRow(rowNo).getCell(1);
  cell.value = title;
  cell.font = { bold: true, size: 11, color: { argb: "FF1F4E79" } };
  sheet.mergeCells(rowNo, 1, rowNo, 8);
}

/**
 * 複数台比較表（A3ヨコ）のシート。
 * HTML版（renderFleetCompareHtml）と同じ並びにして、
 * PDFで出してもExcelで直しても同じ資料になるようにしている。
 */
export function addFleetSheet(
  wb: ExcelJS.Workbook,
  quote: Quote,
  fleet: Fleet,
  calc: FleetCalc,
  settings: Settings,
): ExcelJS.Worksheet {
  const sheet = wb.addWorksheet("複数台比較表");
  sheet.columns = [
    { width: 4 }, // A No
    { width: 26 }, // B 設置場所
    { width: 12 }, // C メーカー / 項目
    { width: 20 }, // D 物件名 / チャージ枚数
    { width: 9 }, // E 印刷速度 / 単価
    { width: 18 }, // F 備考 / 印刷枚数
    { width: 13 }, // G リース料金 / 金額
    { width: 13 }, // H 請求金額
    { width: 2 }, // I 仕切り
    { width: 12 }, // J メーカー / 機種
    { width: 20 }, // K 提案機種 / 項目
    { width: 9 }, // L 印刷速度 / チャージ枚数
    { width: 13 }, // M リース料金 / 単価
    { width: 13 }, // N 印刷枚数
    { width: 13 }, // O 金額
    { width: 13 }, // P 請求金額
  ];
  sheet.pageSetup = {
    // A3（用紙コード8）。ExcelJSの型定義にA3が無いため数値で指定する
    paperSize: A3_PAPER_SIZE,
    orientation: "landscape",
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 1,
    margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 },
  };

  const uniq = (v: string[]) => [...new Set(v.filter(Boolean))];
  const from = uniq(calc.units.map((u) => u.unit.current.makerText)).join("・") || "現行";
  const to = uniq(calc.units.map((u) => u.unit.proposal.makerText)).join("・") || "提案";

  let r = 1;
  putFleetRow(sheet, r++, [`複合機比較表　${from} 複合機　⇒　${to} 複合機（全${calc.units.length}台）`], {
    bold: true,
  });
  putFleetRow(sheet, r, [`${quote.customerName}　${quote.customerHonorific}`], { bold: true });
  sheet.getRow(r).getCell(10).value = settings.company.name;
  r++;
  sheet.getRow(r).getCell(10).value = `TEL ${settings.company.tel ?? ""}　FAX ${settings.company.fax ?? ""}`;
  r++;
  if (quote.staffName) {
    sheet.getRow(r).getCell(10).value = `担当：${quote.staffName}`;
  }
  r += 2;

  // ── リース料金 詳細内訳
  fleetBand(sheet, r++, "- リ ー ス 料 金 詳 細 内 訳 -");
  putFleetRow(sheet, r, ["現状利用状況"], { bold: true, fill: FLEET_HEAD_CURRENT });
  sheet.getRow(r).getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.mergeCells(r, 1, r, 7);
  sheet.getRow(r).getCell(10).value = "導入提案予測";
  sheet.getRow(r).getCell(10).fill = FLEET_HEAD_PROPOSAL;
  sheet.getRow(r).getCell(10).font = { bold: true, color: { argb: "FFFFFFFF" } };
  sheet.mergeCells(r, 10, r, 13);
  r++;

  const leaseHead = [
    "No", "設置場所", "メーカー", "物件名", "印刷速度", "備考", "リース料金",
    null, "メーカー", "提案機種", "印刷速度", "リース料金",
  ];
  putFleetRow(sheet, r++, leaseHead, {
    bold: true,
    fill: HEADER_FILL,
    border: true,
    skipBorder: [7],
    align: leaseHead.map(() => "center" as const),
  });

  for (const u of calc.units) {
    putFleetRow(
      sheet,
      r++,
      [
        u.no,
        u.unit.location,
        u.unit.current.makerText,
        u.unit.current.modelText,
        u.unit.current.ppm ?? "",
        u.unit.current.note ?? "",
        u.current.monthlyLease,
        null,
        u.unit.proposal.makerText,
        u.unit.proposal.modelText,
        u.unit.proposal.ppm ?? "",
        u.proposal.monthlyLease,
      ],
      { border: true, skipBorder: [7], numFmt: YEN },
    );
  }
  putFleetRow(
    sheet,
    r++,
    ["", "", "", "", "", "消費税（10％）", calc.current.leaseTax, null, "", "", "消費税（10％）", calc.proposal.leaseTax],
    { border: true, skipBorder: [7], numFmt: YEN, fill: SUM_FILL },
  );
  putFleetRow(
    sheet,
    r++,
    ["", "", "", "", "", "リース料金 合計", calc.current.leaseTotal, null, "", "", "リース料金 合計", calc.proposal.leaseTotal],
    { border: true, skipBorder: [7], numFmt: YEN, bold: true, fill: SUM_FILL },
  );
  r++;

  // ── カウンター料金 詳細内訳比較
  fleetBand(
    sheet,
    r++,
    `- カ ウ ン タ ー 料 金 詳 細 内 訳 比 較 -${fleet.pagesNote ? `　（${fleet.pagesNote}）` : ""}`,
  );
  const counterHead = [
    "No", "設置場所・機種", "項目", "チャージ枚数", "単価", "印刷枚数", "金額", "請求金額",
    null, "機種", "項目", "チャージ枚数", "単価", "印刷枚数", "金額", "請求金額",
  ];
  putFleetRow(sheet, r++, counterHead, {
    bold: true,
    fill: HEADER_FILL,
    border: true,
    skipBorder: [8],
    align: counterHead.map(() => "center" as const),
  });

  for (const u of calc.units) {
    const left = fleetSideCells(u.current);
    const right = fleetSideCells(u.proposal);
    const height = Math.max(left.length, right.length, 1);
    const top = r;

    for (let i = 0; i < height; i++) {
      const l = left[i] ?? ["", "", "", "", ""];
      const rt = right[i] ?? ["", "", "", "", ""];
      putFleetRow(
        sheet,
        r++,
        [
          i === 0 ? u.no : "",
          i === 0 ? `${u.unit.location}／${u.unit.current.modelText}` : "",
          ...l,
          i === 0 ? u.current.counterTotal : "",
          null,
          i === 0 ? `${u.unit.proposal.makerText} ${u.unit.proposal.modelText}` : "",
          ...rt,
          i === 0 ? u.proposal.counterTotal : "",
        ],
        { border: true, skipBorder: [8], numFmt: YEN },
      );
    }
    if (height > 1) {
      // 設置場所・機種・請求金額は台ごとに縦結合する
      for (const col of [1, 2, 8, 10, 16]) sheet.mergeCells(top, col, top + height - 1, col);
    }
    for (const col of [1, 2, 8, 10, 16]) {
      const cell = sheet.getRow(top).getCell(col);
      cell.alignment = { vertical: "middle", wrapText: col === 2 || col === 10 };
      if (col !== 8 && col !== 16) cell.fill = FLEET_UNIT_FILL;
    }
  }

  putFleetRow(
    sheet,
    r++,
    ["カウンター料金 小計", "", "", "", "", "", "", calc.current.counterSubtotal,
     null, "カウンター料金 小計", "", "", "", "", "", calc.proposal.counterSubtotal],
    { border: true, skipBorder: [8], numFmt: YEN, bold: true, fill: SUM_FILL },
  );
  r += 2;

  // ── 合計
  fleetBand(sheet, r++, "- 合 計 -");
  putFleetRow(sheet, r++, ["", "現状利用状況", "導入提案予測", "削減額"], {
    bold: true,
    fill: HEADER_FILL,
    border: true,
    align: ["left", "center", "center", "center"],
  });
  const totalRow = (label: string, a: number, b: number) =>
    putFleetRow(sheet, r++, [label, a, b, b - a], { border: true, numFmt: YEN });
  totalRow("合計金額 （単月）", calc.current.monthly, calc.proposal.monthly);
  totalRow("合計金額 （年間）", calc.current.yearly, calc.proposal.yearly);
  totalRow(`合計金額 （${calc.leaseYears}年間）`, calc.current.longTerm, calc.proposal.longTerm);
  r++;

  // ── トータル削減料金
  fleetBand(sheet, r++, "- ト ー タ ル 削 減 料 金 -");
  putFleetRow(sheet, r++, ["合計合算削減金額 （単月）", calc.diffMonthly], { border: true, numFmt: YEN });
  putFleetRow(sheet, r++, ["合計合算削減金額 （年間）", calc.diffYearly], { border: true, numFmt: YEN });
  putFleetRow(sheet, r++, [`合計合算削減金額 （${calc.leaseYears}年間）`, calc.diffLeaseTerm], {
    border: true,
    numFmt: YEN,
  });
  putFleetRow(sheet, r, ["削減率", calc.reductionRate], { border: true, bold: true });
  sheet.getRow(r).getCell(2).numFmt = "0.0%";
  r += 2;

  // ── 年間売上高に換算したコスト削減効果
  const save = Math.max(0, -calc.diffYearly);
  if (save > 0) {
    fleetBand(sheet, r++, "- 年間売上高に換算したコスト削減効果 -");
    putFleetRow(sheet, r++, ["利益率", "20%", "10%", "5%"], {
      bold: true,
      fill: HEADER_FILL,
      border: true,
      align: ["left", "center", "center", "center"],
    });
    putFleetRow(sheet, r++, ["年間売上高", save * 5, save * 10, save * 20], { border: true, numFmt: YEN });
    putFleetRow(sheet, r++, ["上記程度の「売上高が増加した」ことと同等の効果が得られます。"]);
  }

  // ── 控除の注意書き
  const deducted = calc.units.filter((u) => u.current.deductedPages > 0 && u.proposal.deductedPages === 0);
  if (deducted.length) {
    r++;
    putFleetRow(sheet, r++, [
      `※ 現行のカウンター明細には控除があり、現行側は控除後の枚数（合計 ▲${deducted
        .reduce((s, u) => s + u.current.deductedPages, 0)
        .toLocaleString()}枚）で計算しています。ご提案する複合機には控除がないため、提案側は実際の印刷枚数そのままで計算しております。`,
    ]);
  }

  return sheet;
}

/** 1台の片側を [項目, チャージ枚数, 単価, 印刷枚数, 金額] の行に展開する */
function fleetSideCells(side: FleetSideCalc): (string | number)[][] {
  const rows: (string | number)[][] = [];
  for (const line of side.lines) {
    if (line.bands.length <= 1) {
      const band = line.bands[0];
      rows.push([
        line.name,
        band ? band.label.replace("枚", "") : "1〜",
        band ? band.unit : 0,
        line.deduction > 0 ? `${line.billablePages.toLocaleString()}（控除▲${line.deduction}）` : line.pages,
        line.amount,
      ]);
      continue;
    }
    line.bands.forEach((band, i) => {
      rows.push([
        i === 0 ? line.name : "　〃",
        band.label.replace("枚", ""),
        band.unit,
        i === 0 && line.deduction > 0
          ? `${line.billablePages.toLocaleString()}（控除▲${line.deduction}）`
          : band.pages,
        band.amount,
      ]);
    });
  }
  if (side.minCharge > 0) {
    rows.push(["最低基本料金", "", side.minCharge, "", side.minChargeApplied ? side.minCharge : "－"]);
  }
  if (side.maintenanceMonthly > 0) {
    rows.push(["月額保守料金", "", side.maintenanceMonthly, "", side.maintenanceMonthly]);
  }
  rows.push(["消費税 （10％）", "", "", "", side.counterTax]);
  return rows;
}
