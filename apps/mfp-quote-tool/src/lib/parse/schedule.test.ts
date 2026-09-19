import { describe, expect, it } from "vitest";
import { looksLikeSchedule, parseSchedule } from "./schedule";
import type { ExtractedDoc } from "./extract";

const doc = (lines: string[]): ExtractedDoc => ({
  name: "schedule.pdf",
  kind: "pdf",
  lines,
  text: lines.join("\n"),
  warnings: [],
});

/** 60回払い・月額15,000円の支払予定表を組み立てる */
function scheduleLines(count = 60, fee = 15000): string[] {
  const lines = [
    "リース料支払予定表",
    "株式会社アプラス",
    "契約番号： 1234-5678-90",
    "回数 支払日 リース料 残債",
  ];
  for (let i = 1; i <= count; i++) {
    const y = 2023 + Math.floor((9 + i) / 12);
    const m = ((9 + i) % 12) + 1;
    const balance = fee * (count - i);
    lines.push(`${i} ${y}/${String(m).padStart(2, "0")}/27 ${fee.toLocaleString()} ${balance.toLocaleString()}`);
  }
  return lines;
}

describe("リース支払予定表の読み取り", () => {
  it("支払予定表かどうかを判定できる", () => {
    expect(looksLikeSchedule(doc(scheduleLines()))).toBe(true);
    expect(looksLikeSchedule(doc(["御見積書", "本体合計 1,937,000"]))).toBe(false);
  });

  it("月額・回数・開始日・満了日を読み取る", () => {
    const r = parseSchedule(doc(scheduleLines()), new Date("2026-08-22T00:00:00Z"));
    expect(r).not.toBeNull();
    expect(r!.monthlyFee).toBe(15_000);
    expect(r!.term).toBe(60);
    expect(r!.lessor).toBe("アプラス");
    expect(r!.contractNo).toBe("1234-5678-90");
    expect(r!.startDate).toBe("2023-11-27");
    expect(r!.endDate).toBe("2028-10-27");
  });

  it("残債と残回数を求める", () => {
    const r = parseSchedule(doc(scheduleLines()), new Date("2026-08-22T00:00:00Z"));
    // 2026-08-22 以降で最初に来る回の残高
    expect(r!.remainingDebt).toBeGreaterThan(0);
    expect(r!.remainingTerm).toBeGreaterThan(0);
    expect(r!.remainingTerm).toBeLessThan(60);
  });

  it("残債が明記されていればその値を優先する", () => {
    const lines = [...scheduleLines(), "未経過リース料 385,000"];
    const r = parseSchedule(doc(lines), new Date("2026-08-22T00:00:00Z"));
    expect(r!.remainingDebt).toBe(385_000);
  });

  it("表として成立しない書類では null を返す", () => {
    expect(parseSchedule(doc(["支払予定表", "1 2024/01/27 15,000"]))).toBeNull();
  });

  it("OCRで行が崩れていても回数・日付・金額が並んでいれば読める", () => {
    const noisy = [
      "リース料 支払 予定表",
      "回数  支払日   リース料   残債",
      "1  2024年1月27日  15,000  885,000",
      "2  2024年2月27日  15,000  870,000",
      "3  2024年3月27日  15,000  855,000",
      "4  2024年4月27日  15,000  840,000",
      "5  2024年5月27日  15,000  825,000",
    ];
    const r = parseSchedule(doc(noisy), new Date("2024-03-01T00:00:00Z"));
    expect(r!.monthlyFee).toBe(15_000);
    expect(r!.startDate).toBe("2024-01-27");
    expect(r!.remainingDebt).toBe(855_000);
  });
});

describe("OCR特有の崩れへの耐性", () => {
  it("濁点の誤認（アプラス→アブラス）でもリース会社を特定する", () => {
    const lines = [
      "リース料支払予定表",
      "株式会社アブラス 契約番号 : AP-2023-114567",
      "1 2024年1月27日 15,000 885,000",
      "2 2024年2月27日 15,000 870,000",
      "3 2024年3月27日 15,000 855,000",
      "4 2024年4月27日 15,000 840,000",
    ];
    expect(parseSchedule(doc(lines))!.lessor).toBe("アプラス");
  });

  it("支払日が潰れた数字列になっても、回数から日付を補完する", () => {
    const lines = [
      "リース料支払予定表 支払回数: 60回",
      "31 | 2026年5月27晶 15,000 435,000",
      "32 | 202646278 15,000 420,000",
      "33 | 2026年7月27晶 15,000 405,000",
      "34 | 202648278 15,000 390,000",
      "35 | 2026498278 15,000 375,000",
      "36 | 20264108278 15,000 360,000",
    ];
    const r = parseSchedule(doc(lines), new Date("2026-08-22T00:00:00Z"))!;
    expect(r.monthlyFee).toBe(15_000);   // 表に繰り返し出る値を採用
    expect(r.term).toBe(60);             // 見出しの支払回数を優先
    expect(r.startDate).toBe("2023-11-27");
    expect(r.endDate).toBe("2028-10-27");
    expect(r.remainingDebt).toBe(390_000);
  });
});

describe("実際のOCR出力（写真から）", () => {
  // 支払予定表の写真を実際にOCRして得られた行をそのまま使う
  const ocrLines = [
    "リース料支払予定表",
    "株式会社アプラス 契約番号 : AP-2023-114567",
    "物件 : 京セラ TASKalfa 2554ci 一式 月額リース料 : 15,000F (税別) 支払回数: 60H",
    "回数 支払日 リース料 残債",
    "2026年5月27日 15,000 435,000",
    "202646278 15,000 420,000",
    "20264478278 15,000 405,000",
    "202648278 15,000 390,000",
    "35 | 20264-98278 15,000 375,000",
    "36 | 20264-10278 | 15,000 360,000",
  ];

  it("回数や支払日が欠けても契約条件を組み立てられる", () => {
    const r = parseSchedule(doc(ocrLines), new Date("2026-08-22T00:00:00Z"))!;
    expect(r.monthlyFee).toBe(15_000);
    expect(r.term).toBe(60);            // 「60H」と化けた支払回数を読む
    expect(r.startDate).toBe("2023-11-27");
    expect(r.endDate).toBe("2028-10-27");
    expect(r.remainingDebt).toBe(390_000);
    expect(r.remainingTerm).toBe(26);
    expect(r.lessor).toBe("アプラス");
    expect(r.contractNo).toBe("AP-2023-114567");
  });
});
