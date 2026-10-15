import { describe, expect, it } from "vitest";
import { findServiceArea, getServiceAreaBook, isSameDayRank, searchServiceAreas } from "./service-area";

describe("保守対応エリア表", () => {
  it("全国分を読み込める", async () => {
    const book = await getServiceAreaBook();
    expect(book).not.toBeNull();
    expect(book!.areas.length).toBeGreaterThan(1800);
  });

  it("市区町村からランクを引ける", async () => {
    expect(await findServiceArea("福岡県", "久留米市")).toMatchObject({ rank: "S" });
    expect(await findServiceArea("福岡県", "大牟田市")).toMatchObject({ rank: "A" });
    expect(await findServiceArea("北海道", "小樽市")).toMatchObject({ rank: "B" });
    expect(await findServiceArea("北海道", "夕張市")).toMatchObject({ rank: "C" });
  });

  it("部分一致で検索できる", async () => {
    const hits = await searchServiceAreas("久留米");
    expect(hits.some((a) => a.city === "久留米市")).toBe(true);
  });

  it("当日対応かどうかを判定できる", () => {
    expect(isSameDayRank("S")).toBe(true);
    expect(isSameDayRank("A")).toBe(true);
    expect(isSameDayRank("B")).toBe(false);
    expect(isSameDayRank(undefined)).toBe(false);
  });
});
