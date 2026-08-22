/**
 * HTTP 層のテスト。署名検証とジョブ認証が効いていることを確認する。
 * Sheets / Anthropic / LINE には触れないパスだけを通す。
 */

import assert from "node:assert/strict";
import crypto from "node:crypto";
import type { Server } from "node:http";
import { after, before, describe, it } from "node:test";

const CHANNEL_SECRET = "test-secret";
const JOB_SECRET = "job-secret";

process.env.LINE_CHANNEL_SECRET ??= CHANNEL_SECRET;
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.ANTHROPIC_API_KEY ??= "sk-ant-test";
process.env.SPREADSHEET_ID ??= "test-spreadsheet";
process.env.JOB_SECRET ??= JOB_SECRET;

const { createApp } = await import("../src/server.js");

let server: Server;
let base: string;

function sign(body: string): string {
  return crypto
    .createHmac("sha256", CHANNEL_SECRET)
    .update(body)
    .digest("base64");
}

function postWebhook(body: string, signature: string): Promise<Response> {
  return fetch(`${base}/line/webhook`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-line-signature": signature,
    },
    body,
  });
}

before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("サーバーのアドレスを取得できませんでした");
  }
  base = `http://127.0.0.1:${address.port}`;
});

after(() => {
  server.close();
});

describe("/healthz", () => {
  it("200 を返す", async () => {
    const response = await fetch(`${base}/healthz`);
    assert.equal(response.status, 200);
  });
});

describe("/line/webhook", () => {
  it("署名が無ければ 400", async () => {
    const response = await fetch(`${base}/line/webhook`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ events: [] }),
    });
    assert.equal(response.status, 400);
  });

  it("署名が不正なら 401", async () => {
    const body = JSON.stringify({ events: [] });
    const response = await postWebhook(body, "invalid-signature");
    assert.equal(response.status, 401);
  });

  it("署名が正しければ 200", async () => {
    const body = JSON.stringify({ events: [] });
    const response = await postWebhook(body, sign(body));
    assert.equal(response.status, 200);
  });

  it("未知の postback を受けても 200 で返す", async () => {
    const body = JSON.stringify({
      events: [
        {
          type: "postback",
          replyToken: "rt",
          mode: "active",
          timestamp: Date.now(),
          source: { type: "group", groupId: "G1", userId: "U1" },
          webhookEventId: "e1",
          deliveryContext: { isRedelivery: false },
          postback: { data: "action=unknown" },
        },
      ],
    });
    const response = await postWebhook(body, sign(body));
    assert.equal(response.status, 200);
  });
});

describe("/jobs/*", () => {
  it("JOB_SECRET が無ければ 401", async () => {
    const response = await fetch(`${base}/jobs/reminders`, { method: "POST" });
    assert.equal(response.status, 401);
  });

  it("JOB_SECRET が違えば 401", async () => {
    const response = await fetch(`${base}/jobs/reminders`, {
      method: "POST",
      headers: { "x-job-secret": "wrong" },
    });
    assert.equal(response.status, 401);
  });
});
