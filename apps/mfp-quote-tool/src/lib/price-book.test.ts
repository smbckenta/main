import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { PriceBook, PriceBookEntry } from "./types";

/**
 * 仕切表そのものの筋が通っているかを見る。
 *
 * 見積の金額はぜんぶこのファイルから出る。ここが崩れていると
 * 画面もPDFも正しく動いたまま、金額だけが間違う。
 *
 * とくに「定価と内訳の合計が合わない」は、資料を見比べて手で直すたびに
 * 起きる。実際、古い仕切表のPDFと見比べて合っていると判断してしまい、
 * 定価が1機種ぶんずれたまま入っていたことがある。
 * 人の目で気をつけるのではなく、毎回ここで止める。
 */

const FILE = path.join(process.cwd(), "data", "price-book.json");

const book: PriceBook = JSON.parse(readFileSync(FILE, "utf8"));

const itemsTotal = (e: PriceBookEntry) =>
  e.items.reduce((sum, i) => sum + i.qty * i.unitPrice, 0);

const label = (e: PriceBookEntry) => `${e.maker} ${e.model}${e.config ? `（${e.config}）` : ""}`;

const withItems = book.entries.filter((e) => e.items.length > 0);

describe("仕切表のデータ", () => {
  it("機種が入っている", () => {
    expect(book.entries.length).toBeGreaterThan(0);
  });

  it("idが重複していない（重複すると保存で上書きし合う）", () => {
    const ids = book.entries.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it.each(book.entries.map((e) => [label(e), e] as const))(
    "%s は定価・仕切価格の大小が逆になっていない",
    (_name, e) => {
      expect(e.listPrice).toBeGreaterThan(0);
      expect(e.cost).toBeGreaterThan(0);
      // 仕切価格が定価を超えていたら、どちらかの桁か列を取り違えている
      expect(e.cost).toBeLessThan(e.listPrice);
    },
  );

  it.each(book.entries.map((e) => [label(e), e] as const))(
    "%s の仕切率は、定価と仕切価格から計算した率と合っている",
    (_name, e) => {
      if (e.costRate === undefined) return;
      // 画面の表示は%の整数まで。1ポイントずれたら数字の入れ替わりを疑う
      expect(Math.abs(e.costRate - e.cost / e.listPrice)).toBeLessThan(0.01);
    },
  );

  it.each(withItems.map((e) => [label(e), e] as const))(
    "%s の見積明細の合計は、定価とぴったり一致する",
    (_name, e) => {
      expect(itemsTotal(e)).toBe(e.listPrice);
    },
  );

  it.each(withItems.map((e) => [label(e), e] as const))(
    "%s の見積明細に、空の行や0円の行がない",
    (_name, e) => {
      for (const i of e.items) {
        expect(i.name.trim(), "品名が空").not.toBe("");
        expect(i.qty, `${i.name} の数量`).toBeGreaterThan(0);
        expect(i.unitPrice, `${i.name} の単価`).toBeGreaterThan(0);
      }
    },
  );

  it("内訳を入れた機種は、搬入設置費まで含めて積み上げている", () => {
    // 定価の積み上げ方をメーカーごとに変えると、比較表の値引率が揃わない。
    // 京セラ・東芝・富士フイルムはいずれも搬入設置費まで含めた合計で入れている
    for (const e of withItems) {
      expect(
        e.items.some((i) => i.name.includes("搬入設置")),
        `${label(e)} に搬入設置費の行がない`,
      ).toBe(true);
    }
  });

  it("富士フイルムは全機種に内訳が入っている（1機種1SKU＋搬入設置費）", () => {
    const fuji = book.entries.filter((e) => e.maker === "FUJIFILM");
    expect(fuji.length).toBeGreaterThan(0);
    for (const e of fuji) {
      expect(e.items.length, `${label(e)} の内訳が未登録`).toBe(2);
    }
  });
});
