import type {
  ChargeLineCalc,
  CurrentCalc,
  CurrentChargeLine,
  Fleet,
  FleetCalc,
  FleetSideCalc,
  FleetTotals,
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

/**
 * 元のExcelと同じ「メイリオ」。
 * Windowsに必ず入っている書体なので、お客様の手元でも同じ見え方になる。
 */
const FONT_STACK =
  '"Meiryo UI", "メイリオ", "Meiryo", "Yu Gothic", "YuGothic", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "IPAGothic", sans-serif';

/**
 * 元のExcelで使われている色。見た目を合わせるために名前で持つ。
 *   見出し（見積書）     #CCFFCC
 *   見出し（比較表の表頭）#BFBFBF（白を25%暗くした灰色）
 *   区分名の列           #EBF1DE（アクセント3を80%明るく）
 *   単価・枚数の強調      #FAC090（アクセント6を40%明るく）
 *   合計の黒帯           #0D0D0D
 */
const CSS = `
  @page { size: A4; margin: 12mm 10mm; }
  * { box-sizing: border-box; }
  /* 背景色は印刷時にも残す（帳票の見出し帯が消えないように） */
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }

  :root {
    --ink: #000;
    --line: #000;
    --head: #bfbfbf;
    --head-green: #ccffcc;
    --label-green: #ebf1de;
    --label-gray: #f2f2f2;
    --orange: #fac090;
    --bar: #0d0d0d;
    --red: #ff0000;
  }

  body {
    font-family: ${FONT_STACK};
    color: var(--ink);
    font-size: 11pt;
    margin: 0;
    line-height: 1.3;
  }

  h1 {
    font-size: 24pt;
    font-weight: 700;
    letter-spacing: 0.5em;
    text-align: center;
    margin: 2px 0;
    text-indent: 0.5em;
  }
  h2 {
    font-size: 24pt;
    font-weight: 700;
    letter-spacing: 0.5em;
    text-align: center;
    margin: 10px 0 4px;
    text-indent: 0.5em;
  }

  table { border-collapse: collapse; width: 100%; }
  /* Excelの罫線と同じ、細い黒の実線 */
  .grid { border: 1px solid var(--line); }
  .grid th, .grid td { border: 1px solid var(--line); padding: 0.25em 0.45em; }
  .grid thead th { background: var(--head); font-weight: 700; text-align: center; }
  .grid tbody th { background: var(--label-gray); font-weight: 700; }
  .plain td { padding: 0.1em 2px; vertical-align: top; line-height: 1.5; }

  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .center { text-align: center; }
  .small { font-size: 0.84em; }
  .muted { color: #555; }

  .head { display: flex; justify-content: space-between; align-items: flex-start; }
  /* 宛名は下線だけ（Excelと同じ） */
  .customer { font-size: 16pt; font-weight: 700; }

  /* 自社情報 */
  .company { text-align: left; font-size: 10pt; line-height: 1.45; }
  .company .name { font-size: 15pt; font-weight: 700; letter-spacing: 0.02em; }
  .company .logo { display: block; width: 260px; max-height: 52px; object-fit: contain; object-position: left center; }
  .company .offices { margin-top: 3px; }
  .company .offices .office-name { font-weight: 700; }
  .brand { display: flex; align-items: center; gap: 10px; }
  .brand img { height: 44px; max-width: 260px; object-fit: contain; object-position: left center; }
  .brand-right { display: flex; align-items: center; gap: 8px; }

  /* 角印はロゴの右肩に重ねて押す（紙に朱肉で押したときと同じ見え方） */
  .company-logo { position: relative; display: inline-block; }
  .company-logo .seal { position: absolute; right: -24px; top: -6px; width: 62px; height: auto; }
  .seal-bar { width: 52px; height: auto; }

  .notes { margin-top: 8px; font-size: 0.86em; line-height: 1.5; white-space: pre-wrap; }

  .grid tbody tr.sum-row td { background: var(--label-gray); font-weight: 700; }
  .grid tbody tr.group-row td { font-weight: 700; }
  /* 合計は黒帯に白抜き（Excelと同じ） */
  .grid tbody tr.total-row .save, .grid tbody tr.total-row .cut { color: #fff; }
  .grid tbody tr.total-row td, .grid tbody tr.total-row th { background: var(--bar); color: #fff; font-weight: 700; }

  /* 削減額は赤。増額は黒のままにして、赤が「削減」だけを指すようにする */
  .save { color: var(--red); font-weight: 700; }
  .cut { color: #000; font-weight: 700; }
  .page-break { page-break-before: always; }

  /* 年間売上高に換算した効果（左に一言、右に表） */
  .effect-block {
    display: flex;
    align-items: center;
    gap: 1.2em;
    margin-top: 1.2em;
  }
  .effect-block .effect-note {
    flex: 1;
    color: var(--red);
    font-weight: 700;
    font-size: calc(14pt * var(--fit, 1));
    line-height: 1.5;
    text-align: center;
    white-space: nowrap;
  }
  .effect { width: 56%; border-collapse: collapse; border: 2px solid #000; }
  .effect th, .effect td { border: 1px solid #000; padding: 0.2em 0.5em; text-align: center; }
  .effect .effect-title { background: #dbeef4; font-size: calc(16pt * var(--fit, 1)); font-weight: 700; }
  .effect .effect-rate-head { background: #eeece1; font-size: calc(10pt * var(--fit, 1)); font-weight: 700; }
  .effect .rate-20 { background: #ff0000; font-weight: 700; font-size: calc(13pt * var(--fit, 1)); }
  .effect .rate-10 { background: #92d050; font-weight: 700; font-size: calc(13pt * var(--fit, 1)); }
  .effect .rate-5 { background: #00b0f0; font-weight: 700; font-size: calc(13pt * var(--fit, 1)); }
  .effect .effect-side { font-weight: 700; font-size: calc(10pt * var(--fit, 1)); width: 14%; border: none; }
  .effect .effect-value { font-size: calc(15pt * var(--fit, 1)); font-weight: 700; font-style: italic; }
`;

/**
 * 見積書（A4たて1枚）。
 *
 * 明細が増えても1枚に収める。金額を並べた紙なので、
 * 2枚目に合計だけが続くと見落とされる。
 */
const QUOTE_CSS = `
  body.quote { font-size: calc(12pt * var(--fit, 1)); line-height: 1.25; }
  body.quote h1 { font-size: calc(24pt * var(--fit, 1)); margin: calc(6px * var(--fit, 1)) 0; }

  /* 宛名（左）と日付・見積書番号（右） */
  body.quote .q-top { display: flex; justify-content: space-between; align-items: flex-end; }
  body.quote .q-to {
    flex: 1;
    border-bottom: 1px solid #000;
    padding: 0 0 0.15em 0.5em;
    font-size: calc(14pt * var(--fit, 1));
    font-weight: 700;
    margin-right: 2em;
  }
  body.quote .q-to .honorific { font-size: calc(11pt * var(--fit, 1)); margin-left: 0.6em; }
  body.quote .q-no { text-align: right; font-size: calc(11pt * var(--fit, 1)); white-space: nowrap; line-height: 1.6; }

  body.quote .q-lead { font-size: calc(10pt * var(--fit, 1)); font-weight: 700; margin: 0.4em 0 0.5em; }

  /* 物件名・納入場所…（細い下線つきの箇条） */
  body.quote .q-terms { width: 52%; border-collapse: collapse; }
  body.quote .q-terms td { border-bottom: 1px solid #a6a6a6; padding: 0.22em 0; font-size: calc(10pt * var(--fit, 1)); font-weight: 700; }
  body.quote .q-terms .q-label { width: 7.5em; text-align: justify; text-align-last: justify; }
  body.quote .q-terms .q-colon { width: 1.2em; text-align: center; }

  body.quote .company { font-size: calc(10pt * var(--fit, 1)); font-weight: 700; width: 46%; }
  body.quote .company .name { font-size: calc(15pt * var(--fit, 1)); }
  body.quote .company .logo { width: calc(260px * var(--fit, 1)); max-height: calc(52px * var(--fit, 1)); }
  body.quote .company .company-contact { padding-left: 1.6em; margin-top: 0.2em; }
  body.quote .company-logo .seal {
    width: calc(78px * var(--fit, 1));
    right: calc(-34px * var(--fit, 1));
    top: calc(-10px * var(--fit, 1));
  }
  body.quote .company .offices { text-align: center; margin-top: 0.7em; }
  body.quote .company .offices .office-name { font-size: calc(11pt * var(--fit, 1)); }

  /* 月額リース料金（緑の見出しセル＋金額） */
  body.quote .lease-box { width: 48%; border-collapse: collapse; margin: 0.6em 0 0.5em; border: 2px solid #000; }
  body.quote .lease-box td { border: 0; padding: 0.2em 0.5em; vertical-align: middle; }
  body.quote .lease-box .label {
    background: var(--head-green);
    border-right: 1px solid #000;
    font-size: calc(16pt * var(--fit, 1));
    font-weight: 700;
    text-align: center;
    white-space: nowrap;
  }
  body.quote .lease-box .value { font-size: calc(18pt * var(--fit, 1)); font-weight: 700; text-align: center; }
  body.quote .lease-box .tax { font-size: calc(10pt * var(--fit, 1)); text-align: right; white-space: nowrap; }

  /* 明細表（Excelと同じ、薄緑の見出し＋細い黒罫） */
  body.quote .grid { border: 2px solid #000; }
  body.quote .grid thead th {
    background: var(--head-green);
    font-size: calc(14pt * var(--fit, 1));
    font-weight: 700;
    border-bottom: 3px double #000;
    padding: 0.2em 0.3em;
  }
  body.quote .grid td { padding: 0.28em 0.45em; vertical-align: middle; }
  body.quote .grid td.center { white-space: nowrap; }
  body.quote .grid tbody tr.group-row td { font-weight: 400; }
  body.quote .grid tbody tr.sum-row td { background: #fff; border-top: 3px double #000; border-bottom: 3px double #000; font-weight: 700; }
  body.quote .grid tbody tr.discount-row td { color: var(--red); border-bottom: 3px double #000; font-weight: 700; }
  body.quote .grid tbody tr.total-row td { background: #fff; color: #000; font-weight: 700; border-top: 0; }
  body.quote .grid .unit-red { color: var(--red); font-weight: 700; }
  body.quote .grid .lease-unit { background: #fabf8f; }
  body.quote .sub-item td { padding-top: 0; padding-bottom: 0.28em; }

  body.quote .section { font-size: calc(12pt * var(--fit, 1)); font-weight: 700; margin: 0.45em 0 0; }
  body.quote .notes { font-size: calc(10pt * var(--fit, 1)); font-weight: 700; margin-top: 0.6em; }
`;

/**
 * 見積書の、行数で伸び縮みする部分の行数。
 * 機器の明細・カウンター単価・リースシミュレーションが縦に伸びる。
 */
export function quoteRowCount(calc: ProposalCalc): number {
  const items = calc.proposal.items.length + (calc.debtSettlement.total > 0 ? 1 : 0);
  // 枠が余った分は空行で埋まる。空行は品目の行より背が低いので、
  // 「品目1行ぶん」に換算して数える（実測 空行30px ／ 品目50px）
  return items + Math.max(0, QUOTE_ITEM_SLOTS - items) * 0.6;
}

/** 機器明細の枠の行数（元のExcelと同じ） */
const QUOTE_ITEM_SLOTS = 8;

/**
 * 見積書の縮小率。
 *
 * 実測（A4たて・印刷幅190mm）：
 *   行数で変わらない部分 約1,067px（見出し・自社情報・カウンター料金7行・
 *   リースシミュレーション3行・注記をすべて含む）／ 明細1行あたり 約50px
 *   （品目1件1,327px ／ 5件1,407px ／ 8件1,467px ／ 12件1,667px ／ 16件1,867px）
 */
export function fitQuote(rowCount: number): number {
  const scale = QUOTE_BUDGET_PX / (QUOTE_BLOCK_PX + QUOTE_ROW_PX * rowCount);
  if (scale >= 0.98) return 1;
  return Math.max(0.5, Math.round(scale * 1_000) / 1_000);
}

const QUOTE_BUDGET_PX = 1_020;
const QUOTE_BLOCK_PX = 1_067;
const QUOTE_ROW_PX = 50;

/**
 * 比較表（A4たて1枚）。
 *
 * 行を詰めて情報を詰め込むより、余白を広く取って読めることを優先する。
 * 営業がお客様の前で開き、指さしながら説明する紙だから。
 * 行が増えて1枚に入らないときだけ、--fit で字と余白を一緒に縮める。
 */
const COMPARE_CSS = `
  body.compare {
    font-size: calc(12pt * var(--fit, 1));
    line-height: 1.25;
  }
  body.compare h2 {
    font-size: calc(24pt * var(--fit, 1));
    letter-spacing: 0.6em;
    margin: calc(14px * var(--fit, 1)) 0 calc(6px * var(--fit, 1));
  }
  body.compare h2.h2-wide { font-size: calc(18pt * var(--fit, 1)); letter-spacing: 0.3em; }
  body.compare .compare-makers {
    text-align: center;
    font-size: calc(18pt * var(--fit, 1));
    font-weight: 700;
    letter-spacing: 0.1em;
    margin-bottom: 1.1em;
  }
  body.compare .notes { font-size: calc(9.5pt * var(--fit, 1)); margin-top: 0.7em; }

  /* 題字の上に置く、ロゴ（左）と角印（右）の帯 */
  body.compare .cmp-brand {
    display: flex;
    align-items: center;
    justify-content: space-between;
    min-height: calc(46px * var(--fit, 1));
  }
  body.compare .cmp-logo { height: calc(40px * var(--fit, 1)); max-width: 50%; object-fit: contain; object-position: left center; }
  body.compare .cmp-name { font-size: calc(13pt * var(--fit, 1)); font-weight: 700; }
  body.compare .seal-compare { width: calc(62px * var(--fit, 1)); height: auto; }

  /* 月間印刷枚数（左上の小さな表） */
  .pages-box { width: auto; margin: 0 0 1em; border-collapse: collapse; }
  .pages-box thead th {
    text-align: left;
    font-weight: 700;
    padding: 0 0 0.3em 1.6em;
    border: none;
  }
  .pages-box td { border: 1px solid #000; padding: 0.3em 0.7em; }
  .pages-box .pages-name { font-weight: 700; border: none; padding-left: 0.2em; white-space: nowrap; }
  .pages-box .pages-value { background: var(--orange); text-align: right; font-weight: 700; min-width: 7.5em; }
  .pages-box .pages-unit { border: none; padding-left: 0.5em; font-weight: 700; }

  /* 本表 */
  .cmp { width: 100%; border-collapse: collapse; table-layout: fixed; border: 2px solid #000; }
  .cmp th, .cmp td { border: 1px solid #000; padding: 0.3em 0.5em; }
  .cmp thead th {
    background: var(--head-green);
    font-weight: 700;
    text-align: center;
    border-bottom: 3px double #000;
  }
  .cmp thead th.save-head { color: var(--red); }
  .cmp tbody th {
    background: var(--label-green);
    text-align: left;
    font-weight: 700;
    font-size: calc(11pt * var(--fit, 1));
    word-break: break-word;
  }
  /* カウンターの区分は、Excelと同じく薄い灰色 */
  .cmp tbody tr.row-counter th { background: var(--label-gray); }
  .cmp td { text-align: center; }
  .cmp .unit-cell { border-right: none; white-space: nowrap; text-align: right; padding-right: 0.8em; }
  .cmp .unit-value {
    display: inline-block;
    min-width: 3.2em;
    padding: 0 0.3em;
    margin: 0 0.15em;
    background: var(--orange);
    text-align: center;
    font-weight: 700;
  }
  .cmp .unit-value.unit-red { color: var(--red); }
  .cmp td.num { border-left: none; text-align: center; }
  .cmp .save-col { padding: 0; }
  .cmp .row-sum td.num { font-weight: 400; }
  .cmp .row-lease td.num, .cmp .row-lease .unit-cell { background: var(--orange); }
  .cmp .row-total th { background: var(--head-green); }
  .cmp .row-total td { font-weight: 700; }
  .cmp tbody tr.row-rule th, .cmp tbody tr.row-rule td { border-bottom: 3px double #000; }

  /* カウンター削減額（表の中でいちばん目を引かせる） */
  .cmp .save-label {
    background: var(--head-green);
    border-bottom: 1px solid #000;
    text-align: center;
    font-weight: 700;
    font-size: calc(10pt * var(--fit, 1));
    padding: 0.1em;
  }
  .cmp .save-value {
    background: #ffff00;
    color: var(--red);
    font-weight: 700;
    text-align: center;
    padding: 0.18em 0.4em;
  }

  /* 合計合算削減金額（3段） */
  .save-summary { width: 100%; border-collapse: collapse; margin-top: 1em; border: 2px solid #000; }
  .save-summary th, .save-summary td { border: 1px solid #000; padding: 0.3em 0.8em; }
  .save-summary th {
    background: var(--head-green);
    width: 52%;
    text-align: center;
    font-size: calc(18pt * var(--fit, 1));
    font-weight: 700;
  }
  .save-summary .yen { width: 7%; font-size: calc(16pt * var(--fit, 1)); font-weight: 700; color: var(--red); }
  .save-summary td.num { font-size: calc(22pt * var(--fit, 1)); font-weight: 400; text-align: right; }
  .save-summary .save { color: var(--red); font-weight: 400; }
  .save-summary .cut { color: #000; font-weight: 400; }

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

/**
 * 自社情報（ロゴ・社名・連絡先・拠点）。
 *
 * 元のExcelでは、ロゴと社名の下に代表者・TEL・FAXを置き、
 * そこから下（拠点名・住所・出張範囲）は中央そろえにしている。
 */
function companyBlock(settings: Settings, logo?: string, seal?: string): string {
  const c = settings.company;
  const offices = c.offices?.length
    ? c.offices
        .map(
          (o) =>
            `<div class="office-name">◎${esc(o.name)}</div><div>${esc(o.address)}</div>`,
        )
        .join("")
    : `<div class="office-name">${esc(c.branchNote ?? "")}</div><div>${esc(c.address ?? "")}</div>`;

  return `
    <div class="company">
      <div class="company-logo">
        ${logo ? `<img class="logo" src="${logo}" alt="${esc(c.name)}">` : `<div class="name">${esc(c.name)}</div>`}
        ${sealImg(seal)}
      </div>
      <div class="company-contact">
        <div>${esc(c.representative ?? "")}</div>
        <div>${c.tel ? `TEL ${esc(c.tel)}` : ""}</div>
        <div>${c.fax ? `FAX ${esc(c.fax)}` : ""}</div>
      </div>
      <div class="offices">
        ${offices}
        <div>${esc(c.areaNote ?? "")}</div>
      </div>
    </div>`;
}

/**
 * 角印（社判）。自社名に重ねて押す。
 * 画像が登録されていなければ、何も出さない（枠だけ残らないように）。
 */
const sealImg = (seal?: string, cls = "seal"): string =>
  seal ? `<img class="${cls}" src="${seal}" alt="社印">` : "";

/** 比較表の上部に置く社名・ロゴ・角印の帯 */
function brandBar(
  settings: Settings,
  logo: string | undefined,
  quote: Quote,
  quoteNo?: string,
  seal?: string,
): string {
  const c = settings.company;
  return `
  <div class="head" style="align-items:center">
    <div class="brand">
      ${logo ? `<img src="${logo}" alt="${esc(c.name)}">` : `<span class="name">${esc(c.name)}</span>`}
    </div>
    <div class="brand-right">
      <div class="small muted" style="text-align:right">
        <div>${esc(c.name)}</div>
        <div>${c.tel ? `TEL ${esc(c.tel)}` : ""}${c.fax ? `　FAX ${esc(c.fax)}` : ""}</div>
        <div>見積番号 ${esc(quoteNo ?? quote.quoteNo)}${quote.staffName ? `　担当 ${esc(quote.staffName)}` : ""}</div>
      </div>
      ${sealImg(seal, "seal seal-bar")}
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
  seal?: string,
): string {
  const c = settings.company;
  const term = (label: string, value: string) =>
    `<tr><td class="q-label">${esc(label)}</td><td class="q-colon">：</td><td>${esc(value)}</td></tr>`;
  return `
  <div class="q-top">
    <div class="q-to">${esc(quote.customerName)}<span class="honorific">${esc(quote.customerHonorific)}</span></div>
    <div class="q-no">
      <div>${esc(jpDate(quote.quoteDate))}</div>
      <div>見積書番号：　${esc(quoteNo ?? quote.quoteNo)}</div>
    </div>
  </div>
  <h1>御　見　積　書</h1>
  <div class="q-lead">下記の通り御見積申し上げます。何卒よろしくお願い致します。</div>
  <div class="head">
    <table class="q-terms">
      ${term("物件名", subject)}
      ${term("納入場所", "別途お打ち合わせ")}
      ${term("御受渡期日", "別途お打ち合わせ")}
      ${term("御支払条件", "別途お打ち合わせ")}
      ${term("有効期限", c.validityText)}
      ${quote.staffName ? term("担当者", quote.staffName) : ""}
    </table>
    ${companyBlock(settings, logo, seal)}
  </div>`;
}

/** 御見積書1枚 */
export function renderQuoteHtml(
  quote: Quote,
  calc: ProposalCalc,
  settings: Settings,
  logo?: string,
  seal?: string,
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

  // 元のExcelは明細の枠を8行ぶん取ってある。品目が少なくても枠の高さを
  // そろえておかないと、合計欄の位置が案件ごとに上下して落ち着かない
  const padRows = "<tr><td>&nbsp;</td><td></td><td></td><td></td><td></td><td></td><td></td></tr>".repeat(
    Math.max(0, QUOTE_ITEM_SLOTS - p.items.length - (calc.debtSettlement.total > 0 ? 1 : 0)),
  );

  const leaseRows = Object.entries(settings.leaseRates)
    .map(([term, rate]) => ({ term: Number(term), rate }))
    .sort((a, b) => a.term - b.term)
    .map(
      (l, i) => `<tr>
        <td class="center">${i + 1}</td>
        <td>リース料金(${Math.round(l.term / 12)}年リース)</td>
        <td class="center">${l.term}</td>
        <td class="center">ヶ月</td>
        <td class="num lease-unit">${n(calc.leaseByTerm[l.term] ?? 0)}</td>
        <td class="num">${n((calc.leaseByTerm[l.term] ?? 0) * l.term)}</td>
        <td>${l.term === p.leaseTerm ? "本見積の条件" : ""}</td>
      </tr>`,
    )
    .join("");

  const u = calc.units;
  // 元のExcelと同じく、区分名と「１枚〜　単価」を上下2行に分ける
  const counterRows = [
    { no: 1, name: "■白黒モード", unit: u.mono, qtyUnit: "枚" },
    { no: 2, name: "■2色カラーコピー", unit: u.twoColor, qtyUnit: "枚" },
    { no: 3, name: "■フルカラー", unit: u.color, qtyUnit: "枚" },
  ]
    .map(
      (r) => `<tr>
        <td class="center">${r.no}</td>
        <td>${esc(r.name)}</td>
        <td></td><td></td><td></td><td></td>
      </tr>
      <tr class="sub-item">
        <td></td>
        <td>１枚〜</td>
        <td class="center">1</td>
        <td class="center">${r.qtyUnit}</td>
        <td class="num unit-red">${unitDigits(r.unit)}</td>
        <td></td>
      </tr>`,
    )
    .join("");

  const body = `
  ${quoteHeader(quote, settings, subject, logo, p.quoteNo, seal)}

  <table class="lease-box"><tr>
    <td class="label">月額リース料金</td>
    <td class="value">${n(calc.monthlyLease)}</td>
    <td class="tax">（税別）</td>
  </tr></table>

  <table class="grid">
    <colgroup>
      <col style="width:4%" /><col /><col style="width:5%" /><col style="width:5%" />
      <col style="width:15%" /><col style="width:14%" /><col style="width:13%" />
    </colgroup>
    <thead><tr>
      <th>No</th><th>メーカー　品　名　型　番</th>
      <th colspan="2">数量</th>
      <th>単　価</th><th>金　額</th><th>備考</th>
    </tr></thead>
    <tbody>
      <tr class="group-row"><td></td><td>${esc(groupLabel)}</td><td></td><td></td><td></td><td></td><td></td></tr>
      ${itemRows}
      ${
        calc.debtSettlement.total > 0
          ? `<tr>
        <td></td><td>旧リース残債精算</td>
        <td class="center">${calc.debtSettlement.totalMonths}</td>
        <td class="center">カ月</td>
        <td class="num">${n(calc.debtSettlement.monthlyLease)}</td>
        <td class="num">${n(calc.debtSettlement.total)}</td>
        <td class="small">残債${calc.debtSettlement.remainingMonths}カ月＋解約手数料${calc.debtSettlement.months}カ月</td>
      </tr>`
          : ""
      }
      ${padRows}
      <tr class="sum-row"><td></td><td colspan="3" class="num">本体合計</td><td></td><td class="num">${n(calc.listTotal)}</td><td></td></tr>
      <tr class="discount-row"><td></td><td colspan="3" class="num">お値引き</td><td class="num">▲</td><td class="num">(${n(Math.abs(calc.discount))})</td><td></td></tr>
      <tr class="total-row"><td></td><td colspan="3" class="num">販売額計</td><td></td><td class="num">${n(calc.sellingTotal)}</td><td></td></tr>
    </tbody>
  </table>

  <div class="section">【カウンター料金】</div>
  <table class="grid">
    <colgroup>
      <col style="width:4%" /><col /><col style="width:5%" /><col style="width:5%" />
      <col style="width:15%" /><col style="width:27%" />
    </colgroup>
    <thead><tr>
      <th>No</th><th>品　　　　名</th><th colspan="2">数量</th>
      <th>単　価</th><th>備考</th>
    </tr></thead>
    <tbody>
      ${counterRows}
      <tr>
        <td class="center">4</td><td>■最低基本料金</td><td class="center">1</td><td class="center">ヶ月</td>
        <td class="num" style="font-weight:700">${n(u.minCharge)}</td><td></td>
      </tr>
    </tbody>
  </table>

  <div class="section">【リースシミュレーション】</div>
  <table class="grid">
    <colgroup>
      <col style="width:4%" /><col /><col style="width:5%" /><col style="width:5%" />
      <col style="width:15%" /><col style="width:14%" /><col style="width:13%" />
    </colgroup>
    <thead><tr>
      <th>No</th><th>品　　　　名</th><th colspan="2">数量</th>
      <th>単　価</th><th>金　額</th><th>備考</th>
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
  return page(`見積書_${quote.customerName}_${makerJp(p.maker)}`, body, {
    css: `${QUOTE_CSS}\n  body.quote { --fit: ${fitQuote(quoteRowCount(calc))}; }`,
    bodyClass: "quote",
  });
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
/**
 * 比較表（現状 vs 1提案）。
 *
 * A4たて1枚に、余白を広く取って刷る。営業がお客様の前で開いて
 * 指さしながら説明する紙なので、行を詰めるより読める大きさを優先する。
 *
 * カウンターの内訳は「帯ごとの金額」と「控除」を別の行に分けて出す。
 * 控除後の枚数で1行にまとめると、なぜその金額になるのかが辿れない。
 */
export function renderCompareHtml(
  quote: Quote,
  current: CurrentCalc,
  calc: ProposalCalc,
  settings: Settings,
  logo?: string,
  seal?: string,
): string {
  const c = quote.current;
  const d = calc.device;
  const cd = calc.currentDevice;

  /** 4列（区分・現状・提案・削減額）の1行 */
  const row = (label: string, left: string, right: string, save = "", cls = "") =>
    `<tr${cls ? ` class="${cls}"` : ""}><th>${esc(label)}</th>${left}${right}<td class="save-col">${save}</td></tr>`;

  /** 値がどちらにも無い行は出さない（空欄が並ぶと表が間延びする） */
  let specRows = 0;
  const specRow = (label: string, left: number | undefined, right: number | undefined, unit: string) =>
    left === undefined && right === undefined
      ? ""
      : (specRows++,
        row(
          label,
          `<td class="num" colspan="2">${left === undefined ? "－" : `${left} ${unit}`}</td>`,
          `<td class="num" colspan="2">${right === undefined ? "－" : `${right} ${unit}`}</td>`,
        ));

  /**
   * 単価つきの金額セル（単価：[  3.0 ]円　3,000）。
   * 提案側の単価は、元のExcelと同じく赤字で出す（いちばん見てほしい数字）。
   */
  const priced = (unit: number | undefined, amount: number | undefined, red = false) =>
    unit === undefined
      ? `<td class="unit-cell"></td><td class="num">${amount === undefined ? "" : n(amount)}</td>`
      : `<td class="unit-cell">単価：<span class="unit-value${red ? " unit-red" : ""}">${unitDigits(unit)}</span>円</td>` +
        `<td class="num">${amount === undefined ? "" : n(amount)}</td>`;

  const blank = `<td class="unit-cell"></td><td class="num"></td>`;
  const money = (v: number) => `<td class="unit-cell"></td><td class="num">${n(v)}</td>`;

  const counterRows = counterCompareRows(current, calc, c, priced, blank, row);
  const saveCell = (v: number) =>
    `<div class="save-label">カウンター削減額</div><div class="save-value">${
      v < 0 ? `▲　${n(Math.abs(v))}` : v > 0 ? `+　${n(v)}` : "±0"
    }</div>`;

  const body = `
  <div class="cmp-brand">
    ${logo ? `<img class="cmp-logo" src="${logo}" alt="${esc(settings.company.name)}">` : `<span class="cmp-name">${esc(settings.company.name)}</span>`}
    ${sealImg(seal, "seal seal-compare")}
  </div>
  <h2>比　較　表</h2>
  <div class="compare-makers">（　${esc(c.makerText || "現行")}　➡　${esc(makerJp(calc.proposal.maker))}　）</div>

  <table class="pages-box">
    <thead><tr><th colspan="3">月間印刷枚数${esc(pagesAverageNote(c))}</th></tr></thead>
    <tbody>${pagesRows(current, c)}</tbody>
  </table>

  <table class="cmp">
    <colgroup>
      <col style="width:25.5%" /><col style="width:12%" /><col style="width:17.7%" />
      <col style="width:12.8%" /><col style="width:19.2%" /><col style="width:12.8%" />
    </colgroup>
    <thead>
      <tr>
        <th></th>
        <th colspan="2">現状利用状況</th>
        <th colspan="2">導入提案予測</th>
        <th class="save-head">削減額</th>
      </tr>
    </thead>
    <tbody>
      ${row("メーカー", `<td class="center" colspan="2">${esc(c.makerText || "－")}</td>`, `<td class="center" colspan="2">${esc(makerJp(calc.proposal.maker))}</td>`)}
      ${row("機種", `<td class="center" colspan="2">${esc(c.modelText || "－")}</td>`, `<td class="center" colspan="2">${esc(calc.proposal.modelText)}</td>`)}
      ${specRow("ウォームタイム", cd?.warmupSec, d?.warmupSec, "秒以下")}
      ${specRow("ファーストコピー（モノクロ）", cd?.firstCopyMonoSec, d?.firstCopyMonoSec, "秒")}
      ${specRow("ファーストコピー（カラー）", cd?.firstCopyColorSec, d?.firstCopyColorSec, "秒")}
      ${specRow("連続コピー速度（モノクロ）", cd?.ppmMono, d?.ppmMono, "枚/分")}
      ${specRow("連続コピー速度（カラー）", cd?.ppmColor, d?.ppmColor, "枚/分")}
      ${row(
        "リース料　①",
        current.leaseUnknown ? `<td class="unit-cell"></td><td class="num">－（不明）</td>` : money(current.monthlyLease),
        calc.counterOnly ? `<td class="unit-cell"></td><td class="num">${n(calc.monthlyLease)}<span class="small muted">（参考）</span></td>` : money(calc.monthlyLease),
        "",
        "row-lease row-rule",
      )}
      ${counterRows}
      ${row(
        "最低基本料金",
        c.units.minCharge ? money(c.units.minCharge) : blank,
        calc.units.minCharge ? money(calc.units.minCharge) : blank,
        "",
        "row-counter",
      )}
      ${row(
        "カウンター請求合計　②",
        money(current.counter.total),
        money(calc.counter.total),
        saveCell(calc.counter.total - current.counter.total),
        "row-sum row-counter row-rule",
      )}
      ${
        calc.counterOnly
          ? ""
          : row(
              "ランニングコスト ①+②",
              money(current.monthlyLease + current.counter.total),
              money(calc.monthlyLease + calc.counter.total),
            )
      }
      ${row("保守料金", current.maintenanceMonthly ? money(current.maintenanceMonthly) : blank, calc.maintenanceMonthly ? money(calc.maintenanceMonthly) : blank)}
      ${row(
        "消費税",
        money(current.tax),
        money(calc.counterOnly ? Math.round(calc.comparable - calc.counter.total - calc.maintenanceMonthly) : calc.runningTax),
      )}
      ${row(
        calc.counterOnly ? "カウンター月間経費" : "月間経費",
        money(current.comparable),
        money(calc.comparable),
        "",
        "row-total",
      )}
    </tbody>
  </table>

  <table class="save-summary">
    <tbody>
      ${saveRow("合計合算削減金額　（単月）", calc.diffMonthly)}
      ${saveRow("合計合算削減金額　（年間）", calc.diffYearly)}
      ${saveRow(`合計合算削減金額　（${calc.leaseYears}年間）`, calc.diffLeaseTerm)}
    </tbody>
  </table>

  ${deductionNote(current, c.chargeLines)}
  ${counterOnlyNote(calc)}
  ${salesEffectBlock(calc.diffYearly)}
  `;
  return page(`比較表_${quote.customerName}_${makerJp(calc.proposal.maker)}`, body, {
    css: `${COMPARE_CSS}\n  body.compare { --fit: ${fitCompare(compareRowCount(current))}; }`,
    bodyClass: "compare",
  });
}

/**
 * 現行だけ控除がかかっていることの注記。
 *
 * 表の「控除」行で引いてはいるが、なぜ提案側に控除の行が無いのかは
 * 書いておかないと伝わらない。ここを黙っていると、提案側を
 * 少なく見せているように受け取られかねない。
 */
function deductionNote(current: CurrentCalc, source?: CurrentChargeLine[]): string {
  const lines = (current.chargeLines ?? []).filter((l) => l.deduction > 0);
  const flat = current.counter.deduction;
  if (!lines.length && !flat) return "";

  // 率は明細に書かれている値をそのまま出す。
  // 控除枚数は切り上げなので、枚数から割り戻すと 3% が 3.8% になってしまう
  const rateOf = (name: string) => source?.find((x) => x.name === name)?.deductionRate;
  const pct = (rate: number | undefined) => (rate === undefined ? "" : `${Math.round(rate * 1000) / 10}%`);
  const detail = lines.length
    ? lines.map((l) => `${l.name} ${pct(rateOf(l.name))}（▲${n(l.deduction)}枚）`).join("　／　")
    : `${pct(flat?.rate)}（合計 ▲${n(flat?.total ?? 0)}枚）`;

  return `<div class="notes">※　現行のカウンター明細には控除（${esc(detail)}）があり、上表の「控除」の行で差し引いています。
　　ご提案する複合機には控除がございませんので、提案側は上記の印刷枚数そのままで計算しております。</div>`;
}

/** 単価は明細と同じ「3.0」「16.8」の書き方にそろえる（整数でも小数第1位まで） */
const unitDigits = (unit: number): string =>
  Math.round(unit * 10) === unit * 10 ? unit.toFixed(1) : unit.toFixed(2);

/** 月間印刷枚数の行。明細を読み取っていれば、その区分名をそのまま使う */
function pagesRows(current: CurrentCalc, c: Quote["current"]): string {
  const cell = (label: string, pages: number) =>
    `<tr><td class="pages-name">${esc(label)}</td><td class="pages-value">${n(pages)}</td><td class="pages-unit">枚</td></tr>`;
  if (current.chargeLines?.length) {
    return current.chargeLines.map((l) => cell(l.name, l.pages)).join("");
  }
  return [
    ["モノクロ", c.monoPages],
    ["フルカラー", c.colorPages],
    ["2色カラー", c.twoColorPages],
  ]
    .filter(([, pages]) => (pages as number) > 0)
    .map(([label, pages]) => cell(label as string, pages as number))
    .join("");
}

/**
 * カウンターの内訳行。
 *
 * 区分ごとに「帯ごとの金額」を出し、控除はその下に別の行として引く。
 * 控除後の枚数で1行にまとめてしまうと、明細のどの数字から来たのかが
 * 追えなくなる（お客様に説明できない）。
 *
 * 帯の金額は控除前の枚数で出し、控除の行で差を引く。
 * こうすると各行の合計が、明細に書かれた請求額とそのまま一致する。
 */
function counterCompareRows(
  current: CurrentCalc,
  calc: ProposalCalc,
  c: Quote["current"],
  priced: (unit: number | undefined, amount: number | undefined, red?: boolean) => string,
  blank: string,
  row: (label: string, left: string, right: string, save?: string, cls?: string) => string,
): string {
  const lines = current.chargeLines;
  if (!lines?.length) {
    const simple = (label: string, lu: number, la: number, ru: number, ra: number) =>
      row(label, priced(lu, la), priced(ru, ra, true), "", "row-counter");
    return [
      c.monoPages > 0 ? simple("ブラック", c.units.mono, current.counter.monoAmount, calc.units.mono, calc.counter.monoAmount) : "",
      c.colorPages > 0 ? simple("フルカラー", c.units.color, current.counter.colorAmount, calc.units.color, calc.counter.colorAmount) : "",
      c.twoColorPages > 0 ? simple("2色カラー", c.units.twoColor, current.counter.twoColorAmount, calc.units.twoColor, calc.counter.twoColorAmount) : "",
    ].join("");
  }

  // 提案側の金額は区分ごとに1回だけ出す（フルカラーが2区分に分かれていても二重に出さない）
  const shown = new Set<string>();
  const proposalUnit = (kind: ChargeLineCalc["kind"]) =>
    kind === "mono" ? calc.units.mono : kind === "twoColor" ? calc.units.twoColor : calc.units.color;
  const proposalAmount = (kind: ChargeLineCalc["kind"]) =>
    kind === "mono" ? calc.counter.monoAmount : kind === "twoColor" ? calc.counter.twoColorAmount : calc.counter.colorAmount;

  return lines
    .map((line) => {
      const first = !shown.has(line.kind);
      shown.add(line.kind);
      const right = first ? priced(proposalUnit(line.kind), proposalAmount(line.kind), true) : blank;

      // 帯ごとの金額を、控除前の枚数で出し直す
      const gross = grossBands(line);
      const bandRows = gross.bands
        .map((b, i) =>
          row(`${line.name}：${b.label}`, priced(b.unit, b.amount), i === 0 ? right : blank, "", "row-counter"),
        )
        .join("");

      // 控除は最後の帯の単価で引く（明細と同じ見せ方）
      const deducted = gross.total - line.amount;
      const deductionRow =
        line.deduction > 0
          ? row("控除", priced(gross.bands[gross.bands.length - 1]?.unit, -deducted), blank, "", "row-counter")
          : "";
      return bandRows + deductionRow;
    })
    .join("");
}

/** 控除前の枚数で帯ごとの金額を出す（表示用。合計は控除の行で辻褄を合わせる） */
function grossBands(line: ChargeLineCalc): { bands: { label: string; unit: number; amount: number }[]; total: number } {
  const bands = line.bands.length
    ? line.bands.map((b) => ({ label: b.label, unit: b.unit, amount: b.amount }))
    : [];
  if (!bands.length || line.deduction <= 0) {
    return { bands, total: bands.reduce((s, b) => s + b.amount, 0) };
  }
  // 控除ぶんを最後の帯に戻す（その帯の単価で刷られていたものとして見せる）
  const last = bands[bands.length - 1];
  const restored = { ...last, amount: last.amount + Math.floor(line.deduction * last.unit) };
  const out = [...bands.slice(0, -1), restored];
  return { bands: out, total: out.reduce((s, b) => s + b.amount, 0) };
}

/** 合計合算削減金額の1行 */
function saveRow(label: string, value: number): string {
  const save = value < 0;
  return `<tr>
    <th>${esc(label)}</th>
    <td class="yen">¥</td>
    <td class="num ${save ? "save" : "cut"}">${save ? "-" : value > 0 ? "+" : ""}${n(Math.abs(value))}</td>
  </tr>`;
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
 * 商談でいちばん効くのがこの表。「月々いくら安くなるか」より
 * 「売上に直すといくらぶんか」のほうが、経営者の方には金額の大きさが伝わる。
 */
function salesEffectBlock(diffYearly: number): string {
  const save = Math.max(0, -diffYearly);
  if (save <= 0) return "";
  return `
  <div class="effect-block">
    <div class="effect-note">右記程度の「売上高が増加した」<br>ことと同等の効果が得られます</div>
    <table class="effect">
      <tbody>
        <tr><td class="effect-title" colspan="4">年間売上高に換算したコスト削減効果</td></tr>
        <tr><td class="effect-side"></td><td class="effect-rate-head" colspan="3">利益率</td></tr>
        <tr>
          <td class="effect-side"></td>
          <td class="rate-20">20%</td><td class="rate-10">10%</td><td class="rate-5">5%</td>
        </tr>
        <tr>
          <td class="effect-side">年間<br>売上高</td>
          <td class="effect-value">${n(save * 5)}</td>
          <td class="effect-value">${n(save * 10)}</td>
          <td class="effect-value">${n(save * 20)}</td>
        </tr>
      </tbody>
    </table>
  </div>`;
}

/** 複数メーカーを横並びにした比較表（同時提案用） */
export function renderMultiCompareHtml(
  quote: Quote,
  current: CurrentCalc,
  calcs: ProposalCalc[],
  settings: Settings,
  logo?: string,
  seal?: string,
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
  ${brandBar(settings, logo, quote, undefined, seal)}
  <h2 class="h2-wide">複合機 比較表（各社同時比較）</h2>
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
  body.fleet { font-size: calc(12pt * var(--fit)); line-height: 1.2; }
  body.fleet .small { font-size: 0.8em; }

  /* ── 見出し（日付・題字・宛名・自社情報） */
  .fleet-date { text-align: right; font-size: calc(10pt * var(--fit)); }
  .fleet-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 10px; }
  .fleet-head > * { flex: 1; }
  .fleet-title {
    flex: 1.2;
    border: 2px solid #000;
    text-align: center;
    font-weight: 700;
    font-size: calc(21pt * var(--fit));
    line-height: 1.25;
    padding: 0.25em 0.4em;
    align-self: flex-start;
  }
  .fleet-title .fleet-subtitle { font-size: calc(12pt * var(--fit)); }
  .fleet-to {
    border-bottom: 2px solid #000;
    font-size: calc(21pt * var(--fit));
    font-weight: 700;
    padding: 0.4em 0 0.15em 1.2em;
    margin-top: 1.2em;
  }
  .fleet-company { text-align: right; font-size: calc(10pt * var(--fit)); font-weight: 700; line-height: 1.5; }
  .fleet-company img { height: calc(34px * var(--fit)); max-width: 100%; object-fit: contain; object-position: right center; }
  /* 角印はロゴの左肩に押す（右端は住所欄で詰まっているため） */
  .fleet-brand { position: relative; display: inline-block; }
  .fleet-brand .seal-fleet {
    position: absolute;
    right: calc(100% + 4px);
    top: calc(-4px * var(--fit));
    width: calc(54px * var(--fit));
    height: auto;
  }
  .fleet-company .name { font-size: calc(13pt * var(--fit)); font-weight: 700; }

  /* ── 帯見出し（題字を太い枠で囲んだもの） */
  .band {
    border: 3px solid #000;
    text-align: center;
    font-weight: 700;
    font-size: calc(18pt * var(--fit));
    letter-spacing: 0.1em;
    padding: 0.2em;
    margin: 0.8em 0 0.6em;
  }

  /* ── 左右に並べた現状／提案の表 */
  .fleet-cols { display: flex; gap: calc(10px * var(--fit)); align-items: flex-start; }
  .fleet-cols > * { flex: 1; min-width: 0; }
  /* 現状 → 提案 の向きが一目で分かるよう、左右の表のあいだに矢印を置く */
  .fleet-cols > .fleet-arrow {
    flex: 0 0 auto;
    align-self: center;
    padding: 0 calc(4px * var(--fit));
    font-size: calc(34pt * var(--fit));
    line-height: 1;
    font-weight: 700;
    color: #000;
  }

  body.fleet .grid { border: 1px solid #000; }
  body.fleet .grid th, body.fleet .grid td {
    border: 1px solid #000;
    padding: 0.2em 0.3em;
    text-align: center;
    vertical-align: middle;
  }
  body.fleet .grid thead th { background: #bfbfbf; font-weight: 700; font-size: calc(10pt * var(--fit)); white-space: nowrap; }
  body.fleet .grid td.nowrap { white-space: nowrap; }
  /* 合計は黒帯に白抜き（Excelと同じ） */
  body.fleet .grid tbody tr.total-row td { background: #0d0d0d; color: #fff; font-weight: 700; }
  body.fleet .grid td.bill { font-weight: 700; font-size: calc(13pt * var(--fit)); }
  body.fleet .grid td.unit-head { font-weight: 700; }
  body.fleet .grid td.no { width: 3%; font-size: calc(9.5pt * var(--fit)); }
  body.fleet .grid .sum-value { font-weight: 700; font-size: calc(13pt * var(--fit)); }

  /* 合計金額（表の下に置く小さな箱） */
  .fleet-total { width: 46%; margin: 0.5em 0 0 auto; border-collapse: collapse; border: 2px solid #000; }
  .fleet-total td { border: 1px solid #000; padding: 0.2em 0.4em; text-align: center; font-weight: 700; }
  .fleet-total .fleet-total-value { font-size: calc(14pt * var(--fit)); }

  /* ── 合計／トータル削減料金（下段） */
  .fleet-bottom { display: flex; gap: calc(18px * var(--fit)); align-items: flex-start; margin-top: 0.8em; }
  .fleet-bottom > * { flex: 1; min-width: 0; }
  .sum-block { width: 100%; border-collapse: collapse; }
  .sum-block td { border: 3px solid #000; padding: 0.15em 0.5em; text-align: center; font-weight: 700; }
  .sum-block .sum-label { font-size: calc(15pt * var(--fit)); border-bottom: 3px double #000; }
  .sum-block .sum-amount { font-size: calc(17pt * var(--fit)); color: var(--red); text-align: right; border-top: 0; }
  .sum-block .sum-yen { float: left; }
  .sum-block .sum-gap td { border: 0; padding: 0.2em; }
  .sum-block.total-save .sum-label { background: #ffff00; }
  .band.band-save { background: #ffff00; }

  body.fleet .effect-block { flex-direction: column-reverse; align-items: stretch; gap: 0.5em; margin-top: 0; }
  body.fleet .effect { width: 100%; }
  body.fleet .effect .effect-title { font-size: calc(15pt * var(--fit)); }
  body.fleet .effect .effect-value { font-size: calc(14pt * var(--fit)); }
  body.fleet .effect-block .effect-note { font-size: calc(14pt * var(--fit)); }

  .fleet-note { margin-top: 0.5em; font-size: calc(9.5pt * var(--fit)); line-height: 1.4; }
  .fleet-note strong { color: var(--red); }
`;

/** 台ごとのカウンター明細を、表の行に展開したもの */
interface FleetRow {
  item: string;
  /** チャージ枚数の下限（「1」「1,001」） */
  chargeFrom: string;
  /** チャージ枚数の上限（空欄なら上限なし） */
  chargeTo: string;
  unit: string;
  pages: string;
  amount: string;
  /** 消費税・最低基本料金など、区分ではない行 */
  sub?: boolean;
}

/** 片側（現行 or 提案）1台ぶんの明細行 */
function fleetSideRows(side: FleetSideCalc): FleetRow[] {
  const rows: FleetRow[] = [];
  // 「1〜1,000」のような帯の表記を、元のExcelと同じ2つの欄に分ける
  const band = (label: string): { chargeFrom: string; chargeTo: string } => {
    const [from, to] = label.replace(/枚/g, "").split(/[〜～]/);
    return { chargeFrom: (from ?? "1").trim(), chargeTo: (to ?? "").trim() };
  };

  for (const line of side.lines) {
    if (line.bands.length <= 1) {
      const b = line.bands[0];
      rows.push({
        item: line.name,
        ...band(b ? b.label : "1〜"),
        unit: b ? unitDigits(b.unit) : "－",
        pages: n(line.billablePages),
        amount: n(line.amount),
      });
      continue;
    }
    // 段が分かれている区分は、段ごとに行を立てる（チャージ枚数の帯がそのまま行になる）
    line.bands.forEach((b, i) => {
      rows.push({
        item: i === 0 ? line.name : "　〃",
        ...band(b.label),
        unit: unitDigits(b.unit),
        pages: n(b.pages),
        amount: n(b.amount),
      });
    });
  }

  if (side.minCharge > 0) {
    rows.push({
      item: "最低基本料金",
      chargeFrom: "",
      chargeTo: "",
      unit: n(side.minCharge),
      pages: "",
      amount: side.minChargeApplied ? n(side.minCharge) : "－",
      sub: true,
    });
  }
  if (side.maintenanceMonthly > 0) {
    rows.push({
      item: "月額保守料金",
      chargeFrom: "",
      chargeTo: "",
      unit: n(side.maintenanceMonthly),
      pages: "",
      amount: n(side.maintenanceMonthly),
      sub: true,
    });
  }
  // 消費税は元のExcelと同じく、台ごとに1行立てる
  rows.push({
    item: "消費税（10％）",
    chargeFrom: "",
    chargeTo: "",
    unit: "",
    pages: "",
    amount: n(side.counterTax),
    sub: true,
  });
  return rows;
}

export function renderFleetCompareHtml(
  quote: Quote,
  fleet: Fleet,
  calc: FleetCalc,
  settings: Settings,
  logo?: string,
  seal?: string,
): string {
  const co = settings.company;
  const uniq = (values: string[]) => [...new Set(values.filter(Boolean))];
  const fromMakers = uniq(calc.units.map((u) => u.unit.current.makerText));
  const toMakers = uniq(calc.units.map((u) => u.unit.proposal.makerText));
  /** 金額は元のExcelと同じ「¥1,234」の書き方にそろえる */
  const ym = (v: number) => `¥${n(v)}`;
  const ppm = (v?: number) => (v === undefined ? "－" : `1分/${v}枚`);

  // ── リース料金 詳細内訳（左＝現状／右＝提案）
  const leaseTable = (sideKey: "current" | "proposal") => {
    const isCurrent = sideKey === "current";
    const totals = calc[sideKey];
    const rows = calc.units
      .map((u, i) => {
        const side = u[sideKey];
        const info = isCurrent ? u.unit.current : u.unit.proposal;
        const place = isCurrent ? `<td>${esc(u.unit.location || "－")}</td>` : "";
        // 月額リース料金（税抜の合計）は、台をまとめて1つの欄に出す
        const total =
          i === 0
            ? `<td class="bill" rowspan="${calc.units.length}">${ym(totals.leaseMonthly)}</td>`
            : "";
        return `<tr>
          <td class="no">${u.no}</td>
          ${place}
          <td class="unit-head">${esc(info.makerText || "－")}</td>
          <td>${esc(info.modelText || "－")}</td>
          <td>${ppm(info.ppm)}</td>
          <td>${side.monthlyLease ? ym(side.monthlyLease) : "－"}</td>
          ${total}
        </tr>`;
      })
      .join("");
    const span = isCurrent ? 4 : 3;
    return `<table class="grid">
      <colgroup>
        <col style="width:3%" />${isCurrent ? '<col style="width:19%" />' : ""}
        <col style="width:${isCurrent ? 15 : 19}%" /><col style="width:${isCurrent ? 17 : 26}%" />
        <col style="width:14%" /><col style="width:15%" /><col style="width:17%" />
      </colgroup>
      <thead><tr>
        <th></th>${isCurrent ? "<th>設置場所</th>" : ""}
        <th>メーカー</th><th>${isCurrent ? "物件名" : "提案機種"}</th>
        <th>印刷速度</th><th>リース料金</th><th>月額リース料金</th>
      </tr></thead>
      <tbody>
        ${rows}
        <tr>
          <td colspan="${span}"></td><td class="nowrap">消費税(10％)</td><td>${ym(totals.leaseTax)}</td>
        </tr>
        <tr class="total-row">
          <td colspan="${span + 2}">リース料金　合計</td>
          <td class="sum-value">${ym(totals.leaseTotal)}</td>
        </tr>
      </tbody>
    </table>`;
  };

  // ── カウンター料金 詳細内訳 比較（左＝現状／右＝提案）
  const counterTable = (sideKey: "current" | "proposal") => {
    const isCurrent = sideKey === "current";
    const totals = calc[sideKey];
    const body = calc.units
      .map((u) => {
        const side = u[sideKey];
        const info = isCurrent ? u.unit.current : u.unit.proposal;
        const rows = fleetSideRows(side);
        const head = isCurrent
          ? `${esc(u.unit.location || "－")}<br>${esc(info.modelText || "－")}`
          : `${esc(info.makerText || "－")}<br>${esc(info.modelText || "－")}`;
        return rows
          .map((r, i) => {
            const first =
              i === 0
                ? `<td class="no" rowspan="${rows.length}">${u.no}</td>
                   <td class="unit-head" rowspan="${rows.length}">${head}</td>`
                : "";
            const bill =
              i === 0
                ? `<td class="bill" rowspan="${rows.length}">${ym(side.counterTotal)}</td>`
                : "";
            return `<tr>
              ${first}
              <td class="nowrap">${esc(r.item)}</td>
              <td>${esc(r.chargeFrom)}${r.chargeFrom ? `　～　${esc(r.chargeTo)}` : ""}</td>
              <td>${esc(r.unit)}</td>
              <td>${r.pages ? `${esc(r.pages)} 枚` : ""}</td>
              <td>${r.amount ? ym(Number(r.amount.replace(/,/g, ""))) : ""}</td>
              ${bill}
            </tr>`;
          })
          .join("");
      })
      .join("");
    return `<table class="grid">
      <colgroup>
        <col style="width:3%" /><col style="width:15%" /><col style="width:16%" />
        <col style="width:11%" /><col style="width:11%" /><col style="width:13%" />
        <col style="width:15%" /><col style="width:16%" />
      </colgroup>
      <thead><tr>
        <th></th><th>${isCurrent ? "設置場所" : "機種"}</th><th>項目</th>
        <th>チャージ枚数</th><th>単価</th><th>印刷枚数</th><th>金額</th><th>請求金額</th>
      </tr></thead>
      <tbody>
        ${body}
        <tr class="total-row">
          <td colspan="7">カウンター料金　小計</td>
          <td class="sum-value">${ym(totals.counterSubtotal)}</td>
        </tr>
      </tbody>
    </table>`;
  };

  /** 表の下に置く「合計金額」の小さな箱 */
  const totalBox = (v: number) =>
    `<table class="fleet-total"><tr><td>合計金額</td><td class="fleet-total-value">${ym(v)}</td></tr></table>`;

  // リース料金が分からない案件は、カウンター料金だけを比べていることを見出しに残す
  const sumLabel = calc.leaseUnknown ? "カウンター料金" : "合計金額";

  /** 合計の3段（単月・年間・リース年数ぶん） */
  const sumBlock = (totals: FleetTotals, cls = "") => `
    <table class="sum-block ${cls}">
      <tbody>
        ${sumPair(`${sumLabel}　（単月）`, totals.monthly, true)}
        ${sumPair(`${sumLabel}　（年間）`, totals.yearly)}
        ${sumPair(`${sumLabel}　（${calc.leaseYears}年間）`, totals.longTerm)}
      </tbody>
    </table>`;

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
  <div class="fleet-date">${esc(jpDate(quote.quoteDate))}</div>
  <div class="fleet-head">
    <div><div class="fleet-to">${esc(quote.customerName)}　${esc(quote.customerHonorific)}</div></div>
    <div class="fleet-title">複合機比較表
      <div class="fleet-subtitle">${esc(fromMakers.join("・") || "現行")}複合機⇒${esc(toMakers.join("・") || "提案")}複合機</div>
    </div>
    <div class="fleet-company">
      <div class="fleet-brand">
        ${logo ? `<img src="${logo}" alt="${esc(co.name)}">` : `<div class="name">${esc(co.name)}</div>`}
        ${sealImg(seal, "seal seal-fleet")}
      </div>
      <div>${esc(co.postalCode ? `〒${co.postalCode}` : "")}</div>
      <div>${esc(co.offices?.[0]?.address ?? co.address ?? "")}</div>
      <div>${co.tel ? `TEL：${esc(co.tel)}` : ""}${co.fax ? `　　FAX：${esc(co.fax)}` : ""}</div>
      <div>${quote.staffName ? `担当：${esc(quote.staffName)}` : ""}</div>
    </div>
  </div>

  ${
    calc.leaseUnknown
      ? ""
      : `<div class="band">-  リ ー ス 料 金 詳 細 内 訳  -</div>
  <div class="fleet-cols">
    <div>${leaseTable("current")}</div>
    <div class="fleet-arrow">➡</div>
    <div>${leaseTable("proposal")}</div>
  </div>`
  }

  <div class="band">-  カ ウ ン タ ー 料 金 詳 細 内 訳　 比 較 -${
    fleet.pagesNote ? `（${esc(fleet.pagesNote)}）` : ""
  }</div>
  <div class="fleet-cols">
    <div>${counterTable("current")}${totalBox(calc.current.monthly)}</div>
    <div class="fleet-arrow">➡</div>
    <div>${counterTable("proposal")}${totalBox(calc.proposal.monthly)}</div>
  </div>
  ${deductionNote}
  ${
    calc.leaseUnknown
      ? `<div class="fleet-note"><strong>※ リース料金について</strong>　現在ご利用中の複合機のリース料金を
        お伺いできていないため、この比較表は<b>カウンター料金のみ</b>で比較しております
        （リース料金は現状・提案とも含んでおりません）。</div>`
      : ""
  }

  <div class="fleet-cols" style="margin-top:0.8em">
    <div>
      <div class="band">-  合 計  -</div>
      ${sumBlock(calc.current)}
    </div>
    <div class="fleet-arrow">➡</div>
    <div>
      <div class="band">-  合 計  -</div>
      ${sumBlock(calc.proposal)}
    </div>
  </div>

  <div class="fleet-bottom">
    <div></div>
    <div>${salesEffectBlock(calc.diffYearly)}</div>
    <div>
      <div class="band band-save">-  ト ー タ ル 削 減 料 金  -</div>
      <table class="sum-block total-save">
        <tbody>
          ${sumPair("合計合算削減金額　（単月）", calc.diffMonthly, true)}
          ${sumPair("合計合算削減金額　（年間）", calc.diffYearly)}
          ${sumPair(`合計合算削減金額　（${calc.leaseYears}年間）`, calc.diffLeaseTerm)}
          ${sumPairText("削減率", `${(calc.reductionRate * 100).toFixed(2)}%`)}
        </tbody>
      </table>
    </div>
  </div>
  `;
  return page(`複数台比較表_${quote.customerName}`, body, {
    css: `${FLEET_CSS}\n  body.fleet { --fit: ${zoom}; }`,
    bodyClass: "fleet",
  });
}

/** 合計の1組（見出しの行＋金額の行） */
function sumPair(label: string, value: number, withYen = false): string {
  return `
    <tr><td class="sum-label">${esc(label)}</td></tr>
    <tr><td class="sum-amount">${withYen ? '<span class="sum-yen">¥</span>' : ""}${
      value < 0 ? `-${n(Math.abs(value))}` : n(value)
    }</td></tr>
    <tr class="sum-gap"><td></td></tr>`;
}

/** 合計の1組（削減率のように、金額ではない値） */
function sumPairText(label: string, value: string): string {
  return `
    <tr><td class="sum-label">${esc(label)}</td></tr>
    <tr><td class="sum-amount" style="text-align:center">${esc(value)}</td></tr>`;
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
  // これより小さくすると紙で読めない。実物の明細は区分1〜4件（4〜10行）が
  // ほとんどで、この下限でも8区分（23行）まで1枚に収まる
  return Math.max(0.4, Math.round(scale * 1_000) / 1_000);
}

/**
 * 比較表の、行数で伸び縮みする部分の行数。
 *
 * 逓減単価の明細が無い場合は「ブラック・フルカラー・2色カラー」の3行で固定なので、
 * 伸び縮みは無い（0を返す）。この3行ぶんの高さは下の COMPARE_BLOCK_PX に含めてある。
 */
export function compareRowCount(current: CurrentCalc, specRows = 0): number {
  const lines = current.chargeLines;
  // 明細を読み取っていない場合は、ブラック・フルカラー・2色カラーの3行。
  // この3行ぶんの高さは COMPARE_BLOCK_PX に含めてあるので0で数える
  const counter = lines?.length
    ? // 帯ごとに1行、控除がある区分はさらに1行
      lines.reduce((sum, l) => sum + Math.max(1, l.bands.length) + (l.deduction > 0 ? 1 : 0), 0)
    : 0;
  // スペックの行（ウォームタイム・ファーストコピー・連続コピー速度）は
  // 機種DBに値があるときだけ出るので、出る数だけ数える
  return counter + specRows;
}

/**
 * 以下の3つは Chromium で実測して求めた値（A4たて・印刷幅190mm）。
 *
 *   印刷できる高さ : 297mm − 上下余白24mm ≒ 1,032px（96dpi）→ 余裕を見て1,020px
 *   行数で変わらない部分 : 題字・枚数表・合計欄・削減効果で約872px
 *     （明細が無いときの3行ぶんもここに含む。実測978px）
 *   明細1行あたり : 約69px（紙に刷って読める高さを取っているぶん、1行が厚い）
 *     実測 9行1,493px / 11行1,619px / 18行2,123px / 23行2,459px
 */
const COMPARE_BUDGET_PX = 1_020;
const COMPARE_BLOCK_PX = 872;
const COMPARE_ROW_PX = 69;

/**
 * A3ヨコ1枚に収まるよう、字と行の高さを縮める割合（Excelの「1ページに収める」と同じ考え方）。
 *
 * 横幅はA3いっぱいのまま使いたいので、全体を拡大縮小（zoom）するのではなく
 * 字の大きさだけを変える。表は幅100%なので、字が小さくなると高さだけが縮む。
 *
 * 台数が多いと字は小さくなるが、これは元のExcel（11台を30%に縮めて
 * 1枚に収めている運用）と同じ。下限は元のExcelと同じ0.3。
 */
export function fitZoom(rowCount: number): number {
  const scale = SHRINKABLE_BUDGET_PX / (BLOCK_HEIGHT_PX + ROW_HEIGHT_PX * rowCount);
  // わずかな縮小は見た目に効かないので等倍のままにする
  if (scale >= 0.98) return 1;
  return Math.max(0.3, Math.round(scale * 1_000) / 1_000);
}

/**
 * 以下の3つは Chromium で実測して求めた値（A3ヨコ・印刷幅404mm）。
 *
 *   印刷できる高さ : A3ヨコ297mm − 上下余白16mm ≒ 1,062px（96dpi）→ 余裕を見て1,050px
 *   行数で変わらない部分 : 題字・帯見出し・合計欄・削減効果で約1,161px
 *   明細1行あたり : 約26.6px
 *     実測 1台1,294px / 2台1,425px / 4台1,691px / 8台2,222px / 16台3,285px
 *     （1台あたり リース1行＋カウンター4行＝5行で約133px）
 */
const SHRINKABLE_BUDGET_PX = 1_050;
const BLOCK_HEIGHT_PX = 1_161;
const ROW_HEIGHT_PX = 26.6;

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
  seal?: string,
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
    <div class="cover-top">${brandBar(settings, logo, quote, p.quoteNo, seal)}</div>
    <div class="cover-mid">
      <div><span class="to">${esc(quote.customerName)} ${esc(quote.customerHonorific)}</span></div>
      <h1>${esc(title)}</h1>
      <div class="lead">${esc(doc.lead?.trim() || base.lead)}</div>
    </div>
    <div class="cover-foot">
      <div class="small muted">${esc(jpDate(quote.quoteDate))}</div>
      ${companyBlock(settings, logo, seal)}
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
    ${salesEffectBlock(calc.diffYearly)}`
        : ""
    }

    ${counterOnlyNote(calc)}

    <div class="notes" style="margin-top:18px">${esc(
      doc.closing?.trim() ||
        "ご不明な点やご要望がございましたら、何なりとお申し付けください。\n何卒ご検討のほど、よろしくお願い申し上げます。",
    )}</div>
    <div style="margin-top:22px;display:flex;justify-content:flex-end">${companyBlock(settings, logo, seal)}</div>
  </div>`;

  return page(`ご提案書_${quote.customerName}_${makerJp(p.maker)}`, cover + flow + optionPage + effect, {
    css: DOC_CSS,
    bodyClass: "doc",
  });
}
