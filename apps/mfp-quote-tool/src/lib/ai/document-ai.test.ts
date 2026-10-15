import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";

/**
 * AI読み取りが黙って文字起こし（OCR）に落ちた不具合の再発防止。
 *
 * 出力上限を大きく取ったまま「まとめて受け取る」呼び方をすると、
 * SDKが送信前に例外を投げる。APIには一度も届かないので、Consoleの
 * 利用履歴にも残らず、画面上は「APIキーは使えます」と出たまま
 * OCRの結果だけが出てくる。原因にたどり着くのが非常に難しい。
 */

const MAX_TOKENS = 32_000;

/** src/lib/ai/document-ai.ts が使っている出力上限に合わせる */
describe("AI読み取りの呼び出し方", () => {
  it("この出力上限では、まとめて受け取る呼び方は送信前に弾かれる", async () => {
    const client = new Anthropic({ apiKey: "sk-ant-test", maxRetries: 0, baseURL: "http://127.0.0.1:1" });
    expect(() =>
      client.messages.create({
        model: "claude-opus-5",
        max_tokens: MAX_TOKENS,
        messages: [{ role: "user", content: "テスト" }],
      }),
    ).toThrow(/Streaming is required/);
  });

  it("ストリーミングなら、この出力上限でも送信まで進む", async () => {
    const client = new Anthropic({ apiKey: "sk-ant-test", maxRetries: 0, baseURL: "http://127.0.0.1:1" });
    // 通信自体は失敗する（届かない宛先に向けている）が、「送信前に弾かれる」のとは別物。
    // ここで Streaming is required が出ないことが確かめたいこと。
    await expect(
      client.messages
        .stream({
          model: "claude-opus-5",
          max_tokens: MAX_TOKENS,
          messages: [{ role: "user", content: "テスト" }],
        })
        .finalMessage(),
    ).rejects.not.toThrow(/Streaming is required/);
  });
});
