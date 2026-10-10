import { describe, expect, it } from "vitest";
import { buildSetupScript, extractSpreadsheetId, makeToken } from "./setup-script";

/**
 * 台帳の設定でつまずかないための下ごしらえ。
 * URLをそのまま貼ってもIDが取れること、スクリプトに書き写しが残らないこと。
 */

const ID = "1EcnpradH2qyEqrH8hxQvTCbjTS6Q9HUDofabKZDLWPE";

describe("台帳のURLからスプレッドシートIDを取り出す", () => {
  it("ブラウザのURLをそのまま貼っても取れる", () => {
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit?usp=drivesdk`)).toBe(ID);
    expect(extractSpreadsheetId(`https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`)).toBe(ID);
  });

  it("IDだけでも取れる", () => {
    expect(extractSpreadsheetId(ID)).toBe(ID);
    expect(extractSpreadsheetId(`  ${ID}  `)).toBe(ID);
  });

  it("関係のない文字列は空で返す", () => {
    expect(extractSpreadsheetId("")).toBe("");
    expect(extractSpreadsheetId("https://example.com/foo")).toBe("");
    expect(extractSpreadsheetId("見積書")).toBe("");
  });
});

describe("貼るだけのスクリプトを作る", () => {
  it("スプレッドシートIDと合言葉が埋め込まれ、雛形の文言は残らない", async () => {
    const token = makeToken();
    const script = await buildSetupScript(ID, token);
    expect(script).toContain(`var SPREADSHEET_ID = "${ID}";`);
    expect(script).toContain(`var TOKEN = "${token}";`);
    expect(script).not.toContain("ここを合言葉に書き換える");
    // 本体（読み書きの窓口）はそのまま残っている
    expect(script).toContain("function doPost(e)");
  });

  it("合言葉は毎回違い、貼り間違えにくい文字だけを使う", () => {
    const a = makeToken();
    const b = makeToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]{20,}$/);
  });
});
