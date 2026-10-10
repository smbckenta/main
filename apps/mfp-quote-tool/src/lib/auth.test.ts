import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

/**
 * ログインの土台。
 * パスワードは元の文字列を残さず、合っているときだけ通す。
 * 権限（オーナー・管理者・利用者）でできることが分かれる。
 */

let dir = "";
let auth: typeof import("./auth");

const OWNER = "k.kevin@denrai.net";
const ADMIN = "akamine@denrai.net";
const MEMBER = "staff@denrai.net";

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
  it("メールアドレスでないIDは断る", () => {
    expect(auth.checkCredentials("kosaka", "password1")).toContain("メールアドレス");
    expect(auth.checkCredentials("小坂ケビン", "password1")).toContain("メールアドレス");
    expect(auth.checkCredentials("k.kevin@denrai", "password1")).toContain("メールアドレス");
  });

  it("弱いパスワードは断る", () => {
    expect(auth.checkCredentials(OWNER, "abc")).toContain("8文字以上");
    expect(auth.checkCredentials(OWNER, "12345678")).toContain("数字だけ");
  });

  it("メールアドレスとふつうのパスワードは通す", () => {
    expect(auth.checkCredentials(OWNER, "smbc0301")).toBeUndefined();
  });
});

describe("利用者の登録とログイン", () => {
  it("最初の1人はオーナーになる", async () => {
    expect(await auth.hasAnyUser()).toBe(false);
    const owner = await auth.createUser("K.Kevin@Denrai.net", "mfp-2026-pass", "小坂");
    expect(owner.role).toBe("owner");

    // IDは大文字小文字を区別しない
    const me = await auth.verifyUser(OWNER, "mfp-2026-pass");
    expect(me?.id).toBe(OWNER);
    expect(me?.name).toBe("小坂");
  });

  it("2人目からは利用者。オーナーを名乗らせない", async () => {
    const added = await auth.createUser(MEMBER, "staff-pass-1", "山田", "owner");
    expect(added.role).toBe("admin");
    await auth.setRole(OWNER, MEMBER, "member");
    expect((await auth.findUser(MEMBER))?.role).toBe("member");
  });

  it("パスワードが違えば通さない", async () => {
    expect(await auth.verifyUser(OWNER, "mfp-2026-Pass")).toBeUndefined();
    expect(await auth.verifyUser(OWNER, "")).toBeUndefined();
    expect(await auth.verifyUser("unknown@denrai.net", "mfp-2026-pass")).toBeUndefined();
  });

  it("パスワードは元の文字列を残さない", async () => {
    const list = await auth.listUsers();
    expect(JSON.stringify(list)).not.toContain("mfp-2026-pass");
    expect(list[0].hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("同じIDは二重に登録できない", async () => {
    await expect(auth.createUser(OWNER, "another-pass-1")).rejects.toThrow("すでに登録");
  });

  it("パスワードを変えると、古いほうでは入れなくなる", async () => {
    await auth.changePassword(OWNER, "mfp-2026-pass", "mfp-2027-newpass");
    expect(await auth.verifyUser(OWNER, "mfp-2026-pass")).toBeUndefined();
    expect(await auth.verifyUser(OWNER, "mfp-2027-newpass")).toBeTruthy();
  });

  it("いまのパスワードが違えば変えられない", async () => {
    await expect(auth.changePassword(OWNER, "wrong-pass-1", "another-pass-1")).rejects.toThrow(
      "いまのパスワードが違います",
    );
  });
});

describe("権限", () => {
  it("管理者を任命できるのはオーナーだけ", async () => {
    await auth.createUser(ADMIN, "akamine-pass-1", "赤嶺");
    await auth.setRole(OWNER, ADMIN, "admin");
    expect((await auth.findUser(ADMIN))?.role).toBe("admin");

    await expect(auth.setRole(ADMIN, MEMBER, "admin")).rejects.toThrow("オーナーだけ");
  });

  it("オーナーの権限は動かせない", async () => {
    await expect(auth.setRole(OWNER, OWNER, "member")).rejects.toThrow("オーナーの権限");
    await expect(auth.setRole(OWNER, ADMIN, "owner")).rejects.toThrow("1人だけ");
  });

  it("管理者は他の人のパスワードを再発行できる", async () => {
    const issued = await auth.resetPassword(ADMIN, MEMBER);
    expect(issued.length).toBeGreaterThanOrEqual(8);
    expect(await auth.verifyUser(MEMBER, "staff-pass-1")).toBeUndefined();
    expect(await auth.verifyUser(MEMBER, issued)).toBeTruthy();
  });

  it("ふつうの利用者は他の人のパスワードに触れない", async () => {
    await expect(auth.resetPassword(MEMBER, ADMIN)).rejects.toThrow("管理者だけ");
  });

  it("管理者でもオーナーのパスワードは変えられない", async () => {
    await expect(auth.resetPassword(ADMIN, OWNER)).rejects.toThrow("オーナー本人");
  });

  it("オーナーは削除できない。削除できるのも管理者だけ", async () => {
    await expect(auth.deleteUser(ADMIN, OWNER)).rejects.toThrow("オーナーは削除できません");
    await expect(auth.deleteUser(MEMBER, ADMIN)).rejects.toThrow("管理者だけ");
    await auth.deleteUser(OWNER, MEMBER);
    expect((await auth.listUsers()).map((u) => u.id)).toEqual([OWNER, ADMIN]);
  });

  it("再発行のパスワードは紛らわしい文字を使わない", () => {
    expect(auth.makePassword()).not.toMatch(/[0OlI1]/);
  });
});

describe("ログインの保持（署名つきの文字列）", () => {
  it("作った文字列からIDを読み戻せる", async () => {
    const token = await auth.createSessionToken(OWNER);
    expect(await auth.readSessionToken(token)).toBe(OWNER);
  });

  it("書き換えられた文字列は受け付けない", async () => {
    const token = await auth.createSessionToken(OWNER);
    const [payload, mac] = token.split(".");
    // 別人のIDに差し替える
    const forged = Buffer.from(JSON.stringify({ id: ADMIN, exp: Date.now() + 1000 })).toString(
      "base64url",
    );
    expect(await auth.readSessionToken(`${forged}.${mac}`)).toBeUndefined();
    expect(await auth.readSessionToken(`${payload}.${mac}x`)).toBeUndefined();
    expect(await auth.readSessionToken(undefined)).toBeUndefined();
    expect(await auth.readSessionToken("でたらめ")).toBeUndefined();
  });
});
