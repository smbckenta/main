import { describe, expect, it } from "vitest";
import { cleanModelText, plausiblePpm } from "./fleet-specs";

/**
 * カウンター明細から起こした型番は、メーカー名や製品コードが付いたまま入る。
 * そのままでは機種DBにも当たらず、メーカーのサイトも引けない。
 */
describe("型番の整形", () => {
  it("メーカー名と括弧書きの製品コードを落とす", () => {
    // 実物：大塚商会の請求書から起こした型番
    expect(cleanModelText("RICOH IM C4500（[302B]IMC4500)")).toBe("IM C4500");
    expect(cleanModelText("IMC3500（[302A] IMC3500)")).toBe("IMC3500");
    expect(cleanModelText("リコー MP C3003SP（本体）")).toBe("MP C3003SP");
  });

  it("もともときれいな型番はそのまま", () => {
    expect(cleanModelText("IM C3500F")).toBe("IM C3500F");
    expect(cleanModelText("TASKalfa MZ3501ci")).toBe("TASKalfa MZ3501ci");
  });

  it("メーカー名だけの行は空になる（引きに行かない）", () => {
    expect(cleanModelText("RICOH").length).toBeLessThan(3);
    expect(cleanModelText("")).toBe("");
  });

  it("余分な空白をつめる", () => {
    expect(cleanModelText("  IM   C4500  ")).toBe("IM C4500");
  });
});

describe("印刷速度の筋の確かめ", () => {
  it("複合機としてありえない速度は「分からない」として扱う", () => {
    // 仕様ページの読み違いで機種DBに入ってしまった値（A4 の 4）
    expect(plausiblePpm(4)).toBeUndefined();
    expect(plausiblePpm(0)).toBeUndefined();
    expect(plausiblePpm(500)).toBeUndefined();
    expect(plausiblePpm(undefined)).toBeUndefined();
  });

  it("実機の速度はそのまま通す", () => {
    expect(plausiblePpm(25)).toBe(25);
    expect(plausiblePpm(35)).toBe(35);
    expect(plausiblePpm(60)).toBe(60);
  });
});

describe("メーカー名つきの型番", () => {
  it("社名や「コピー」が付いていても型番だけにする", () => {
    // 実物：比較表に出ていた表記
    expect(cleanModelText("東芝コピー 2515AC")).toBe("2515AC");
    expect(cleanModelText("リコージャパン株式会社 IMC4510")).toBe("IMC4510");
    expect(cleanModelText("コニカミノルタ bizhub C308（C308）")).toBe("bizhub C308");
    expect(cleanModelText("キヤノン iR-ADVC3935F")).toBe("iR-ADVC3935F");
  });
});
