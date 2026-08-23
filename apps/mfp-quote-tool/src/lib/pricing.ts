import { calcOptions } from "./proposal-doc";
import type {
  ChargeLineCalc,
  CounterBreakdown,
  CounterTier,
  CounterUnits,
  CurrentCalc,
  CurrentChargeLine,
  DeviceSpec,
  Maker,
  MakerNote,
  PriceBookEntry,
  Proposal,
  ProposalCalc,
  PtfRule,
  Quote,
  ServiceRank,
  Settings,
} from "./types";

/** 端数処理 */
export function roundTo(value: number, unit: number): number {
  if (!unit || unit <= 1) return Math.round(value);
  return Math.round(value / unit) * unit;
}

/** 端数の切り上げ（月額リース料に使う。16,080円 → 16,100円） */
export function ceilTo(value: number, unit: number): number {
  if (!unit || unit <= 1) return Math.ceil(value);
  return Math.ceil(value / unit) * unit;
}

/** 明細（定価）の合計 */
export function sumItems(items: { qty: number; unitPrice: number }[]): number {
  return items.reduce((s, i) => s + i.qty * i.unitPrice, 0);
}

/** 支払回数に対応するリース料率 */
export function leaseRateOf(term: number, rates: Record<string, number>): number {
  const r = rates[String(term)];
  if (r !== undefined) return r;
  const keys = Object.keys(rates).map(Number).filter(Number.isFinite);
  if (!keys.length) return 0;
  const nearest = keys.sort((a, b) => Math.abs(a - term) - Math.abs(b - term))[0];
  return rates[String(nearest)];
}

/** 判定値（カラー枚数 or 現行カウンター額）から単価段を選ぶ */
export function pickTier(tiers: CounterTier[], value: number): CounterTier | undefined {
  return tiers.find((t) => value >= t.min && (t.max === null || value <= t.max));
}

/**
 * 提案カウンター単価の自動判定。
 *  1. 設定の基準（カラー枚数 or 現行カウンター額）で単価段を選ぶ
 *  2. メーカーごとの交渉レンジに収める
 *  3. 保守対応ランク S/A（当日対応可）は印刷枚数が少なくても基準単価（0.7/7.0）まで出せる
 *  4. ランク B 以下・離島・僻地エリアはレンジ上限側に寄せる
 */
export function autoCounterUnits(
  settings: Settings,
  quote: Quote,
  maker: Maker,
  makerNote?: MakerNote,
  currentCounterAmount?: number,
  serviceRank?: ServiceRank,
  isIsland = false,
): CounterUnits {
  const basisValue =
    settings.counterBasis === "counterAmount"
      ? (currentCounterAmount ?? 0)
      : quote.current.colorPages;
  const tiers =
    settings.counterBasis === "counterAmount"
      ? settings.counterTiersByAmount
      : settings.counterTiersByColorVolume;
  const tier = pickTier(tiers, basisValue) ?? tiers[0];

  const area = settings.areas.find((a) => a.name === quote.area);
  const sameDay = serviceRank === "S" || serviceRank === "A";
  const hardArea = isIsland || serviceRank === "B" || serviceRank === "C" || serviceRank === "D";
  let mono = tier?.mono ?? 0;
  let color = tier?.color ?? 0;

  if (makerNote) {
    const [monoMin, monoMax] = makerNote.counterMono;
    const [colorMin, colorMax] = makerNote.counterColor;
    if ((area?.remote || hardArea) && !sameDay) {
      // 翌日対応以降・離島・僻地はメーカーレンジの上限側（＝交渉が通りにくい前提）
      mono = Math.max(mono, monoMax);
      color = Math.max(color, colorMax);
    } else {
      mono = Math.min(Math.max(mono, monoMin), monoMax);
      color = Math.min(Math.max(color, colorMin), colorMax);
    }
  }

  // 当日対応エリアは枚数が少なくても基準単価まで出せる
  if (sameDay) {
    mono = Math.min(mono, settings.sameDayBaseUnits.mono);
    color = Math.min(color, settings.sameDayBaseUnits.color);
  }

  mono = round2(mono + (area?.monoAdd ?? 0));
  color = round2(color + (area?.colorAdd ?? 0));

  // 2色カラーはメーカー別の運用値を優先する（京セラは2.0円）
  const twoColorFixed = settings.twoColorUnitByMaker?.[maker];
  return {
    mono,
    color,
    twoColor: twoColorFixed ?? round2(color * settings.twoColorRatio),
    minCharge: makerNote?.minCharge ?? settings.defaultMinCharge,
  };
}

/** 保守対応ランク・離島区分から提案上の注意文を作る */
export function serviceWarningOf(rank?: ServiceRank, island?: string): string | undefined {
  const notes: string[] = [];
  if (rank === "B") notes.push("保守はランクB（翌日対応）のエリアです。当日保守ができず、カウンター単価も高くなりやすいため提案が難しいエリアです。");
  if (rank === "C") notes.push("保守はランクC（翌々日以降の対応）のエリアです。当日保守ができず、カウンター単価も高くなりやすいため提案が難しいエリアです。");
  if (rank === "D") notes.push("保守はランクD（対応不可）のエリアです。このメーカーでの提案はできません。");
  if (island) notes.push(`離島区分：${island}。保守訪問に追加費用・日数がかかる場合があります。`);
  return notes.length ? notes.join("\n") : undefined;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * 一律控除（ミスプリント控除など）を効かせた請求枚数。
 * 控除カウントは明細の慣習に合わせて切り上げる。
 */
export function deductPages(pages: number, rate?: number): { billable: number; deduction: number } {
  const p = Math.max(0, Math.round(pages || 0));
  if (!rate || rate <= 0) return { billable: p, deduction: 0 };
  const deduction = Math.ceil(p * rate);
  return { billable: Math.max(0, p - deduction), deduction };
}

/**
 * カウンター請求額の内訳。
 *
 * deductionRate は「ミスプリント1%控除」「2%控除」のように、
 * 印刷枚数そのものが一律で差し引かれる現行契約の控除。
 * 当社の提案にはこの控除が無いので、提案側では渡さない
 * （＝実枚数のまま計算し、控除ありの現行と正しく比べる）。
 */
export function calcCounter(
  units: CounterUnits,
  volume: { monoPages: number; colorPages: number; twoColorPages: number },
  deductionRate?: number,
): CounterBreakdown {
  const mono = deductPages(volume.monoPages, deductionRate);
  const color = deductPages(volume.colorPages, deductionRate);
  const twoColor = deductPages(volume.twoColorPages, deductionRate);

  const monoAmount = mono.billable * units.mono;
  const colorAmount = color.billable * units.color;
  const twoColorAmount = twoColor.billable * units.twoColor;
  const sum = monoAmount + colorAmount + twoColorAmount;
  const minChargeApplied = units.minCharge > 0 && sum < units.minCharge;
  return {
    monoAmount: Math.round(monoAmount),
    colorAmount: Math.round(colorAmount),
    twoColorAmount: Math.round(twoColorAmount),
    minChargeApplied,
    total: Math.round(minChargeApplied ? units.minCharge : sum),
    deduction:
      deductionRate && deductionRate > 0
        ? {
            rate: deductionRate,
            mono: mono.deduction,
            color: color.deduction,
            twoColor: twoColor.deduction,
            total: mono.deduction + color.deduction + twoColor.deduction,
            billable: { mono: mono.billable, color: color.billable, twoColor: twoColor.billable },
          }
        : undefined,
  };
}

/**
 * 逓減単価（パフォーマンスチャージ）の1区分を計算する。
 *
 * 明細と1円まで合わせるため、次の順番と丸め方に従う。
 *   1. 控除カウント = カウント × 控除率（切り上げ）
 *   2. 請求カウント = カウント − 控除カウント
 *   3. 段は上の帯から順に埋め、帯ごとに金額を出して小数を切り捨てる
 * 先に合計してから丸めると、明細と1円ずれる。
 */
export function calcChargeLine(line: CurrentChargeLine): ChargeLineCalc {
  const pages = Math.max(0, Math.round(line.pages));
  const deduction = line.deductionRate ? Math.ceil(pages * line.deductionRate) : 0;
  const billablePages = Math.max(0, pages - deduction);

  const tiers = [...line.tiers].sort((a, b) => a.from - b.from);
  const bands: ChargeLineCalc["bands"] = [];
  let remaining = billablePages;
  let amount = 0;

  for (const tier of tiers) {
    if (remaining <= 0) break;
    // 帯の幅（上限なしの帯は残り全部）
    const width = tier.to === null ? remaining : Math.max(0, tier.to - tier.from + 1);
    const take = Math.min(remaining, width);
    if (take <= 0) continue;
    const bandAmount = Math.floor(take * tier.unit);
    bands.push({
      label: tier.to === null ? `${tier.from.toLocaleString()}枚〜` : `${tier.from.toLocaleString()}〜${tier.to.toLocaleString()}枚`,
      pages: take,
      unit: tier.unit,
      amount: bandAmount,
    });
    amount += bandAmount;
    remaining -= take;
  }

  // 帯を使い切ってもまだ残る場合は、最後の帯の単価で計算する
  if (remaining > 0 && tiers.length) {
    const last = tiers[tiers.length - 1];
    const bandAmount = Math.floor(remaining * last.unit);
    bands.push({ label: `${last.from.toLocaleString()}枚〜`, pages: remaining, unit: last.unit, amount: bandAmount });
    amount += bandAmount;
  }

  const effectiveUnit = pages > 0 ? Math.round((amount / pages) * 100) / 100 : 0;
  const amountDiff = line.amount !== undefined ? amount - line.amount : undefined;

  return {
    name: line.name,
    kind: line.kind,
    pages,
    deduction,
    billablePages,
    bands,
    amount,
    effectiveUnit,
    amountDiff,
  };
}

export function calcChargeLines(lines: CurrentChargeLine[]): ChargeLineCalc[] {
  return lines.map(calcChargeLine);
}

/** 現行機の月間経費 */
export function calcCurrent(quote: Quote, taxRate: number): CurrentCalc {
  const c = quote.current;
  // 逓減単価の明細を読み取っている場合は、そちらを正としてカウンター請求額を出す
  const chargeLines = c.chargeLines?.length ? calcChargeLines(c.chargeLines) : undefined;
  // 明細の区分ごとに控除が入っている場合は chargeLines 側で控除済みなので、
  // 一律控除（c.deductionRate）は単価×枚数で計算するときにだけ効かせる
  const counter = chargeLines
    ? chargeBreakdown(chargeLines, c.units)
    : calcCounter(c.units, c, c.deductionRate);
  // リース料金が分からない案件は、リース料を0円として扱わずに比較から外す。
  // 0円として扱うと、削減額を実際より大きく見せてしまう。
  const leaseUnknown = Boolean(c.leaseUnknown);
  const monthlyLease = leaseUnknown ? 0 : c.monthlyLease;
  const running = monthlyLease + counter.total + c.maintenanceMonthly;
  const tax = Math.round(running * taxRate);
  const comparableRunning = leaseUnknown ? counter.total + c.maintenanceMonthly : running;
  return {
    monthlyLease,
    leaseUnknown,
    counter,
    chargeLines,
    maintenanceMonthly: c.maintenanceMonthly,
    running: Math.round(running),
    tax,
    monthlyTotal: Math.round(running + tax),
    comparable: Math.round(comparableRunning * (1 + taxRate)),
    totalPages: chargeLines
      ? chargeLines.reduce((sum, l) => sum + l.pages, 0)
      : c.monoPages + c.colorPages + c.twoColorPages,
  };
}

/** 逓減単価の行から、従来どおりの3区分の内訳にまとめ直す */
function chargeBreakdown(lines: ChargeLineCalc[], units: CounterUnits): CounterBreakdown {
  const sumOf = (kind: ChargeLineCalc["kind"]) =>
    lines.filter((l) => l.kind === kind).reduce((sum, l) => sum + l.amount, 0);
  const sum = lines.reduce((total, l) => total + l.amount, 0);
  const minChargeApplied = units.minCharge > 0 && sum < units.minCharge;

  // 区分ごとの控除も、全体としてどれだけ引かれているかを見せられるようにまとめる
  const deductedPages = (kind: ChargeLineCalc["kind"]) =>
    lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.deduction, 0);
  const billableOf = (kind: ChargeLineCalc["kind"]) =>
    lines.filter((l) => l.kind === kind).reduce((s, l) => s + l.billablePages, 0);
  const totalPages = lines.reduce((s, l) => s + l.pages, 0);
  const totalDeduction = lines.reduce((s, l) => s + l.deduction, 0);

  return {
    monoAmount: sumOf("mono"),
    colorAmount: sumOf("color") + sumOf("other"),
    twoColorAmount: sumOf("twoColor"),
    minChargeApplied,
    total: Math.round(minChargeApplied ? units.minCharge : sum),
    deduction: totalDeduction
      ? {
          rate: totalPages > 0 ? Math.round((totalDeduction / totalPages) * 10_000) / 10_000 : 0,
          mono: deductedPages("mono"),
          color: deductedPages("color") + deductedPages("other"),
          twoColor: deductedPages("twoColor"),
          total: totalDeduction,
          billable: {
            mono: billableOf("mono"),
            color: billableOf("color") + billableOf("other"),
            twoColor: billableOf("twoColor"),
          },
        }
      : undefined,
  };
}

/**
 * PTF（代理店報酬）。
 * 既定は「本体価格の10%」。オプション（フィニッシャー・ICカードリーダー等）や
 * 追加のPC設定作業として本体価格に上乗せした分には料率を適用しない。
 */
/**
 * PTF（代理店報酬）。
 * 代理店が2社入る案件では、1社目に rate（10%）、2社目に secondRate（2%）を払い出す。
 * 2社目には固定額・カウンター報酬・上限は掛けず、料率ぶんだけを計算する。
 */
export function calcPtf(
  rule: PtfRule,
  args: {
    grossProfit: number;
    sellingTotal: number;
    sellingBase: number;
    monthlyCounter: number;
    twoAgencies?: boolean;
  },
): { primary: number; second: number; total: number } {
  const baseAmount =
    rule.base === "bodyPrice"
      ? Math.max(0, args.sellingBase)
      : rule.base === "grossProfit"
        ? Math.max(0, args.grossProfit)
        : rule.base === "sellingPrice"
          ? Math.max(0, args.sellingTotal)
          : 0;

  const counter = rule.counter.enabled
    ? args.monthlyCounter * rule.counter.rate * rule.counter.months
    : 0;

  let primary = baseAmount * rule.rate + counter + rule.fixed;
  if (rule.cap > 0) primary = Math.min(primary, rule.cap);
  primary = roundTo(Math.max(0, primary), rule.roundUnit || 1);

  const second = args.twoAgencies
    ? roundTo(Math.max(0, baseAmount * (rule.secondRate ?? 0)), rule.roundUnit || 1)
    : 0;

  return { primary, second, total: primary + second };
}

/** 1提案の見積・月額・収益をまとめて計算 */
export function calcProposal(
  quote: Quote,
  proposal: Proposal,
  settings: Settings,
  ctx: {
    device?: DeviceSpec;
    currentDevice?: DeviceSpec;
    priceBook?: PriceBookEntry;
    makerNote?: MakerNote;
    serviceRank?: ServiceRank;
    island?: string;
  } = {},
): ProposalCalc {
  const taxRate = settings.company.taxRate;
  const qty = Math.max(1, proposal.qty);
  const listTotal = sumItems(proposal.items) * qty;
  // オプション・追加PC設定の上乗せ分（PTF対象外。値引きせずそのまま加算する）
  const addOnTotal = sumItems(proposal.items.filter((i) => i.ptfExempt)) * qty;
  const cost = (proposal.cost ?? ctx.priceBook?.cost ?? 0) * qty;

  // 旧リースの残債精算（残債 + 現行リース料×解約事務手数料の月数）も
  // 新しいリースに含めるため、上乗せ分として扱う（PTFの対象外）
  const debt = settings.debtSettlement;
  const remainingDebt = debt.includeInQuote ? (quote.current.remainingDebt ?? 0) : 0;
  const cancellationFee = remainingDebt > 0 ? quote.current.monthlyLease * debt.cancellationMonths : 0;
  // 見積書では「現行リース料 × 月数」の形で見せるため、残債を月数に直しておく
  const currentMonthly = quote.current.monthlyLease;
  const remainingMonths =
    remainingDebt > 0 && currentMonthly > 0 ? Math.round(remainingDebt / currentMonthly) : 0;
  const debtSettlement = {
    remainingDebt,
    cancellationFee,
    months: debt.cancellationMonths,
    total: Math.round(remainingDebt + cancellationFee),
    monthlyLease: currentMonthly,
    remainingMonths,
    totalMonths: remainingDebt > 0 ? remainingMonths + debt.cancellationMonths : 0,
  };

  // 本体価格（PTFの対象）の決定
  let sellingBase = 0;
  const targetTerm = proposal.leaseTerm;
  const leaseRate = leaseRateOf(targetTerm, settings.leaseRates);
  if (proposal.pricingMode === "fromGp") {
    // 仕切価格に粗利額をそのまま加える
    sellingBase = cost + (proposal.grossProfitAmount ?? 0);
  } else if (proposal.pricingMode === "fromLease") {
    // 目標月額から逆算した総額から、上乗せ分を差し引いた残りが本体価格
    const total = leaseRate > 0 ? (proposal.targetMonthlyLease ?? 0) / leaseRate : 0;
    sellingBase = total - addOnTotal - debtSettlement.total;
  } else if (proposal.pricingMode === "fromMargin") {
    const rate = Math.min(Math.max(proposal.marginRate ?? settings.defaultMarginRate, 0), 0.95);
    sellingBase = cost > 0 ? cost / (1 - rate) : 0;
  } else {
    // 本体価格を直接入力する方式。オプションと残債精算はこのあと加算する
    sellingBase = proposal.bodyPrice ?? proposal.sellingTotal ?? 0;
  }
  // 「仕切＋GP」と「本体価格を直接入力」は、入れた額がそのまま金額になるべきなので
  // 端数処理しない。逆算した額（目標リース料・粗利率）だけ端数を丸める。
  const asEntered = proposal.pricingMode === "fromGp" || proposal.pricingMode === "fromPrice";
  sellingBase = asEntered
    ? Math.max(0, Math.round(sellingBase))
    : roundTo(Math.max(0, sellingBase), settings.roundUnit);

  const sellingTotal = sellingBase + addOnTotal + debtSettlement.total;
  // 値引きは機器の見積明細に対する調整。残債精算は値引きの対象にしない
  const discount = sellingBase + addOnTotal - listTotal;
  const tax = Math.round(sellingTotal * taxRate);

  // 月額リース料は端数を切り上げる（設定の leaseRoundUnit 単位）
  const leaseUnit = settings.leaseRoundUnit ?? 1;
  const leaseByTerm: Record<number, number> = {};
  for (const [term, rate] of Object.entries(settings.leaseRates)) {
    leaseByTerm[Number(term)] = ceilTo(sellingTotal * rate, leaseUnit);
  }
  const monthlyLease = leaseByTerm[targetTerm] ?? ceilTo(sellingTotal * leaseRate, leaseUnit);

  // カウンター単価。単価段の判定には、控除も反映した実際の請求額を使う
  const current = calcCurrent(quote, taxRate);
  const currentCounterAmount = current.counter.total;
  const counterAuto = !proposal.counterOverridden;
  const autoUnits = autoCounterUnits(
    settings,
    quote,
    proposal.maker,
    ctx.makerNote,
    currentCounterAmount,
    ctx.serviceRank,
    !!ctx.island,
  );
  const units = counterAuto ? autoUnits : (proposal.units ?? autoUnits);

  // 提案後の印刷枚数は現行実績をそのまま使う（同じ枚数を刷る前提での比較）。
  // 現行契約にミスプリント控除が付いていても、当社の提案には控除が無いので
  // ここでは控除率を渡さず、実枚数のまま計算する。
  const counter = calcCounter(units, quote.current);

  const running = monthlyLease + counter.total + proposal.maintenanceMonthly;
  const runningTax = Math.round(running * taxRate);
  const monthlyTotal = Math.round(running + runningTax);

  // 現行のリース料金が分からない案件は、両側ともリース料を除いて
  // カウンター料金だけで比べる（片側だけ含めると比較にならない）
  const counterOnly = current.leaseUnknown;
  const comparableRunning = counterOnly ? counter.total + proposal.maintenanceMonthly : running;
  const comparable = Math.round(comparableRunning * (1 + taxRate));
  const diffMonthly = comparable - current.comparable;

  // 残債精算はリース会社へ支払う立替分なので粗利には含めない
  const grossProfit = sellingBase + addOnTotal - cost;
  const ptf = calcPtf(settings.ptf, {
    grossProfit,
    sellingTotal,
    sellingBase,
    monthlyCounter: counter.total,
    twoAgencies: proposal.twoAgencies,
  });

  return {
    proposal,
    device: ctx.device,
    currentDevice: ctx.currentDevice,
    priceBook: ctx.priceBook,
    listTotal,
    sellingBase,
    addOnTotal,
    debtSettlement,
    sellingTotal,
    discount,
    tax,
    sellingTotalWithTax: sellingTotal + tax,
    leaseByTerm,
    leaseRate,
    monthlyLease,
    units,
    counterAuto,
    serviceRank: ctx.serviceRank,
    serviceWarning: serviceWarningOf(ctx.serviceRank, ctx.island),
    minChargeNeedsInput: ctx.makerNote?.minCharge === null || ctx.makerNote?.minCharge === undefined,
    counter,
    maintenanceMonthly: proposal.maintenanceMonthly,
    running: Math.round(running),
    runningTax,
    monthlyTotal,
    counterOnly,
    comparable,
    diffMonthly,
    diffYearly: diffMonthly * 12,
    // 削減額の最後の1行は、提案するリース年数に合わせる（6年リースなら6年間）
    diffLeaseTerm: diffMonthly * targetTerm,
    leaseYears: Math.round(targetTerm / 12),
    cost,
    grossProfit: Math.round(grossProfit),
    ptf: ptf.total,
    ptfBreakdown: { primary: ptf.primary, second: ptf.second },
    netProfit: Math.round(grossProfit - ptf.total),
    // 提案資料に載せるオプション（付けた場合の月額リース料の増加額つき）
    options: calcOptions(proposal, ctx.device, settings),
  };
}

/** 月間総印刷枚数から推奨する〇〇枚機を返す */
export function recommendGrade(settings: Settings, totalPages: number): number {
  const sorted = [...settings.gradeTiers].sort((a, b) => b.minPages - a.minPages);
  return sorted.find((t) => totalPages >= t.minPages)?.ppm ?? sorted[sorted.length - 1]?.ppm ?? 25;
}

/** 推奨グレードに最も近い機種を仕切表から選ぶ */
export function recommendEntry(
  entries: PriceBookEntry[],
  maker: Maker,
  targetPpm: number,
  category = "A3カラー",
): PriceBookEntry | undefined {
  const candidates = entries.filter((e) => e.maker === maker && e.category === category);
  const pool = candidates.length ? candidates : entries.filter((e) => e.maker === maker);
  if (!pool.length) return undefined;
  // 推奨速度以上で最も近いもの。無ければ最速のもの
  const atOrAbove = pool.filter((e) => e.gradePpm >= targetPpm).sort((a, b) => a.gradePpm - b.gradePpm);
  return atOrAbove[0] ?? [...pool].sort((a, b) => b.gradePpm - a.gradePpm)[0];
}

export const yen = (n: number): string => `¥${Math.round(n).toLocaleString("ja-JP")}`;
export const pct = (n: number, digits = 2): string => `${(n * 100).toFixed(digits)}%`;
