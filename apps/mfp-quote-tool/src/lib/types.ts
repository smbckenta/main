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

/**
 * 機種に付けられるオプション（提案資料に写真付きで並べる）。
 *
 * 提案資料には定価を載せず、「付けた場合に月額リース料がいくら増えるか」だけを出す。
 * お客様が見るのは月々の負担額であって、機器の値段ではないため。
 */
export interface DeviceOption {
  id: string;
  /** 品名（例: 両画面原稿送り装置） */
  name: string;
  /** メーカー型番 */
  modelCode?: string;
  /** 定価（円・税抜）。リース料の増加額はここから計算する */
  listPrice: number;
  /** 提案資料に載せる短い説明 */
  description?: string;
  /** 写真のファイル名（データ保存先の photos/ に置く） */
  photo?: string;
  /** 分類（給紙・フィニッシャー・セキュリティ など） */
  category?: string;
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
  /** 機種の写真のファイル名（データ保存先の photos/ に置く）。提案資料に載せる */
  photo?: string;
  /** この機種に付けられるオプション。提案資料の「オプションのご紹介」になる */
  options?: DeviceOption[];
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
  /** 提案資料（写真入りのご提案書） */
  proposalDoc: ProposalDocSettings;
  /** 担当者（見積書に印字・削除記録に使う） */
  staff: string[];
  /** 案件の削除 */
  deletion: DeletionSettings;
  /** 見積書番号の台帳（Googleスプレッドシート）連携 */
  quoteRegister: QuoteRegisterSettings;
  /** AI（Claude）による書類の読み取り */
  ai: AiSettings;
}

/** 提案資料（見積書・比較表とは別に出す、写真入りのご提案書）の設定 */
export interface ProposalDocSettings {
  /**
   * オプションの掛け率。
   * オプションを付けた場合の月額リース料は「定価 × この率 × リース料率」で出す。
   * 既定は0.8（8掛け）。
   */
  optionPriceRate: number;
  /** 表紙に入れる標題 */
  title: string;
  /** 表紙に入れるリード文 */
  lead: string;
  /** 提案する複合機の訴求ポイント（既定値。案件ごとに書き換えられる） */
  highlights: string[];
}

/**
 * 見積書番号の台帳。
 * 番号は台帳の続きから採番し、発行した番号は 見積書番号／顧客名／内容 の3列で書き戻す。
 */
export interface QuoteRegisterSettings {
  enabled: boolean;
  /**
   * 台帳への接続方式
   *  appsScript     : スプレッドシートに貼ったApps Scriptのウェブアプリ経由（設定が簡単）
   *  serviceAccount : Google Cloudのサービスアカウント鍵を使う
   */
  mode: "appsScript" | "serviceAccount";
  /** スプレッドシートのID（URLの /d/ と /edit の間）。serviceAccount で使う */
  spreadsheetId: string;
  /** シート（タブ）名 */
  sheetName: string;
  /** Apps Script ウェブアプリのURL */
  webAppUrl: string;
  /** Apps Script と共有する合言葉 */
  webAppToken: string;
  /** 台帳を読めないときに使う開始番号 */
  startNumber: number;
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
  /**
   * 印刷枚数そのものに一律でかかる控除の率（0.02 = 2%）。
   * 「ミスプリント1%控除」「2%控除」など。区分ごとの明細ではなく
   * 枚数全体に効くタイプの控除をここで持つ。
   */
  deductionRate?: number;
  /**
   * 段階単価（パフォーマンスチャージ）の内訳。
   * 「1-1000／月 3.0円」のように単価が逓減する明細で埋まる。
   */
  chargeLines?: CurrentChargeLine[];
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

/**
 * 逓減単価（パフォーマンスチャージ）の1段。
 * 「1-1000／月 3.0円」「1001-2000／月 2.6円」のように、
 * 1ヶ月あたりの枚数の帯ごとに単価が決まる。
 */
export interface ChargeTier {
  /** 帯の下限（枚・以上） */
  from: number;
  /** 帯の上限（枚・以下）。null は上限なし */
  to: number | null;
  /** 単価（円/枚） */
  unit: number;
}

/**
 * 現行機のカウンター区分1行。
 * 明細の区分（モノクロ／フルカラーコピー／フルカラープリント…）をそのまま持ち、
 * 比較表ではこの行数ぶんだけ行を増やして内訳を見せる。
 */
export interface CurrentChargeLine {
  /** 明細に書かれている区分名 */
  name: string;
  /** 提案側のどの単価と比べる区分か */
  kind: "mono" | "color" | "twoColor" | "other";
  /** 月間カウント（控除前） */
  pages: number;
  /** 控除率（0.02 = 2%）。控除カウントは切り上げる */
  deductionRate?: number;
  /** 段階単価。1段だけなら一律単価 */
  tiers: ChargeTier[];
  /** 明細に書かれている金額（税抜）。検算に使う */
  amount?: number;
}

/** 現行機の状況 */
export interface CurrentMachine {
  makerText: string;
  modelText: string;
  deviceId?: string;
  /** 月額リース料（税抜） */
  monthlyLease: number;
  /**
   * 現行のリース料金が分からない案件。
   * リース明細をお預かりできていない、金額が不明、といった場合に true。
   *
   * このときはリース料を比較に含めず、カウンター料金だけで比べる。
   * 分からない額を0円として扱うと、削減額を実際より大きく見せてしまうため。
   * リース満了で本当に0円の案件とは区別する（そちらは false のまま）。
   */
  leaseUnknown?: boolean;
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
   * カウンター料金の内訳（逓減単価の明細を読み取った場合）。
   * これがある場合は、こちらを正としてカウンター請求額を計算する。
   */
  chargeLines?: CurrentChargeLine[];
  /**
   * 枚数の集計期間。
   * カウンター明細を複数月分読み込んだ場合、月間枚数はこの期間の平均になる。
   * 見積書・比較表には「（2025/03-2025/08平均印刷枚数）」と注記する。
   */
  pagesPeriod?: { from: string; to: string; months: number };
  /**
   * 印刷枚数そのものに一律でかかる控除の率（0.02 = 2%）。
   * リコー・キヤノンの明細でよくある「ミスプリント1%控除」「2%控除」。
   *
   * これは現行機の契約にだけ付いているもので、当社の提案には控除が無い。
   * 提案側は控除なしの実枚数で計算するため、ここは現行の計算にしか使わない。
   */
  deductionRate?: number;
  /** 現行のカウンター単価 */
  units: CounterUnits;
  /** 保守料金（別建ての場合） */
  maintenanceMonthly: number;
}

/* ---------------- 複数台（A3ヨコ 複数台比較表） ---------------- */

/**
 * 複数台比較表の1台ぶん。現行側・提案側とも同じ形で持つ。
 *
 * 1台ずつ「リース料金」と「カウンター料金」を並べ、
 * 台数ぶんの合計で現行と提案を比べる、というA3ヨコの比較表の運用に合わせている。
 */
export interface FleetSide {
  makerText: string;
  /** 現行側は物件名、提案側は提案機種 */
  modelText: string;
  /** 印刷速度（枚/分） */
  ppm?: number;
  /** 備考（A3モノクロ複合機／レンタル など） */
  note?: string;
  /** 月額リース料（税抜） */
  monthlyLease: number;
  /**
   * カウンターの区分（モノクロ／カラー…）。
   * 「チャージ枚数」の帯（1-4000 など）も tiers で持つ。
   */
  lines: CurrentChargeLine[];
  /** 最低基本料金（円/月）。カウンター計がこれを下回る月はこの額になる */
  minCharge: number;
  /** 月額保守料金（円/月）。カウンター計に加算する（理想科学など） */
  maintenanceMonthly: number;
}

export interface FleetUnit {
  id: string;
  /** 設置場所 */
  location: string;
  current: FleetSide;
  proposal: FleetSide;
}

/** 複数台の入替提案（A3ヨコの複数台比較表） */
export interface Fleet {
  /** この案件を複数台比較表で出すか */
  enabled: boolean;
  /** 印刷枚数の集計期間（見出しの括弧書き。例: 2023年-2024年印刷枚数） */
  pagesNote?: string;
  /**
   * 提案するリースの支払回数（60/72/84）。
   * 合計金額と削減額の「◯年間」は、この回数から出した年数に合わせる
   * （6年リースなら6年間）。
   */
  leaseTerm: number;
  /**
   * 現行のリース料金が分からない案件。
   * リース料金の内訳を出さず、カウンター料金だけで比べる。
   */
  leaseUnknown?: boolean;
  units: FleetUnit[];
}

/* ---------------- 複数台の計算結果 ---------------- */

/** 1台の片側（現行 or 提案）の計算結果 */
export interface FleetSideCalc {
  monthlyLease: number;
  lines: ChargeLineCalc[];
  /** 控除された枚数の合計（現行側の一律控除。提案側は0） */
  deductedPages: number;
  /** カウンター区分の合計（税抜・最低基本料金の適用前） */
  meteredSubtotal: number;
  minCharge: number;
  minChargeApplied: boolean;
  maintenanceMonthly: number;
  /** 請求金額（税抜） = max(カウンター計, 最低基本料金) + 月額保守料金 */
  counterBeforeTax: number;
  counterTax: number;
  /** 請求金額（税込） */
  counterTotal: number;
}

export interface FleetUnitCalc {
  unit: FleetUnit;
  /** 表に出す通し番号（1始まり） */
  no: number;
  current: FleetSideCalc;
  proposal: FleetSideCalc;
}

/** 現行 or 提案の全台合計 */
export interface FleetTotals {
  /** 月額リース料の合計（税抜） */
  leaseMonthly: number;
  leaseTax: number;
  /** リース料金 合計（税込） */
  leaseTotal: number;
  /** カウンター料金 小計（税込） */
  counterSubtotal: number;
  /**
   * 合計金額（単月・税込）。
   * リース料金が不明な案件では、カウンター料金の小計だけになる。
   */
  monthly: number;
  yearly: number;
  /** 合計金額（リース年数ぶん） */
  longTerm: number;
}

export interface FleetCalc {
  units: FleetUnitCalc[];
  current: FleetTotals;
  proposal: FleetTotals;
  /** リース料金が不明で、カウンター料金だけで比べる案件か */
  leaseUnknown: boolean;
  /** 提案 − 現行（マイナスが削減） */
  diffMonthly: number;
  diffYearly: number;
  /** リース年数ぶんの削減額 */
  diffLeaseTerm: number;
  /** リースの支払回数（60/72/84） */
  leaseTerm: number;
  /** リース年数（5/6/7）。表の見出しに使う */
  leaseYears: number;
  /** 削減率（マイナスが削減）。diffMonthly ÷ 現行の合計金額 */
  reductionRate: number;
}

/**
 * 販売額の決め方
 *  fromGp     : 仕切価格に粗利額（GP）を加える（本体価格 = 仕切 + GP）
 *  fromLease  : 目標の月額リース料から販売額を逆算（既存Excelと同じ運用）
 *  fromMargin : 仕切価格に粗利率を乗せる
 *  fromPrice  : 本体価格を直接入力（オプション・残債精算はこれに加算される）
 */
export type PricingMode = "fromGp" | "fromLease" | "fromMargin" | "fromPrice";

export interface Proposal {
  id: string;
  maker: Maker;
  /**
   * この提案の見積書番号。
   * 台帳の運用に合わせ、機種（提案）1件につき1番号を割り当てる。
   */
  quoteNo?: string;
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
  /**
   * fromPrice: 本体価格（税抜）を直接入力した額。
   * PTFの対象になる額で、オプション（ptfExempt）と旧リースの残債精算は
   * これに加算されて販売額計になる。
   */
  bodyPrice?: number;
  /** @deprecated bodyPrice の旧称。古い案件を読むためだけに残している */
  sellingTotal?: number;
  /** 見積書に載せるリース回数 */
  leaseTerm: LeaseTerm;
  /** 代理店が2社入る案件（PTFを2社に払い出す） */
  twoAgencies?: boolean;
  /**
   * 提案資料に載せるオプション（機種DBのオプションID）。
   * 未指定なら、その機種のオプションをすべて載せる。
   */
  optionIds?: string[];
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
  /**
   * 複合機が複数台ある案件。
   * enabled のときは、台数ぶんを1枚にまとめたA3ヨコの複数台比較表を出す。
   */
  fleet?: Fleet;
  /** 提案資料（写真入りのご提案書）に載せる、この案件だけの内容 */
  proposalDoc?: QuoteProposalDoc;
  ingest?: {
    counter: CounterReading[];
    lease: LeaseReading[];
    files: IngestedFileRecord[];
    warnings: string[];
  };
  createdAt: string;
  updatedAt: string;
}

/**
 * 読み取った資料1件の記録。
 * どのファイルを、どうやって（AI／文字起こし）読んだのかを残す。
 */
export interface IngestedFileRecord {
  /** アップロード時のファイル名（画面に出す） */
  name: string;
  kind: string;
  role: string;
  parsedAt: string;
  /** 保管したファイル名。これで原本を開き直せる */
  file?: string;
  /** AI（Claude）で読み取ったか */
  aiUsed?: boolean;
  /** 文字起こし（OCR）で読み取ったか */
  ocrUsed?: boolean;
  /** 読み取れた行数（確認用） */
  lineCount?: number;
}

/** 案件ごとの提案資料の内容 */
export interface QuoteProposalDoc {
  /** 表紙の標題（未指定なら設定の既定値） */
  title?: string;
  /** 表紙のリード文 */
  lead?: string;
  /** 現状の課題（箇条書き。提案資料の「現状」ページに載せる） */
  issues?: string[];
  /** 提案の訴求ポイント（箇条書き。未指定なら設定の既定値） */
  highlights?: string[];
  /** 現行機の写真のファイル名。未指定なら機種DBの写真を使う */
  currentPhoto?: string;
  /** 結びの文 */
  closing?: string;
}

/* ---------------- 計算結果 ---------------- */

export interface CounterBreakdown {
  monoAmount: number;
  colorAmount: number;
  twoColorAmount: number;
  /** 最低基本料金の適用有無 */
  minChargeApplied: boolean;
  total: number;
  /**
   * 一律控除（ミスプリント控除など）の内訳。
   * 現行機にだけ付くもので、提案側では undefined になる。
   */
  deduction?: CounterDeduction;
}

/** 一律控除の内訳（控除された枚数と、控除後の請求枚数） */
export interface CounterDeduction {
  rate: number;
  mono: number;
  color: number;
  twoColor: number;
  /** 控除された枚数の合計 */
  total: number;
  /** 控除後の請求枚数 */
  billable: { mono: number; color: number; twoColor: number };
}

/** 逓減単価の段ごとの計算結果（比較表の行になる） */
export interface ChargeBandCalc {
  label: string;
  pages: number;
  unit: number;
  amount: number;
}

/** カウンター区分1行の計算結果 */
export interface ChargeLineCalc {
  name: string;
  kind: CurrentChargeLine["kind"];
  /** 控除前のカウント */
  pages: number;
  /** 控除カウント（切り上げ） */
  deduction: number;
  /** 請求カウント */
  billablePages: number;
  bands: ChargeBandCalc[];
  amount: number;
  /** 実効単価 = 金額 ÷ 控除前カウント（提案の一律単価と比べる用） */
  effectiveUnit: number;
  /** 明細の金額と計算が合わない場合の差額（円）。0なら一致 */
  amountDiff?: number;
}

export interface CurrentCalc {
  monthlyLease: number;
  /** リース料金が不明で、カウンター料金だけで比べる案件か */
  leaseUnknown: boolean;
  counter: CounterBreakdown;
  maintenanceMonthly: number;
  /** カウンター料金の内訳（逓減単価の明細を読み取った場合） */
  chargeLines?: ChargeLineCalc[];
  /** ランニングコスト（税抜） */
  running: number;
  tax: number;
  /** 月間経費（税込） */
  monthlyTotal: number;
  /**
   * 提案と比べる額（税込）。
   * ふつうは月間経費と同じだが、リース料金が不明な案件では
   * カウンター料金＋保守料金だけになる。
   */
  comparable: number;
  totalPages: number;
}

/** オプション1件の、提案資料に出す計算結果 */
export interface OptionCalc {
  option: DeviceOption;
  /** 定価 × 掛け率（提案資料には出さない社内向けの数字） */
  price: number;
  /** これを付けた場合に増える月額リース料（円）。提案資料にはこれだけ出す */
  monthlyLeaseAdd: number;
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
    /** 現行リース料の単月額（見積書の単価欄に出す） */
    monthlyLease: number;
    /** 残債の月数（残債 ÷ 現行リース料） */
    remainingMonths: number;
    /** 見積書の数量欄に出す月数（残債の月数 ＋ 解約事務手数料の月数） */
    totalMonths: number;
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
  /**
   * カウンター料金だけで比べているか。
   * 現行のリース料金が不明な案件では、両側ともリース料を除いて比べる。
   */
  counterOnly: boolean;
  /** 現行と比べる額（税込）。counterOnly のときはリース料を含まない */
  comparable: number;
  /** 現行との差額（マイナスが削減） */
  diffMonthly: number;
  diffYearly: number;
  /** リース期間ぶんの削減額（リース年数 × 12ヶ月） */
  diffLeaseTerm: number;
  /** この提案のリース年数（5/6/7）。比較表の見出しに使う */
  leaseYears: number;
  /** 収益 */
  cost: number;
  grossProfit: number;
  /** PTF合計（代理店2社の場合は2社ぶんの合計） */
  ptf: number;
  /** PTFの内訳（1社目／2社目） */
  ptfBreakdown: { primary: number; second: number };
  netProfit: number;
  /** 提案資料に載せるオプションと、その月額リース料の増加額 */
  options: OptionCalc[];
}
