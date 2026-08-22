/**
 * ネットワークに触れない純粋ロジックのテスト。
 * 実行: npm test
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";

process.env.LINE_CHANNEL_SECRET ??= "test-secret";
process.env.LINE_CHANNEL_ACCESS_TOKEN ??= "test-token";
process.env.ANTHROPIC_API_KEY ??= "sk-ant-test";
process.env.SPREADSHEET_ID ??= "test-spreadsheet";
process.env.TIMEZONE ??= "Asia/Tokyo";

const { formatLocal, hoursUntil, isValidIso, toIsoInTimezone } = await import(
  "../src/time.js"
);
const { filterNewTasks, isSimilar, normalize } = await import(
  "../src/jobs/analyze.js"
);
const { sortByUrgency } = await import("../src/jobs/digest.js");
const { canAutoExecute } = await import("../src/actions/executor.js");
const { taskListMessage, actionApprovalMessage } = await import(
  "../src/line/messages.js"
);

type StoredTask = Awaited<
  ReturnType<typeof import("../src/store/taskRepo.js").listTasks>
>[number];

function task(overrides: Partial<StoredTask> = {}): StoredTask {
  return {
    rowNumber: 2,
    id: "abc123",
    groupId: "G1",
    title: "見積書を送付する",
    detail: "",
    assignee: "田中",
    assigneeUserId: "",
    dueAt: "",
    status: "open",
    priority: "normal",
    sourceMessageIds: [],
    createdAt: "2026-08-20T09:00:00+09:00",
    updatedAt: "2026-08-20T09:00:00+09:00",
    lastRemindedAt: "",
    notes: "",
    ...overrides,
  };
}

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    title: "請求書を作成する",
    detail: "",
    assignee: "",
    dueAt: null,
    priority: "normal" as const,
    sourceMessageIds: ["m100"],
    confidence: 0.9,
    ...overrides,
  };
}

describe("time", () => {
  it("Asia/Tokyo のオフセット付き ISO を返す", () => {
    const iso = toIsoInTimezone(new Date("2026-08-22T05:30:00Z"));
    assert.equal(iso, "2026-08-22T14:30:00+09:00");
  });

  it("UTC 深夜が翌日 09:00 JST になる（24時 正規化）", () => {
    const iso = toIsoInTimezone(new Date("2026-08-22T15:00:00Z"));
    assert.equal(iso, "2026-08-23T00:00:00+09:00");
  });

  it("不正な日時を弾く", () => {
    assert.equal(isValidIso("来週の火曜"), false);
    assert.equal(isValidIso(null), false);
    assert.equal(isValidIso("2026-08-22T14:30:00+09:00"), true);
  });

  it("残り時間を計算する", () => {
    const from = new Date("2026-08-22T00:00:00Z");
    assert.equal(hoursUntil("2026-08-22T06:00:00Z", from), 6);
    assert.equal(hoursUntil("2026-08-21T21:00:00Z", from), -3);
  });

  it("日本語表記に整形する", () => {
    const formatted = formatLocal("2026-08-22T05:30:00Z");
    assert.match(formatted, /2026/);
    assert.match(formatted, /14:30/);
  });
});

describe("重複判定", () => {
  it("表記ゆれを吸収する", () => {
    assert.equal(normalize("「見積書」を送付する。"), "見積書を送付する");
  });

  it("包含関係を同一とみなす", () => {
    assert.equal(isSimilar("見積書を送付する", "見積書を送付"), true);
  });

  it("短い別物を誤判定しない", () => {
    assert.equal(isSimilar("A社へ連絡", "B社へ請求"), false);
  });
});

describe("filterNewTasks", () => {
  it("確度の低い候補を捨てる", () => {
    const { accepted, skipped } = filterNewTasks(
      [candidate({ confidence: 0.3 })],
      [],
    );
    assert.equal(accepted.length, 0);
    assert.equal(skipped, 1);
  });

  it("既存タスクと同じ根拠メッセージなら捨てる", () => {
    const existing = task({ sourceMessageIds: ["m100"] });
    const { accepted, skipped } = filterNewTasks([candidate()], [existing]);
    assert.equal(accepted.length, 0);
    assert.equal(skipped, 1);
  });

  it("既存タスクと似たタイトルなら捨てる", () => {
    const existing = task({ title: "請求書を作成する" });
    const { accepted } = filterNewTasks(
      [candidate({ sourceMessageIds: ["m999"] })],
      [existing],
    );
    assert.equal(accepted.length, 0);
  });

  it("同一バッチ内の重複も 1 件に畳む", () => {
    const { accepted } = filterNewTasks(
      [
        candidate({ sourceMessageIds: ["m1"] }),
        candidate({ sourceMessageIds: ["m2"] }),
      ],
      [],
    );
    assert.equal(accepted.length, 1);
  });

  it("新規タスクは通す", () => {
    const { accepted } = filterNewTasks([candidate()], []);
    assert.equal(accepted.length, 1);
  });
});

describe("sortByUrgency", () => {
  it("期限が近い順、期限なしは最後", () => {
    const sorted = sortByUrgency([
      task({ id: "none", dueAt: "" }),
      task({ id: "late", dueAt: "2030-01-01T00:00:00+09:00" }),
      task({ id: "soon", dueAt: "2026-01-01T00:00:00+09:00" }),
    ]);
    assert.deepEqual(
      sorted.map((t) => t.id),
      ["soon", "late", "none"],
    );
  });

  it("期限が同じなら優先度順", () => {
    const sorted = sortByUrgency([
      task({ id: "low", dueAt: "", priority: "low" }),
      task({ id: "high", dueAt: "", priority: "high" }),
    ]);
    assert.deepEqual(
      sorted.map((t) => t.id),
      ["high", "low"],
    );
  });
});

describe("自動実行のリスク判定", () => {
  it("既定（low まで自動）ではメール送信を自動実行しない", () => {
    assert.equal(canAutoExecute("low"), true);
    assert.equal(canAutoExecute("medium"), false);
    assert.equal(canAutoExecute("high"), false);
  });
});

describe("メッセージ生成", () => {
  it("タスクが無ければテキストで返す", () => {
    const message = taskListMessage("📋 未完了タスク", []);
    assert.equal(message.type, "text");
  });

  it("タスクがあれば Flex を返し 10 件で打ち切る", () => {
    const tasks = Array.from({ length: 15 }, (_, i) =>
      task({ id: `t${i}`, title: `タスク${i}` }),
    );
    const message = taskListMessage("📋 未完了タスク", tasks);
    assert.equal(message.type, "flex");
    const bubble = (message as { contents: { body: { contents: unknown[] } } })
      .contents;
    assert.equal(bubble.body.contents.length, 10);
  });

  it("承認カードに実行/取消の postback が入る", () => {
    const message = actionApprovalMessage(
      {
        id: "a1",
        taskId: "abc123",
        groupId: "G1",
        type: "gmail.send",
        risk: "high",
        status: "awaiting_approval",
        summary: "A 社へ見積書を送信",
        params: {
          title: null,
          startAt: null,
          endAt: null,
          location: null,
          attendees: null,
          to: ["a@example.com"],
          subject: "お見積り",
          body: "本文",
          text: null,
        },
        result: "",
        createdAt: "",
        updatedAt: "",
      },
      task(),
    );
    const serialized = JSON.stringify(message);
    assert.match(serialized, /action=approve&actionId=a1/);
    assert.match(serialized, /action=reject&actionId=a1/);
  });
});
