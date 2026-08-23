import { calcChargeLines } from "./pricing";
import type {
  CurrentChargeLine,
  Fleet,
  FleetCalc,
  FleetSide,
  FleetSideCalc,
  FleetTotals,
  FleetUnit,
  FleetUnitCalc,
} from "./types";

/**
 * 複数台（A3ヨコの複数台比較表）の計算。
 *
 * 1台ごとに
 *   リース料金（税抜）
 *   請求金額 = ( max(カウンター区分の合計, 最低基本料金) + 月額保守料金 ) × 消費税
 * を出し、台数ぶんを足し上げて現行と提案を比べる。
 *
 * 最低基本料金は「下回った月はその額になる」下限であって加算ではない。
 * 月額保守料金（理想科学のインクジェット等）は、カウンターとは別建てで加算する。
 */

/** 空の1台ぶん（画面で行を足したときの初期値） */
export function emptyFleetSide(): FleetSide {
  return {
    makerText: "",
    modelText: "",
    monthlyLease: 0,
    lines: [],
    minCharge: 0,
    maintenanceMonthly: 0,
  };
}

export function emptyFleetUnit(id: string): FleetUnit {
  return { id, location: "", current: emptyFleetSide(), proposal: emptyFleetSide() };
}

export const DEFAULT_FLEET: Fleet = {
  enabled: false,
  // 既定は6年リース。合計・削減の「◯年間」はこの回数に合わせる
  leaseTerm: 72,
  units: [],
};

/** 現行側の1台をそのまま提案側に写す（据え置く台の入力を省く） */
export function copySide(side: FleetSide): FleetSide {
  return {
    ...side,
    lines: side.lines.map((l) => ({ ...l, tiers: l.tiers.map((t) => ({ ...t })) })),
  };
}

/**
 * 現行の1台を「当社の提案」のたたき台として写す。
 *
 * 現行契約に付いている一律控除（ミスプリント1%控除・2%控除など）は
 * 当社の提案には無いので、写すときに必ず落とす。
 * 控除を残したままにすると、提案側の請求枚数が実際より少なく出てしまう。
 */
export function proposalFromCurrent(side: FleetSide): FleetSide {
  const copied = copySide(side);
  copied.lines = copied.lines.map((l) => ({ ...l, deductionRate: undefined, amount: undefined }));
  return copied;
}

/** その台の片側にかかっている控除率（区分でいちばん大きいもの）。0 なら控除なし */
export function deductionRateOf(side: FleetSide): number {
  return side.lines.reduce((max, l) => Math.max(max, l.deductionRate ?? 0), 0);
}

/** 片側の全区分に同じ控除率をかける（画面の「控除」欄用） */
export function withDeductionRate(side: FleetSide, rate: number): FleetSide {
  return {
    ...side,
    lines: side.lines.map((l) => ({ ...l, deductionRate: rate > 0 ? rate : undefined })),
  };
}

/** カウンター区分の1行（画面で追加するときの初期値） */
export function newChargeLine(name: string, kind: CurrentChargeLine["kind"]): CurrentChargeLine {
  return { name, kind, pages: 0, tiers: [{ from: 1, to: null, unit: 0 }] };
}

/** 1台の片側（現行 or 提案）を計算する */
export function calcFleetSide(side: FleetSide, taxRate: number): FleetSideCalc {
  const lines = calcChargeLines(side.lines ?? []);
  const meteredSubtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const minCharge = Math.max(0, side.minCharge ?? 0);
  const minChargeApplied = minCharge > 0 && meteredSubtotal < minCharge;
  const maintenanceMonthly = Math.max(0, side.maintenanceMonthly ?? 0);

  const counterBeforeTax = (minChargeApplied ? minCharge : meteredSubtotal) + maintenanceMonthly;
  const counterTax = Math.round(counterBeforeTax * taxRate);

  return {
    monthlyLease: Math.max(0, Math.round(side.monthlyLease ?? 0)),
    lines,
    deductedPages: lines.reduce((sum, l) => sum + l.deduction, 0),
    meteredSubtotal: Math.round(meteredSubtotal),
    minCharge,
    minChargeApplied,
    maintenanceMonthly,
    counterBeforeTax: Math.round(counterBeforeTax),
    counterTax,
    counterTotal: Math.round(counterBeforeTax) + counterTax,
  };
}

/**
 * 片側の全台合計。
 * リース料金が分からない案件（leaseUnknown）は、合計にリース料を入れず
 * カウンター料金だけで比べる。分からない額を0円として扱うと、
 * 削減額を実際より大きく見せてしまうため。
 */
function totalsOf(
  sides: FleetSideCalc[],
  taxRate: number,
  leaseYears: number,
  leaseUnknown: boolean,
): FleetTotals {
  const leaseMonthly = sides.reduce((sum, s) => sum + s.monthlyLease, 0);
  const leaseTax = Math.round(leaseMonthly * taxRate);
  const leaseTotal = leaseMonthly + leaseTax;
  const counterSubtotal = sides.reduce((sum, s) => sum + s.counterTotal, 0);
  const monthly = leaseUnknown ? counterSubtotal : leaseTotal + counterSubtotal;
  return {
    leaseMonthly,
    leaseTax,
    leaseTotal,
    counterSubtotal,
    monthly,
    yearly: monthly * 12,
    longTerm: monthly * 12 * leaseYears,
  };
}

/** 複数台比較表ぜんぶを計算する */
export function calcFleet(fleet: Fleet, taxRate: number): FleetCalc {
  // 合計も削減も、提案するリース年数に合わせる（6年リースなら6年間）
  const leaseTerm = fleet.leaseTerm > 0 ? fleet.leaseTerm : 72;
  const leaseYears = Math.round(leaseTerm / 12);

  const units: FleetUnitCalc[] = fleet.units.map((unit, i) => ({
    unit,
    no: i + 1,
    current: calcFleetSide(unit.current, taxRate),
    proposal: calcFleetSide(unit.proposal, taxRate),
  }));

  const leaseUnknown = Boolean(fleet.leaseUnknown);
  const current = totalsOf(units.map((u) => u.current), taxRate, leaseYears, leaseUnknown);
  const proposal = totalsOf(units.map((u) => u.proposal), taxRate, leaseYears, leaseUnknown);

  const diffMonthly = proposal.monthly - current.monthly;

  return {
    units,
    current,
    proposal,
    leaseUnknown,
    diffMonthly,
    diffYearly: diffMonthly * 12,
    diffLeaseTerm: diffMonthly * leaseTerm,
    leaseTerm,
    leaseYears,
    reductionRate: current.monthly > 0 ? diffMonthly / current.monthly : 0,
  };
}

/** 複数台比較表として出せる状態か（1台でも入っていれば出せる） */
export function hasFleet(fleet?: Fleet): fleet is Fleet {
  return Boolean(fleet?.enabled && fleet.units.length);
}
