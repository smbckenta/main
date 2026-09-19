import { describe, expect, it } from "vitest";
import { specFromTable } from "./parse-spec-html";

/**
 * 比較表の印刷速度が、実機と違う値で出ていた（25枚機が「4」になる など）。
 * 原因は「A4ヨコ：25枚/分」の "A4" の 4 を先に拾っていたこと。
 */
const speedOf = (value: string) => specFromTable({ 連続コピー速度: value });

describe("印刷速度の読み取り", () => {
  it("用紙サイズの数字を速度と取り違えない", () => {
    // これまで 4 になっていた書き方
    expect(speedOf("A4ヨコ：25枚/分").ppmMono).toBe(25);
    expect(speedOf("A4 30枚/分").ppmColor).toBe(30);
    expect(speedOf("A3 35枚/分").ppmMono).toBe(35);
    expect(speedOf("A4ノビ 50枚/分").ppmMono).toBe(50);
    expect(speedOf("B4タテ 45ページ/分").ppmMono).toBe(45);
  });

  it("モノクロとカラーで速度が違う場合は別々に拾う", () => {
    const spec = speedOf("モノクロ：A4ヨコ 35枚/分、フルカラー：A4ヨコ 30枚/分");
    expect(spec.ppmMono).toBe(35);
    expect(spec.ppmColor).toBe(30);
  });

  it("片方しか書かれていない場合は両方に同じ値を入れる", () => {
    const spec = speedOf("A4ヨコ 26枚/分");
    expect(spec.ppmMono).toBe(26);
    expect(spec.ppmColor).toBe(26);
  });

  it("全角の記号でも読める", () => {
    expect(speedOf("Ａ４ヨコ　２５枚／分").ppmMono).toBe(25);
  });

  it("ありえない速度は捨てる（数字が出ているほうが誤解を招く）", () => {
    expect(speedOf("A4").ppmMono).toBeUndefined();
    expect(speedOf("毎分1000枚/分").ppmMono).toBeUndefined();
  });
});

describe("ファーストコピータイムの読み取り", () => {
  const fcOf = (value: string) => specFromTable({ ファーストコピータイム: value });

  it("用紙サイズの数字を秒数と取り違えない", () => {
    expect(fcOf("A4ヨコ 5.6秒").ppmMono).toBeUndefined();
    expect(fcOf("A4ヨコ 5.6秒").firstCopyMonoSec).toBe(5.6);
    expect(fcOf("モノクロ A4ヨコ 4.8秒／フルカラー A4ヨコ 6.3秒").firstCopyColorSec).toBe(6.3);
  });
});

describe("ウォームアップタイムの読み取り", () => {
  it("秒が付いた数値を拾う", () => {
    expect(specFromTable({ ウォームアップタイム: "20秒以下" }).warmupSec).toBe(20);
    expect(specFromTable({ ウォームアップタイム: "約17.5秒" }).warmupSec).toBe(17.5);
  });
});
