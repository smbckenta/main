/**
 * 折衝記録まわりの純粋ロジックのテスト。
 * 重複判定、基幹システムへ送るペイロードの組み立て、レスポンスの読み取り。
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.LINE_CHANNEL_SECRET ??= "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.ANTHROPIC_API_KEY ??= "sk-ant-test";
process.env.SPREADSHEET_ID ??= "test-spreadsheet";
process.env.TIMEZONE ??= "Asia/Tokyo";

const { contactKey, filterNewInteractions } = await import(
  "../src/jobs/analyze.js"
);
const { mapFields, normalizeName, pickPath } = await import(
  "../src/sinks/coreSystem.js"
);
const { recordApprovalMessage } = await import("../src/line/messages.js");

type StoredRecord = Awaited<
  ReturnType<typeof import("../src/store/recordRepo.js").listRecords>
>[number];

function stored(overrides: Partial<StoredRecord> = {}): StoredRecord {
  return {
    rowNumber: 2,
    id: "r1",
    groupId: "G1",
    kind: "customer",
    counterpartyName: "株式会社アルファ",
    counterpartyId: "",
    contactPerson: "田中様",
    ourStaff: "山内",
    occurredAt: "2026-08-20T14:00:00+09:00",
    channel: "visit",
    subject: "複合機の入替提案",
    summary: "現行機の更新時期について相談を受けた。",
    detail: "",
    nextAction: "見積提出",
    nextActionDueAt: "2026-08-25T18:00:00+09:00",
    stage: "提案中",
    amount: "",
    sourceMessageIds: ["m1"],
    confidence: 0.9,
    status: "draft",
    externalId: "",
    externalUrl: "",
    syncedAt: "",
    error: "",
    createdAt: "2026-08-20T15:00:00+09:00",
    updatedAt: "2026-08-20T15:00:00+09:00",
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    kind: "customer" as const,
    counterpartyName: "株式会社ベータ",
    contactPerson: "",
    ourStaff: "上野",
    occurredAt: "2026-08-21T10:00:00+09:00",
    channel: "phone" as const,
    subject: "保守契約の更新",
    summary: "更新意向あり。",
    detail: "",
    nextAction: "",
    nextActionDueAt: null,
    stage: "",
    amount: "",
    sourceMessageIds: ["m50"],
    confidence: 0.9,
    ...overrides,
  };
}

describe("contactKey", () => {
  it("法人格の表記ゆれを吸収する", () => {
    assert.equal(
      contactKey("株式会社アルファ", "2026-08-20T14:00:00+09:00"),
      contactKey("アルファ（株）", "2026-08-20T09:00:00+09:00"),
    );
  });

  it("日付が違えば別の接触とみなす", () => {
    assert.notEqual(
      contactKey("アルファ", "2026-08-20T14:00:00+09:00"),
      contactKey("アルファ", "2026-08-21T14:00:00+09:00"),
    );
  });
});

describe("filterNewInteractions", () => {
  it("確度が閾値未満なら捨てる（既定 0.6）", () => {
    const accepted = filterNewInteractions([candidate({ confidence: 0.5 })], []);
    assert.equal(accepted.length, 0);
  });

  it("相手先が空なら捨てる", () => {
    const accepted = filterNewInteractions(
      [candidate({ counterpartyName: "  " })],
      [],
    );
    assert.equal(accepted.length, 0);
  });

  it("同じ相手・同じ日の既存記録があれば捨てる", () => {
    const existing = stored({
      counterpartyName: "ベータ株式会社",
      occurredAt: "2026-08-21T15:00:00+09:00",
      sourceMessageIds: ["m9"],
    });
    const accepted = filterNewInteractions([candidate()], [existing]);
    assert.equal(accepted.length, 0);
  });

  it("根拠メッセージがすべて既存記録のものなら捨てる", () => {
    const existing = stored({
      counterpartyName: "別の会社",
      occurredAt: "2020-01-01T00:00:00+09:00",
      sourceMessageIds: ["m50"],
    });
    const accepted = filterNewInteractions([candidate()], [existing]);
    assert.equal(accepted.length, 0);
  });

  it("同一バッチ内の同じ接触も 1 件に畳む", () => {
    const accepted = filterNewInteractions(
      [
        candidate({ sourceMessageIds: ["m1"] }),
        candidate({ sourceMessageIds: ["m2"], subject: "別の言い回し" }),
      ],
      [],
    );
    assert.equal(accepted.length, 1);
  });

  it("新規の接触は通す", () => {
    const accepted = filterNewInteractions([candidate()], [stored()]);
    assert.equal(accepted.length, 1);
  });
});

describe("normalizeName", () => {
  it("法人格と空白を落とす", () => {
    assert.equal(normalizeName("株式会社 アルファ"), "アルファ");
    assert.equal(normalizeName("アルファ（株）"), "アルファ");
  });
});

describe("pickPath", () => {
  it("ドット区切りで値を取り出す", () => {
    assert.equal(pickPath({ data: { record: { id: 42 } } }, "data.record.id"), "42");
  });

  it("見つからなければ空文字", () => {
    assert.equal(pickPath({ a: 1 }, "b.c"), "");
    assert.equal(pickPath(null, "a"), "");
  });

  it("オブジェクトが当たった場合は空文字（文字列化しない）", () => {
    assert.equal(pickPath({ a: { b: 1 } }, "a"), "");
  });
});

describe("mapFields", () => {
  it("マップに無いフィールドはこちらの名前のまま送る", () => {
    const payload = mapFields(stored(), {});
    assert.equal(payload.counterpartyName, "株式会社アルファ");
    assert.equal(payload.kind, "customer");
  });

  it("マップされたフィールドは先方の名前になる", () => {
    const payload = mapFields(stored(), {
      counterpartyName: "customer_name",
      occurredAt: "contacted_at",
    });
    assert.equal(payload.customer_name, "株式会社アルファ");
    assert.equal(payload.contacted_at, "2026-08-20T14:00:00+09:00");
    assert.equal(payload.counterpartyName, undefined);
  });

  it("空文字の日時は null で送る（先方の日付型で弾かれないように）", () => {
    const payload = mapFields(stored({ occurredAt: "" }), {});
    assert.equal(payload.occurredAt, null);
  });

  it("出所を追える情報を必ず含める", () => {
    const payload = mapFields(stored(), {});
    assert.equal(payload.sourceSystem, "line-task-bot");
    assert.equal(payload.sourceRecordId, "r1");
    assert.deepEqual(payload.sourceMessageIds, ["m1"]);
  });
});

describe("recordApprovalMessage", () => {
  it("承認/破棄の postback を含む Flex を返す", () => {
    const message = recordApprovalMessage(stored());
    assert.equal(message.type, "flex");
    const serialized = JSON.stringify(message);
    assert.match(serialized, /action=rec_approve&recordId=r1/);
    assert.match(serialized, /action=rec_reject&recordId=r1/);
  });

  it("相手先と件名が本文に出る", () => {
    const serialized = JSON.stringify(recordApprovalMessage(stored()));
    assert.match(serialized, /株式会社アルファ/);
    assert.match(serialized, /複合機の入替提案/);
  });
});
