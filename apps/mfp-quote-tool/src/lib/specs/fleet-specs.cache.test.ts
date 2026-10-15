import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * いちど調べた印刷速度は機種DBに残し、二度とインターネットに出ない。
 * 台数が多い案件では、ここが効かないと同じ機種を何度も取りに行ってしまう。
 */

// 本番の保存先を汚さないよう、テスト専用のフォルダに向ける
const DATA_DIR = path.join(tmpdir(), `mfp-fleet-specs-${process.pid}`);
process.env.MFP_DATA_DIR = DATA_DIR;

describe("印刷速度のキャッシュ", () => {
  let fetched = 0;

  beforeAll(async () => {
    // メーカーサイトへの問い合わせを数える（実際には出ない）
    vi.stubGlobal("fetch", async () => {
      fetched += 1;
      return new Response("", { status: 404 });
    });
    await fs.mkdir(DATA_DIR, { recursive: true }).catch(() => {});
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await fs.rm(DATA_DIR, { recursive: true, force: true }).catch(() => {});
  });

  it("機種DBにある機種はインターネットに出ない", async () => {
    const { upsertDevice } = await import("../store");
    const { fillFleetSpecs } = await import("./fleet-specs");
    await upsertDevice({
      maker: "RICOH",
      model: "IM C9999",
      ppmColor: 90,
      source: { method: "manual" },
    });

    fetched = 0;
    const fleet = {
      enabled: true,
      leaseTerm: 72,
      units: [
        {
          id: "u1",
          location: "本社",
          current: {
            makerText: "リコー",
            // 括弧書きの製品コードが付いていても引ける
            modelText: "RICOH IM C9999（[999X]IMC9999)",
            monthlyLease: 0,
            minCharge: 0,
            maintenanceMonthly: 0,
            lines: [],
          },
          proposal: {
            makerText: "",
            modelText: "",
            monthlyLease: 0,
            minCharge: 0,
            maintenanceMonthly: 0,
            lines: [],
          },
        },
      ],
    };

    const result = await fillFleetSpecs(fleet, { fetchSpec: true });
    expect(result.fleet.units[0].current.ppm).toBe(90);
    expect(result.filled[0].origin).toBe("local");
    expect(fetched).toBe(0);
  });

  it("すでに速度が入っている台には手を出さない", async () => {
    const { fillFleetSpecs } = await import("./fleet-specs");
    fetched = 0;
    const fleet = {
      enabled: true,
      leaseTerm: 72,
      units: [
        {
          id: "u1",
          location: "本社",
          current: {
            makerText: "リコー",
            modelText: "IM C0001",
            ppm: 35,
            monthlyLease: 0,
            minCharge: 0,
            maintenanceMonthly: 0,
            lines: [],
          },
          proposal: {
            makerText: "",
            modelText: "",
            monthlyLease: 0,
            minCharge: 0,
            maintenanceMonthly: 0,
            lines: [],
          },
        },
      ],
    };
    const result = await fillFleetSpecs(fleet, { fetchSpec: true });
    expect(result.fleet.units[0].current.ppm).toBe(35);
    expect(result.filled).toEqual([]);
    expect(fetched).toBe(0);
  });
});

describe("読み違えた速度の取り直し", () => {
  it("機種DBに「4枚/分」が残っていても、それを答えにしない", async () => {
    const { upsertDevice } = await import("../store");
    const { fillFleetSpecs } = await import("./fleet-specs");
    // 仕様ページの読み違いで入ってしまった値（「A4ヨコ 25枚/分」の A4）
    await upsertDevice({
      maker: "TOSHIBA",
      model: "2515AC",
      ppmColor: 4,
      ppmMono: 4,
      source: { method: "web" },
    });

    const fleet = {
      enabled: true,
      leaseTerm: 72,
      units: [
        {
          id: "u1",
          location: "津南",
          current: {
            makerText: "東芝",
            modelText: "東芝コピー 2515AC",
            // 画面にも読み違えた値が入っている状態
            ppm: 4,
            monthlyLease: 0,
            minCharge: 0,
            maintenanceMonthly: 0,
            lines: [],
          },
          proposal: {
            makerText: "",
            modelText: "",
            monthlyLease: 0,
            minCharge: 0,
            maintenanceMonthly: 0,
            lines: [],
          },
        },
      ],
    };

    // インターネットにも出られない状況（ここでは404を返す）
    const result = await fillFleetSpecs(fleet, { fetchSpec: true });
    // 間違った 4 を残さず、「分からない」として扱う
    expect(result.fleet.units[0].current.ppm).toBeUndefined();
    expect(result.missing).toEqual(["津南"]);
  });
});
