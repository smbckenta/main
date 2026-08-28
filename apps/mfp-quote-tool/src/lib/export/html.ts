import type {
  ChargeLineCalc,
  CurrentCalc,
  Fleet,
  FleetCalc,
  FleetSideCalc,
  ProposalCalc,
  Quote,
  Settings,
} from "../types";
import { yen } from "../pricing";
import { pagesAverageNote } from "../labels";
import { groupOptions } from "../proposal-doc";

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
    font-size: 9.5pt;
    margin: 0;
    line-height: 1.35;
  }

  h1 {
    font-size: 19pt;
    letter-spacing: 0.4em;
    text-align: center;
    color: var(--accent);
    margin: 4px 0 3px;
    text-indent: 0.4em;
  }
  h1 + .small { text-align: center; color: #4a5a6b; }
  h1::after {
    content: "";
    display: block;
    width: 120px;
    height: 2px;
    margin: 5px auto 0;
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
  .grid th, .grid td { border: 1px solid var(--line-soft); padding: 2.5px 6px; }
  .grid thead th {
    background: var(--accent);
    color: #fff;
    font-weight: 600;
    letter-spacing: 0.04em;
    border-color: var(--accent);
  }
  .grid tbody th { background: var(--accent-soft); font-weight: 600; }
  .grid tbody tr:nth-child(even) td { background: #f7fafc; }
  .plain td { padding: 0 2px; vertical-align: top; line-height: 1.5; }

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
    max-width: 56%;
    font-size: 8.5pt;
    line-height: 1.4;
    border-left: 3px solid var(--accent);
    padding: 0 0 0 9px;
  }
  .company .name { font-size: 11.5pt; font-weight: 700; color: var(--accent); letter-spacing: 0.02em; }
  .company .logo { display: block; width: 215px; max-height: 42px; object-fit: contain; object-position: left center; margin-bottom: 2px; }
  .company .offices { margin-top: 2px; font-size: 7.8pt; }
  .company .offices div { display: flex; gap: 6px; }
  .company .offices .office-name { font-weight: 600; white-space: nowrap; color: var(--accent); }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { height: 44px; max-width: 260px; object-fit: contain; object-position: left center; }

  /* 月額リース料の強調枠 */
  .lease-box {
    display: flex;
    align-items: baseline;
    gap: 10px;
    margin: 8px 0 6px;
    padding: 5px 12px;
    background: linear-gradient(90deg, var(--accent-soft), #f7fafc);
    border: 1px solid var(--line);
    border-left: 5px solid var(--accent);
    border-radius: 3px;
  }
  .lease-box .label { font-weight: 700; font-size: 11pt; color: var(--accent); letter-spacing: 0.08em; }
  .lease-box .value { font-size: 17pt; font-weight: 700; color: var(--ink); letter-spacing: 0.02em; }
  .lease-box .value::before { content: "¥"; font-size: 13pt; margin-right: 2px; color: var(--accent); }

  .section {
    margin-top: 8px;
    font-weight: 700;
    color: var(--accent);
    border-left: 4px solid var(--accent);
    padding-left: 8px;
  }
  .notes {
    margin-top: 8px;
    font-size: 8pt;
    line-height: 1.4;
    white-space: pre-wrap;
    background: #f7fafc;
    border: 1px solid var(--line-soft);
    border-radius: 3px;
    padding: 5px 8px;
  }

  .grid tbody tr.sum-row td { background: var(--accent-soft); font-weight: 700; }
  .grid tbody tr.group-row td {
    background: #eef3f8;
    font-weight: 700;
    color: var(--accent);
    letter-spacing: 0.04em;
  }
  /* 濃い帯の行では、削減額の色を明るくして読めるようにする */
  .grid tbody tr.total-row .save { color: #ffc9c2; }
  .grid tbody tr.total-row .cut { color: #d6e2ef; }
  .grid tbody tr.total-row td, .grid tbody tr.total-row th { background: var(--accent); color: #fff; font-weight: 700; border-color: var(--accent); }

  /* 削減額は赤で強調する（お客様がいちばん見る数字）。
     増額のほうは控えめな色にして、赤が「削減」だけを指すようにする。 */
  .save { color: #d0021b; font-weight: 700; }
  .cut { color: #40556b; font-weight: 700; }
  /* 合計の削減額（単月・年間・リース年数）はひときわ大きく出す */
  .save-total .save { font-size: 1.25em; }
  .page-break { page-break-before: always; }

  /* 比較表の削減効果。商談でいちばん見る表なので、他より一段大きく出す */
  .effect { margin-top: 14px; border: 2px solid #b3001b; }
  .effect thead th {
    background: #b3001b;
    color: #fff;
    font-size: 1.28em;
    letter-spacing: 0.1em;
    padding: 0.45em 0.6em;
    border-color: #b3001b;
  }
  .effect .effect-rate th { background: #fdeaec; color: #7a0013; font-size: 1.05em; padding: 0.3em 0.6em; }
  .effect .effect-value th { background: #fdeaec; color: #7a0013; font-weight: 700; }
  .effect .effect-value td {
    background: #fff !important;
    color: #d0021b;
    font-weight: 700;
    font-size: 1.72em;
    letter-spacing: 0.01em;
    padding: 0.18em 0.5em;
  }
  .effect .effect-value td::before { content: "¥"; font-size: 0.62em; margin-right: 0.15em; }
  .effect-note { margin-top: 5px; font-size: 0.98em; color: #7a0013; }
  /* 合計合算削減金額の表。下の削減効果と幅を揃えて、目線が縦に流れるようにする */
  .save-summary th { font-size: 1.05em; }
  .effect-note b { color: #b3001b; }
`;

/**
 * 比較表を1枚に収めるための縮小。
 *
 * 明細の区分や段が増えると行が伸びて2枚目にこぼれる。表を切って
 * 2枚にすると、お客様は「現状」と「提案」を並べて見られなくなるので、
 * Excelの「1ページに収める」と同じように、字と余白を一緒に縮めて1枚に収める。
 *
 * 大きさに関わる指定はすべて em か var(--fit) 経由にしてある。
 * ここを pt や px で書くと、その部分だけ縮まずに行だけが潰れてしまう。
 */
const COMPARE_CSS = `
  body.compare { font-size: calc(9.5pt * var(--fit, 1)); }
  body.compare h2 {
    font-size: calc(15pt * var(--fit, 1));
    margin: calc(16px * var(--fit, 1)) 0 calc(10px * var(--fit, 1));
    padding-bottom: calc(6px * var(--fit, 1));
  }
  body.compare .grid th, body.compare .grid td { padding: 0.26em 0.63em; }
  body.compare .small { font-size: 0.9em; }
  body.compare .notes { font-size: 0.86em; margin-top: 0.8em; padding: 0.5em 0.85em; }
  body.compare .customer { font-size: calc(13.5pt * var(--fit, 1)); min-width: 0; }
  body.compare .company { font-size: calc(8.5pt * var(--fit, 1)); }
  body.compare .company .name { font-size: calc(11.5pt * var(--fit, 1)); }
  body.compare .company .offices { font-size: calc(7.8pt * var(--fit, 1)); }
  body.compare .company .logo { width: calc(215px * var(--fit, 1)); max-height: calc(42px * var(--fit, 1)); }
  body.compare .brand img { height: calc(44px * var(--fit, 1)); }
  body.compare .effect { margin-top: 0.9em; }
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

function page(title: string, body: string, opts: { css?: string; bodyClass?: string } = {}): string {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>${CSS}${opts.css ?? ""}</style></head><body${opts.bodyClass ? ` class="${opts.bodyClass}"` : ""}>${body}</body></html>`;
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
      ${logo ? `<img class="logo" src="${logo}" alt="${esc(c.name)}">` : `<div class="name">${esc(c.name)}</div>`}
      <div>${esc(c.representative ?? "")}</div>
      <div>${c.tel ? `TEL ${esc(c.tel)}` : ""}${c.fax ? `　FAX ${esc(c.fax)}` : ""}</div>
      ${offices}
      <div>${esc(c.areaNote ?? "")}</div>
    </div>`;
}

/** 比較表の上部に置く社名・ロゴの帯 */
function brandBar(settings: Settings, logo: string | undefined, quote: Quote, quoteNo?: string): string {
  const c = settings.company;
  return `
  <div class="head" style="align-items:center">
    <div class="brand">
      ${logo ? `<img src="${logo}" alt="${esc(c.name)}">` : `<span class="name">${esc(c.name)}</span>`}
    </div>
    <div class="small muted" style="text-align:right">
      <div>${esc(c.name)}</div>
      <div>${c.tel ? `TEL ${esc(c.tel)}` : ""}${c.fax ? `　FAX ${esc(c.fax)}` : ""}</div>
      <div>見積番号 ${esc(quoteNo ?? quote.quoteNo)}${quote.staffName ? `　担当 ${esc(quote.staffName)}` : ""}</div>
    </div>
  </div>`;
}

/** 見積書のヘッダー（宛名・自社情報） */
function quoteHeader(
  quote: Quote,
  settings: Settings,
  subject: string,
  logo?: string,
  quoteNo?: string,
): string {
  const c = settings.company;
  return `
  <div class="head">
    <div>
      <span class="customer">${esc(quote.customerName)}</span>
      <span style="font-size:12pt"> ${esc(quote.customerHonorific)}</span>
    </div>
    <div class="small">
      <div>${esc(jpDate(quote.quoteDate))}</div>
      <div>見積書番号：${esc(quoteNo ?? quote.quoteNo)}</div>
    </div>
  </div>
  <h1>御 見 積 書</h1>
  <div class="small">下記の通り御見積申し上げます。何卒よろしくお願い致します。</div>
  <div class="head" style="margin-top:5px">
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
  ${quoteHeader(quote, settings, subject, logo, p.quoteNo)}

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
        <td></td><td>旧リース残債精算</td>
        <td class="center">${calc.debtSettlement.totalMonths}</td>
        <td class="center">カ月</td>
        <td class="num">${n(calc.debtSettlement.monthlyLease)}</td>
        <td class="num">${n(calc.debtSettlement.total)}</td>
        <td class="muted">残債${calc.debtSettlement.remainingMonths}カ月＋解約事務手数料${calc.debtSettlement.months}カ月</td>
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

/**
 * 逓減単価の明細を、比較表の行に展開する。
 *
 * 現状側は「区分 → 段」の順に行を立て、提案側は一律単価なので
 * その区分の先頭行にだけ金額を出す。左右で行数が揃わなくてよい。
 */
function tieredCounterRows(lines: ChargeLineCalc[], calc: ProposalCalc): string {
  const unitOf = (kind: ChargeLineCalc["kind"]): number =>
    kind === "mono" ? calc.units.mono : kind === "twoColor" ? calc.units.twoColor : calc.units.color;
  const amountOf = (kind: ChargeLineCalc["kind"]): number =>
    kind === "mono"
      ? calc.counter.monoAmount
      : kind === "twoColor"
        ? calc.counter.twoColorAmount
        : calc.counter.colorAmount;

  // 提案側の金額は区分ごとに1回だけ出す（フルカラーが2区分に分かれていても二重に出さない）
  const shown = new Set<string>();

  return lines
    .map((line) => {
      const first = !shown.has(line.kind);
      shown.add(line.kind);
      const right = first
        ? `<td class="num">単価：${unitYen(unitOf(line.kind))}　${n(amountOf(line.kind))}</td>`
        : `<td></td>`;

      const head = `<tr>
        <th style="text-align:left">${esc(line.name)}<br><span class="small muted">${n(line.pages)}枚${
          line.deduction > 0 ? `（控除 ${n(line.deduction)}枚）` : ""
        }　実効 ${unitYen(line.effectiveUnit)}</span></th>
        <td class="num">${n(line.amount)}</td>
        ${right}
        <td></td>
      </tr>`;

      // 段が2つ以上ある区分だけ、内訳の行を足す
      const bands =
        line.bands.length > 1
          ? line.bands
              .map(
                (b) => `<tr>
        <th style="text-align:left;font-weight:400">　${esc(b.label)}　${unitYen(b.unit)}</th>
        <td class="num muted">${n(b.pages)}枚　${n(b.amount)}</td>
        <td></td><td></td>
      </tr>`,
              )
              .join("")
          : "";

      return head + bands;
    })
    .join("");
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

  /**
   * カウンターの行。
   * 逓減単価（段階単価）の明細を読み取っている場合は、
   * 区分ごと・段ごとに行を増やして内訳をそのまま見せる。
   * 一律単価に均してしまうと「なぜこの金額か」を説明できなくなるため。
   */
  const counterRows = current.chargeLines?.length
    ? tieredCounterRows(current.chargeLines, calc)
    : `${counterRow("ブラック", c.units.mono, current.counter.monoAmount, calc.units.mono, calc.counter.monoAmount)}
      ${counterRow("フルカラー", c.units.color, current.counter.colorAmount, calc.units.color, calc.counter.colorAmount)}
      ${counterRow("2色カラー", c.units.twoColor, current.counter.twoColorAmount, calc.units.twoColor, calc.counter.twoColorAmount)}`;

  const ded = current.counter.deduction;

  const body = `
  ${brandBar(settings, logo, quote, calc.proposal.quoteNo)}
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
  ${
    ded
      ? `<div class="notes">※　現行のカウンター明細には控除（${
          Math.round(ded.rate * 1000) / 10
        }%）があり、現行側は控除後の枚数 ブラック ${n(ded.billable.mono)}枚 ／ フルカラー ${n(
          ded.billable.color,
        )}枚${ded.twoColor ? ` ／ 2色カラー ${n(ded.billable.twoColor)}枚` : ""} で計算しています（合計 ▲${n(
          ded.total,
        )}枚）。
　　ご提案する複合機には控除がございませんので、提案側は上記の印刷枚数そのままで計算しております。</div>`
      : ""
  }

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
        <td class="num">${current.leaseUnknown ? "－（不明）" : n(current.monthlyLease)}</td>
        <td class="num">${n(calc.monthlyLease)}${calc.counterOnly ? '<span class="small muted">（参考）</span>' : ""}</td>
        <td class="num">${calc.counterOnly ? "－" : diff(calc.monthlyLease - current.monthlyLease)}</td>
      </tr>
      ${counterRows}
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
      ${
        calc.counterOnly
          ? ""
          : `<tr class="sum-row">
        <th style="text-align:left">ランニングコスト ①+②</th>
        <td class="num">${n(current.monthlyLease + current.counter.total)}</td>
        <td class="num">${n(calc.monthlyLease + calc.counter.total)}</td>
        <td class="num">${diff(calc.monthlyLease + calc.counter.total - current.monthlyLease - current.counter.total)}</td>
      </tr>`
      }
      <tr>
        <th style="text-align:left">保守料金</th>
        <td class="num">${n(current.maintenanceMonthly)}</td>
        <td class="num">${n(calc.maintenanceMonthly)}</td>
        <td></td>
      </tr>
      <tr>
        <th style="text-align:left">消費税</th>
        <td class="num">${n(current.tax)}</td>
        <td class="num">${n(calc.counterOnly ? Math.round(calc.comparable - calc.counter.total - calc.maintenanceMonthly) : calc.runningTax)}</td>
        <td></td>
      </tr>
      <tr class="total-row">
        <th style="text-align:left">　${calc.counterOnly ? "カウンター月間経費" : "月間経費"}</th>
        <td class="num">${n(current.comparable)}</td>
        <td class="num">${n(calc.comparable)}</td>
        <td class="num">${diff(calc.diffMonthly)}</td>
      </tr>
    </tbody>
  </table>

  <table class="grid save-summary" style="width:78%;margin-top:14px">
    <tbody>
      <tr class="save-total"><th style="text-align:left">合計合算削減金額　（単月）</th><td class="num">${diff(calc.diffMonthly)}</td></tr>
      <tr class="save-total"><th style="text-align:left">合計合算削減金額　（年間）</th><td class="num">${diff(calc.diffYearly)}</td></tr>
      <tr class="save-total"><th style="text-align:left">合計合算削減金額　（${calc.leaseYears}年間）</th><td class="num">${diff(calc.diffLeaseTerm)}</td></tr>
    </tbody>
  </table>

  ${counterOnlyNote(calc)}
  ${salesEffectTable(calc.diffYearly)}
  `;
  return page(`比較表_${quote.customerName}_${makerJp(calc.proposal.maker)}`, body, {
    css: `${COMPARE_CSS}\n  body.compare { --fit: ${fitCompare(compareRowCount(current))}; }`,
    bodyClass: "compare",
  });
}

/**
 * リース料金が分からない案件に付ける注記。
 * リース料を含めずに比べていることを、必ず帳票にも残す。
 */
function counterOnlyNote(calc?: ProposalCalc): string {
  if (!calc?.counterOnly) return "";
  return `<div class="notes">※　現在ご利用中の複合機のリース料金をお伺いできていないため、
　　この比較表は<b>カウンター料金のみ</b>で比較しております（リース料金は現状・提案とも含んでおりません）。
　　リース料金をお知らせいただければ、リース料を含めた比較表をあらためてご用意いたします。</div>`;
}

/**
 * 削減額を「年間売上高に換算した効果」（利益率20%/10%/5% → 5倍/10倍/20倍）。
 *
 * 商談でいちばん効くのがこの表なので、他の表より大きく、赤で出す。
 * 「月々いくら安くなるか」より「売上に直すといくらぶんか」のほうが、
 * 経営者の方には金額の大きさが伝わる。
 */
function salesEffectTable(diffYearly: number, width = "78%"): string {
  const save = Math.max(0, -diffYearly);
  if (save <= 0) return "";
  return `
  <table class="grid effect" style="width:${width}">
    <thead><tr><th colspan="4">年間売上高に換算したコスト削減効果</th></tr></thead>
    <tbody>
      <tr class="effect-rate"><th>利益率</th><th class="center">20%</th><th class="center">10%</th><th class="center">5%</th></tr>
      <tr class="effect-value">
        <th>年間売上高</th>
        <td class="num">${n(save * 5)}</td>
        <td class="num">${n(save * 10)}</td>
        <td class="num">${n(save * 20)}</td>
      </tr>
    </tbody>
  </table>
  <div class="effect-note">上記程度の<b>「売上高が増加した」ことと同等の効果</b>が得られます。</div>`;
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
  const best = calcs.reduce((b, x, i) => (x.comparable < calcs[b].comparable ? i : b), 0);
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

  // 現状が段階単価の明細の場合、単価欄は実効単価（金額÷枚数）で並べる。
  // 名目単価を並べると、控除のぶん現状が実際より高く見えてしまう。
  const tiered = Boolean(current.chargeLines?.length);
  const currentUnit = (kind: "mono" | "color"): number => {
    const lines = current.chargeLines?.filter((l) => (kind === "mono" ? l.kind === "mono" : l.kind !== "mono")) ?? [];
    if (!lines.length) return kind === "mono" ? c.units.mono : c.units.color;
    const pages = lines.reduce((sum, l) => sum + l.pages, 0);
    const amount = lines.reduce((sum, l) => sum + l.amount, 0);
    return pages > 0 ? Math.round((amount / pages) * 100) / 100 : 0;
  };

  const body = `
  ${brandBar(settings, logo, quote)}
  <h2>複合機 比較表（各社同時比較）</h2>
  <div class="head">
    <div><span class="customer">${esc(quote.customerName)}</span> ${esc(quote.customerHonorific)}</div>
    <div class="small">${esc(jpDate(quote.quoteDate))}</div>
  </div>
  <div class="small" style="margin:6px 0">
    月間印刷枚数${esc(pagesAverageNote(c))}：ブラック ${n(c.monoPages)}枚 ／ フルカラー ${n(c.colorPages)}枚 ／ 2色カラー ${n(c.twoColorPages)}枚
    ${
      current.counter.deduction
        ? `<br>※現行は控除（${
            Math.round(current.counter.deduction.rate * 1000) / 10
          }%・▲${n(current.counter.deduction.total)}枚）後の枚数で計算しています。各社の提案には控除がないため、提案側は上記の枚数そのままです。`
        : ""
    }
  </div>
  <table class="grid">
    <thead>${head}</thead>
    <tbody>
      ${row("機種", esc(c.modelText || "－"), calcs.map((x) => esc(x.proposal.modelText)))}
      ${row("連続コピー速度（カラー）", x2(currentSpec(calcs)?.ppmColor, "枚/分"), calcs.map((x) => x2(x.device?.ppmColor, "枚/分")))}
      ${row("ファーストコピー（カラー）", x2(currentSpec(calcs)?.firstCopyColorSec, "秒"), calcs.map((x) => x2(x.device?.firstCopyColorSec, "秒")))}
      ${row("販売額計（税抜）", "－", calcs.map((x) => n(x.sellingTotal)))}
      ${row("リース回数", c.leaseTerm ? `${c.leaseTerm}回` : "－", calcs.map((x) => `${x.proposal.leaseTerm}回`))}
      ${row(
        current.leaseUnknown ? "月額リース料（参考）" : "月額リース料",
        current.leaseUnknown ? "－（不明）" : n(current.monthlyLease),
        calcs.map((x) => n(x.monthlyLease)),
      )}
      ${row(
        tiered ? "モノクロ単価（現状は実効）" : "モノクロ単価",
        unitYen(currentUnit("mono")),
        calcs.map((x) => unitYen(x.units.mono)),
      )}
      ${row(
        tiered ? "フルカラー単価（現状は実効）" : "フルカラー単価",
        unitYen(currentUnit("color")),
        calcs.map((x) => unitYen(x.units.color)),
      )}
      ${row("カウンター請求合計", n(current.counter.total), calcs.map((x) => n(x.counter.total)))}
      ${row(
        current.leaseUnknown ? "カウンター月間経費（税込）" : "月間経費（税込）",
        n(current.comparable),
        calcs.map((x) => n(x.comparable)),
      )}
      ${row("削減額（単月）", "－", calcs.map((x) => diff(x.diffMonthly)))}
      ${row("削減額（年間）", "－", calcs.map((x) => diff(x.diffYearly)))}
      ${row(leaseYearsLabel(calcs), "－", calcs.map((x) => diff(x.diffLeaseTerm)))}
    </tbody>
  </table>
  <div class="small" style="margin-top:6px">※黄色の列が月間経費の最も安い提案です。</div>
  ${counterOnlyNote(calcs[0])}
  `;
  return page(`比較表_${quote.customerName}_各社`, body, {
    // 各社を横並びにした比較表は、明細の区分が増えても行は増えない
    // （区分ごとの内訳は出さず、カウンター合計だけを並べる）。
    // 背が高くなるのはメーカーの数が増えたときだけ。
    css: `${COMPARE_CSS}\n  body.compare { --fit: ${fitCompare(0, calcs.length)}; }`,
    bodyClass: "compare",
  });
}

/**
 * 各社同時比較の「削減額（◯年間）」の見出し。
 * 各社のリース年数はふつう揃えるが、揃っていない場合は年数を並べて誤解を防ぐ。
 */
function leaseYearsLabel(calcs: ProposalCalc[]): string {
  const years = [...new Set(calcs.map((c) => c.leaseYears))];
  return `削減額（${years.join("・")}年間＝リース期間）`;
}

const x2 = (v: number | undefined, unit: string): string => (v === undefined ? "－" : `${v}${unit}`);
const currentSpec = (calcs: ProposalCalc[]) => calcs[0]?.currentDevice;

/* ---------------- A3ヨコ 複数台比較表 ---------------- */

/**
 * 複合機が複数台ある案件で使う、A3ヨコ1枚の比較表。
 *
 * 左が現行、右が提案。上から
 *   リース料金 詳細内訳 → カウンター料金 詳細内訳比較 → 合計 → 削減効果
 * の順に、台数ぶんを1枚に収める（実際に運用している比較表と同じ並び）。
 */
const FLEET_CSS = `
  @page { size: A3 landscape; margin: 8mm; }
  /* 台数が多いときは字を小さくして高さだけ詰める（横幅はA3いっぱいのまま使う） */
  body.fleet { font-size: calc(7.4pt * var(--fit)); line-height: 1.2; }
  body.fleet .small { font-size: 0.86em; }
  body.fleet h1 { font-size: 14pt; letter-spacing: 0.18em; margin: 0 0 2px; }
  body.fleet h1::after { width: 200px; margin-top: 3px; }
  /* 余白も字の大きさに合わせて詰める（そうしないと行が縮まない） */
  body.fleet .grid th, body.fleet .grid td { padding: 0.14em 0.4em; }
  body.fleet .company { max-width: 42%; font-size: 7pt; }
  body.fleet .company .logo { width: 170px; max-height: 32px; }

  .fleet-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
  .fleet-head .customer { font-size: 12pt; min-width: 220px; }

  .band {
    margin: 0.7em 0 0.3em;
    font-weight: 700;
    font-size: 1.16em;
    letter-spacing: 0.28em;
    color: var(--accent);
    border-bottom: 2px solid var(--accent);
    padding-bottom: 2px;
  }
  .band .band-note { float: right; font-size: 0.82em; letter-spacing: 0; font-weight: 400; color: #5b6b7c; }

  /* 左（現状）と右（提案）を隔てる帯 */
  .grid th.gap, .grid td.gap { border: 0; background: #fff !important; width: 1%; min-width: 6px; padding: 0; }
  .grid thead th.side-current { background: #46586b; border-color: #46586b; }
  .grid thead th.side-proposal { background: var(--accent); border-color: var(--accent); }
  .grid tbody td.unit-head { background: #f2f6fa; font-weight: 600; }
  .grid tbody tr.unit-first td { border-top: 1.4px solid var(--line); }
  .grid tbody td.bill { background: #eef3f8; font-weight: 700; font-size: 1.05em; }

  .fleet-bottom { display: flex; gap: 14px; align-items: flex-start; margin-top: 0.8em; }
  .fleet-bottom > * { flex: 1; min-width: 0; }
  .fleet-note { margin-top: 0.5em; font-size: 0.95em; color: #5b6b7c; line-height: 1.35; }
  .fleet-note strong { color: #b3261e; }
`;

/** 台ごとのカウンター明細を、表の行に展開したもの */
interface FleetRow {
  item: string;
  charge: string;
  unit: string;
  pages: string;
  amount: string;
  /** 消費税・小計など、区分ではない行 */
  sub?: boolean;
}

const pagesCell = (line: ChargeLineCalc): string =>
  line.deduction > 0
    ? `${n(line.billablePages)}枚<br><span class="small muted">${n(line.pages)}枚−控除${n(line.deduction)}枚</span>`
    : `${n(line.pages)}枚`;

/** 片側（現行 or 提案）1台ぶんの明細行 */
function fleetSideRows(side: FleetSideCalc): FleetRow[] {
  const rows: FleetRow[] = [];

  for (const line of side.lines) {
    if (line.bands.length <= 1) {
      const band = line.bands[0];
      rows.push({
        item: line.name,
        charge: band ? band.label.replace("枚", "") : "1〜",
        unit: band ? unitYen(band.unit) : "－",
        pages: pagesCell(line),
        amount: n(line.amount),
      });
      continue;
    }
    // 段が分かれている区分は、段ごとに行を立てる（チャージ枚数の帯がそのまま行になる）
    line.bands.forEach((band, i) => {
      rows.push({
        item: i === 0 ? line.name : "　〃",
        charge: band.label.replace("枚", ""),
        unit: unitYen(band.unit),
        pages: i === 0 ? pagesCell(line) : `${n(band.pages)}枚`,
        amount: n(band.amount),
      });
    });
  }

  if (side.minCharge > 0) {
    rows.push({
      item: "最低基本料金",
      charge: "",
      unit: n(side.minCharge),
      pages: "",
      amount: side.minChargeApplied ? n(side.minCharge) : "－",
      sub: true,
    });
  }
  if (side.maintenanceMonthly > 0) {
    rows.push({
      item: "月額保守料金",
      charge: "",
      unit: n(side.maintenanceMonthly),
      pages: "",
      amount: n(side.maintenanceMonthly),
      sub: true,
    });
  }
  return rows;
}

/**
 * 請求金額の欄。
 * 台数が多いと消費税だけで行数が膨らむため、消費税は請求金額の欄に併記して
 * 1台あたりの行数を減らす（A3ヨコ1枚に収めるため）。
 */
const billCell = (side: FleetSideCalc): string =>
  `${n(side.counterTotal)}<br><span class="small muted">税抜 ${n(side.counterBeforeTax)}＋税 ${n(
    side.counterTax,
  )}</span>`;

/** 機種名の欄（設置場所・メーカー・型番をまとめて出す） */
const sideTitle = (maker: string, model: string): string =>
  `${esc(maker || "－")}<br><span class="small">${esc(model || "－")}</span>`;

export function renderFleetCompareHtml(
  quote: Quote,
  fleet: Fleet,
  calc: FleetCalc,
  settings: Settings,
  logo?: string,
): string {
  const diff = (v: number) =>
    v === 0 ? "±0" : v < 0 ? `<span class="save">▲${n(Math.abs(v))}</span>` : `<span class="cut">+${n(v)}</span>`;

  const uniq = (values: string[]) => [...new Set(values.filter(Boolean))];
  const fromMakers = uniq(calc.units.map((u) => u.unit.current.makerText));
  const toMakers = uniq(calc.units.map((u) => u.unit.proposal.makerText));

  // ── リース料金 詳細内訳
  const leaseRows = calc.units
    .map(
      (u) => `<tr>
      <td class="center">${u.no}</td>
      <td>${esc(u.unit.location || "－")}</td>
      <td>${esc(u.unit.current.makerText || "－")}</td>
      <td>${esc(u.unit.current.modelText || "－")}</td>
      <td class="center">${u.unit.current.ppm ?? "－"}</td>
      <td class="small">${esc(u.unit.current.note ?? "")}</td>
      <td class="num">${u.current.monthlyLease ? n(u.current.monthlyLease) : "－"}</td>
      <td class="gap"></td>
      <td>${esc(u.unit.proposal.makerText || "－")}</td>
      <td>${esc(u.unit.proposal.modelText || "－")}</td>
      <td class="center">${u.unit.proposal.ppm ?? "－"}</td>
      <td class="num">${u.proposal.monthlyLease ? n(u.proposal.monthlyLease) : "－"}</td>
    </tr>`,
    )
    .join("");

  // ── カウンター料金 詳細内訳比較（左右で行数が違うので、多いほうに合わせて空欄で埋める）
  const counterRows = calc.units
    .map((u) => {
      const left = fleetSideRows(u.current);
      const right = fleetSideRows(u.proposal);
      const height = Math.max(left.length, right.length, 1);

      return Array.from({ length: height }, (_, i) => {
        const l = left[i];
        const r = right[i];
        const cells = (row: FleetRow | undefined) =>
          row
            ? `<td${row.sub ? ' class="muted"' : ""}>${esc(row.item)}</td>
             <td class="center small">${esc(row.charge)}</td>
             <td class="num">${esc(row.unit)}</td>
             <td class="num">${row.pages}</td>
             <td class="num">${esc(row.amount)}</td>`
            : `<td></td><td></td><td></td><td></td><td></td>`;

        const head =
          i === 0
            ? `<td class="center unit-head" rowspan="${height}">${u.no}</td>
               <td class="unit-head" rowspan="${height}">${esc(u.unit.location || "－")}<br>
                 <span class="small">${esc(u.unit.current.makerText)} ${esc(u.unit.current.modelText)}</span></td>`
            : "";
        const leftBill =
          i === 0 ? `<td class="num bill" rowspan="${height}">${billCell(u.current)}</td>` : "";
        const rightHead =
          i === 0
            ? `<td class="unit-head" rowspan="${height}">${sideTitle(u.unit.proposal.makerText, u.unit.proposal.modelText)}</td>`
            : "";
        const rightBill =
          i === 0 ? `<td class="num bill" rowspan="${height}">${billCell(u.proposal)}</td>` : "";
        const gap = i === 0 ? `<td class="gap" rowspan="${height}"></td>` : "";

        return `<tr class="${i === 0 ? "unit-first" : ""}">${head}${cells(l)}${leftBill}${gap}${rightHead}${cells(r)}${rightBill}</tr>`;
      }).join("");
    })
    .join("");

  // ── 控除の注意書き（現行に控除があり、提案に無い台がある場合）
  const deductedUnits = calc.units.filter((u) => u.current.deductedPages > 0 && u.proposal.deductedPages === 0);
  const deductionNote = deductedUnits.length
    ? `<div class="fleet-note"><strong>※ 控除について</strong>　現行のカウンター明細には
        ミスプリント控除（印刷枚数を一律で差し引く控除）があり、現行側は控除後の枚数で計算しています
        （${deductedUnits.map((u) => `No.${u.no} ▲${n(u.current.deductedPages)}枚`).join("、")}／合計 ▲${n(
          deductedUnits.reduce((s, u) => s + u.current.deductedPages, 0),
        )}枚）。
        ご提案する複合機には控除がないため、提案側は実際の印刷枚数そのままで計算しております。</div>`
    : "";

  // Excelの「1ページに収める」と同じで、行数が多いときは全体を縮小して1枚に収める。
  const rowCount =
    (calc.leaseUnknown ? 0 : calc.units.length) +
    calc.units.reduce((sum, u) => sum + Math.max(fleetSideRows(u.current).length, fleetSideRows(u.proposal).length, 1), 0);
  const zoom = fitZoom(rowCount);

  const body = `
  <div class="fleet-head">
    <div>
      <h1>複合機比較表</h1>
      <div class="small">${esc(fromMakers.join("・") || "現行")} 複合機　⇒　${esc(toMakers.join("・") || "提案")} 複合機（全${calc.units.length}台）</div>
      <div style="margin-top:6px"><span class="customer">${esc(quote.customerName)}</span> <span style="font-size:10pt">${esc(quote.customerHonorific)}</span></div>
    </div>
    ${companyBlock(settings, logo)}
  </div>

  ${calc.leaseUnknown ? "" : `<div class="band">- リ ー ス 料 金 詳 細 内 訳 -</div>
  <table class="grid">
    <thead>
      <tr>
        <th class="side-current" colspan="7">現状利用状況</th>
        <th class="gap"></th>
        <th class="side-proposal" colspan="4">導入提案予測</th>
      </tr>
      <tr>
        <th style="width:2.5%">No</th><th style="width:16%">設置場所</th><th style="width:7.5%">メーカー</th>
        <th style="width:13%">物件名</th><th style="width:4%">印刷速度</th><th style="width:8%">備考</th>
        <th style="width:9%">リース料金</th>
        <th class="gap"></th>
        <th style="width:7.5%">メーカー</th><th style="width:14%">提案機種</th>
        <th style="width:4%">印刷速度</th><th style="width:13%">リース料金</th>
      </tr>
    </thead>
    <tbody>
      ${leaseRows}
      <tr class="sum-row">
        <td colspan="5"></td><td class="center">消費税（10％）</td>
        <td class="num">${n(calc.current.leaseTax)}</td>
        <td class="gap"></td>
        <td colspan="2"></td><td class="center">消費税（10％）</td>
        <td class="num">${n(calc.proposal.leaseTax)}</td>
      </tr>
      <tr class="total-row">
        <td colspan="5"></td><td class="center">リース料金 合計</td>
        <td class="num">${n(calc.current.leaseTotal)}</td>
        <td class="gap"></td>
        <td colspan="2"></td><td class="center">リース料金 合計</td>
        <td class="num">${n(calc.proposal.leaseTotal)}</td>
      </tr>
    </tbody>
  </table>`}

  <div class="band">- カ ウ ン タ ー 料 金 詳 細 内 訳 比 較 -
    ${fleet.pagesNote ? `<span class="band-note">（${esc(fleet.pagesNote)}）</span>` : ""}
  </div>
  <table class="grid">
    <thead>
      <tr>
        <th class="side-current" colspan="8">現状利用状況</th>
        <th class="gap"></th>
        <th class="side-proposal" colspan="7">導入提案予測</th>
      </tr>
      <tr>
        <th style="width:2.5%">No</th><th style="width:12%">設置場所・機種</th>
        <th style="width:8%">項目</th><th style="width:5%">チャージ枚数</th><th style="width:4.5%">単価</th>
        <th style="width:7%">印刷枚数</th><th style="width:6%">金額</th><th style="width:7%">請求金額</th>
        <th class="gap"></th>
        <th style="width:10%">機種</th>
        <th style="width:8%">項目</th><th style="width:5%">チャージ枚数</th><th style="width:4.5%">単価</th>
        <th style="width:7%">印刷枚数</th><th style="width:6%">金額</th><th style="width:7%">請求金額</th>
      </tr>
    </thead>
    <tbody>
      ${counterRows}
      <tr class="total-row">
        <td colspan="7">カウンター料金 小計</td>
        <td class="num">${n(calc.current.counterSubtotal)}</td>
        <td class="gap"></td>
        <td colspan="6">カウンター料金 小計</td>
        <td class="num">${n(calc.proposal.counterSubtotal)}</td>
      </tr>
    </tbody>
  </table>
  ${deductionNote}
  ${
    calc.leaseUnknown
      ? `<div class="fleet-note"><strong>※ リース料金について</strong>　現在ご利用中の複合機のリース料金を
        お伺いできていないため、この比較表は<b>カウンター料金のみ</b>で比較しております
        （リース料金は現状・提案とも含んでおりません）。
        リース料金をお知らせいただければ、リース料を含めた比較表をあらためてご用意いたします。</div>`
      : ""
  }

  <div class="fleet-bottom">
    <div>
      <div class="band">- 合 計 -</div>
      <table class="grid">
        <thead><tr>
          <th></th><th class="side-current">現状利用状況</th>
          <th class="side-proposal">導入提案予測</th><th>削減額</th>
        </tr></thead>
        <tbody>
          <tr>
            <th style="text-align:left">${calc.leaseUnknown ? "カウンター料金 （単月）" : "合計金額 （単月）"}</th>
            <td class="num">${n(calc.current.monthly)}</td>
            <td class="num">${n(calc.proposal.monthly)}</td>
            <td class="num">${diff(calc.diffMonthly)}</td>
          </tr>
          <tr>
            <th style="text-align:left">${calc.leaseUnknown ? "カウンター料金 （年間）" : "合計金額 （年間）"}</th>
            <td class="num">${n(calc.current.yearly)}</td>
            <td class="num">${n(calc.proposal.yearly)}</td>
            <td class="num">${diff(calc.diffYearly)}</td>
          </tr>
          <tr class="total-row">
            <th style="text-align:left">${calc.leaseUnknown ? "カウンター料金" : "合計金額"} （${calc.leaseYears}年間）</th>
            <td class="num">${n(calc.current.longTerm)}</td>
            <td class="num">${n(calc.proposal.longTerm)}</td>
            <td class="num">${diff(calc.diffLeaseTerm)}</td>
          </tr>
        </tbody>
      </table>
    </div>
    <div>
      <div class="band">- ト ー タ ル 削 減 料 金 -</div>
      <table class="grid">
        <tbody>
          <tr class="save-total"><th style="text-align:left">合計合算削減金額 （単月）</th><td class="num">${diff(calc.diffMonthly)}</td></tr>
          <tr class="save-total"><th style="text-align:left">合計合算削減金額 （年間）</th><td class="num">${diff(calc.diffYearly)}</td></tr>
          <tr class="save-total"><th style="text-align:left">合計合算削減金額 （${calc.leaseYears}年間）</th><td class="num">${diff(calc.diffLeaseTerm)}</td></tr>
          <tr class="total-row"><th style="text-align:left">削減率</th><td class="num">${
            calc.reductionRate === 0
              ? "±0%"
              : calc.reductionRate < 0
                ? `<span class="save">▲${(Math.abs(calc.reductionRate) * 100).toFixed(1)}%</span>`
                : `<span class="cut">+${(calc.reductionRate * 100).toFixed(1)}%</span>`
          }</td></tr>
        </tbody>
      </table>
    </div>
    <div>${salesEffectTable(calc.diffYearly, "100%")}</div>
  </div>
  `;
  return page(`複数台比較表_${quote.customerName}`, body, {
    css: `${FLEET_CSS}\n  body.fleet { --fit: ${zoom}; }`,
    bodyClass: "fleet",
  });
}

/**
 * 比較表（A4たて）の、行数に応じた縮小率。
 *
 * 表が伸びる原因は、逓減単価の明細の区分と段。1区分あたり1行、
 * 段が2つ以上ある区分はさらに段の数だけ行が増える。
 * 各社を横並びにした比較表は列が増えるぶん、見出しが折り返して背が高くなる。
 *
 * PDFに書き出すときは、これを出発点にChromiumで実際の高さを測り直して
 * 詰め直す（fitToOnePage）。ここでの見積りは、HTMLをそのまま
 * ブラウザで印刷したときのための備え。
 */
export function fitCompare(rowCount: number, columns = 1): number {
  const budget = COMPARE_BUDGET_PX - (columns > 1 ? 30 * (columns - 1) : 0);
  const scale = budget / (COMPARE_BLOCK_PX + COMPARE_ROW_PX * rowCount);
  if (scale >= 0.98) return 1;
  return Math.max(0.5, Math.round(scale * 1_000) / 1_000);
}

/**
 * 比較表の、行数で伸び縮みする部分の行数。
 *
 * 逓減単価の明細が無い場合は「ブラック・フルカラー・2色カラー」の3行で固定なので、
 * 伸び縮みは無い（0を返す）。この3行ぶんの高さは下の COMPARE_BLOCK_PX に含めてある。
 */
export function compareRowCount(current: CurrentCalc): number {
  const lines = current.chargeLines;
  if (!lines?.length) return 0;
  // 区分ごとに1行。段が2つ以上ある区分は、その段の数だけ行が増える
  return lines.reduce((sum, l) => sum + 1 + (l.bands.length > 1 ? l.bands.length : 0), 0);
}

/**
 * 以下の3つは Chromium で実測して求めた値（A4たて・印刷幅190mm）。
 *
 *   印刷できる高さ : 297mm − 上下余白24mm ≒ 1,032px（96dpi）→ 余裕を見て1,020px
 *   行数で変わらない部分 : 見出し・自社情報・枚数表・合計欄・削減効果で約925px（余裕を見て945px）
 *   明細1行あたり : 約37.5px（区分名の下に枚数と実効単価を添えるため2行分の高さになる）
 */
const COMPARE_BUDGET_PX = 1_020;
const COMPARE_BLOCK_PX = 945;
const COMPARE_ROW_PX = 37.5;

/**
 * A3ヨコ1枚に収まるよう、字と行の高さを縮める割合（Excelの「1ページに収める」と同じ考え方）。
 *
 * 横幅はA3いっぱいのまま使いたいので、全体を拡大縮小（zoom）するのではなく
 * 字の大きさだけを変える。表は幅100%なので、字が小さくなると高さだけが縮む。
 *
 * 台数が多いと字は小さくなるが、これは元のExcel（16台を1枚に収める運用）と同じ。
 * ただし読めなくなる手前（0.45）で止め、それ以上は2枚に分ける。
 */
export function fitZoom(rowCount: number): number {
  const scale = SHRINKABLE_BUDGET_PX / (BLOCK_HEIGHT_PX + ROW_HEIGHT_PX * rowCount);
  // わずかな縮小は見た目に効かないので等倍のままにする
  if (scale >= 0.98) return 1;
  return Math.max(0.45, Math.round(scale * 1_000) / 1_000);
}

/**
 * 以下の3つは Chromium で実測して求めた値。
 * 高さは fit を f として 105 + (300 + 17.2 × 行数) × f でほぼ線形に効く。
 *
 *   印刷できる高さ  : A3ヨコ297mm − 余白16mm ≒ 1,060px（96dpi）→ 余裕を見て1,000px
 *   縮まない部分    : 罫線と自社情報など約105px
 *   縮む部分        : 見出し帯・合計欄で約300px ＋ 明細1行あたり約17.2px
 */
const SHRINKABLE_BUDGET_PX = 1_000 - 105;
const BLOCK_HEIGHT_PX = 300;
const ROW_HEIGHT_PX = 17.2;

/* ---------------- 提案資料（写真入りのご提案書） ---------------- */

/**
 * 見積書・比較表とは別に出す、お客様にお渡しする提案資料。
 *
 * 構成は 表紙 → 現状 → ご提案 → オプションのご紹介 → 導入効果 の順。
 * オプションは「付けた場合に月々いくら増えるか」だけを載せ、
 * 定価や販売額は出さない（お客様が判断するのは月々の負担額のため）。
 */
const DOC_CSS = `
  @page { size: A4; margin: 14mm 13mm; }
  body.doc { font-size: 10.5pt; line-height: 1.7; }

  .doc-page { page-break-after: always; }
  .doc-page:last-child { page-break-after: auto; }

  /* 表紙 */
  .cover { display: flex; flex-direction: column; min-height: 250mm; }
  .cover .cover-top { flex: 0 0 auto; }
  .cover .cover-mid { flex: 1 1 auto; display: flex; flex-direction: column; justify-content: center; }
  .cover h1 {
    font-size: 26pt;
    letter-spacing: 0.18em;
    line-height: 1.5;
    margin: 0 0 6px;
    text-indent: 0.18em;
  }
  .cover h1::after { width: 180px; height: 3px; margin-top: 14px; }
  .cover .to {
    font-size: 17pt;
    font-weight: 700;
    border-bottom: 2px solid var(--accent);
    display: inline-block;
    padding: 0 24px 6px 0;
    margin-bottom: 22px;
  }
  .cover .lead { white-space: pre-wrap; color: #37485a; margin-top: 18px; }
  .cover .cover-foot { flex: 0 0 auto; display: flex; justify-content: space-between; align-items: flex-end; }

  .doc h2 {
    font-size: 15pt;
    letter-spacing: 0.16em;
    text-align: left;
    text-indent: 0;
    margin: 0 0 14px;
    padding: 0 0 6px 12px;
    border-bottom: 2px solid var(--accent);
    border-left: 6px solid var(--accent);
  }
  .doc h3 { font-size: 11.5pt; color: var(--accent); margin: 14px 0 6px; }

  /* 写真 */
  .photo {
    display: flex;
    align-items: center;
    justify-content: center;
    background: #f4f7fa;
    border: 1px solid var(--line-soft);
    border-radius: 4px;
    overflow: hidden;
  }
  .photo img { max-width: 100%; max-height: 100%; object-fit: contain; }
  .photo.empty { color: #93a3b4; font-size: 8.5pt; }
  .machine { display: flex; gap: 18px; align-items: flex-start; }
  .machine .photo { width: 46%; height: 62mm; flex: 0 0 auto; }
  .machine .detail { flex: 1 1 auto; }
  .machine .model { font-size: 15pt; font-weight: 700; color: var(--accent); }
  .machine .maker { font-size: 10pt; color: #5b6b7c; }

  /* 現状→提案の矢印 */
  .flow { display: flex; align-items: center; gap: 14px; margin: 16px 0; }
  .flow > .side { flex: 1 1 0; text-align: center; }
  .flow .photo { height: 52mm; margin-bottom: 6px; }
  .flow .arrow { flex: 0 0 auto; font-size: 22pt; color: var(--accent); font-weight: 700; }
  .flow .caption { font-weight: 700; }
  .flow .caption .sub { display: block; font-size: 9pt; font-weight: 400; color: #5b6b7c; }

  /* 箇条書き */
  .points { list-style: none; padding: 0; margin: 10px 0 0; }
  .points li { position: relative; padding: 5px 0 5px 26px; border-bottom: 1px dashed var(--line-soft); }
  .points li::before {
    content: "✓";
    position: absolute;
    left: 4px;
    color: var(--accent);
    font-weight: 700;
  }
  .issues li::before { content: "●"; color: #b3261e; font-size: 8pt; top: 7px; }

  /* オプション */
  .options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
  .option {
    display: flex;
    gap: 10px;
    border: 1px solid var(--line-soft);
    border-radius: 4px;
    padding: 8px;
    break-inside: avoid;
  }
  .option .photo { width: 30mm; height: 26mm; flex: 0 0 auto; }
  .option .body { flex: 1 1 auto; min-width: 0; }
  .option .name { font-weight: 700; line-height: 1.4; }
  .option .code { font-size: 8.5pt; color: #5b6b7c; }
  .option .desc { font-size: 9pt; color: #37485a; margin-top: 2px; }
  .option .add {
    margin-top: 5px;
    padding: 3px 8px;
    display: inline-block;
    background: var(--accent-soft);
    border-left: 3px solid var(--accent);
    border-radius: 2px;
    font-size: 9pt;
  }
  .option .add strong { font-size: 12pt; color: var(--accent); }

  /* 導入効果 */
  .effect-big {
    display: flex;
    gap: 14px;
    margin: 14px 0;
  }
  .effect-big > div {
    flex: 1 1 0;
    text-align: center;
    border: 1px solid var(--line);
    border-top: 4px solid var(--accent);
    border-radius: 4px;
    padding: 12px 8px;
  }
  .effect-big .label { font-size: 9.5pt; color: #5b6b7c; }
  .effect-big .value { font-size: 20pt; font-weight: 700; color: var(--accent); letter-spacing: 0.02em; }
  .effect-big .value.save { color: #0a7d32; }
`;

/** 写真の枠。無いときは枠だけ出して、体裁が崩れないようにする */
const photoBox = (src: string | undefined, alt: string, cls = ""): string =>
  src
    ? `<div class="photo ${cls}"><img src="${src}" alt="${esc(alt)}"></div>`
    : `<div class="photo empty ${cls}">写真未登録</div>`;

/** 提案資料に渡す写真（ファイル名 → data URI） */
export interface DocPhotos {
  current?: string;
  proposal?: string;
  byOption: Record<string, string>;
}

export function renderProposalDocHtml(
  quote: Quote,
  current: CurrentCalc,
  calc: ProposalCalc,
  settings: Settings,
  photos: DocPhotos,
  logo?: string,
): string {
  const doc = quote.proposalDoc ?? {};
  const base = settings.proposalDoc;
  const c = quote.current;
  const p = calc.proposal;
  const d = calc.device;
  const cd = calc.currentDevice;

  const title = doc.title?.trim() || base.title;
  const highlights = (doc.highlights?.length ? doc.highlights : base.highlights).filter((h) => h.trim());
  const issues = (doc.issues ?? []).filter((i) => i.trim());
  const save = Math.max(0, -calc.diffMonthly);

  const spec = (label: string, value: string | number | undefined, unit = "") =>
    value === undefined || value === "" ? "" : `<tr><th>${esc(label)}</th><td>${esc(value)}${unit}</td></tr>`;

  // ── 表紙
  const cover = `
  <div class="doc-page cover">
    <div class="cover-top">${brandBar(settings, logo, quote, p.quoteNo)}</div>
    <div class="cover-mid">
      <div><span class="to">${esc(quote.customerName)} ${esc(quote.customerHonorific)}</span></div>
      <h1>${esc(title)}</h1>
      <div class="lead">${esc(doc.lead?.trim() || base.lead)}</div>
    </div>
    <div class="cover-foot">
      <div class="small muted">${esc(jpDate(quote.quoteDate))}</div>
      ${companyBlock(settings, logo)}
    </div>
  </div>`;

  // ── 現状 → ご提案
  const flow = `
  <div class="doc-page">
    <h2>現状のご利用状況と、ご提案</h2>
    <div class="flow">
      <div class="side">
        ${photoBox(photos.current, c.modelText || "現行機")}
        <div class="caption">${esc(c.makerText || "現行機")}
          <span class="sub">${esc(c.modelText || "－")}</span></div>
      </div>
      <div class="arrow">➡</div>
      <div class="side">
        ${photoBox(photos.proposal, p.modelText)}
        <div class="caption">${esc(makerJp(p.maker))}
          <span class="sub">${esc(p.modelText)}</span></div>
      </div>
    </div>

    <table class="grid" style="margin-top:4px">
      <thead><tr>
        <th style="width:30%"></th>
        <th style="width:35%">現在ご利用の複合機</th>
        <th style="width:35%">ご提案する複合機</th>
      </tr></thead>
      <tbody>
        <tr><th style="text-align:left">メーカー</th><td>${esc(c.makerText || "－")}</td><td>${esc(makerJp(p.maker))}</td></tr>
        <tr><th style="text-align:left">機種</th><td>${esc(c.modelText || "－")}</td><td>${esc(p.modelText)}</td></tr>
        <tr><th style="text-align:left">印刷速度（カラー）</th><td>${x2(cd?.ppmColor, "枚/分")}</td><td>${x2(d?.ppmColor, "枚/分")}</td></tr>
        <tr><th style="text-align:left">印刷速度（モノクロ）</th><td>${x2(cd?.ppmMono, "枚/分")}</td><td>${x2(d?.ppmMono, "枚/分")}</td></tr>
        <tr><th style="text-align:left">ファーストコピー（カラー）</th><td>${x2(cd?.firstCopyColorSec, "秒")}</td><td>${x2(d?.firstCopyColorSec, "秒")}</td></tr>
        <tr><th style="text-align:left">ウォームアップ</th><td>${x2(cd?.warmupSec, "秒")}</td><td>${x2(d?.warmupSec, "秒")}</td></tr>
        <tr><th style="text-align:left">最大用紙サイズ</th><td>${esc(cd?.maxPaperSize ?? "－")}</td><td>${esc(d?.maxPaperSize ?? "－")}</td></tr>
      </tbody>
    </table>

    ${
      issues.length
        ? `<h3>現状の課題</h3>
           <ul class="points issues">${issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
        : ""
    }
    ${
      highlights.length
        ? `<h3>ご提案のポイント</h3>
           <ul class="points">${highlights.map((h) => `<li>${esc(h)}</li>`).join("")}</ul>`
        : ""
    }
  </div>`;

  // ── オプションのご紹介（金額は出さず、月々の上乗せ額だけを出す）
  const optionPage = calc.options.length
    ? `
  <div class="doc-page">
    <h2>オプションのご紹介</h2>
    <p class="small muted">
      下記は、ご提案の複合機に追加できるオプションです。
      金額は「お付けした場合に月々のリース料がいくら増えるか」で記載しております（税別・${p.leaseTerm}回払いの場合）。
    </p>
    ${groupOptions(calc.options)
      .map(
        (group) => `
      <h3>${esc(group.category)}</h3>
      <div class="options">
        ${group.items
          .map(
            (o) => `
          <div class="option">
            ${photoBox(o.option.photo ? photos.byOption[o.option.photo] : undefined, o.option.name)}
            <div class="body">
              <div class="name">${esc(o.option.name)}</div>
              ${o.option.modelCode ? `<div class="code">${esc(o.option.modelCode)}</div>` : ""}
              ${o.option.description ? `<div class="desc">${esc(o.option.description)}</div>` : ""}
              <div class="add">月額 <strong>+${n(o.monthlyLeaseAdd)}</strong> 円</div>
            </div>
          </div>`,
          )
          .join("")}
      </div>`,
      )
      .join("")}
  </div>`
    : "";

  // ── 導入効果
  const effect = `
  <div class="doc-page">
    <h2>導入後の月々のご負担</h2>
    <div class="effect-big">
      <div>
        <div class="label">現在の月間経費（税込）</div>
        <div class="value">${n(current.comparable)}<span style="font-size:11pt"> 円</span></div>
      </div>
      <div>
        <div class="label">ご提案後の月間経費（税込）</div>
        <div class="value">${n(calc.comparable)}<span style="font-size:11pt"> 円</span></div>
      </div>
      <div>
        <div class="label">月々の削減額</div>
        <div class="value ${save > 0 ? "save" : ""}">${save > 0 ? `▲${n(save)}` : n(Math.abs(calc.diffMonthly))}<span style="font-size:11pt"> 円</span></div>
      </div>
    </div>

    <table class="grid" style="width:70%">
      <tbody>
        <tr><th style="text-align:left">月額リース料（税別・${p.leaseTerm}回払い）</th><td class="num">${n(calc.monthlyLease)} 円</td></tr>
        <tr><th style="text-align:left">モノクロ カウンター単価</th><td class="num">${unitYen(calc.units.mono)}</td></tr>
        <tr><th style="text-align:left">フルカラー カウンター単価</th><td class="num">${unitYen(calc.units.color)}</td></tr>
        <tr><th style="text-align:left">2色カラー カウンター単価</th><td class="num">${unitYen(calc.units.twoColor)}</td></tr>
        <tr><th style="text-align:left">最低基本料金</th><td class="num">${n(calc.units.minCharge)} 円</td></tr>
      </tbody>
    </table>

    ${
      save > 0
        ? `<table class="grid" style="width:70%;margin-top:14px">
      <tbody>
        <tr><th style="text-align:left">削減額（年間）</th><td class="num save">▲${n(save * 12)} 円</td></tr>
        <tr class="total-row"><th style="text-align:left">削減額（${calc.leaseYears}年間）</th><td class="num save">▲${n(Math.abs(calc.diffLeaseTerm))} 円</td></tr>
      </tbody>
    </table>
    ${salesEffectTable(calc.diffYearly, "70%")}`
        : ""
    }

    ${counterOnlyNote(calc)}

    <div class="notes" style="margin-top:18px">${esc(
      doc.closing?.trim() ||
        "ご不明な点やご要望がございましたら、何なりとお申し付けください。\n何卒ご検討のほど、よろしくお願い申し上げます。",
    )}</div>
    <div style="margin-top:22px;display:flex;justify-content:flex-end">${companyBlock(settings, logo)}</div>
  </div>`;

  return page(`ご提案書_${quote.customerName}_${makerJp(p.maker)}`, cover + flow + optionPage + effect, {
    css: DOC_CSS,
    bodyClass: "doc",
  });
}
