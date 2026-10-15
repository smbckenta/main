import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./defaults";
import {
  describeRates,
  isOutdatedLeaseRates,
  LEASE_RATE_NOTICE,
  STANDARD_LEASE_RATES,
} from "./lease-rates";
import { calcProposal, leaseRateOf } from "./pricing";
import type { Proposal, Quote } from "./types";

/**
 * リース料率。
 *
 * 料率はリース会社が決めるもので、改定の通知が来たら書き換える。
 * 低いまま使うと月額リース料を安く見せてしまい、契約後に
 * リース会社の請求と合わなくなるので、通知の数字そのままを押さえる。
 */

describe("2026年10月26日ご申込分からの料率", () => {
  it("通知の数字どおり（5年2.01% / 6年1.72% / 7年1.51%）", () => {
    expect(STANDARD_LEASE_RATES).toEqual({ "60": 0.0201, "72": 0.0172, "84": 0.0151 });
  });

  it("初期設定もこの料率を使う", () => {
    expect(DEFAULT_SETTINGS.leaseRates).toEqual(STANDARD_LEASE_RATES);
  });

  it("改定前の料率も記録しておく（何がどう変わったか後から分かるように）", () => {
    expect(LEASE_RATE_NOTICE.before[60]).toBe(0.0195);
    expect(LEASE_RATE_NOTICE.before[72]).toBe(0.0166);
    expect(LEASE_RATE_NOTICE.before[84]).toBe(0.0145);
    // 全期間そろって +0.06ポイント
    for (const term of [36, 48, 60, 72, 84, 96] as const) {
      const diff = LEASE_RATE_NOTICE.after[term] - LEASE_RATE_NOTICE.before[term];
      expect(Math.round(diff * 10_000) / 10_000, `${term}ヶ月`).toBe(0.0006);
    }
  });

  it("このツールが見積に使う5〜7年は、通知の改定後と一致する", () => {
    for (const term of [60, 72, 84] as const) {
      expect(STANDARD_LEASE_RATES[String(term)], `${term}ヶ月`).toBe(LEASE_RATE_NOTICE.after[term]);
    }
  });
});

describe("古い料率に気づけるか", () => {
  it("改定前のまま保存されていれば、古いと分かる", () => {
    expect(isOutdatedLeaseRates({ "60": 0.0195, "72": 0.0166, "84": 0.0145 })).toBe(true);
  });

  it("1つだけ古くても見逃さない", () => {
    expect(isOutdatedLeaseRates({ "60": 0.0201, "72": 0.0172, "84": 0.0145 })).toBe(true);
  });

  it("期間が増減していても気づく", () => {
    expect(isOutdatedLeaseRates({ "60": 0.0201, "72": 0.0172 })).toBe(true);
    expect(isOutdatedLeaseRates({ ...STANDARD_LEASE_RATES, "96": 0.0143 })).toBe(true);
  });

  it("最新なら知らせない", () => {
    expect(isOutdatedLeaseRates({ ...STANDARD_LEASE_RATES })).toBe(false);
  });

  it("画面に出す並びは、年数の短い順", () => {
    expect(describeRates(STANDARD_LEASE_RATES)).toBe("5年：2.01%　6年：1.72%　7年：1.51%");
  });
});

describe("見積の金額に効くか", () => {
  const quote: Quote = {
    id: "q",
    title: "t",
    customerName: "テスト",
    customerHonorific: "御中",
    quoteNo: "1",
    quoteDate: "2026-10-26",
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
    createdAt: "",
    updatedAt: "",
  };

  const proposal: Proposal = {
    id: "p",
    maker: "KYOCERA",
    modelText: "TASKalfa MZ2501ci",
    qty: 1,
    items: [{ name: "本体", qty: 1, unit: "台", unitPrice: 741_500 }],
    cost: 441_500,
    pricingMode: "fromGp",
    grossProfitAmount: 300_000,
    leaseTerm: 72,
    counterOverridden: false,
    maintenanceMonthly: 0,
  };

  it("6年リースの料率が1.72%として使われる", () => {
    expect(leaseRateOf(72, DEFAULT_SETTINGS.leaseRates)).toBe(0.0172);
  });

  it("改定で月額リース料が上がる（安く見せてしまわない）", () => {
    const q = { ...quote, proposals: [proposal] };
    const after = calcProposal(q, proposal, DEFAULT_SETTINGS);
    const before = calcProposal(q, proposal, {
      ...DEFAULT_SETTINGS,
      leaseRates: { "60": 0.0195, "72": 0.0166, "84": 0.0145 },
    });
    expect(after.monthlyLease).toBeGreaterThan(before.monthlyLease);
    // 販売額計 741,500 × 1.72% = 12,753.8 → 100円単位で切り上げ 12,800
    expect(after.monthlyLease).toBe(12_800);
    expect(before.monthlyLease).toBe(12_400);
  });
});
