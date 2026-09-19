import { describe, expect, it } from "vitest";
import { DEFAULT_FLEET, distinctMachines, fleetFromReadings } from "./fleet";
import type { CounterReading } from "./types";

/**
 * カウンター明細に載っている複合機を、1台残らず複数台比較表に取り込む。
 * 設置場所も明細から取る（手で打ち直すと台数ぶん間違いが増える）。
 */

const reading = (over: Partial<CounterReading>): CounterReading => ({ confidence: 0.8, ...over });

const OTSUKA: CounterReading[] = [
  reading({ location: "本社", serialNo: "630001", modelText: "IM C3500F", makerText: "リコー", amount: 46_360 }),
  reading({ location: "北部九州工事課", serialNo: "630088", modelText: "IM C3500F", makerText: "リコー", amount: 630, maintenanceMonthly: 1_800 }),
  reading({ location: "ゆめソーラー直方店", serialNo: "629763", modelText: "IM C3500F", makerText: "リコー", amount: 2_557, maintenanceMonthly: 800 }),
];

describe("明細に載っている台を数える", () => {
  it("機番が違えば別の台", () => {
    expect(distinctMachines(OTSUKA)).toHaveLength(3);
  });

  it("同じ機械の複数月ぶんは1台にまとめる", () => {
    const twoMonths = [
      reading({ serialNo: "630088", periodFrom: "2025-01-01", monoPages: 1_000 }),
      reading({ serialNo: "630088", periodFrom: "2025-02-01", monoPages: 1_200 }),
    ];
    expect(distinctMachines(twoMonths)).toHaveLength(1);
  });

  it("機番も設置場所も無い読み取りは台として数えない", () => {
    expect(distinctMachines([reading({ monoPages: 100 })])).toHaveLength(0);
  });
});

describe("明細から複数台比較表を組む", () => {
  const fleet = fleetFromReadings(OTSUKA);

  it("台数ぶんの行ができ、設置場所が入る", () => {
    expect(fleet.enabled).toBe(true);
    expect(fleet.units.map((u) => u.location)).toEqual(["本社", "北部九州工事課", "ゆめソーラー直方店"]);
  });

  it("現行側にメーカー・機種・保守料金が入る", () => {
    const kita = fleet.units[1];
    expect(kita.current.makerText).toBe("リコー");
    expect(kita.current.modelText).toBe("IM C3500F");
    expect(kita.current.maintenanceMonthly).toBe(1_800);
    expect(kita.serialNo).toBe("630088");
  });

  it("提案側は空にする（現行と同じ機種が出てこないように）", () => {
    for (const u of fleet.units) {
      expect(u.proposal.modelText).toBe("");
      expect(u.proposal.makerText).toBe("");
    }
  });

  it("枚数と単価が読めていれば、区分の行も作る", () => {
    const withPages = fleetFromReadings([
      reading({
        location: "本社",
        serialNo: "630001",
        monoPages: 1_389,
        monoUnit: 2.84,
        colorPages: 435,
        colorUnit: 13.79,
        deductionRate: 0.02,
      }),
    ]);
    const lines = withPages.units[0].current.lines;
    expect(lines.map((l) => [l.name, l.pages, l.tiers[0].unit])).toEqual([
      ["モノクロ", 1_389, 2.84],
      ["フルカラー", 435, 13.79],
    ]);
    expect(lines[0].deductionRate).toBe(0.02);
  });

  it("枚数も単価も読めていない区分は行にしない", () => {
    expect(fleetFromReadings([reading({ location: "本社", amount: 1_000 })]).units[0].current.lines).toEqual([]);
  });

  it("枚数が分からない明細は、請求額を最低基本料金に置いて合計を合わせる", () => {
    // 販売店の請求書は請求額しか載っていない。0円にすると現状が安く見えてしまう
    const side = fleetFromReadings([reading({ location: "本社", amount: 46_360 })]).units[0].current;
    expect(side.minCharge).toBe(46_360);
  });

  it("枚数が読めている台は最低基本料金に入れない（二重計上になる）", () => {
    const side = fleetFromReadings([
      reading({ location: "本社", amount: 3_938, monoPages: 1_389, monoUnit: 2.84 }),
    ]).units[0].current;
    expect(side.minCharge).toBe(0);
  });
});

describe("すでに入力してある台への取り込み", () => {
  it("同じ機番の台は現行側だけ差し替え、提案側の入力は残す", () => {
    const first = fleetFromReadings(OTSUKA);
    // 営業が提案機種とリース料を入れた状態にする
    first.units[1].proposal = { ...first.units[1].proposal, makerText: "京セラ", modelText: "TASKalfa MZ3501ci", monthlyLease: 11_000 };
    first.units[1].current.monthlyLease = 24_500;

    const again = fleetFromReadings(
      [reading({ location: "北部九州工事課", serialNo: "630088", modelText: "IM C3500F", makerText: "リコー", amount: 700 })],
      first,
    );
    expect(again.units).toHaveLength(3);
    expect(again.units[1].proposal.modelText).toBe("TASKalfa MZ3501ci");
    expect(again.units[1].proposal.monthlyLease).toBe(11_000);
    // 手で入れた現行のリース料も消さない（明細には載っていないため）
    expect(again.units[1].current.monthlyLease).toBe(24_500);
  });

  it("設置場所が変わっていなければ、機番が無くても同じ台とみなす", () => {
    const first = fleetFromReadings([reading({ location: "本社", modelText: "旧機" })]);
    const again = fleetFromReadings([reading({ location: "本社", modelText: "新機" })], first);
    expect(again.units).toHaveLength(1);
    expect(again.units[0].current.modelText).toBe("新機");
  });

  it("明細に無い台は消さない", () => {
    const base = { ...DEFAULT_FLEET, units: [...fleetFromReadings(OTSUKA).units] };
    const again = fleetFromReadings([reading({ location: "新店舗", serialNo: "999999" })], base);
    expect(again.units).toHaveLength(4);
  });
});

describe("販売店の請求書とメーカーの明細を突き合わせる", () => {
  it("機番で1台にまとめ、両方から分かることを寄せる", () => {
    // 販売店の請求書からは設置場所と金額、メーカーの明細からは枚数と単価が来る
    const fleet = fleetFromReadings([
      reading({ location: "北部九州工事課", serialNo: "630088", modelText: "IM C3500F", amount: 630 }),
      reading({ serialNo: "630088", monoPages: 1_389, monoUnit: 2.84 }),
    ]);
    expect(fleet.units).toHaveLength(1);
    expect(fleet.units[0].location).toBe("北部九州工事課");
    expect(fleet.units[0].current.lines[0].pages).toBe(1_389);
  });
});

describe("2枚の書類を別々に読ませた場合", () => {
  it("販売店の請求書とメーカーの明細が、機番で1台にまとまる", () => {
    // 実際の画面の流れ：まず大塚商会の請求書、あとからリコーの明細を読ませる
    const all = [
      ...OTSUKA,
      reading({ serialNo: "630088", monoPages: 1_389, monoUnit: 2.84, colorPages: 382, colorUnit: 13.9 }),
    ];
    const machines = distinctMachines(all);
    expect(machines).toHaveLength(3);

    const kita = machines.find((m) => m.serialNo === "630088")!;
    expect(kita.location).toBe("北部九州工事課"); // 請求書から
    expect(kita.monoPages).toBe(1_389); // メーカーの明細から
    expect(kita.maintenanceMonthly).toBe(1_800);

    const fleet = fleetFromReadings(all);
    const unit = fleet.units.find((u) => u.serialNo === "630088")!;
    expect(unit.location).toBe("北部九州工事課");
    expect(unit.current.lines.map((l) => [l.name, l.pages])).toEqual([
      ["モノクロ", 1_389],
      ["フルカラー", 382],
    ]);
    // 枚数が入ったので、請求額を最低基本料金に置く必要はなくなる
    expect(unit.current.minCharge).toBe(0);
  });
});
