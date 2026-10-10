import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * ログインの土台。
 * パスワードは元の文字列を残さず、合っているときだけ通す。
 */

let dir = "";
let auth: typeof import("./auth");

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mfp-auth-"));
  process.env.MFP_DATA_DIR = dir;
  auth = await import("./auth");
});

afterAll(async () => {
  delete process.env.MFP_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("IDと合言葉の決まり", () => {
  it("短いIDや弱いパスワードは断る", () => {
    expect(auth.checkCredentials("ab", "password1")).toContain("3文字以上");
    expect(auth.checkCredentials("小坂ケビン", "password1")).toContain("半角");
    expect(auth.checkCredentials("kosaka", "abc")).toContain("8文字以上");
    expect(auth.checkCredentials("kosaka", "12345678")).toContain("数字だけ");
  });

  it("ふつうのIDとパスワードは通す", () => {
    expect(auth.checkCredentials("kosaka", "mfp-2026-pass")).toBeUndefined();
  });
});

describe("利用者の登録とログイン", () => {
  it("登録してからログインできる", async () => {
    expect(await auth.hasAnyUser()).toBe(false);
    await auth.createUser("Kosaka", "mfp-2026-pass", "小坂");
    expect(await auth.hasAnyUser()).toBe(true);

    // IDは大文字小文字を区別しない
    const me = await auth.verifyUser("kosaka", "mfp-2026-pass");
    expect(me?.id).toBe("kosaka");
    expect(me?.name).toBe("小坂");
  });

  it("パスワードが違えば通さない", async () => {
    expect(await auth.verifyUser("kosaka", "mfp-2026-Pass")).toBeUndefined();
    expect(await auth.verifyUser("kosaka", "")).toBeUndefined();
    expect(await auth.verifyUser("unknown", "mfp-2026-pass")).toBeUndefined();
  });

  it("パスワードは元の文字列を残さない", async () => {
    const list = await auth.listUsers();
    expect(JSON.stringify(list)).not.toContain("mfp-2026-pass");
    expect(list[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じIDは二重に登録できない", async () => {
    await expect(auth.createUser("kosaka", "another-pass-1")).rejects.toThrow("すでに登録");
  });

  it("パスワードを変えると、古いほうでは入れなくなる", async () => {
    await auth.changePassword("kosaka", "mfp-2026-pass", "mfp-2027-newpass");
    expect(await auth.verifyUser("kosaka", "mfp-2026-pass")).toBeUndefined();
    expect(await auth.verifyUser("kosaka", "mfp-2027-newpass")).toBeTruthy();
  });

  it("いまのパスワードが違えば変えられない", async () => {
    await expect(auth.changePassword("kosaka", "wrong-pass-1", "another-pass-1")).rejects.toThrow(
      "いまのパスワードが違います",
    );
  });

  it("最後の1人は削除できない", async () => {
    await expect(auth.deleteUser("kosaka")).rejects.toThrow("最後の利用者");
    await auth.createUser("akamine", "akamine-pass-1", "赤嶺");
    await auth.deleteUser("akamine");
    expect((await auth.listUsers()).map((u) => u.id)).toEqual(["kosaka"]);
  });
});

describe("ログインの保持（署名つきの文字列）", () => {
  it("作った文字列からIDを読み戻せる", async () => {
    const token = await auth.createSessionToken("kosaka");
    expect(await auth.readSessionToken(token)).toBe("kosaka");
  });

  it("書き換えられた文字列は受け付けない", async () => {
    const token = await auth.createSessionToken("kosaka");
    const [payload, mac] = token.split(".");
    // 別人のIDに差し替える
    const forged = Buffer.from(JSON.stringify({ id: "akamine", exp: Date.now() + 1000 })).toString(
      "base64url",
    );
    expect(await auth.readSessionToken(`${forged}.${mac}`)).toBeUndefined();
    expect(await auth.readSessionToken(`${payload}.${mac}x`)).toBeUndefined();
    expect(await auth.readSessionToken(undefined)).toBeUndefined();
    expect(await auth.readSessionToken("でたらめ")).toBeUndefined();
  });
});
