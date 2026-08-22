import type {
  CounterBreakdown,
  CounterTier,
  CounterUnits,
  CurrentCalc,
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

  return {
    mono,
    color,
    twoColor: round2(color * settings.twoColorRatio),
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

/** カウンター請求額の内訳 */
export function calcCounter(
  units: CounterUnits,
  volume: { monoPages: number; colorPages: number; twoColorPages: number },
): CounterBreakdown {
  const monoAmount = volume.monoPages * units.mono;
  const colorAmount = volume.colorPages * units.color;
  const twoColorAmount = volume.twoColorPages * units.twoColor;
  const sum = monoAmount + colorAmount + twoColorAmount;
  const minChargeApplied = units.minCharge > 0 && sum < units.minCharge;
  return {
    monoAmount: Math.round(monoAmount),
    colorAmount: Math.round(colorAmount),
    twoColorAmount: Math.round(twoColorAmount),
    minChargeApplied,
    total: Math.round(minChargeApplied ? units.minCharge : sum),
  };
}

/** 現行機の月間経費 */
export function calcCurrent(quote: Quote, taxRate: number): CurrentCalc {
  const c = quote.current;
  const counter = calcCounter(c.units, c);
  const running = c.monthlyLease + counter.total + c.maintenanceMonthly;
  const tax = Math.round(running * taxRate);
  return {
    monthlyLease: c.monthlyLease,
    counter,
    maintenanceMonthly: c.maintenanceMonthly,
    running: Math.round(running),
    tax,
    monthlyTotal: Math.round(running + tax),
    totalPages: c.monoPages + c.colorPages + c.twoColorPages,
  };
}

/**
 * PTF（代理店報酬）。
 * 既定は「本体価格の10%」。オプション（フィニッシャー・ICカードリーダー等）や
 * 追加のPC設定作業として本体価格に上乗せした分には料率を適用しない。
 */
export function calcPtf(
  rule: PtfRule,
  args: { grossProfit: number; sellingTotal: number; sellingBase: number; monthlyCounter: number },
): number {
  let base = 0;
  if (rule.base === "bodyPrice") base = Math.max(0, args.sellingBase) * rule.rate;
  else if (rule.base === "grossProfit") base = Math.max(0, args.grossProfit) * rule.rate;
  else if (rule.base === "sellingPrice") base = Math.max(0, args.sellingTotal) * rule.rate;

  const counter = rule.counter.enabled
    ? args.monthlyCounter * rule.counter.rate * rule.counter.months
    : 0;

  let total = base + counter + rule.fixed;
  if (rule.cap > 0) total = Math.min(total, rule.cap);
  return roundTo(Math.max(0, total), rule.roundUnit || 1);
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
  const debtSettlement = {
    remainingDebt,
    cancellationFee,
    months: debt.cancellationMonths,
    total: Math.round(remainingDebt + cancellationFee),
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
    sellingBase = proposal.sellingTotal ?? 0;
  }
  // GP指定は「仕切＋GP」がそのまま金額になるべきなので端数処理しない
  sellingBase =
    proposal.pricingMode === "fromGp"
      ? Math.max(0, Math.round(sellingBase))
      : roundTo(Math.max(0, sellingBase), settings.roundUnit);

  const sellingTotal = sellingBase + addOnTotal + debtSettlement.total;
  // 値引きは機器の見積明細に対する調整。残債精算は値引きの対象にしない
  const discount = sellingBase + addOnTotal - listTotal;
  const tax = Math.round(sellingTotal * taxRate);

  const leaseByTerm: Record<number, number> = {};
  for (const [term, rate] of Object.entries(settings.leaseRates)) {
    leaseByTerm[Number(term)] = Math.round(sellingTotal * rate);
  }
  const monthlyLease = leaseByTerm[targetTerm] ?? Math.round(sellingTotal * leaseRate);

  // カウンター単価
  const currentCounterAmount = calcCounter(quote.current.units, quote.current).total;
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

  // 提案後の印刷枚数は現行実績をそのまま使う（同じ枚数を刷る前提での比較）
  const counter = calcCounter(units, quote.current);

  const running = monthlyLease + counter.total + proposal.maintenanceMonthly;
  const runningTax = Math.round(running * taxRate);
  const monthlyTotal = Math.round(running + runningTax);

  const current = calcCurrent(quote, taxRate);
  const diffMonthly = monthlyTotal - current.monthlyTotal;

  // 残債精算はリース会社へ支払う立替分なので粗利には含めない
  const grossProfit = sellingBase + addOnTotal - cost;
  const ptf = calcPtf(settings.ptf, {
    grossProfit,
    sellingTotal,
    sellingBase,
    monthlyCounter: counter.total,
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
    diffMonthly,
    diffYearly: diffMonthly * 12,
    diffSixYears: diffMonthly * 72,
    cost,
    grossProfit: Math.round(grossProfit),
    ptf,
    netProfit: Math.round(grossProfit - ptf),
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
