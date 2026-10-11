import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * ブラウザだけで動かせる部分を、動かせるまま保つ。
 *
 * 統合基幹システムはclaude.aiのアーティファクト（ブラウザの中だけで動くページ）で、
 * 各ツールはShadow DOMに画面を作る形で組み込まれる。サーバーは無い。
 *
 * このツールの中身のうち、
 *   ・料金の計算（pricing / fleet / calc-context）
 *   ・見積書と比較表の組版（export/html）
 * はNodeに依存していないので、そのままブラウザへ持っていける。
 * ここが組み込みの土台になるので、うっかり node:fs などを足して
 * 持っていけなくなることがないよう、取り込みをたどって見張る。
 */

const LIB = path.join(process.cwd(), "src", "lib");

/**
 * 組み込みのときブラウザへ持っていく入口。
 *
 * 「料金を計算して、見積書と比較表のHTMLを組む」までが、そのまま動く。
 * 値をどこから読むか（calc-context / proposal-builder）と、
 * 紙にする部分（export/pdf / export/excel）はNode側に残るので、ここには入れない。
 */
const BROWSER_ENTRIES = [
  "pricing.ts",
  "fleet.ts",
  "proposal-doc.ts",
  "export/html.ts",
  "labels.ts",
  "defaults.ts",
  "types.ts",
];

/**
 * ブラウザへ持っていくときに、差し替えが要るもの。
 *
 * この一覧は docs/integration.md の表と対になっている。
 * どちらかだけ直すと食い違うので、テストでも固定しておく。
 */
const NEEDS_REPLACING = [
  "store.ts", // 保存先：ホスト側の保存先に繋ぎ替える
  "calc-context.ts", // 設定・仕切表・写真の読み込み：ホストから渡す
  "proposal-builder.ts", // 同上（仕切表を読む）
  "export/pdf.ts", // PDF化：Chromiumが要る。ブラウザでは window.print()
  "export/excel.ts", // Excel出力：アーティファクトでは .xlsx を保存できない
  "auth.ts", // ログイン：ホスト側が持つ
  "session.ts", // 同上
];

/** ブラウザには無いもの。これを取り込んだ時点で持っていけなくなる */
const NODE_ONLY = /^(node:|fs$|path$|crypto$|playwright|exceljs|tesseract\.js|pdfjs-dist|@napi-rs\/|heic-convert|next\/)/;

/** そのファイルが取り込んでいるものを並べる */
async function importsOf(file: string): Promise<string[]> {
  const source = await fs.readFile(file, "utf8");
  return [...source.matchAll(/\bfrom\s+"([^"]+)"/g)].map((m) => m[1]);
}

/** 入口からたどれる .ts をすべて集める */
async function reachable(entries: string[]): Promise<Map<string, string[]>> {
  const seen = new Map<string, string[]>();
  const queue = entries.map((e) => path.join(LIB, e));

  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    const specs = await importsOf(file);
    seen.set(file, specs);

    for (const spec of specs) {
      if (!spec.startsWith(".")) continue;
      // 拡張子は書かない書き方なので、.ts を足して探す
      const resolved = path.resolve(path.dirname(file), spec);
      for (const candidate of [`${resolved}.ts`, path.join(resolved, "index.ts")]) {
        try {
          await fs.access(candidate);
          queue.push(candidate);
          break;
        } catch {
          /* 次の候補へ */
        }
      }
    }
  }
  return seen;
}

describe("ブラウザへ持っていける部分", () => {
  it("計算と組版は、Nodeのものを取り込んでいない", async () => {
    const graph = await reachable(BROWSER_ENTRIES);
    const offenders: string[] = [];

    for (const [file, specs] of graph) {
      for (const spec of specs) {
        if (NODE_ONLY.test(spec)) {
          offenders.push(`${path.relative(LIB, file)} → ${spec}`);
        }
      }
    }

    expect(
      offenders,
      `Nodeでしか動かないものが混ざると、統合基幹システム（ブラウザの中）へ持っていけなくなります:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("見積書・比較表の組版は、入口からたどり着ける", async () => {
    const graph = await reachable(BROWSER_ENTRIES);
    const files = [...graph.keys()].map((f) => path.relative(LIB, f));
    expect(files).toContain(path.join("export", "html.ts"));
    expect(files).toContain("pricing.ts");
  });

  it("差し替えが要るものは、持っていく側に紛れ込んでいない", async () => {
    const graph = await reachable(BROWSER_ENTRIES);
    const files = [...graph.keys()].map((f) => path.relative(LIB, f).replace(/\\/g, "/"));
    for (const name of NEEDS_REPLACING) {
      expect(files, `${name} はブラウザでは動かないので、持っていく側に入れない`).not.toContain(name);
    }
  });

  it("差し替えが要るものは、実際に存在する（名前が変わったら気づけるように）", async () => {
    for (const name of NEEDS_REPLACING) {
      await expect(fs.access(path.join(LIB, name))).resolves.toBeUndefined();
    }
  });
});
