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
 *  3. 僻地エリアはレンジ上限側に寄せる
 */
export function autoCounterUnits(
  settings: Settings,
  quote: Quote,
  maker: Maker,
  makerNote?: MakerNote,
  currentCounterAmount?: number,
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
  let mono = tier?.mono ?? 0;
  let color = tier?.color ?? 0;

  if (makerNote) {
    const [monoMin, monoMax] = makerNote.counterMono;
    const [colorMin, colorMax] = makerNote.counterColor;
    if (area?.remote) {
      // 僻地はメーカーレンジの上限側（＝交渉が通りにくい前提）
      mono = Math.max(mono, monoMax);
      color = Math.max(color, colorMax);
    } else {
      mono = Math.min(Math.max(mono, monoMin), monoMax);
      color = Math.min(Math.max(color, colorMin), colorMax);
    }
  }

  mono = round2(mono + (area?.monoAdd ?? 0));
  color = round2(color + (area?.colorAdd ?? 0));

  return {
    mono,
    color,
    twoColor: round2(color * settings.twoColorRatio),
    minCharge: settings.defaultMinCharge,
  };
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

/** PTF（代理店報酬） */
export function calcPtf(
  rule: PtfRule,
  args: { grossProfit: number; sellingTotal: number; monthlyCounter: number },
): number {
  let base = 0;
  if (rule.base === "grossProfit") base = Math.max(0, args.grossProfit) * rule.rate;
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
  } = {},
): ProposalCalc {
  const taxRate = settings.company.taxRate;
  const listTotal = sumItems(proposal.items) * Math.max(1, proposal.qty);
  const cost = (proposal.cost ?? ctx.priceBook?.cost ?? 0) * Math.max(1, proposal.qty);

  // 販売額計の決定
  let sellingTotal = 0;
  const targetTerm = proposal.leaseTerm;
  const leaseRate = leaseRateOf(targetTerm, settings.leaseRates);
  if (proposal.pricingMode === "fromLease") {
    sellingTotal = leaseRate > 0 ? (proposal.targetMonthlyLease ?? 0) / leaseRate : 0;
  } else if (proposal.pricingMode === "fromMargin") {
    const rate = Math.min(Math.max(proposal.marginRate ?? settings.defaultMarginRate, 0), 0.95);
    sellingTotal = cost > 0 ? cost / (1 - rate) : 0;
  } else {
    sellingTotal = proposal.sellingTotal ?? 0;
  }
  sellingTotal = roundTo(sellingTotal, settings.roundUnit);

  const discount = sellingTotal - listTotal;
  const tax = Math.round(sellingTotal * taxRate);

  const leaseByTerm: Record<number, number> = {};
  for (const [term, rate] of Object.entries(settings.leaseRates)) {
    leaseByTerm[Number(term)] = Math.round(sellingTotal * rate);
  }
  const monthlyLease = leaseByTerm[targetTerm] ?? Math.round(sellingTotal * leaseRate);

  // カウンター単価
  const currentCounterAmount = calcCounter(quote.current.units, quote.current).total;
  const counterAuto = !proposal.counterOverridden;
  const units = counterAuto
    ? autoCounterUnits(settings, quote, proposal.maker, ctx.makerNote, currentCounterAmount)
    : (proposal.units ?? autoCounterUnits(settings, quote, proposal.maker, ctx.makerNote, currentCounterAmount));

  // 提案後の印刷枚数は現行実績をそのまま使う（同じ枚数を刷る前提での比較）
  const counter = calcCounter(units, quote.current);

  const running = monthlyLease + counter.total + proposal.maintenanceMonthly;
  const runningTax = Math.round(running * taxRate);
  const monthlyTotal = Math.round(running + runningTax);

  const current = calcCurrent(quote, taxRate);
  const diffMonthly = monthlyTotal - current.monthlyTotal;

  const grossProfit = sellingTotal - cost;
  const ptf = calcPtf(settings.ptf, {
    grossProfit,
    sellingTotal,
    monthlyCounter: counter.total,
  });

  return {
    proposal,
    device: ctx.device,
    currentDevice: ctx.currentDevice,
    priceBook: ctx.priceBook,
    listTotal,
    sellingTotal,
    discount,
    tax,
    sellingTotalWithTax: sellingTotal + tax,
    leaseByTerm,
    leaseRate,
    monthlyLease,
    units,
    counterAuto,
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
