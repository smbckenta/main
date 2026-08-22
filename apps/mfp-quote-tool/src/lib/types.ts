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
  /**
   * PTFの対象外（フィニッシャー・ICカードリーダー等のオプション、
   * 追加のPC設定作業など、本体価格に上乗せした分）。
   * この分は値引き対象にせず、そのまま販売額計に加算する。
   */
  ptfExempt?: boolean;
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
  /** 最低基本料金（円/月）。null は「都度メーカー条件を確認して手入力」 */
  minCharge?: number | null;
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

/** 保守対応ランク（メーカーの担当エリア表より） */
export type ServiceRank = "S" | "A" | "B" | "C" | "D";

/** 市区町村ごとの保守対応エリア */
export interface ServiceArea {
  pref: string;
  city: string;
  rank: ServiceRank;
  /** 離島区分（空文字は離島でない） */
  island: string;
}

export interface ServiceAreaBook {
  source: string;
  importedAt: string;
  rankLabels: Record<string, string>;
  islandLabels: Record<string, string>;
  columns: string[];
  /** [県名, 市町村名, ランク, 離島区分] */
  areas: [string, string, string, string][];
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
  /**
   * bodyPrice   : 本体価格（販売額計からオプション・追加PC設定の上乗せ分を除いた額）に対する率
   * grossProfit : GPに対する率
   * sellingPrice: 販売額計（上乗せ分を含む）に対する率
   * fixed       : 固定額のみ
   */
  base: "bodyPrice" | "grossProfit" | "sellingPrice" | "fixed";
  rate: number;
  /**
   * 代理店が2社入る場合の、2社目の料率。
   * 提案ごとに「代理店2社」を選ぶと、この率ぶんが追加で払い出される（10% + 2%）。
   */
  secondRate: number;
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
  /** 本社住所（拠点一覧を使う場合は offices を優先して印字する） */
  address?: string;
  tel?: string;
  fax?: string;
  branchNote?: string;
  areaNote?: string;
  /** 拠点（本社・営業所）。見積書・比較表に並べて印字する */
  offices?: { name: string; address: string }[];
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
  /** 既定の最低基本料金（円/月）。メーカー別の指定がない場合に使う */
  defaultMinCharge: number;
  /**
   * 当日対応エリア（保守ランク S / A）で提示できる基準単価。
   * 印刷枚数が少なくてもこの単価までは出せる、という下限の保証。
   */
  sameDayBaseUnits: { mono: number; color: number };
  /** 機種グレードの推奨（月間総印刷枚数→〇〇枚機） */
  gradeTiers: { minPages: number; ppm: number }[];
  areas: AreaSetting[];
  /** 既定の粗利率（fromMargin モード用） */
  defaultMarginRate: number;
  /** 既定のGP（粗利額・円）。提案を追加したときの初期値 */
  defaultGrossProfit: number;
  /**
   * 現行リースの残債精算。
   * 残債 + 現行リース料 × 解約事務手数料の月数 を見積金額（リース対象額）に含める。
   */
  debtSettlement: {
    includeInQuote: boolean;
    /** 解約事務手数料として上乗せする現行リース料の月数 */
    cancellationMonths: number;
  };
  ptf: PtfRule;
  /** 見積金額の端数処理単位 */
  roundUnit: number;
  /**
   * 月額リース料の端数処理単位（円）。
   * この単位で切り上げる（16,080円 → 16,100円）。
   */
  leaseRoundUnit: number;
  /** メーカー別の2色カラー単価（指定が無いメーカーは twoColorRatio で計算） */
  twoColorUnitByMaker: Partial<Record<Maker, number>>;
  /** 担当者（見積書に印字・削除記録に使う） */
  staff: string[];
  /** 案件の削除 */
  deletion: DeletionSettings;
  /** AI（Claude）による書類の読み取り */
  ai: AiSettings;
}

/** 案件を削除するときの取り決め */
export interface DeletionSettings {
  /**
   * 削除パスワードのハッシュ（SHA-256の16進）。
   * 平文は保存しない。未設定のあいだは削除できない。
   */
  passwordHash: string;
}

/** 案件を削除した記録 */
export interface DeletionRecord {
  deletedAt: string;
  /** 削除した担当者 */
  deletedBy: string;
  quoteId: string;
  quoteNo: string;
  customerName: string;
  title: string;
  /** 退避したファイル名（data/quotes-deleted/ 配下） */
  archivedFile: string;
}

/**
 * AI（Claude）で書類を読み取るための設定。
 * スキャンPDFや写真は文字起こし（OCR）だけでは表が崩れて読めないため、
 * PDF・画像をそのままAIに渡して内容を判断させる。
 */
export interface AiSettings {
  /** AI解析を使うか */
  enabled: boolean;
  /** APIキー。空欄なら環境変数 ANTHROPIC_API_KEY を使う */
  apiKey: string;
  /** 使用するモデル */
  model: string;
  /** 1ファイルあたりAIに渡す最大ページ数 */
  maxPages: number;
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
  /** 残債（未経過リース料）。支払予定表から読み取る */
  remainingDebt?: number;
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
  /** 残債（未経過リース料）。支払予定表から読み取る */
  remainingDebt?: number;
  /** 月間印刷枚数 */
  monoPages: number;
  colorPages: number;
  twoColorPages: number;
  /**
   * 枚数の集計期間。
   * カウンター明細を複数月分読み込んだ場合、月間枚数はこの期間の平均になる。
   * 見積書・比較表には「（2025/03-2025/08平均印刷枚数）」と注記する。
   */
  pagesPeriod?: { from: string; to: string; months: number };
  /** 現行のカウンター単価 */
  units: CounterUnits;
  /** 保守料金（別建ての場合） */
  maintenanceMonthly: number;
}

/**
 * 販売額の決め方
 *  fromGp     : 仕切価格に粗利額（GP）を加える（本体価格 = 仕切 + GP）
 *  fromLease  : 目標の月額リース料から販売額を逆算（既存Excelと同じ運用）
 *  fromMargin : 仕切価格に粗利率を乗せる
 *  fromPrice  : 販売額計を直接入力
 */
export type PricingMode = "fromGp" | "fromLease" | "fromMargin" | "fromPrice";

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
  /** fromGp: 上乗せする粗利額（GP・円） */
  grossProfitAmount?: number;
  /** fromLease: 目標月額リース料 */
  targetMonthlyLease?: number;
  /** fromMargin: 粗利率 */
  marginRate?: number;
  /** fromPrice: 販売額計 */
  sellingTotal?: number;
  /** 見積書に載せるリース回数 */
  leaseTerm: LeaseTerm;
  /** 代理店が2社入る案件（PTFを2社に払い出す） */
  twoAgencies?: boolean;
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
  /** 担当者名（見積書に印字） */
  staffName?: string;
  /** 保守対応エリア（メーカー担当エリア表の市区町村） */
  serviceArea?: { pref: string; city: string };
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
  /** 本体価格（PTFの対象。オプション・追加設定の上乗せを含まない） */
  sellingBase: number;
  /** オプション・追加設定の上乗せ合計（PTF対象外） */
  addOnTotal: number;
  /** 旧リースの残債精算（残債 + 解約事務手数料）。PTF対象外 */
  debtSettlement: {
    remainingDebt: number;
    /** 解約事務手数料（現行リース料 × 月数） */
    cancellationFee: number;
    months: number;
    total: number;
  };
  /** 販売額計 = 本体価格 + 上乗せ分 + 残債精算 */
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
  /** 保守対応ランク（判定できた場合） */
  serviceRank?: ServiceRank;
  /** 提案時の注意（保守ランクB以下・離島など） */
  serviceWarning?: string;
  /** 最低基本料金を都度確認する必要があるメーカーか */
  minChargeNeedsInput: boolean;
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
  /** PTF合計（代理店2社の場合は2社ぶんの合計） */
  ptf: number;
  /** PTFの内訳（1社目／2社目） */
  ptfBreakdown: { primary: number; second: number };
  netProfit: number;
}
