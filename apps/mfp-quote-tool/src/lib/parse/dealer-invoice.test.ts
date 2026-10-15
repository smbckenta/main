import { describe, expect, it } from "vitest";
import { parseCounter } from "./counter";
import { parseDealerInvoice } from "./dealer-invoice";
import type { ExtractedDoc } from "./extract";

/**
 * 実物（大塚商会「内訳書」リフェコ株式会社様 2025年2月分）を書き起こしたもの。
 * この様式は設置場所ごとに伝票が並ぶので、台数と設置場所がここから分かる。
 */
const OTSUKA_LINES = [
  "内 訳 書",
  "2025年 2月28日発行 ページ 4 / 14",
  "株式会社 大塚商会",
  "〒830-1222",
  "福岡県三井郡大刀洗町大字上高橋",
  "1121-1",
  "リフェコ 株式会社",
  "北部九州工事課 御中",
  "お客様コード 2002581558",
  "請求No. 010082836638",
  "「請求書」と「内訳書」のセットでインボイス要件を満たします。合わせて保管ください。",
  "日付 伝票番号 品名・規格 数量 単価 金額",
  "2/ 6 FS80347908",
  "北部九州工事課",
  "契約書No.：M223039361",
  "たよれーる(保守契約)料金",
  "リコー ドキュメントソリューション",
  "2025年 2月分 1000",
  "お問合せNo.（1005337492）",
  "■2025/ 2 1,000円 消費税等 10%",
  "2/ 6 FS80347931",
  "北部九州工事課",
  "契約書No.：M223786060",
  "たよれーる(保守契約)料金",
  "RICOH IM C3500F",
  "2025年 2月分 800",
  "お問合せNo.（1005880135）",
  "■2025/ 2 800円 消費税等 10%",
  "2/ 7 EA51588147",
  "パフォーマンスチャージ（株式会社リコーの代行請求）",
  "IMC3500 630088",
  "■課税対象合計 630円 消費税等 10%",
  "小 計 3,983",
];

/** 2ページ目（別の設置場所）。実際は1ファイルに何ページも入っている */
const NAOKATA_LINES = [
  "内 訳 書",
  "2025年 2月28日発行 ページ 5 / 14",
  "株式会社 大塚商会",
  "リフェコ 株式会社",
  "ゆめソーラー直方店 御中",
  "2/ 6 FS80348059",
  "ゆめソーラー直方店",
  "契約書No.：M222899210",
  "たよれーる(保守契約)料金",
  "RICOH IM C3500F",
  "2025年 2月分 800",
  "■2025/ 2 800円 消費税等 10%",
  "2/ 7 EA51588113",
  "パフォーマンスチャージ（株式会社リコーの代行請求）",
  "IMC3500 629763",
  "■課税対象合計 2,557円 消費税等 10%",
  "小 計 3,357",
];

const doc = (lines: string[]): ExtractedDoc => ({
  name: "大塚商会_内訳書.pdf",
  kind: "pdf",
  ocrUsed: true,
  lines,
  text: lines.join("\n"),
  warnings: [],
});

describe("販売店の請求書（大塚商会の内訳書）", () => {
  it("設置場所ごとに1台として読み取る", () => {
    const readings = parseDealerInvoice(doc([...OTSUKA_LINES, ...NAOKATA_LINES]));
    expect(readings.map((r) => r.location)).toEqual(["北部九州工事課", "ゆめソーラー直方店"]);
  });

  it("機種・機番・メーカーを拾う", () => {
    const [kita, naokata] = parseDealerInvoice(doc([...OTSUKA_LINES, ...NAOKATA_LINES]));
    // 保守契約の行にある正式な型番（IM C3500F）を採り、機番はチャージの行から採る
    expect(kita.modelText).toBe("IM C3500F");
    expect(kita.serialNo).toBe("630088");
    expect(kita.makerText).toBe("リコー");
    expect(naokata.serialNo).toBe("629763");
  });

  it("カウンター料金と保守料金を分けて拾う", () => {
    const [kita, naokata] = parseDealerInvoice(doc([...OTSUKA_LINES, ...NAOKATA_LINES]));
    // パフォーマンスチャージ 630円 ／ たよれーる 1,000 + 800 = 1,800円
    expect(kita.amount).toBe(630);
    expect(kita.maintenanceMonthly).toBe(1_800);
    expect(naokata.amount).toBe(2_557);
    expect(naokata.maintenanceMonthly).toBe(800);
  });

  it("同じ設置場所が何度出てきても1台にまとめる", () => {
    const readings = parseDealerInvoice(doc(OTSUKA_LINES));
    expect(readings).toHaveLength(1);
  });

  it("カウンター明細の読み取り全体からも同じ結果になる", () => {
    const readings = parseCounter(doc([...OTSUKA_LINES, ...NAOKATA_LINES]));
    expect(readings.map((r) => r.location)).toEqual(["北部九州工事課", "ゆめソーラー直方店"]);
  });

  it("メーカー直のパフォーマンスチャージ明細には手を出さない（そちらは枚数まで読める）", () => {
    const ricoh = [
      "サービス料金計算明細",
      "パフォーマンスチャージ 9,937",
      "モノカラー総出力 1,389カウント",
      "控除 2%の控除カウント 28カウント",
      "1- 1000 ／月 3.0円 1,000カウント 3,000円",
    ];
    expect(parseDealerInvoice(doc(ricoh))).toEqual([]);
  });
});
