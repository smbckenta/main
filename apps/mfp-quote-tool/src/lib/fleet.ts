import { calcChargeLines } from "./pricing";
import type {
  CounterReading,
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

/* ---------------- カウンター明細からの台の組み立て ---------------- */

/**
 * 明細から「別々の機械」として読めたものを数える。
 *
 * 同じ機械の複数月ぶん・複数の書類ぶんは1台にまとめる。
 * 機番か設置場所が違うものだけを別の台とみなす。
 * 販売店の請求書（設置場所と請求額）とメーカーの明細（枚数と単価）は
 * 別々の紙で来るので、ここで機番を頼りに1台へ寄せる。
 */
export function distinctMachines(readings: CounterReading[]): CounterReading[] {
  return mergeReadings(readings.filter((r) => r.serialNo || r.location));
}

/** 読み取り結果から現行側の1台を組む */
function sideFromReading(reading: CounterReading): FleetSide {
  const lines: CurrentChargeLine[] = reading.chargeLines?.length
    ? reading.chargeLines.map((l) => ({ ...l, tiers: l.tiers.map((t) => ({ ...t })) }))
    : ([
        ["モノクロ", "mono", reading.monoPages, reading.monoUnit],
        ["フルカラー", "color", reading.colorPages, reading.colorUnit],
        ["2色カラー", "twoColor", reading.twoColorPages, reading.twoColorUnit],
      ] as const)
        // 枚数も単価も読めなかった区分は行にしない（0円の行が並ぶと読みにくい）
        .filter(([, , pages, unit]) => (pages ?? 0) > 0 || (unit ?? 0) > 0)
        .map(([name, kind, pages, unit]) => ({
          name,
          kind,
          pages: pages ?? 0,
          deductionRate: reading.deductionRate,
          tiers: [{ from: 1, to: null, unit: unit ?? 0 }],
        }));

  return {
    makerText: reading.makerText ?? "",
    modelText: reading.modelText ?? "",
    monthlyLease: 0,
    // 販売店の請求書には枚数も単価も載っておらず、請求額しか分からない。
    // その場合だけ、請求額を最低基本料金に置いて現状の合計が実際の支払額に合うようにする。
    // （最低基本料金は「枚数によらずこの額」という下限なので、枚数が分からない
    //   いまの状態を素直に表せる。あとでメーカーの明細を読ませて枚数が入れば、
    //   区分の合計がこれを上回り、そちらが採用される）
    minCharge: lines.length ? 0 : (reading.amount ?? 0),
    maintenanceMonthly: reading.maintenanceMonthly ?? 0,
    lines,
  };
}

/**
 * 同じ機械の読み取りかどうか。
 *
 * 機番がいちばん確かな手がかり。販売店の請求書とメーカーの明細を
 * 両方読み込んだときに、機番で突き合わせて1台にまとめたい。
 * 機番が無ければ設置場所で見る。
 */
function sameMachine(a: CounterReading, b: CounterReading): boolean {
  if (a.serialNo && b.serialNo) return a.serialNo === b.serialNo;
  if (a.location && b.location) return a.location === b.location;
  return false;
}

/**
 * 台ごとの読み取り結果を1台にまとめる。
 *
 * 販売店の請求書（設置場所・機種・請求額）とメーカーの明細（枚数・単価）は
 * 別々の紙で来る。機番で突き合わせて、両方の分かることを1台に寄せる。
 */
function mergeReadings(readings: CounterReading[]): CounterReading[] {
  const out: CounterReading[] = [];
  for (const r of readings) {
    const found = out.find((x) => sameMachine(x, r));
    if (!found) {
      out.push({ ...r });
      continue;
    }
    // 先に読めているものを優先し、空いているところだけ埋める
    found.location ??= r.location;
    found.serialNo ??= r.serialNo;
    found.modelText ??= r.modelText;
    found.makerText ??= r.makerText;
    found.maintenanceMonthly ??= r.maintenanceMonthly;
    found.amount ??= r.amount;
    found.monoPages ??= r.monoPages;
    found.colorPages ??= r.colorPages;
    found.twoColorPages ??= r.twoColorPages;
    found.monoUnit ??= r.monoUnit;
    found.colorUnit ??= r.colorUnit;
    found.twoColorUnit ??= r.twoColorUnit;
    found.deductionRate ??= r.deductionRate;
    if (!found.chargeLines?.length && r.chargeLines?.length) found.chargeLines = r.chargeLines;
  }
  return out;
}

/**
 * カウンター明細から複数台の比較表を組む。
 *
 * 明細に載っている複合機を1台残らず拾うのが狙い。設置場所も明細から取る。
 * すでに画面で入力してある台は消さず、機番か設置場所で突き合わせて
 * 読み取れた内容だけを重ねる（手で直したリース料や提案機種を消さないため）。
 */
export function fleetFromReadings(readings: CounterReading[], base?: Fleet): Fleet {
  const fleet = base ?? DEFAULT_FLEET;
  const merged = distinctMachines(readings.filter((r) => r.location || r.serialNo || r.modelText));
  if (!merged.length) return fleet;

  const units = [...fleet.units];
  merged.forEach((reading, i) => {
    const current = sideFromReading(reading);
    const at = units.findIndex(
      (u) =>
        (reading.serialNo && u.serialNo === reading.serialNo) ||
        (reading.location && u.location === reading.location),
    );
    if (at >= 0) {
      // すでにある台：現行側だけ差し替え、提案側は手入力を残す
      units[at] = {
        ...units[at],
        location: units[at].location || (reading.location ?? ""),
        serialNo: units[at].serialNo ?? reading.serialNo,
        current: { ...current, monthlyLease: units[at].current.monthlyLease },
      };
      return;
    }
    units.push({
      id: `u${Date.now().toString(36)}${units.length}${i}`,
      location: reading.location ?? "",
      serialNo: reading.serialNo,
      current,
      // 提案機種は営業が選ぶもの。現行の型番を写すと「現行と同じ機種」が
      // 出てきてしまうので、空のまま渡して画面で選んでもらう
      proposal: emptyFleetSide(),
    });
  });

  return { ...fleet, enabled: true, units };
}
