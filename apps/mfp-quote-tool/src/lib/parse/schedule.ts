import type { LeaseReading } from "../types";
import type { ExtractedDoc } from "./extract";
import { addMonths, kanaKey, parseJpDate, parseNumber, remainingMonths, toHalfWidth } from "./normalize";

/**
 * リース支払予定表の読み取り。
 * 「回数 / 支払日 / リース料 / 残債」が並ぶ表から、
 * 月額・支払回数・開始日・満了日・残債（未経過リース料）を組み立てる。
 * 契約書が手元に無く支払予定表だけ預かる場合が多いため、独立した読み取りにしている。
 */

interface ScheduleRow {
  no: number;
  date?: string;
  amount?: number;
  balance?: number;
}

const LESSOR_NAMES = [
  "アプラス",
  "三菱HCキャピタル",
  "東京センチュリー",
  "オリックス",
  "芙蓉総合リース",
  "JA三井リース",
  "NECキャピタルソリューション",
  "リコーリース",
  "みずほリース",
  "NTTファイナンス",
  "日立キャピタル",
  "富士通リース",
  "西日本リース",
  "セイコーリース",
];

/** この書類が支払予定表らしいか */
export function looksLikeSchedule(doc: ExtractedDoc): boolean {
  const text = toHalfWidth(doc.text);
  if (/(支払予定表|返済予定表|償還予定表|お支払い予定|支払明細表|リース料支払予定)/.test(text)) return true;
  // 見出しが崩れていても「回数」「支払日」「残債」が揃っていれば予定表とみなす
  const hints = [/回数|回目/, /支払日|引落日|入金日/, /残債|残高|未経過/];
  return hints.filter((h) => h.test(text)).length >= 2;
}

/**
 * 予定表の1行を解釈する。
 * OCRでは行頭の回数が欠けたり罫線が記号に化けたりするので、
 * 「支払日らしいもの＋金額」が並んでいれば行とみなし、回数は後で番号を振り直す。
 */
function parseRow(line: string): ScheduleRow | null {
  // 罫線が「|」などに化けて行頭に付くことがあるため、数字の手前の記号は落とす
  const s = toHalfWidth(line).replace(/^[^0-9A-Za-z぀-ヿ一-鿿]{0,4}/, "");

  const noMatch = s.match(/^\s*(\d{1,3})\s*(?:回目?)?(?![\d,.-])/);
  const no = noMatch ? Number(noMatch[1]) : undefined;
  const rest = noMatch ? s.slice(noMatch[0].length) : s;

  // 日付は先に取り除く。年（2024など）を金額と誤認しないため
  const dateMatch = rest.match(
    /(?:令和|平成|昭和|[RHS])?\s*\d{1,4}\s*[年./-]\s*\d{1,2}\s*[月./-]\s*\d{1,2}\s*日?/,
  );
  const date = dateMatch ? parseJpDate(dateMatch[0]) : undefined;
  let withoutDate = dateMatch ? rest.replace(dateMatch[0], " ") : rest;

  // 「2026年8月27日」が数字列に潰れた列（202648278 / 20264-98278 など）も
  // 日付として扱い、金額の候補からは除く
  const squashed = [...withoutDate.matchAll(/\b20\d{2}[\d\-./]{2,9}\d\b/g)].find(
    (m) => m[0].replace(/\D/g, "").length >= 6,
  );
  const hasDateLike = !!date || !!squashed;
  if (squashed) withoutDate = withoutDate.replace(squashed[0], " ");

  const amounts = [...withoutDate.matchAll(/[\d,]{3,}/g)]
    .map((m) => parseNumber(m[0]))
    .filter((n): n is number => n !== undefined && n >= 1000 && n < 50_000_000);

  // 支払日と金額の両方が無い行は表の行ではない
  if (!hasDateLike || amounts.length === 0) return null;
  if (no !== undefined && (no < 1 || no > 200)) return null;

  // 金額列は「リース料 … 残債」の順が一般的。最大値を残債とみなす
  const amount = amounts[0];
  const balance = amounts.length > 1 ? Math.max(...amounts.slice(1)) : undefined;
  return { no: no as number, date, amount, balance };
}

/**
 * 回数が読めなかった行に番号を振る。
 * 予定表は1行1回ずつ連番なので、読めた行を起点に前後へ番号を伸ばせる。
 */
function fillMissingNumbers(rows: ScheduleRow[]): boolean {
  const known = rows.findIndex((r) => Number.isFinite(r.no));
  if (known === -1) {
    // 1つも読めなければ先頭から連番とみなす（絶対位置は分からない）
    rows.forEach((r, i) => (r.no = i + 1));
    return false;
  }
  for (let i = known - 1; i >= 0; i--) if (!Number.isFinite(rows[i].no)) rows[i].no = rows[i + 1].no - 1;
  for (let i = known + 1; i < rows.length; i++) if (!Number.isFinite(rows[i].no)) rows[i].no = rows[i - 1].no + 1;
  return true;
}

/**
 * 支払日が読み取れなかった行を、読み取れた行から補完する。
 * 支払は毎月1回なので「回数の差＝月数の差」で埋められる。
 */
function fillMissingDates(rows: ScheduleRow[]): void {
  const dated = rows.filter((r) => r.date);
  if (!dated.length) return;
  // 他の行と月数の整合が取れる行を基準にする（1行だけ大きく崩れた場合の保険）
  const anchor =
    dated.find((a) =>
      dated.filter((b) => b !== a && monthsApart(a, b)).length >= Math.max(1, dated.length - 2),
    ) ?? dated[0];
  for (const row of rows) {
    if (!row.date) row.date = addMonths(anchor.date!, row.no - anchor.no);
  }
}

/** 2行の「回数の差」と「支払日の月数差」が一致するか */
function monthsApart(a: ScheduleRow, b: ScheduleRow): boolean {
  const [ay, am] = a.date!.split("-").map(Number);
  const [by, bm] = b.date!.split("-").map(Number);
  return (by - ay) * 12 + (bm - am) === b.no - a.no;
}

/** 最頻値（同数なら小さい方） */
function mode(values: number[]): number | undefined {
  if (!values.length) return undefined;
  const counts = new Map<number, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0][0];
}

export function parseSchedule(doc: ExtractedDoc, today = new Date()): LeaseReading | null {
  const lines = doc.lines.map(toHalfWidth);
  if (!lines.length) return null;

  const rows: ScheduleRow[] = [];
  const evidence: string[] = [];
  for (const line of lines) {
    const row = parseRow(line);
    if (row) {
      rows.push(row);
      if (evidence.length < 6) evidence.push(line);
    }
  }
  // 表として成立しない（数行しか拾えない）場合は支払予定表として扱わない
  if (rows.length < 4) return null;
  const numbersKnown = fillMissingNumbers(rows);

  const joinedText = lines.join("\n");
  const amounts = rows.map((r) => r.amount).filter((n): n is number => n !== undefined);

  // 月額は表の最頻値を基本にする。表に何度も現れる値の方がOCRの誤りに強い
  const feeLabel = joinedText.match(/(?:月額リース料|リース料\s*\(?月額\)?|毎月のお支払[額い]?)\s*[:：]?\s*[¥\\]?\s*([\d,]+)/);
  const feeMode = mode(amounts);
  const feeModeCount = feeMode ? amounts.filter((a) => a === feeMode).length : 0;
  const monthlyFee = feeModeCount >= 3 ? feeMode : (parseNumber(feeLabel?.[1]) ?? feeMode);

  // 支払回数も見出し優先（表が途中のページだけの場合に効く）
  // 「60回」の"回"がOCRで別の字に化けることがあるため、単位は1文字まで緩める
  const termLabel = joinedText.match(/(?:支払回数|リース期間)\s*[:：]?\s*(\d{1,3})\s*[^\d\s,.]?/);
  const labeledTerm = Number(termLabel?.[1]);
  const maxNo = Math.max(...rows.map((r) => r.no));
  const term = labeledTerm >= 12 && labeledTerm <= 120 ? labeledTerm : maxNo;

  // OCRで一部の支払日が崩れても、毎月払いであることを利用して残りを補う
  fillMissingDates(rows);
  const withDate = rows.filter((r) => r.date);

  // 回数が1つも読めていない場合、絶対位置が分からないので開始日は出さない
  const firstRow = [...withDate].sort((a, b) => a.no - b.no)[0];
  const startDate = numbersKnown && firstRow ? addMonths(firstRow.date!, -(firstRow.no - 1)) : undefined;
  const endDate = startDate ? addMonths(startDate, term - 1) : undefined;

  // 残債: 明示ラベルがあればそれを、無ければ今日以降で最初に来る回の残高
  let remainingDebt: number | undefined;
  for (const line of lines) {
    const m = line.match(/(?:残債|残高|未経過リース料|一括精算額)\s*[:：]?\s*[¥\\]?\s*([\d,]{4,})/);
    if (m) {
      remainingDebt = parseNumber(m[1]);
      evidence.push(line);
      break;
    }
  }
  if (remainingDebt === undefined) {
    const iso = today.toISOString().slice(0, 10);
    const next = withDate.filter((r) => r.date! >= iso).sort((a, b) => a.no - b.no)[0];
    remainingDebt = next?.balance;
  }

  // 残回数は満了日から数える（表が途中のページだけでも正しく出せる）
  const remainingTerm = endDate
    ? remainingMonths(endDate, today)
    : withDate.filter((r) => r.date! >= today.toISOString().slice(0, 10)).length || undefined;

  const joined = lines.join("\n");
  // OCRは濁点を取り違えやすいので、濁点を無視したキーで照合する
  const joinedKana = kanaKey(joined);
  const lessor = LESSOR_NAMES.find((n) => joined.includes(n) || joinedKana.includes(kanaKey(n)));
  const contractNo = joined.match(/(?:契約番号|契約No\.?|お客様番号)\s*[:：]?\s*([A-Z0-9-]{4,})/i)?.[1];

  let score = 1; // 表として読めている時点で一定の確度
  if (monthlyFee) score += 1;
  if (startDate && endDate) score += 1;
  if (remainingDebt) score += 0.5;

  return {
    lessor,
    contractNo,
    monthlyFee,
    term: term >= 12 && term <= 120 ? term : undefined,
    startDate,
    endDate,
    remainingDebt,
    remainingTerm,
    confidence: Math.min(1, score / 3),
    evidence,
  };
}
