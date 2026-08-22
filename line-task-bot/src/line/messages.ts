/** LINE へ送るメッセージの組み立て。Flex Message のレイアウトをここに集約する。 */

import type { messagingApi } from "@line/bot-sdk";

type Message = messagingApi.Message;
type FlexBubble = messagingApi.FlexBubble;
type FlexComponent = messagingApi.FlexComponent;
import { formatLocal, formatLocalDate, hoursUntil } from "../time.js";
import type {
  InteractionRecord,
  StoredAction,
  StoredTask,
  Task,
} from "../types.js";

const PRIORITY_LABEL: Record<Task["priority"], string> = {
  high: "高",
  normal: "中",
  low: "低",
};

const STATUS_LABEL: Record<Task["status"], string> = {
  open: "未着手",
  in_progress: "進行中",
  done: "完了",
  cancelled: "取消",
};

const COLOR_URGENT = "#D64545";
const COLOR_SOON = "#E08A1E";
const COLOR_NORMAL = "#5B6470";
const COLOR_ACCENT = "#2C6BED";

export function text(content: string): Message {
  // LINE のテキストメッセージ上限は 5000 文字
  return { type: "text", text: content.slice(0, 5000) };
}

/** 期限までの余裕で色を変える。一覧の中で急ぎが目に入るように。 */
function dueColor(dueAt: string): string {
  if (!dueAt) return COLOR_NORMAL;
  const hours = hoursUntil(dueAt);
  if (hours < 0) return COLOR_URGENT;
  if (hours < 24) return COLOR_SOON;
  return COLOR_NORMAL;
}

function dueLabel(dueAt: string): string {
  if (!dueAt) return "期限なし";
  const hours = hoursUntil(dueAt);
  if (hours < 0) return `期限超過（${formatLocalDate(dueAt)}）`;
  return formatLocal(dueAt);
}

function taskRow(task: StoredTask): FlexComponent {
  return {
    type: "box",
    layout: "vertical",
    spacing: "xs",
    margin: "md",
    contents: [
      {
        type: "text",
        text: `${task.priority === "high" ? "⚡ " : ""}${task.title}`,
        wrap: true,
        size: "sm",
        weight: "bold",
      },
      {
        type: "box",
        layout: "baseline",
        spacing: "sm",
        contents: [
          {
            type: "text",
            text: dueLabel(task.dueAt),
            size: "xxs",
            color: dueColor(task.dueAt),
            flex: 3,
          },
          {
            type: "text",
            text: `${task.assignee || "担当未定"} / ${STATUS_LABEL[task.status]}`,
            size: "xxs",
            color: COLOR_NORMAL,
            flex: 2,
            align: "end",
          },
        ],
      },
      {
        type: "box",
        layout: "horizontal",
        spacing: "sm",
        margin: "sm",
        contents: [
          {
            type: "button",
            style: "link",
            height: "sm",
            action: {
              type: "postback",
              label: "完了",
              data: `action=done&taskId=${task.id}`,
              displayText: `「${task.title}」を完了にします`,
            },
          },
          {
            type: "button",
            style: "link",
            height: "sm",
            action: {
              type: "postback",
              label: "実行案",
              data: `action=plan&taskId=${task.id}`,
              displayText: `「${task.title}」の実行案を出します`,
            },
          },
        ],
      },
      { type: "separator", margin: "md" },
    ],
  };
}

/** 未完了タスク一覧。期限が近い順に並べ替えてから渡すこと。 */
export function taskListMessage(
  title: string,
  tasks: StoredTask[],
): Message {
  if (tasks.length === 0) {
    return text(`${title}\n未完了のタスクはありません。`);
  }

  // Flex Message のサイズ上限があるため 10 件で打ち切る
  const shown = tasks.slice(0, 10);
  const bubble: FlexBubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        { type: "text", text: title, weight: "bold", size: "md" },
        {
          type: "text",
          text: `${tasks.length} 件${tasks.length > shown.length ? `（うち ${shown.length} 件を表示）` : ""}`,
          size: "xs",
          color: COLOR_NORMAL,
        },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      contents: shown.map(taskRow),
    },
  };

  return { type: "flex", altText: `${title}（${tasks.length} 件）`, contents: bubble };
}

/** 承認待ちアクションの確認カード。 */
export function actionApprovalMessage(
  action: Omit<StoredAction, "rowNumber">,
  task: Task,
): Message {
  const detail = actionDetailLines(action);
  const bubble: FlexBubble = {
    type: "bubble",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: "実行の確認",
          weight: "bold",
          size: "sm",
          color: COLOR_ACCENT,
        },
        { type: "text", text: action.summary, wrap: true, weight: "bold" },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "text",
          text: `タスク: ${task.title}`,
          size: "xs",
          color: COLOR_NORMAL,
          wrap: true,
        },
        { type: "separator" },
        ...detail.map(
          (line): FlexComponent => ({
            type: "text",
            text: line,
            size: "xs",
            wrap: true,
          }),
        ),
      ],
    },
    footer: {
      type: "box",
      layout: "horizontal",
      spacing: "sm",
      contents: [
        {
          type: "button",
          style: "secondary",
          height: "sm",
          action: {
            type: "postback",
            label: "取消",
            data: `action=reject&actionId=${action.id}`,
            displayText: "実行を取り消します",
          },
        },
        {
          type: "button",
          style: "primary",
          height: "sm",
          color: COLOR_ACCENT,
          action: {
            type: "postback",
            label: "実行する",
            data: `action=approve&actionId=${action.id}`,
            displayText: "実行します",
          },
        },
      ],
    },
  };

  return { type: "flex", altText: `実行の確認: ${action.summary}`, contents: bubble };
}

function actionDetailLines(action: Omit<StoredAction, "rowNumber">): string[] {
  const params = action.params;
  switch (action.type) {
    case "calendar.createEvent":
      return [
        `件名: ${params.title ?? "（未設定）"}`,
        `日時: ${params.startAt ? formatLocal(params.startAt) : "（未設定）"}`,
        ...(params.location ? [`場所: ${params.location}`] : []),
        ...(params.attendees?.length
          ? [`参加者: ${params.attendees.join(", ")}`]
          : []),
      ];
    case "gmail.draft":
    case "gmail.send":
      return [
        `宛先: ${(params.to ?? []).join(", ") || "（未設定）"}`,
        `件名: ${params.subject ?? "（未設定）"}`,
        `本文:\n${(params.body ?? "").slice(0, 400)}`,
      ];
    case "line.notify":
      return [params.text ?? "（本文なし）"];
  }
}

/* ------------------------------------------------------------------ *
 * 折衝記録
 * ------------------------------------------------------------------ */

const CHANNEL_LABEL: Record<InteractionRecord["channel"], string> = {
  visit: "訪問",
  phone: "電話",
  online: "オンライン",
  email: "メール",
  chat: "チャット",
  other: "その他",
};

const KIND_LABEL: Record<InteractionRecord["kind"], string> = {
  customer: "顧客折衝",
  partner: "パートナー打合せ",
};

/**
 * 抽出した折衝記録の確認カード。
 * 基幹システムへ入る内容なので、承認前に中身がすべて見えるようにしている。
 */
export function recordApprovalMessage(record: InteractionRecord): Message {
  const rows: [string, string][] = [
    ["日時", record.occurredAt ? formatLocal(record.occurredAt) : "未特定"],
    ["手段", CHANNEL_LABEL[record.channel]],
    ["先方担当", record.contactPerson || "未記載"],
    ["弊社担当", record.ourStaff || "未記載"],
    ...(record.stage ? ([["段階", record.stage]] as [string, string][]) : []),
    ...(record.amount ? ([["金額", record.amount]] as [string, string][]) : []),
  ];

  const bubble: FlexBubble = {
    type: "bubble",
    size: "mega",
    header: {
      type: "box",
      layout: "vertical",
      contents: [
        {
          type: "text",
          text: `${KIND_LABEL[record.kind]}の記録`,
          size: "xs",
          weight: "bold",
          color: COLOR_ACCENT,
        },
        {
          type: "text",
          text: record.counterpartyName,
          weight: "bold",
          size: "lg",
          wrap: true,
        },
        { type: "text", text: record.subject, size: "sm", wrap: true },
      ],
    },
    body: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        ...rows.map(
          ([label, value]): FlexComponent => ({
            type: "box",
            layout: "baseline",
            spacing: "sm",
            contents: [
              {
                type: "text",
                text: label,
                size: "xs",
                color: COLOR_NORMAL,
                flex: 2,
              },
              { type: "text", text: value, size: "xs", flex: 5, wrap: true },
            ],
          }),
        ),
        { type: "separator", margin: "md" },
        {
          type: "text",
          text: record.summary,
          size: "sm",
          wrap: true,
          margin: "md",
        },
        ...(record.nextAction
          ? [
              {
                type: "text" as const,
                text: `次回: ${record.nextAction}${record.nextActionDueAt ? `（${formatLocalDate(record.nextActionDueAt)}）` : ""}`,
                size: "xs" as const,
                color: COLOR_SOON,
                wrap: true,
                margin: "md" as const,
              },
            ]
          : []),
      ],
    },
    footer: {
      type: "box",
      layout: "vertical",
      spacing: "sm",
      contents: [
        {
          type: "box",
          layout: "horizontal",
          spacing: "sm",
          contents: [
            {
              type: "button",
              style: "secondary",
              height: "sm",
              action: {
                type: "postback",
                label: "破棄",
                data: `action=rec_reject&recordId=${record.id}`,
                displayText: "この記録を破棄します",
              },
            },
            {
              type: "button",
              style: "primary",
              height: "sm",
              color: COLOR_ACCENT,
              action: {
                type: "postback",
                label: "登録する",
                data: `action=rec_approve&recordId=${record.id}`,
                displayText: "この記録を登録します",
              },
            },
          ],
        },
        {
          type: "text",
          text: `修正が必要なら records シートの ID ${record.id} を直してから登録してください`,
          size: "xxs",
          color: COLOR_NORMAL,
          wrap: true,
        },
      ],
    },
  };

  return {
    type: "flex",
    altText: `折衝記録の確認: ${record.counterpartyName} / ${record.subject}`,
    contents: bubble,
  };
}

/** 未承認の記録一覧。件数だけ伝えて、詳細は個別カードで見てもらう。 */
export function draftRecordsMessage(
  records: InteractionRecord[],
): Message {
  if (records.length === 0) {
    return text("未承認の折衝記録はありません。");
  }
  const lines = records.map(
    (record) =>
      `・[${record.id}] ${record.counterpartyName} / ${record.subject}${record.occurredAt ? `（${formatLocalDate(record.occurredAt)}）` : ""}`,
  );
  return text(
    `未承認の折衝記録が ${records.length} 件あります。\n\n${lines.join("\n")}\n\n「記録 <ID>」で内容を確認できます。`,
  );
}

/** 新規タスクを検出したときの通知。 */
export function newTasksMessage(tasks: Task[]): Message {
  const lines = tasks.map((task) => {
    const due = task.dueAt ? ` / 期限 ${formatLocal(task.dueAt)}` : "";
    const assignee = task.assignee ? ` / 担当 ${task.assignee}` : "";
    return `・${task.title}（優先度 ${PRIORITY_LABEL[task.priority]}${assignee}${due}）`;
  });
  return text(
    `会話から ${tasks.length} 件のタスクを登録しました。\n\n${lines.join("\n")}\n\n「タスク」と送ると一覧を表示します。`,
  );
}

export const HELP_TEXT = `使い方

タスク        未完了タスクの一覧
今日          今日が期限のタスク
解析          直近の会話をいますぐ解析
完了 <ID>     タスクを完了にする
追加 <内容>   タスクを手動で追加
実行案 <ID>   タスクに対する実行案を出す
記録          未承認の折衝記録の一覧
記録 <ID>     折衝記録の内容を確認して登録
ヘルプ        この説明

一覧のボタンからも完了・実行案の操作ができます。`;
