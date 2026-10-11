import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { Quote } from "./types";

/**
 * 案件に「作った人・直した人」を残す。
 *
 * 1人で使っているうちは無くても困らないが、基幹システムに入れて
 * 全社で共有すると必ず要る。あとから足すと、それまでの案件が全部
 * 「作った人が分からない」まま残るので、先に入れてある。
 */

let dir = "";
let store: typeof import("./store");

const blank = (id: string): Quote => ({
  id,
  title: "複合機入替のご提案",
  customerName: "ヤハタ木工有限会社",
  customerHonorific: "御中",
  quoteNo: "137240",
  quoteDate: "2026-10-11",
  area: "福岡",
  current: {
    makerText: "",
    modelText: "",
    monthlyLease: 0,
    monoPages: 0,
    colorPages: 0,
    twoColorPages: 0,
    units: { mono: 0, color: 0, twoColor: 0, minCharge: 0 },
    maintenanceMonthly: 0,
  },
  proposals: [],
  createdAt: "2026-10-11T00:00:00.000Z",
  updatedAt: "2026-10-11T00:00:00.000Z",
});

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "mfp-owner-"));
  process.env.MFP_DATA_DIR = dir;
  store = await import("./store");
});

afterAll(async () => {
  delete process.env.MFP_DATA_DIR;
  await rm(dir, { recursive: true, force: true });
});

describe("案件の作った人・直した人", () => {
  it("作った人は最初の1回だけ記録し、あとから上書きしない", async () => {
    const made = await store.saveQuote(blank("q1"), "k.kevin@denrai.net");
    expect(made.createdBy).toBe("k.kevin@denrai.net");
    expect(made.updatedBy).toBe("k.kevin@denrai.net");

    const edited = await store.saveQuote({ ...made, title: "直した" }, "akamine@denrai.net");
    expect(edited.createdBy).toBe("k.kevin@denrai.net");
    expect(edited.updatedBy).toBe("akamine@denrai.net");
  });

  it("ログインの前に作られた案件も、そのまま開ける", async () => {
    const old = await store.saveQuote(blank("q2"));
    expect(old.createdBy).toBeUndefined();

    // あとから誰かが直せば、その人が「直した人」として入る
    const edited = await store.saveQuote({ ...old, title: "直した" }, "akamine@denrai.net");
    expect(edited.createdBy).toBe("akamine@denrai.net");
    expect(edited.updatedBy).toBe("akamine@denrai.net");
  });

  it("削除の記録には、選んだ担当者と、ログインしていた人の両方を残す", async () => {
    await store.saveQuote(blank("q3"), "k.kevin@denrai.net");
    const record = await store.deleteQuote("q3", "小坂", "k.kevin@denrai.net");
    expect(record.deletedBy).toBe("小坂");
    expect(record.deletedByUser).toBe("k.kevin@denrai.net");
    expect(await store.getQuote("q3")).toBeUndefined();
  });
});
