import { describe, expect, it } from "vitest";
import { checkApiKey, maskApiKey } from "./api-key";

/** 本物と同じ長さの、でたらめなキー（テスト用） */
const VALID = `sk-ant-api03-${"A1b2C3d4E5".repeat(9)}AA`;

describe("APIキーの点検", () => {
  it("正しい形のキーは通す", () => {
    expect(VALID.length).toBeGreaterThanOrEqual(90);
    expect(checkApiKey(VALID)).toBeUndefined();
  });

  it("Consoleの一覧に出ている伏せ字を貼ってしまった場合に気づける", () => {
    // 一覧の表示をそのままコピーすると、この23文字になる
    const masked = "sk-ant-api03-C7J...3gAA";
    expect(masked).toHaveLength(23);
    expect(checkApiKey(masked)).toMatch(/伏せ字/);
  });

  it("途中で切れたキーは長さで気づける", () => {
    expect(checkApiKey("sk-ant-api03-C7J4kd0")).toMatch(/20文字/);
  });

  it("空白・改行が混ざったキーを弾く", () => {
    expect(checkApiKey(`${VALID.slice(0, 40)} ${VALID.slice(40)}`)).toMatch(/空白/);
  });

  it("そもそも別の文字列を貼っている場合を弾く", () => {
    expect(checkApiKey("APIkey")).toMatch(/sk-ant-/);
  });

  it("伏せ字にしたキーは、頭と尻尾と長さだけを見せる", () => {
    expect(maskApiKey(VALID)).toBe(`sk-ant-api03…${VALID.slice(-4)}（${VALID.length}文字）`);
    // 真ん中は絶対に出さない
    expect(maskApiKey(VALID)).not.toContain(VALID.slice(20, 40));
  });
});
