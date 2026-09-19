import { calcChargeLines, ceilTo, floorTo, leaseRateOf, roundTo } from "./pricing";
import type {
  CounterReading,
  CurrentChargeLine,
  FleetPricing,
  FleetPricingCalc,
  Maker,
  PriceBook,
  PriceBookEntry,
  Settings,
  Fleet,
  FleetCalc,
  FleetSide,
  FleetSideCalc,
  FleetTotals,
  FleetUnit,
  FleetUnitCalc,
} from "./types";
import { MAKER_LABELS } from "./types";

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

/**
 * 提案する1台のリース料を、決め方に沿って計算する。
 *
 * 1台だけの案件（calcProposal）と同じ順序で計算する。
 *   本体価格を決める → 上乗せ分を足して販売額計 → × リース料率 → 切り上げ
 * 「目標月額から逆算」だけは切り下げる。切り上げると目標月額をわずかに
 * 上回り、そこに100円単位の切り上げが掛かって100円高く出てしまう。
 */
export function calcUnitLease(
  pricing: FleetPricing,
  leaseTerm: number,
  settings: Settings,
): FleetPricingCalc {
  const cost = Math.max(0, pricing.cost ?? 0);
  const addOnTotal = Math.max(0, pricing.addOnTotal ?? 0);
  const leaseRate = leaseRateOf(leaseTerm, settings.leaseRates);

  let bodyPrice = 0;
  if (pricing.mode === "fromGp") {
    bodyPrice = cost + (pricing.grossProfitAmount ?? 0);
  } else if (pricing.mode === "fromLease") {
    const total = leaseRate > 0 ? (pricing.targetMonthlyLease ?? 0) / leaseRate : 0;
    bodyPrice = floorTo(total, settings.roundUnit) - addOnTotal;
  } else if (pricing.mode === "fromMargin") {
    const rate = Math.min(Math.max(pricing.marginRate ?? settings.defaultMarginRate, 0), 0.95);
    bodyPrice = cost > 0 ? cost / (1 - rate) : 0;
  } else {
    bodyPrice = pricing.bodyPrice ?? 0;
  }

  // 入れた額（GP・本体価格）と、逆算した額はここで丸め直さない。
  // 丸め直すと目標月額に戻らなくなる。
  const asEntered = pricing.mode !== "fromMargin";
  bodyPrice = asEntered
    ? Math.max(0, Math.round(bodyPrice))
    : roundTo(Math.max(0, bodyPrice), settings.roundUnit);

  const sellingTotal = bodyPrice + addOnTotal;
  const grossProfit = sellingTotal - cost;
  return {
    cost,
    bodyPrice,
    addOnTotal,
    sellingTotal,
    grossProfit,
    marginRate: sellingTotal > 0 ? grossProfit / sellingTotal : 0,
    monthlyLease: ceilTo(sellingTotal * leaseRate, settings.leaseRoundUnit ?? 1),
    leaseRate,
  };
}

/**
 * 提案側の印刷枚数を、現行と同じにそろえる。
 *
 * 提案後も同じ枚数を刷る前提で比べるので、枚数は現行の実績そのもの。
 * 現行契約にミスプリント控除が付いていても、当社の提案には控除が無いため、
 * 控除を差し引く前の枚数を使う（差し引いた枚数で比べると提案側が安く出る）。
 *
 * 区分の並びが現行と揃っていればそのまま写す。揃っていない場合
 * （現行はフルカラーがコピーとプリントに分かれ、提案は1区分）は、
 * 同じ種別の枚数を合計して1区分に入れる。
 */
export function syncProposalPages(current: FleetSide, proposal: FleetSide): FleetSide {
  if (!proposal.lines?.length) return proposal;

  const currentByKind = new Map<CurrentChargeLine["kind"], number[]>();
  for (const l of current.lines ?? []) {
    currentByKind.set(l.kind, [...(currentByKind.get(l.kind) ?? []), l.pages]);
  }

  const seen = new Map<CurrentChargeLine["kind"], number>();
  const lines = proposal.lines.map((line) => {
    const from = currentByKind.get(line.kind) ?? [];
    const sameKindCount = proposal.lines.filter((x) => x.kind === line.kind).length;
    const i = seen.get(line.kind) ?? 0;
    seen.set(line.kind, i + 1);
    // 区分の数が現行と同じなら1対1、違うなら同じ種別を合計して先頭の区分に入れる
    const pages =
      sameKindCount === from.length
        ? (from[i] ?? 0)
        : i === 0
          ? from.reduce((sum, n) => sum + n, 0)
          : 0;
    return pages === line.pages ? line : { ...line, pages };
  });
  return { ...proposal, lines };
}

/** 1台の片側（現行 or 提案）を計算する */
export function calcFleetSide(
  side: FleetSide,
  taxRate: number,
  /** リース料の決め方を使う場合に渡す（提案側） */
  lease?: { leaseTerm: number; settings: Settings },
): FleetSideCalc {
  const pricing = side.pricing && lease ? calcUnitLease(side.pricing, lease.leaseTerm, lease.settings) : undefined;
  const lines = calcChargeLines(side.lines ?? []);
  const meteredSubtotal = lines.reduce((sum, l) => sum + l.amount, 0);
  const minCharge = Math.max(0, side.minCharge ?? 0);
  const minChargeApplied = minCharge > 0 && meteredSubtotal < minCharge;
  const maintenanceMonthly = Math.max(0, side.maintenanceMonthly ?? 0);

  const counterBeforeTax = (minChargeApplied ? minCharge : meteredSubtotal) + maintenanceMonthly;
  const counterTax = Math.round(counterBeforeTax * taxRate);

  return {
    // 決め方が入っていればそちらを正とする（手入力の値は使わない）
    monthlyLease: pricing ? pricing.monthlyLease : Math.max(0, Math.round(side.monthlyLease ?? 0)),
    pricing,
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
export function calcFleet(fleet: Fleet, taxRate: number, settings?: Settings): FleetCalc {
  // 合計も削減も、提案するリース年数に合わせる（6年リースなら6年間）
  const leaseTerm = fleet.leaseTerm > 0 ? fleet.leaseTerm : 72;
  const leaseYears = Math.round(leaseTerm / 12);
  const lease = settings ? { leaseTerm, settings } : undefined;

  const units: FleetUnitCalc[] = fleet.units.map((unit, i) => ({
    unit,
    no: i + 1,
    current: calcFleetSide(unit.current, taxRate),
    // 提案側の枚数は現行と同じ（控除前）にそろえてから計算する
    proposal: calcFleetSide(syncProposalPages(unit.current, unit.proposal), taxRate, lease),
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

/* ---------------- 台ごとの機種の自動選定 ---------------- */

/**
 * その台に要る印刷速度（枚/分）。
 *
 * 現行機の印刷速度が分かっていればそれを基準にする。分からない場合は
 * その台の月間印刷枚数から、設定のグレード表で判定する。
 * 複数台の案件で全台の合計枚数から1台を選ぶと、実際には各拠点に
 * 置く機械なので大きすぎる機種になってしまう。台ごとに見るのが正しい。
 */
export function requiredPpm(unit: FleetUnit, settings: Settings, currentPpm?: number): number {
  const pages = (unit.current.lines ?? []).reduce((sum, l) => sum + l.pages, 0);
  const byPages = [...settings.gradeTiers]
    .sort((a, b) => b.minPages - a.minPages)
    .find((t) => pages >= t.minPages)?.ppm;
  const fallback = byPages ?? settings.gradeTiers[0]?.ppm ?? 25;
  // 現行と同等以上にしたいので、現行の速度と枚数から要る速度の大きいほうを取る。
  // 画面に速度が入っていなくても、機種DBから引けた速度があればそれを使う
  return Math.max(unit.current.ppm ?? 0, currentPpm ?? 0, fallback);
}

/**
 * 仕切表から、その台に出す機種を選ぶ。
 * 現行と同等以上の速度で、いちばん近いもの。無ければ手持ちで最速のもの。
 */
export function pickEntryForUnit(
  entries: PriceBookEntry[],
  maker: Maker,
  targetPpm: number,
): PriceBookEntry | undefined {
  const sameMaker = entries.filter((e) => e.maker === maker);
  const a3Color = sameMaker.filter((e) => e.category === "A3カラー");
  const pool = a3Color.length ? a3Color : sameMaker;
  if (!pool.length) return undefined;
  const atOrAbove = pool.filter((e) => e.gradePpm >= targetPpm).sort((a, b) => a.gradePpm - b.gradePpm);
  return atOrAbove[0] ?? [...pool].sort((a, b) => b.gradePpm - a.gradePpm)[0];
}

/**
 * 全台に提案機種を自動で入れる。
 *
 * 台ごとに現行と同等以上の機種を選び、台数ぶんそのまま提案する。
 * 印刷枚数は現行と同じ（控除前）を写し、単価は現行の単価を初期値にする
 * （そのままでは削減が出ないので、営業が下げて詰める前提のたたき台）。
 */
export interface AutoSelectContext {
  /** 現行機の印刷速度（機種DBやインターネットから引けた場合）。台のidをキーにする */
  currentPpm?: Record<string, number>;
  /** 提案のカウンター単価（メーカーの条件から自動判定したもの）。台のidをキーにする */
  counterUnits?: Record<string, { mono: number; color: number; twoColor: number }>;
}

export function autoSelectProposals(
  fleet: Fleet,
  maker: Maker,
  book: PriceBook,
  settings: Settings,
  ctx: AutoSelectContext = {},
): Fleet {
  const units = fleet.units.map((unit) => {
    const entry = pickEntryForUnit(book.entries, maker, requiredPpm(unit, settings, ctx.currentPpm?.[unit.id]));
    if (!entry) return unit;

    // 枚数と区分は現行から引き継ぎ、単価は当社の提案の単価に入れ替える。
    // 現行の単価をそのまま残すと、同じ単価のまま比べることになって
    // 削減が出ない（見比べる紙として意味をなさない）。
    const proposed = ctx.counterUnits?.[unit.id];
    const base = proposalFromCurrent(unit.current);
    const lines = proposed
      ? base.lines.map((l) => ({
          ...l,
          tiers: [{ from: 1, to: null, unit: proposed[l.kind === "other" ? "mono" : l.kind] ?? 0 }],
        }))
      : base.lines;

    return {
      ...unit,
      proposal: {
        ...base,
        lines,
        makerText: MAKER_LABELS[maker],
        modelText: entry.model,
        ppm: entry.gradePpm,
        // 提案側に現行の保守料金・最低基本料金は引き継がない（契約が変わるため）
        minCharge: book.makerNotes[maker]?.minCharge ?? 0,
        maintenanceMonthly: 0,
        monthlyLease: 0,
        pricing: {
          mode: "fromGp" as const,
          priceBookId: entry.id,
          cost: entry.cost,
          grossProfitAmount: settings.defaultGrossProfit,
          marginRate: settings.defaultMarginRate,
        },
      },
    };
  });
  return { ...fleet, enabled: true, units };
}
