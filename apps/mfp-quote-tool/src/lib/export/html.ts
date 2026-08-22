import type { CurrentCalc, ProposalCalc, Quote, Settings } from "../types";
import { yen } from "../pricing";
import { pagesAverageNote } from "../labels";

/**
 * 既存の御見積書・比較表（Excel）の体裁に合わせたHTML。
 * PDF出力と画面プレビューで共用する。
 */

const FONT_STACK =
  '"Yu Gothic", "YuGothic", "Meiryo", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "IPAGothic", sans-serif';

const CSS = `
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  /* 背景色は印刷時にも残す（帳票の見出し帯が消えないように） */
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  :root {
    --ink: #16212e;
    --accent: #1f4e79;
    --accent-soft: #eaf0f7;
    --line: #b9c6d4;
    --line-soft: #dbe3ec;
  }

  body {
    font-family: ${FONT_STACK};
    color: var(--ink);
    font-size: 10pt;
    margin: 0;
    line-height: 1.45;
  }

  h1 {
    font-size: 21pt;
    letter-spacing: 0.45em;
    text-align: center;
    color: var(--accent);
    margin: 10px 0 4px;
    text-indent: 0.45em;
  }
  h1 + .small { text-align: center; color: #4a5a6b; }
  h1::after {
    content: "";
    display: block;
    width: 132px;
    height: 3px;
    margin: 8px auto 0;
    background: linear-gradient(90deg, var(--accent), #6f9bc4);
    border-radius: 2px;
  }
  h2 {
    font-size: 15pt;
    letter-spacing: 0.35em;
    text-align: center;
    color: var(--accent);
    margin: 16px 0 10px;
    padding-bottom: 6px;
    border-bottom: 2px solid var(--accent);
    text-indent: 0.35em;
  }

  table { border-collapse: collapse; width: 100%; }
  .grid { border: 1px solid var(--line); }
  .grid th, .grid td { border: 1px solid var(--line-soft); padding: 4px 7px; }
  .grid thead th {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    letter-spacing: 0.04em;
    border-color: var(--accent);
  }
  .grid tbody th { background: var(--accent-soft); font-weight: 600; }
  .grid tbody tr:nth-child(even) td { background: #f7fafc; }
  .plain td { padding: 2px 2px; vertical-align: top; }

  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  .small { font-size: 8.5pt; }
  .muted { color: #5b6b7c; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  .customer {
    font-size: 13.5pt;
    font-weight: 600;
    border-bottom: 2px solid var(--accent);
    min-width: 260px;
    padding-bottom: 3px;
  }

  /* 自社情報 */
  .company {
    text-align: left;
    max-width: 58%;
    font-size: 9pt;
    line-height: 1.55;
    border-left: 3px solid var(--accent);
    padding: 2px 0 2px 10px;
  }
  .company .name { font-size: 12.5pt; font-weight: 700; color: var(--accent); letter-spacing: 0.02em; }
  .company .logo { display: block; width: 230px; max-height: 52px; object-fit: contain; object-position: left center; margin-bottom: 5px; }
  .company .offices { margin-top: 4px; font-size: 8.3pt; }
  .company .offices div { display: flex; gap: 6px; }
  .company .offices .office-name { font-weight: 600; white-space: nowrap; color: var(--accent); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { height: 44px; max-width: 260px; object-fit: contain; object-position: left center; }

  /* 月額リース料の強調枠 */
  .lease-box {
    display: flex;
    align-items: baseline;
    gap: 12px;
    margin: 12px 0 8px;
    padding: 8px 14px;
    background: linear-gradient(90deg, var(--accent-soft), #f7fafc);
    border: 1px solid var(--line);
    border-left: 5px solid var(--accent);
    border-radius: 3px;
  }
  .lease-box .label { font-weight: 700; font-size: 11pt; color: var(--accent); letter-spacing: 0.08em; }
  .lease-box .value { font-size: 19pt; font-weight: 700; color: var(--ink); letter-spacing: 0.02em; }
  .lease-box .value::before { content: "¥"; font-size: 13pt; margin-right: 2px; color: var(--accent); }

  .section {
    margin-top: 14px;
    font-weight: 700;
    color: var(--accent);
    border-left: 4px solid var(--accent);
    padding-left: 8px;
  }
  .notes {
    margin-top: 12px;
    font-size: 8.5pt;
    white-space: pre-wrap;
    background: #f7fafc;
    border: 1px solid var(--line-soft);
    border-radius: 3px;
    padding: 8px 10px;
  }

  .grid tbody tr.sum-row td { background: var(--accent-soft); font-weight: 700; }
  .grid tbody tr.group-row td {
    background: #eef3f8;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.04em;
  }
  /* 濃い帯の行では、削減額の色を明るくして読めるようにする */
  .grid tbody tr.total-row .save { color: #8ce8ad; }
  .grid tbody tr.total-row .cut { color: #ffb3ac; }
  .grid tbody tr.total-row td, .grid tbody tr.total-row th { background: var(--accent); color: #fff; font-weight: 700; border-color: var(--accent); }

  .cut { color: #b3261e; font-weight: 700; }
  .save { color: #0a7d32; font-weight: 700; }
  .page-break { page-break-before: always; }

  /* 比較表の削減効果 */
  .effect { margin-top: 12px; }
  .effect thead th { background: #14395c; color: #fff; }
  .effect tbody tr td:last-child { font-weight: 700; }
`;

const esc = (s: unknown): string =>
  String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

const n = (v: number): string => Math.round(v).toLocaleString("ja-JP");
const unitYen = (v: number): string => `${Number(v.toFixed(2))}円`;

function jpDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CSS}</style></head><body>${body}</body></html>`;
}

/** 自社情報（ロゴ・社名・連絡先・拠点） */
function companyBlock(settings: Settings, logo?: string): string {
  const c = settings.company;
  const offices = c.offices?.length
    ? `<div class="offices">${c.offices
        .map(
          (o) =>
            `<div><span class="office-name">${esc(o.name)}</span><span>${esc(o.address)}</span></div>`,
        )
        .join("")}</div>`
    : `<div style="margin-top:4px">${esc(c.branchNote ?? "")}</div><div>${esc(c.address ?? "")}</div>`;

  return `
    <div class="company">
      ${logo ? `<img class="logo" src="${logo}" alt="${esc(c.name)}">` : ""}
      <div class="name"${logo ? ' style="font-size:11pt"' : ""}>${esc(c.name)}</div>
      <div>${esc(c.representative ?? "")}</div>
      <div>${c.tel ? `TEL ${esc(c.tel)}` : ""}${c.fax ? `　FAX ${esc(c.fax)}` : ""}</div>
      ${offices}
      <div>${esc(c.areaNote ?? "")}</div>
    </div>`;
}

/** 比較表の上部に置く社名・ロゴの帯 */
function brandBar(settings: Settings, logo: string | undefined, quote: Quote): string {
  const c = settings.company;
  return `
  <div class="head" style="align-items:center">
    <div class="brand">
      ${logo ? `<img src="${logo}" alt="${esc(c.name)}">` : `<span class="name">${esc(c.name)}</span>`}
    </div>
    <div class="small muted" style="text-align:right">
      <div>${esc(c.name)}</div>
      <div>${c.tel ? `TEL ${esc(c.tel)}` : ""}${c.fax ? `　FAX ${esc(c.fax)}` : ""}</div>
      <div>見積番号 ${esc(quote.quoteNo)}${quote.staffName ? `　担当 ${esc(quote.staffName)}` : ""}</div>
    </div>
  </div>`;
}

/** 見積書のヘッダー（宛名・自社情報） */
function quoteHeader(quote: Quote, settings: Settings, subject: string, logo?: string): string {
  const c = settings.company;
  return `
  <div class="head">
    <div>
      <span class="customer">${esc(quote.customerName)}</span>
      <span style="font-size:12pt"> ${esc(quote.customerHonorific)}</span>
    </div>
    <div class="small">
      <div>${esc(jpDate(quote.quoteDate))}</div>
      <div>見積書番号：${esc(quote.quoteNo)}</div>
    </div>
  </div>
  <h1>御 見 積 書</h1>
  <div class="small">下記の通り御見積申し上げます。何卒よろしくお願い致します。</div>
  <div class="head" style="margin-top:8px">
    <table class="plain" style="width:52%">
      <tr><td style="width:6.5em">物件名</td><td>：${esc(subject)}</td></tr>
      <tr><td>納入場所</td><td>：別途お打ち合わせ</td></tr>
      <tr><td>御受渡期日</td><td>：別途お打ち合わせ</td></tr>
      <tr><td>御支払条件</td><td>：別途お打ち合わせ</td></tr>
      <tr><td>有効期限</td><td>：${esc(c.validityText)}</td></tr>
      ${quote.staffName ? `<tr><td>担当者</td><td>：${esc(quote.staffName)}</td></tr>` : ""}
    </table>
    ${companyBlock(settings, logo)}
  </div>`;
}

/** 御見積書1枚 */
export function renderQuoteHtml(
  quote: Quote,
  calc: ProposalCalc,
  settings: Settings,
  logo?: string,
): string {
  const p = calc.proposal;
  const subject = `${p.modelText}${calc.priceBook ? `　（${calc.priceBook.gradePpm}枚機）` : ""}`;
  const groupLabel = calc.priceBook
    ? `【${makerJp(p.maker)}　${calc.priceBook.category}複合機】`
    : `【${makerJp(p.maker)}複合機】`;

  const itemRows = p.items
    .map(
      (item, i) => `<tr>
        <td class="center">${i + 1}</td>
        <td>${esc(item.name)}</td>
        <td class="center">${item.qty}</td>
        <td class="center">${esc(item.unit)}</td>
        <td class="num">${n(item.unitPrice)}</td>
        <td class="num">${n(item.qty * item.unitPrice)}</td>
        <td></td>
      </tr>`,
    )
    .join("");

  const leaseRows = Object.entries(settings.leaseRates)
    .map(([term, rate]) => ({ term: Number(term), rate }))
    .sort((a, b) => a.term - b.term)
    .map(
      (l, i) => `<tr>
        <td class="center">${i + 1}</td>
        <td>リース料金(${Math.round(l.term / 12)}年リース)</td>
        <td class="center">${l.term}</td>
        <td class="center">ヶ月</td>
        <td class="num">${n(calc.leaseByTerm[l.term] ?? 0)}</td>
        <td class="num">${n((calc.leaseByTerm[l.term] ?? 0) * l.term)}</td>
        <td>${l.term === p.leaseTerm ? "本見積の条件" : ""}</td>
      </tr>`,
    )
    .join("");

  const u = calc.units;
  const counterRows = [
    { no: 1, name: "■白黒モード", unit: u.mono, qtyUnit: "枚" },
    { no: 2, name: "■2色カラーコピー", unit: u.twoColor, qtyUnit: "枚" },
    { no: 3, name: "■フルカラー", unit: u.color, qtyUnit: "枚" },
  ]
    .map(
      (r) => `<tr>
        <td class="center">${r.no}</td>
        <td>${esc(r.name)}<br><span class="small">１枚〜</span></td>
        <td class="center">1</td>
        <td class="center">${r.qtyUnit}</td>
        <td class="num">${Number(r.unit.toFixed(2))}</td>
        <td></td>
      </tr>`,
    )
    .join("");

  const body = `
  ${quoteHeader(quote, settings, subject, logo)}

  <div class="lease-box">
    <span class="label">月額リース料金</span>
    <span class="value">${n(calc.monthlyLease)}</span>
    <span>（税別・${p.leaseTerm}回払い）</span>
  </div>

  <table class="grid">
    <thead><tr>
      <th style="width:5%">No</th><th>メーカー　品　名　型　番</th>
      <th style="width:7%">数量</th><th style="width:7%"></th>
      <th style="width:14%">単　価</th><th style="width:14%">金　額</th><th style="width:14%">備考</th>
    </tr></thead>
    <tbody>
      <tr class="group-row"><td></td><td colspan="6">${esc(groupLabel)}</td></tr>
      ${itemRows}
      <tr class="sum-row"><td></td><td>本体合計</td><td colspan="3"></td><td class="num">${n(calc.listTotal)}</td><td></td></tr>
      <tr><td></td><td>お値引き</td><td colspan="2"></td><td class="center">▲</td><td class="num">${n(calc.discount)}</td><td></td></tr>
      ${
        calc.debtSettlement.total > 0
          ? `<tr>
        <td></td><td>旧リース残債精算</td><td colspan="3"></td>
        <td class="num">${n(calc.debtSettlement.total)}</td>
        <td class="muted">残債 ${n(calc.debtSettlement.remainingDebt)}＋解約事務手数料（リース料${calc.debtSettlement.months}ヶ月分）${n(calc.debtSettlement.cancellationFee)}</td>
      </tr>`
          : ""
      }
      <tr class="total-row"><td></td><td>販売額計</td><td colspan="3"></td><td class="num">${n(calc.sellingTotal)}</td><td></td></tr>
    </tbody>
  </table>

  <div class="section">【カウンター料金】</div>
  <table class="grid">
    <thead><tr>
      <th style="width:5%">No</th><th>品　　名</th><th style="width:7%">数量</th><th style="width:7%"></th>
      <th style="width:14%">単　価</th><th style="width:28%">備考</th>
    </tr></thead>
    <tbody>
      ${counterRows}
      <tr>
        <td class="center">4</td><td>■最低基本料金</td><td class="center">1</td><td class="center">ヶ月</td>
        <td class="num">${n(u.minCharge)}</td><td></td>
      </tr>
    </tbody>
  </table>

  <div class="section">【リースシミュレーション】</div>
  <table class="grid">
    <thead><tr>
      <th style="width:5%">No</th><th>品　　名</th><th style="width:7%">数量</th><th style="width:7%"></th>
      <th style="width:14%">単　価</th><th style="width:14%">金　額</th><th style="width:14%">備考</th>
    </tr></thead>
    <tbody>${leaseRows}</tbody>
  </table>

  <div class="notes">${
    calc.debtSettlement.total > 0
      ? `※　現在ご利用中のリースの残債（${n(calc.debtSettlement.remainingDebt)}円）と解約事務手数料（リース料${calc.debtSettlement.months}ヶ月分 ${n(calc.debtSettlement.cancellationFee)}円）を本見積に含めております。\n`
      : ""
  }※　この御見積書の金額は「税抜」となっております。
※　PC設定台数は${pcSetupNote(calc)}
${p.note ? `※　${esc(p.note)}` : ""}</div>
  `;
  return page(`見積書_${quote.customerName}_${makerJp(p.maker)}`, body);
}

function pcSetupNote(calc: ProposalCalc): string {
  const maker = calc.proposal.maker;
  const free = maker === "KYOCERA" || maker === "TOSHIBA" ? 5 : 1;
  return `${free}台目まで無料となり、${free + 1}台目以降は5,000円/台の費用が発生いたします。`;
}

function makerJp(maker: string): string {
  const map: Record<string, string> = {
    KYOCERA: "京セラ",
    TOSHIBA: "東芝",
    FUJIFILM: "富士フイルム",
    SHARP: "シャープ",
    RICOH: "リコー",
    CANON: "キヤノン",
    KONICA_MINOLTA: "コニカミノルタ",
    OTHER: "その他",
  };
  return map[maker] ?? maker;
}

/** 比較表（現状 vs 1提案）— 既存Excelの比較表と同じ並び */
export function renderCompareHtml(
  quote: Quote,
  current: CurrentCalc,
  calc: ProposalCalc,
  settings: Settings,
  logo?: string,
): string {
  const c = quote.current;
  const d = calc.device;
  const cd = calc.currentDevice;

  const specRow = (
    label: string,
    left: string | number | undefined,
    leftUnit: string,
    right: string | number | undefined,
    rightUnit: string,
  ) => `<tr>
      <th style="text-align:left">${esc(label)}</th>
      <td class="num">${left === undefined ? "－" : `${left}${leftUnit}`}</td>
      <td class="num">${right === undefined ? "－" : `${right}${rightUnit}`}</td>
      <td></td>
    </tr>`;

  const counterRow = (
    label: string,
    leftUnit: number,
    leftAmount: number,
    rightUnit: number,
    rightAmount: number,
  ) => `<tr>
      <th style="text-align:left">${esc(label)}</th>
      <td class="num">単価：${unitYen(leftUnit)}　${n(leftAmount)}</td>
      <td class="num">単価：${unitYen(rightUnit)}　${n(rightAmount)}</td>
      <td></td>
    </tr>`;

  const diff = (v: number) =>
    v === 0 ? "±0" : v < 0 ? `<span class="save">▲${n(Math.abs(v))}</span>` : `<span class="cut">+${n(v)}</span>`;

  const body = `
  ${brandBar(settings, logo, quote)}
  <h2>比 較 表</h2>
  <div class="center" style="margin-bottom:8px">
    （ ${esc(c.makerText || "現行")} ➡ ${esc(makerJp(calc.proposal.maker))} ）
  </div>

  <table class="grid" style="width:60%;margin-bottom:10px">
    <thead><tr><th colspan="2">月間印刷枚数${esc(pagesAverageNote(c))}</th></tr></thead>
    <tbody>
      <tr><td>ブラック</td><td class="num">${n(c.monoPages)} 枚</td></tr>
      <tr><td>フルカラー</td><td class="num">${n(c.colorPages)} 枚</td></tr>
      <tr><td>2色カラー</td><td class="num">${n(c.twoColorPages)} 枚</td></tr>
    </tbody>
  </table>

  <table class="grid">
    <thead><tr>
      <th style="width:26%"></th>
      <th style="width:27%">現状利用状況</th>
      <th style="width:27%">導入提案予測</th>
      <th>削減額</th>
    </tr></thead>
    <tbody>
      <tr><th style="text-align:left">メーカー</th><td>${esc(c.makerText || "－")}</td><td>${esc(makerJp(calc.proposal.maker))}</td><td></td></tr>
      <tr><th style="text-align:left">機種</th><td>${esc(c.modelText || "－")}</td><td>${esc(calc.proposal.modelText)}</td><td></td></tr>
      ${specRow("ウォームタイム", cd?.warmupSec, "秒以下", d?.warmupSec, "秒以下")}
      ${specRow("ファーストコピー（モノクロ）", cd?.firstCopyMonoSec, "秒", d?.firstCopyMonoSec, "秒")}
      ${specRow("ファーストコピー（カラー）", cd?.firstCopyColorSec, "秒", d?.firstCopyColorSec, "秒")}
      ${specRow("連続コピー速度（モノクロ）", cd?.ppmMono, "枚/分", d?.ppmMono, "枚/分")}
      ${specRow("連続コピー速度（カラー）", cd?.ppmColor, "枚/分", d?.ppmColor, "枚/分")}
      <tr>
        <th style="text-align:left">リース料　①</th>
        <td class="num">${n(current.monthlyLease)}</td>
        <td class="num">${n(calc.monthlyLease)}</td>
        <td class="num">${diff(calc.monthlyLease - current.monthlyLease)}</td>
      </tr>
      ${counterRow("ブラック", c.units.mono, current.counter.monoAmount, calc.units.mono, calc.counter.monoAmount)}
      ${counterRow("フルカラー", c.units.color, current.counter.colorAmount, calc.units.color, calc.counter.colorAmount)}
      ${counterRow("2色カラー", c.units.twoColor, current.counter.twoColorAmount, calc.units.twoColor, calc.counter.twoColorAmount)}
      <tr>
        <th style="text-align:left">最低基本料金</th>
        <td class="num">${n(c.units.minCharge)}</td>
        <td class="num">${n(calc.units.minCharge)}</td>
        <td></td>
      </tr>
      <tr>
        <th style="text-align:left">カウンター請求合計　②</th>
        <td class="num">${n(current.counter.total)}</td>
        <td class="num">${n(calc.counter.total)}</td>
        <td class="num">${diff(calc.counter.total - current.counter.total)}</td>
      </tr>
      <tr class="sum-row">
        <th style="text-align:left">ランニングコスト ①+②</th>
        <td class="num">${n(current.monthlyLease + current.counter.total)}</td>
        <td class="num">${n(calc.monthlyLease + calc.counter.total)}</td>
        <td class="num">${diff(calc.monthlyLease + calc.counter.total - current.monthlyLease - current.counter.total)}</td>
      </tr>
      <tr>
        <th style="text-align:left">保守料金</th>
        <td class="num">${n(current.maintenanceMonthly)}</td>
        <td class="num">${n(calc.maintenanceMonthly)}</td>
        <td></td>
      </tr>
      <tr>
        <th style="text-align:left">消費税</th>
        <td class="num">${n(current.tax)}</td>
        <td class="num">${n(calc.runningTax)}</td>
        <td></td>
      </tr>
      <tr class="total-row">
        <th style="text-align:left">　月間経費</th>
        <td class="num">${n(current.monthlyTotal)}</td>
        <td class="num">${n(calc.monthlyTotal)}</td>
        <td class="num">${diff(calc.diffMonthly)}</td>
      </tr>
    </tbody>
  </table>

  <table class="grid" style="width:62%;margin-top:14px">
    <tbody>
      <tr><th style="text-align:left">合計合算削減金額　（単月）</th><td class="num">${diff(calc.diffMonthly)}</td></tr>
      <tr><th style="text-align:left">合計合算削減金額　（年間）</th><td class="num">${diff(calc.diffYearly)}</td></tr>
      <tr><th style="text-align:left">合計合算削減金額　（6年間）</th><td class="num">${diff(calc.diffSixYears)}</td></tr>
    </tbody>
  </table>

  ${salesEffectTable(calc.diffYearly)}
  `;
  return page(`比較表_${quote.customerName}_${makerJp(calc.proposal.maker)}`, body);
}

/** 削減額を「年間売上高に換算した効果」（利益率20%/10%/5% → 5倍/10倍/20倍） */
function salesEffectTable(diffYearly: number): string {
  const save = Math.max(0, -diffYearly);
  if (save <= 0) return "";
  return `
  <table class="grid effect" style="width:70%">
    <thead><tr><th colspan="4">年間売上高に換算したコスト削減効果</th></tr></thead>
    <tbody>
      <tr><th>利益率</th><th class="center">20%</th><th class="center">10%</th><th class="center">5%</th></tr>
      <tr>
        <th>年間売上高</th>
        <td class="num">${n(save * 5)}</td>
        <td class="num">${n(save * 10)}</td>
        <td class="num">${n(save * 20)}</td>
      </tr>
    </tbody>
  </table>
  <div class="small" style="margin-top:4px">上記程度の「売上高が増加した」ことと同等の効果が得られます。</div>`;
}

/** 複数メーカーを横並びにした比較表（同時提案用） */
export function renderMultiCompareHtml(
  quote: Quote,
  current: CurrentCalc,
  calcs: ProposalCalc[],
  settings: Settings,
  logo?: string,
): string {
  const c = quote.current;
  const best = calcs.reduce((b, x, i) => (x.monthlyTotal < calcs[b].monthlyTotal ? i : b), 0);
  const head = `<tr>
      <th style="width:20%"></th>
      <th>現状利用状況</th>
      ${calcs
        .map(
          (x, i) =>
            `<th${i === best ? ' style="background:#f6d97a;color:#16212e"' : ""}>${esc(makerJp(x.proposal.maker))}</th>`,
        )
        .join("")}
    </tr>`;

  const row = (label: string, left: string, values: string[]) =>
    `<tr><th style="text-align:left">${esc(label)}</th><td class="num">${left}</td>${values
      .map((v, i) => `<td class="num"${i === best ? ' style="background:#fff6d8"' : ""}>${v}</td>`)
      .join("")}</tr>`;

  const diff = (v: number) =>
    v === 0 ? "±0" : v < 0 ? `<span class="save">▲${n(Math.abs(v))}</span>` : `<span class="cut">+${n(v)}</span>`;

  const body = `
  ${brandBar(settings, logo, quote)}
  <h2>複合機 比較表（各社同時比較）</h2>
  <div class="head">
    <div><span class="customer">${esc(quote.customerName)}</span> ${esc(quote.customerHonorific)}</div>
    <div class="small">${esc(jpDate(quote.quoteDate))}</div>
  </div>
  <div class="small" style="margin:6px 0">
    月間印刷枚数${esc(pagesAverageNote(c))}：ブラック ${n(c.monoPages)}枚 ／ フルカラー ${n(c.colorPages)}枚 ／ 2色カラー ${n(c.twoColorPages)}枚
  </div>
  <table class="grid">
    <thead>${head}</thead>
    <tbody>
      ${row("機種", esc(c.modelText || "－"), calcs.map((x) => esc(x.proposal.modelText)))}
      ${row("連続コピー速度（カラー）", x2(currentSpec(calcs)?.ppmColor, "枚/分"), calcs.map((x) => x2(x.device?.ppmColor, "枚/分")))}
      ${row("ファーストコピー（カラー）", x2(currentSpec(calcs)?.firstCopyColorSec, "秒"), calcs.map((x) => x2(x.device?.firstCopyColorSec, "秒")))}
      ${row("販売額計（税抜）", "－", calcs.map((x) => n(x.sellingTotal)))}
      ${row("リース回数", c.leaseTerm ? `${c.leaseTerm}回` : "－", calcs.map((x) => `${x.proposal.leaseTerm}回`))}
      ${row("月額リース料", n(current.monthlyLease), calcs.map((x) => n(x.monthlyLease)))}
      ${row("モノクロ単価", unitYen(c.units.mono), calcs.map((x) => unitYen(x.units.mono)))}
      ${row("フルカラー単価", unitYen(c.units.color), calcs.map((x) => unitYen(x.units.color)))}
      ${row("カウンター請求合計", n(current.counter.total), calcs.map((x) => n(x.counter.total)))}
      ${row("月間経費（税込）", n(current.monthlyTotal), calcs.map((x) => n(x.monthlyTotal)))}
      ${row("削減額（単月）", "－", calcs.map((x) => diff(x.diffMonthly)))}
      ${row("削減額（年間）", "－", calcs.map((x) => diff(x.diffYearly)))}
      ${row("削減額（6年間）", "－", calcs.map((x) => diff(x.diffSixYears)))}
    </tbody>
  </table>
  <div class="small" style="margin-top:6px">※黄色の列が月間経費の最も安い提案です。</div>
  `;
  return page(`比較表_${quote.customerName}_各社`, body);
}

const x2 = (v: number | undefined, unit: string): string => (v === undefined ? "－" : `${v}${unit}`);
const currentSpec = (calcs: ProposalCalc[]) => calcs[0]?.currentDevice;
