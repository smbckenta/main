/**
 * 複合機見積ツールのドメイン型定義。
 * 既存の Excel 帳票（御見積書＋比較表）と「Denrai 複合機仕切表」の運用に合わせている。
 *
 * 用語:
 *  - 定価     : メーカー希望小売価格。見積明細に並べる金額
 *  - 販売額計 : 顧客提示の販売価格（定価 − 値引き）。リース料の元になる
 *  - 仕切価格 : 仕入原価（仕切表の「仕切価格」）
 *  - GP       : 粗利益 = 販売額計 − 仕切価格
 *  - PTF      : 代理店へ支払う報酬額
 *  - NP       : 純利益 = GP − PTF
 *  - CV       : 月間印刷枚数
 */

export const MAKERS = [
  "KYOCERA",
  "TOSHIBA",
  "FUJIFILM",
  "SHARP",
  "RICOH",
  "CANON",
  "KONICA_MINOLTA",
  "OTHER",
] as const;

export type Maker = (typeof MAKERS)[number];

export const MAKER_LABELS: Record<Maker, string> = {
  KYOCERA: "京セラ",
  TOSHIBA: "東芝",
  FUJIFILM: "富士フイルム",
  SHARP: "シャープ",
  RICOH: "リコー",
  CANON: "キヤノン",
  KONICA_MINOLTA: "コニカミノルタ",
  OTHER: "その他",
};

/** リース支払回数（5年/6年/7年） */
export const LEASE_TERMS = [60, 72, 84] as const;
export type LeaseTerm = (typeof LEASE_TERMS)[number];

/* ---------------- マスタ ---------------- */

/** 見積明細1行（定価ベース） */
export interface QuoteItem {
  name: string;
  qty: number;
  unit: string;
  /** 定価（円・税抜） */
  unitPrice: number;
}

/** 仕切表の1機種 */
export interface PriceBookEntry {
  id: string;
  maker: Maker;
  model: string;
  /** 給紙段数などの構成表記（例: 4段） */
  config?: string;
  category: "A3カラー" | "A4カラー卓上" | "モノクロ" | string;
  /** 〇〇枚機 */
  gradePpm: number;
  /** 構成一式の定価合計 */
  listPrice: number;
  /** 仕切率（0.23 = 23%） */
  costRate?: number;
  costRateMin?: number;
  costRateMax?: number;
  /** 仕切価格（円）。幅がある場合は cost に中央値、min/max に幅を持つ */
  cost: number;
  costMin?: number;
  costMax?: number;
  functions?: string;
  /** 見積明細のひな型 */
  items: QuoteItem[];
  note?: string;
}

/** メーカーごとのカウンター単価の交渉レンジ・付帯費用 */
export interface MakerNote {
  counterMono: [number, number];
  counterColor: [number, number];
  note?: string;
  pcSetupFree?: number;
  pcSetupFee?: number;
  removalFee?: number;
  stairFee?: string;
}

export interface PriceBook {
  version: string;
  source: string;
  note?: string;
  entries: PriceBookEntry[];
  makerNotes: Partial<Record<Maker, MakerNote>>;
}

/** 機種スペック（比較表に載せる項目 + 任意の詳細） */
export interface DeviceSpec {
  id: string;
  maker: Maker;
  /** 比較表に表示するメーカー表記（例: 京セラドキュメントソリューション） */
  makerText?: string;
  model: string;
  /** ウォームアップタイム（秒） */
  warmupSec?: number;
  /** ファーストコピータイム（秒） */
  firstCopyMonoSec?: number;
  firstCopyColorSec?: number;
  /** 連続コピー速度（枚/分） */
  ppmMono?: number;
  ppmColor?: number;
  maxPaperSize?: "A3" | "A4" | "A3ノビ";
  colorType?: "color" | "mono";
  /** インターネット取得などで得た追加スペック */
  extra?: Record<string, string>;
  source: SpecSource;
  updatedAt: string;
}

export interface SpecSource {
  /** seed: 同梱初期データ / web: インターネット取得 / manual: 手入力 */
  method: "seed" | "web" | "manual";
  url?: string;
  fetchedAt?: string;
  note?: string;
}

/* ---------------- 設定 ---------------- */

/** カウンター単価の自動判定ルール（1段） */
export interface CounterTier {
  /** 判定値の下限（以上） */
  min: number;
  /** 判定値の上限（以下）。null は上限なし */
  max: number | null;
  mono: number;
  color: number;
}

export interface AreaSetting {
  name: string;
  /** 僻地・遠隔地。単価をメーカー上限側に寄せる */
  remote: boolean;
  /** 単価への加算（円/枚）。個別調整用 */
  monoAdd?: number;
  colorAdd?: number;
}

/** PTF（代理店報酬）ルール */
export interface PtfRule {
  /** grossProfit: GPに対する率 / sellingPrice: 販売額計に対する率 / fixed: 固定額のみ */
  base: "grossProfit" | "sellingPrice" | "fixed";
  rate: number;
  /** 固定加算額（円/件） */
  fixed: number;
  /** カウンター報酬（月額カウンター × 率 × 月数） */
  counter: { enabled: boolean; rate: number; months: number };
  /** 上限額（0 は上限なし） */
  cap: number;
  /** 端数処理単位 */
  roundUnit: number;
}

export interface CompanyInfo {
  name: string;
  representative?: string;
  postalCode?: string;
  address?: string;
  tel?: string;
  fax?: string;
  branchNote?: string;
  areaNote?: string;
  validityText: string;
  taxRate: number;
}

export interface Settings {
  company: CompanyInfo;
  /** リース料率（支払回数→料率） */
  leaseRates: Record<string, number>;
  /**
   * カウンター単価の自動判定基準
   *  colorVolume: 月間カラー枚数で判定
   *  counterAmount: 現行の月額カウンター請求額で判定
   */
  counterBasis: "colorVolume" | "counterAmount";
  counterTiersByColorVolume: CounterTier[];
  counterTiersByAmount: CounterTier[];
  /** 2色カラー単価（フルカラー単価に対する係数）。0.3 なら 7.0円 → 2.1円 */
  twoColorRatio: number;
  /** 既定の最低基本料金（円/月） */
  defaultMinCharge: number;
  /** 機種グレードの推奨（月間総印刷枚数→〇〇枚機） */
  gradeTiers: { minPages: number; ppm: number }[];
  areas: AreaSetting[];
  /** 既定の粗利率（fromMargin モード用） */
  defaultMarginRate: number;
  ptf: PtfRule;
  /** 見積金額の端数処理単位 */
  roundUnit: number;
}

/* ---------------- 読み取り結果 ---------------- */

/** 印刷明細（カウンター明細）の読み取り結果 */
export interface CounterReading {
  modelText?: string;
  serialNo?: string;
  periodFrom?: string;
  periodTo?: string;
  monoPages?: number;
  colorPages?: number;
  twoColorPages?: number;
  monoUnit?: number;
  colorUnit?: number;
  twoColorUnit?: number;
  /** 明細上の請求額（税抜） */
  amount?: number;
  confidence: number;
  evidence?: string[];
}

/** リース契約書の読み取り結果 */
export interface LeaseReading {
  lessor?: string;
  contractNo?: string;
  monthlyFee?: number;
  term?: number;
  startDate?: string;
  endDate?: string;
  itemText?: string;
  makerText?: string;
  modelText?: string;
  /** 残回数 */
  remainingTerm?: number;
  confidence: number;
  evidence?: string[];
}

/* ---------------- 案件 ---------------- */

export interface CounterUnits {
  mono: number;
  color: number;
  twoColor: number;
  /** 最低基本料金（円/月） */
  minCharge: number;
}

/** 現行機の状況 */
export interface CurrentMachine {
  makerText: string;
  modelText: string;
  deviceId?: string;
  /** 月額リース料（税抜） */
  monthlyLease: number;
  leaseTerm?: number;
  leaseStart?: string;
  leaseEnd?: string;
  /** 月間印刷枚数 */
  monoPages: number;
  colorPages: number;
  twoColorPages: number;
  /** 現行のカウンター単価 */
  units: CounterUnits;
  /** 保守料金（別建ての場合） */
  maintenanceMonthly: number;
}

/**
 * 販売額の決め方
 *  fromLease  : 目標の月額リース料から販売額を逆算（既存Excelと同じ運用）
 *  fromMargin : 仕切価格に粗利率を乗せる
 *  fromPrice  : 販売額計を直接入力
 */
export type PricingMode = "fromLease" | "fromMargin" | "fromPrice";

export interface Proposal {
  id: string;
  maker: Maker;
  priceBookId?: string;
  modelText: string;
  deviceId?: string;
  /** 台数（明細のqtyに乗算せず、明細をそのまま使う運用のため既定1） */
  qty: number;
  items: QuoteItem[];
  /** 仕切価格合計（未指定なら仕切表から） */
  cost?: number;
  pricingMode: PricingMode;
  /** fromLease: 目標月額リース料 */
  targetMonthlyLease?: number;
  /** fromMargin: 粗利率 */
  marginRate?: number;
  /** fromPrice: 販売額計 */
  sellingTotal?: number;
  /** 見積書に載せるリース回数 */
  leaseTerm: LeaseTerm;
  units?: CounterUnits;
  counterOverridden?: boolean;
  maintenanceMonthly: number;
  note?: string;
}

export interface Quote {
  id: string;
  title: string;
  customerName: string;
  customerHonorific: string;
  quoteNo: string;
  quoteDate: string;
  /** エリア名（設定の areas から選択） */
  area: string;
  current: CurrentMachine;
  proposals: Proposal[];
  ingest?: {
    counter: CounterReading[];
    lease: LeaseReading[];
    files: { name: string; kind: string; role: string; parsedAt: string }[];
    warnings: string[];
  };
  createdAt: string;
  updatedAt: string;
}

/* ---------------- 計算結果 ---------------- */

export interface CounterBreakdown {
  monoAmount: number;
  colorAmount: number;
  twoColorAmount: number;
  /** 最低基本料金の適用有無 */
  minChargeApplied: boolean;
  total: number;
}

export interface CurrentCalc {
  monthlyLease: number;
  counter: CounterBreakdown;
  maintenanceMonthly: number;
  /** ランニングコスト（税抜） */
  running: number;
  tax: number;
  /** 月間経費（税込） */
  monthlyTotal: number;
  totalPages: number;
}

export interface ProposalCalc {
  proposal: Proposal;
  /** 提案機のスペック */
  device?: DeviceSpec;
  /** 現行機のスペック（比較表の左列） */
  currentDevice?: DeviceSpec;
  priceBook?: PriceBookEntry;
  /** 定価合計 */
  listTotal: number;
  /** 販売額計 */
  sellingTotal: number;
  /** 値引き（負値） */
  discount: number;
  tax: number;
  /** 販売額計（税込） */
  sellingTotalWithTax: number;
  /** 各リース年数の月額 */
  leaseByTerm: Record<number, number>;
  leaseRate: number;
  monthlyLease: number;
  units: CounterUnits;
  counterAuto: boolean;
  counter: CounterBreakdown;
  maintenanceMonthly: number;
  running: number;
  runningTax: number;
  monthlyTotal: number;
  /** 現行との差額（マイナスが削減） */
  diffMonthly: number;
  diffYearly: number;
  diffSixYears: number;
  /** 収益 */
  cost: number;
  grossProfit: number;
  ptf: number;
  netProfit: number;
}
