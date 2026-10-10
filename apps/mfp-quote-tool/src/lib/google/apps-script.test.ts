import { describe, expect, it } from "vitest";
import { checkAppsScriptInput } from "./apps-script";

/**
 * 台帳につながらないとき、何を直せばよいかを名指しで返せているか。
 * ここで言い当てられないと、お客様は設定画面の前で手が止まる。
 */

const TOKEN = "vhlqnL6p021BkKk6m2uMfnlL";
const OK_URL = "https://script.google.com/macros/s/AKfycbx0123456789/exec";

describe("台帳（Apps Script）の入力チェック", () => {
  it("正しいURLと合言葉なら何も言わない", () => {
    expect(checkAppsScriptInput(OK_URL, TOKEN)).toBeUndefined();
  });

  it("台帳スプレッドシートのURLを貼ったときは、そのことを指摘する", () => {
    const msg = checkAppsScriptInput("https://docs.google.com/spreadsheets/d/1Ecnprad/edit", TOKEN);
    expect(msg).toContain("台帳スプレッドシートのURL");
    expect(msg).toContain("script.google.com/macros/s/");
  });

  it("URLが空なら、どこで取るURLかを案内する", () => {
    expect(checkAppsScriptInput("", TOKEN)).toContain("デプロイ → ウェブアプリ");
  });

  it("まったく別のURLなら形を示す", () => {
    expect(checkAppsScriptInput("https://example.com/foo", TOKEN)).toContain("https://script.google.com/macros/s/");
  });

  it("テスト用の /dev で終わるURLは使えないと伝える", () => {
    const msg = checkAppsScriptInput("https://script.google.com/macros/s/AKfycbx/dev", TOKEN);
    expect(msg).toContain("/dev");
    expect(msg).toContain("/exec");
  });

  it("末尾が /exec でも /dev でもなければ指摘する", () => {
    expect(checkAppsScriptInput("https://script.google.com/macros/s/AKfycbx", TOKEN)).toContain("/exec");
  });

  it("合言葉が未入力なら指摘する", () => {
    expect(checkAppsScriptInput(OK_URL, "")).toContain("合言葉");
  });

  it("合言葉が雛形のままなら、書き換えるよう伝える", () => {
    const msg = checkAppsScriptInput(OK_URL, "ここを合言葉に書き換える");
    expect(msg).toContain("雛形のまま");
  });
});
