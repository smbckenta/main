import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 会社全体のマスタを書き換える口は、必ず権限を確かめてから通す。
 *
 * 仕切表・機種スペックDB・設定・ロゴ／角印は、全員が同じものを見て
 * 同じ見積を作るための土台。ここが1人の思いつきで変わると、
 * 誰かが気づかないまま古い条件で見積を出してしまう。
 *
 * 画面側でボタンを隠してはいるが、それは見た目の話でしかない。
 * 守っているのはこのAPI側なので、口が増えたときに確かめ忘れないよう
 * ファイルを見て回って確かめる。
 */

const API = path.join(process.cwd(), "src", "app", "api");

/** 書き換えの口（これらに requireMasterEditor が要る） */
const WRITE_METHODS = ["POST", "PUT", "PATCH", "DELETE"];

/** マスタを書き換えるAPI */
const MASTER_ROUTES = [
  "pricebook/route.ts",
  "devices/route.ts",
  "devices/photo/route.ts",
  "settings/route.ts",
  "logo/route.ts",
  "seal/route.ts",
];

const read = (rel: string) => fs.readFile(path.join(API, rel), "utf8");

/**
 * その関数の中身だけを取り出す。
 * 次の export までで切らないと、短い関数のときに隣の関数まで拾ってしまう。
 */
function bodyOf(source: string, method: string): string | undefined {
  const head = new RegExp(`export async function ${method}\\([^)]*\\)[^{]*\\{`);
  const m = source.match(head);
  if (!m || m.index === undefined) return undefined;
  const rest = source.slice(m.index + m[0].length);
  const next = rest.search(/\nexport (async )?function /);
  return next === -1 ? rest : rest.slice(0, next);
}

describe("マスタを書き換える口の守り", () => {
  it.each(MASTER_ROUTES)("%s の書き換えは、権限を確かめてから通す", async (rel) => {
    const source = await read(rel);
    expect(source, `${rel} が requireMasterEditor を使っていない`).toContain(
      "requireMasterEditor",
    );

    // 書き換えの口それぞれが、本体の中で確かめていること
    for (const method of WRITE_METHODS) {
      const body = bodyOf(source, method);
      if (body === undefined) continue;
      expect(body, `${rel} の ${method} が権限を確かめていない`).toContain("requireMasterEditor");
    }
  });

  it("読み取り（GET）は、ログインしていれば誰でも通す", async () => {
    // 営業が仕切価格を見られないと見積が作れない。止めているのは書き換えだけ
    const source = await read("pricebook/route.ts");
    const get = bodyOf(source, "GET");
    expect(get).toBeDefined();
    expect(get).not.toContain("requireMasterEditor");
  });

  it("案件の読み書きは、権限で止めない（営業の日常の作業なので）", async () => {
    const source = await read("quotes/route.ts");
    expect(source).not.toContain("requireMasterEditor");
  });
});
