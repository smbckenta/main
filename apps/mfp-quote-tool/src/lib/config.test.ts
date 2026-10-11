import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 置き場所の設定。
 *
 * 基幹システムに入れるときに書き換える値なので、
 * 書き方のゆれ（前後のスラッシュ、空文字）で動きが変わらないことを押さえる。
 */

const ENV_KEYS = ["MFP_BASE_PATH", "MFP_IDENTITY", "MFP_IDENTITY_HEADER", "MFP_PROXY_TOKEN"];

const load = async (env: Record<string, string>) => {
  for (const key of ENV_KEYS) delete process.env[key];
  Object.assign(process.env, env);
  vi.resetModules();
  return import("./config");
};

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("このツールの住所（BASE_PATH）", () => {
  it("指定が無ければ、いまのまま入口直下", async () => {
    expect((await load({})).BASE_PATH).toBe("");
  });

  it("先頭のスラッシュは足し、末尾のスラッシュは落とす", async () => {
    expect((await load({ MFP_BASE_PATH: "mfp" })).BASE_PATH).toBe("/mfp");
    expect((await load({ MFP_BASE_PATH: "/mfp/" })).BASE_PATH).toBe("/mfp");
    expect((await load({ MFP_BASE_PATH: "/tools/mfp//" })).BASE_PATH).toBe("/tools/mfp");
  });

  it("空白だけの指定は、指定なしと同じに扱う", async () => {
    expect((await load({ MFP_BASE_PATH: "   " })).BASE_PATH).toBe("");
  });
});

describe("ログインしている人を誰が決めるか", () => {
  it("既定はこのツール自身のログイン画面", async () => {
    const c = await load({});
    expect(c.IDENTITY_SOURCE).toBe("local");
    expect(c.TRUSTED_PROXY_TOKEN).toBeUndefined();
  });

  it("header を指定したときだけ、基幹システムから受け取る", async () => {
    expect((await load({ MFP_IDENTITY: "header" })).IDENTITY_SOURCE).toBe("header");
    // 綴り違いで、うっかり開いてしまわないこと
    expect((await load({ MFP_IDENTITY: "Header" })).IDENTITY_SOURCE).toBe("local");
    expect((await load({ MFP_IDENTITY: "sso" })).IDENTITY_SOURCE).toBe("local");
  });

  it("ヘッダー名と合言葉は差し替えられる", async () => {
    const c = await load({ MFP_IDENTITY_HEADER: "x-denrai-login", MFP_PROXY_TOKEN: "aikotoba" });
    expect(c.IDENTITY_HEADER).toBe("x-denrai-login");
    expect(c.TRUSTED_PROXY_TOKEN).toBe("aikotoba");
  });
});
