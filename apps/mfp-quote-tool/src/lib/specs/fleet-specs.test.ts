import { describe, expect, it } from "vitest";
import { cleanModelText } from "./fleet-specs";

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
