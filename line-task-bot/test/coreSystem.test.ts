/**
 * 基幹システム連携クライアントのテスト。
 * スタブの HTTP サーバーを立てて、実際にリクエストを飛ばして確認する。
 * 認証ヘッダ・冪等性キー・リトライ・マスタ照合の絞り込みが対象。
 */

import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, it } from "node:test";

process.env.LINE_CHANNEL_SECRET ??= "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.ANTHROPIC_API_KEY ??= "sk-ant-test";
process.env.SPREADSHEET_ID ??= "test-spreadsheet";

interface CapturedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: unknown;
}

const received: CapturedRequest[] = [];
/** 次のリクエストへの応答を差し替えるためのフック。 */
let respond: (
  req: CapturedRequest,
) => { status: number; body: unknown } = () => ({
  status: 200,
  body: { id: "INT-1", url: "https://core.example.com/1" },
});

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", () => {
    const captured: CapturedRequest = {
      method: req.method ?? "",
      url: req.url ?? "",
      headers: req.headers,
      body: raw ? JSON.parse(raw) : null,
    };
    received.push(captured);
    const result = respond(captured);
    res.writeHead(result.status, { "content-type": "application/json" });
    res.end(JSON.stringify(result.body));
  });
});

let sink: import("../src/sinks/coreSystem.js").CoreSystemSink;

function record(overrides: Record<string, unknown> = {}) {
  return {
    id: "rec-1",
    groupId: "G1",
    kind: "customer" as const,
    counterpartyName: "株式会社アルファ",
    counterpartyId: "",
    contactPerson: "田中様",
    ourStaff: "山内",
    occurredAt: "2026-08-20T14:00:00+09:00",
    channel: "visit" as const,
    subject: "複合機の入替提案",
    summary: "更新時期の相談。",
    detail: "",
    nextAction: "",
    nextActionDueAt: "",
    stage: "提案中",
    amount: "",
    sourceMessageIds: ["m1"],
    confidence: 0.9,
    status: "approved" as const,
    externalId: "",
    externalUrl: "",
    syncedAt: "",
    error: "",
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

before(async () => {
  server.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const address = server.address();
  if (typeof address === "string" || address === null) {
    throw new Error("スタブサーバーのアドレスを取得できませんでした");
  }

  // config はモジュール読み込み時に評価されるので、import より前に設定する
  process.env.RECORD_SINK = "http";
  process.env.CORE_BASE_URL = `http://127.0.0.1:${address.port}`;
  process.env.CORE_AUTH_HEADER = "Authorization";
  process.env.CORE_AUTH_VALUE = "Bearer test-token-123";
  process.env.CORE_FIELD_MAP = JSON.stringify({
    counterpartyName: "customer_name",
    occurredAt: "contacted_at",
  });

  const module = await import("../src/sinks/coreSystem.js");
  sink = new module.CoreSystemSink();
});

after(() => {
  server.close();
});

describe("createRecord", () => {
  it("認証ヘッダと冪等性キーを付けて POST する", async () => {
    received.length = 0;
    respond = () => ({ status: 200, body: { id: "INT-42", url: "https://core/42" } });

    const result = await sink.createRecord(record());

    assert.equal(result.externalId, "INT-42");
    assert.equal(result.externalUrl, "https://core/42");

    const sent = received[0];
    assert.ok(sent);
    assert.equal(sent.method, "POST");
    assert.equal(sent.url, "/api/interactions");
    assert.equal(sent.headers.authorization, "Bearer test-token-123");
    // 再送しても二重登録されないよう、記録 ID を冪等性キーとして送る
    assert.equal(sent.headers["x-idempotency-key"], "rec-1");
  });

  it("CORE_FIELD_MAP に従ってフィールド名を置き換える", async () => {
    received.length = 0;
    respond = () => ({ status: 200, body: { id: "INT-43" } });

    await sink.createRecord(record());

    const body = received[0]?.body as Record<string, unknown>;
    assert.equal(body.customer_name, "株式会社アルファ");
    assert.equal(body.contacted_at, "2026-08-20T14:00:00+09:00");
    assert.equal(body.counterpartyName, undefined);
    // マップに無いフィールドはこちらの名前のまま
    assert.equal(body.subject, "複合機の入替提案");
  });

  it("5xx はリトライして成功すれば通す", async () => {
    received.length = 0;
    let calls = 0;
    respond = () => {
      calls += 1;
      return calls === 1
        ? { status: 503, body: { message: "unavailable" } }
        : { status: 200, body: { id: "INT-44" } };
    };

    const result = await sink.createRecord(record());
    assert.equal(result.externalId, "INT-44");
    assert.equal(received.length, 2);
  });

  it("4xx はリトライせず即座に失敗する", async () => {
    received.length = 0;
    respond = () => ({ status: 400, body: { message: "counterparty is required" } });

    await assert.rejects(
      () => sink.createRecord(record()),
      /400/,
    );
    // 再送しても結果が変わらないので 1 回で諦める
    assert.equal(received.length, 1);
  });

  it("ID が読めなくても例外にはしない（送信自体は成功しているため）", async () => {
    received.length = 0;
    respond = () => ({ status: 200, body: { unexpected: "shape" } });

    const result = await sink.createRecord(record());
    assert.equal(result.externalId, "");
  });
});

describe("findCounterparty", () => {
  it("候補が 1 件ならその ID を返す", async () => {
    received.length = 0;
    respond = () => ({
      status: 200,
      body: { items: [{ id: "C-1", name: "株式会社アルファ" }] },
    });

    const match = await sink.findCounterparty("アルファ", "customer");
    assert.equal(match?.id, "C-1");
    assert.equal(match?.ambiguous, false);
    assert.match(received[0]?.url ?? "", /\/api\/counterparties\?q=/);
    assert.match(received[0]?.url ?? "", /kind=customer/);
  });

  it("法人格を除いた完全一致が 1 件ならそれを採用する", async () => {
    respond = () => ({
      status: 200,
      body: {
        items: [
          { id: "C-1", name: "株式会社アルファ" },
          { id: "C-2", name: "アルファ商事株式会社" },
        ],
      },
    });

    const match = await sink.findCounterparty("アルファ", "customer");
    assert.equal(match?.id, "C-1");
    assert.equal(match?.ambiguous, false);
  });

  it("絞り込めなければ ambiguous を立てて ID を返さない", async () => {
    respond = () => ({
      status: 200,
      body: {
        items: [
          { id: "C-1", name: "アルファ工業" },
          { id: "C-2", name: "アルファ商事" },
        ],
      },
    });

    const match = await sink.findCounterparty("アルファ", "customer");
    assert.equal(match?.ambiguous, true);
    assert.equal(match?.id, "");
  });

  it("候補が 0 件なら null", async () => {
    respond = () => ({ status: 200, body: { items: [] } });
    assert.equal(await sink.findCounterparty("存在しない会社", "customer"), null);
  });

  it("名前が空なら API を叩かない", async () => {
    received.length = 0;
    assert.equal(await sink.findCounterparty("   ", "customer"), null);
    assert.equal(received.length, 0);
  });
});
