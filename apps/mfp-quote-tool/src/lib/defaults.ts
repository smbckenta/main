import type { Settings } from "./types";
import { DEFAULT_PROPOSAL_DOC } from "./proposal-doc";

/**
 * 初期設定値。既存の見積書Excel・仕切表・研修資料の運用値をそのまま初期値にしている。
 * 変更は設定画面（/settings）から行う。
 */
export const DEFAULT_SETTINGS: Settings = {
  company: {
    // 複合機の提案は株式会社Life Yokusuru名義で作成する
    name: "株式会社Life Yokusuru",
    representative: "代表取締役　小坂 ケビン 絢太",
    postalCode: "",
    address: "福岡県久留米市本町2-23　栗原ビルディング4F",
    tel: "0942-64-9035",
    fax: "0942-64-9036",
    branchNote: "◎久留米本社",
    offices: [
      { name: "久留米本社", address: "福岡県久留米市本町2-23　栗原BLD 4F" },
      { name: "博多営業所", address: "福岡県福岡市博多区博多駅前4-18-19　博多フロントビル5F" },
      { name: "横浜営業所", address: "神奈川県横浜市都筑区川向町2002番3" },
    ],
    areaNote: "",
    validityText: "ご提示から2週間",
    taxRate: 0.1,
  },

  // 既存見積書のリースシミュレーション（5年1.95% / 6年1.66% / 7年1.45%）
  leaseRates: { "60": 0.0195, "72": 0.0166, "84": 0.0145 },

  counterBasis: "colorVolume",

  // 研修資料「複合機1台あたりの印刷量とおおよその単価」
  counterTiersByColorVolume: [
    { min: 0, max: 500, mono: 0.7, color: 7.0 },
    { min: 501, max: 1500, mono: 0.65, color: 6.5 },
    { min: 1501, max: 3000, mono: 0.6, color: 6.0 },
    { min: 3001, max: 4500, mono: 0.55, color: 5.5 },
    { min: 4501, max: 6000, mono: 0.5, color: 5.0 },
    { min: 6001, max: 10000, mono: 0.45, color: 4.5 },
    { min: 10001, max: null, mono: 0.4, color: 4.0 },
  ],

  // 研修資料「複合機1台あたりカウンター料金総合計とおおよその単価」
  counterTiersByAmount: [
    { min: 0, max: 15000, mono: 0.7, color: 7.0 },
    { min: 15001, max: 25000, mono: 0.65, color: 6.5 },
    { min: 25001, max: 40000, mono: 0.6, color: 6.0 },
    { min: 40001, max: 55000, mono: 0.55, color: 5.5 },
    { min: 55001, max: 150000, mono: 0.5, color: 5.0 },
    { min: 150001, max: 250000, mono: 0.45, color: 4.5 },
    { min: 250001, max: null, mono: 0.4, color: 4.0 },
  ],

  // 2色カラーはフルカラー単価の約3割（京セラ提案例: フルカラー7.0円 → 2色2.0円）
  twoColorRatio: 0.3,
  // メーカー別の指定がない場合の最低基本料金（都度メーカー条件を確認して入力する）
  defaultMinCharge: 0,
  // 保守ランクS/A（当日対応可）のエリアで、印刷枚数が少なくても提示できる基準単価
  sameDayBaseUnits: { mono: 0.7, color: 7.0 },

  // 研修資料「複合機のグレード（〇〇枚機）」
  gradeTiers: [
    { minPages: 0, ppm: 25 },
    { minPages: 3001, ppm: 35 },
    { minPages: 8000, ppm: 40 },
    { minPages: 15000, ppm: 50 },
    { minPages: 20000, ppm: 60 },
    { minPages: 30000, ppm: 70 },
  ],

  areas: [
    { name: "福岡", remote: false },
    { name: "佐賀", remote: false },
    { name: "長崎", remote: false },
    { name: "熊本", remote: false },
    { name: "大分", remote: false },
    { name: "宮崎", remote: false },
    { name: "鹿児島", remote: false },
    { name: "関西圏", remote: false },
    { name: "関東圏", remote: false },
    { name: "その他地域", remote: false },
    { name: "離島・僻地", remote: true },
  ],

  defaultMarginRate: 0.3,
  // 提案を追加したときのGP（粗利額）の初期値
  defaultGrossProfit: 300_000,

  // 旧リースの残債は「残債 + 現行リース料3ヶ月分（解約事務手数料）」を見積金額に含める
  debtSettlement: { includeInQuote: true, cancellationMonths: 3 },

  // PTFは本体価格の10%。オプション・追加PC設定として上乗せした分には料率を適用しない
  ptf: {
    base: "bodyPrice",
    rate: 0.1,
    // 代理店が2社入る場合、2社目は本体価格の2%
    secondRate: 0.02,
    fixed: 0,
    counter: { enabled: false, rate: 0.1, months: 60 },
    cap: 0,
    roundUnit: 1,
  },

  roundUnit: 100,
  // 月額リース料は100円単位で切り上げる（16,080円 → 16,100円）
  leaseRoundUnit: 100,

  // 京セラの2色カラーは2.0円（フルカラー7.0円に対する運用値）
  twoColorUnitByMaker: { KYOCERA: 2.0 },

  proposalDoc: DEFAULT_PROPOSAL_DOC,

  staff: [
    "小坂 ケビン 絢太",
    "山内 孔士郎",
    "河内山 大我",
    "中村 啓就",
    "諸富 有佳倫",
    "上野 光一",
    "徳永 将",
    "田中 孝樹",
    "池 善信",
    "江藤 錠太郎",
  ],

  // 案件の削除にはパスワードが要る。初期値は未設定＝削除できない
  deletion: { passwordHash: "" },

  // 見積書番号の台帳（Googleスプレッドシート「見積書」シート）
  quoteRegister: {
    enabled: true,
    // 台帳のスプレッドシートに設置した Apps Script のウェブアプリ経由で読み書きする
    mode: "appsScript",
    spreadsheetId: "1EcnpradH2qyEqrH8hxQvTCbjTS6Q9HUDofabKZDLWPE",
    sheetName: "見積書",
    webAppUrl: "",
    webAppToken: "",
    startNumber: 137_240,
  },

  // 書類の読み取りはAI（Claude）が既定。APIキーは設定画面か環境変数 ANTHROPIC_API_KEY で渡す
  ai: {
    enabled: true,
    apiKey: "",
    model: "claude-opus-5",
    maxPages: 20,
  },
};
