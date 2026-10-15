import { describe, expect, it } from "vitest";
import { config } from "./proxy";

/**
 * 入口でログインを確かめる範囲。
 *
 * MFP_BASE_PATH を設定して `/mfp` のような場所にぶら下げると、
 * 照合に使われる道は基準部分を取り除いたあとのものになり、
 * トップページだけが空文字になる。`/(.*)` の形だけでは引っかからず、
 * トップページが素通りしていた（実際に起きた）。
 */

describe("入口で止める範囲", () => {
  it("トップページを別に並べてある（ぶら下げたときに素通りさせないため）", () => {
    expect(config.matcher).toContain("/");
  });

  it("画面もAPIも拾う", () => {
    const patterns = config.matcher.map((m) => new RegExp(`^${m.replace(/\/$/, "")}$`));
    const hits = (p: string) => patterns.some((re) => re.test(p));
    for (const path of ["/", "/settings", "/pricebook", "/api/quotes", "/api/auth/users"]) {
      expect(hits(path), `${path} が入口の対象から漏れている`).toBe(true);
    }
  });
});
