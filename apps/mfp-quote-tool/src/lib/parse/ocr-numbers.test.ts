import { describe, expect, it } from "vitest";
import { normalizeOcrNumbers } from "./ocr";

describe("OCRの数字の崩れを直す", () => {
  it("桁区切りの後の空白を詰める", () => {
    expect(normalizeOcrNumbers("モノクロ 452, 180 455, 180")).toBe("モノクロ 452,180 455,180");
  });

  it("桁区切りがピリオドとして読まれた場合はカンマに戻す", () => {
    expect(normalizeOcrNumbers("3.000 枚")).toBe("3,000 枚");
  });

  it("小数点がカンマとして読まれた場合はピリオドに戻す", () => {
    expect(normalizeOcrNumbers("フルカラー 2,000 15,00 30,000")).toBe("フルカラー 2,000 15.00 30,000");
    expect(normalizeOcrNumbers("単価 1,5 円")).toBe("単価 1.5 円");
  });

  it("正しい桁区切りは変えない", () => {
    expect(normalizeOcrNumbers("1,234,567 円")).toBe("1,234,567 円");
    expect(normalizeOcrNumbers("15.00")).toBe("15.00");
  });
});
