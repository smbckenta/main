/**
 * 会話から「顧客との折衝記録」「パートナーとの打ち合わせ記録」を抽出する。
 *
 * タスク抽出（extractor.ts）とは目的が違う。
 * - タスク   : これから誰かがやること
 * - 折衝記録 : すでに起きたやり取りの事実
 * 同じ会話から両方が出ることもある（「A 社と面談した。見積を出す」→ 記録 1 件 + タスク 1 件）。
 *
 * 基幹システムに入る情報なので、タスク抽出より保守的に判定する。
 * 迷ったら出さない。誤登録を消して回るコストのほうが、取りこぼしより高い。
 */

import { z } from "zod";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic } from "./client.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { nowIsoInTimezone } from "../time.js";
import type { StoredChatMessage, StoredInteractionRecord } from "../types.js";

const InteractionSchema = z.object({
  kind: z
    .enum(["customer", "partner"])
    .describe(
      "顧客（見込み客・既存客）とのやり取りなら customer、代理店・仕入先・協業先とのやり取りなら partner。",
    ),
  counterpartyName: z
    .string()
    .describe("相手先の会社名・組織名。会話に出てきた表記のまま。"),
  contactPerson: z
    .string()
    .describe("先方の担当者名。会話に出てこなければ空文字。"),
  ourStaff: z
    .string()
    .describe("対応した弊社側の担当者。報告している発言者が通常これにあたる。"),
  occurredAt: z
    .string()
    .nullable()
    .describe(
      "折衝が行われた日時。ISO 8601 のオフセット付き。報告している日時ではなく、実際に会った／話した日時。特定できなければ null。",
    ),
  channel: z
    .enum(["visit", "phone", "online", "email", "chat", "other"])
    .describe(
      "訪問=visit、電話=phone、オンライン会議=online、メール=email、チャット=chat、不明=other。",
    ),
  subject: z.string().describe("一覧に出す件名。30 文字以内。"),
  summary: z.string().describe("何が話されたかの要約。3 行程度。"),
  detail: z
    .string()
    .describe(
      "議題、先方の反応・要望・懸念、決定事項。会話に書かれていることだけを書く。",
    ),
  nextAction: z
    .string()
    .describe("次にやると合意されたこと。無ければ空文字。"),
  nextActionDueAt: z
    .string()
    .nullable()
    .describe("次回アクションの期限。ISO 8601。無ければ null。"),
  stage: z
    .string()
    .describe(
      "商談の段階（例: 初回接触 / ヒアリング / 提案中 / 見積提出 / クロージング / 受注 / 失注 / 定例）。読み取れなければ空文字。",
    ),
  amount: z
    .string()
    .describe("金額の話が出た場合はその金額。出ていなければ空文字。"),
  sourceMessageIds: z
    .array(z.string())
    .describe("この記録の根拠となったメッセージ ID。必ず 1 件以上。"),
  confidence: z
    .number()
    .describe("記録として登録してよいと考える度合い。0.0〜1.0。"),
});

const ExtractionSchema = z.object({
  records: z.array(InteractionSchema),
});

export type ExtractedInteraction = z.infer<typeof InteractionSchema>;

const SYSTEM_PROMPT = `あなたは日本の企業のグループ LINE を読み、営業活動の記録を基幹システムへ登録するアシスタントです。

## 抽出するもの
すでに発生した、顧客またはパートナーとの「外部との接触」の報告。

- 訪問・来社・面談の報告（「本日 A 社さんへ訪問しました」）
- 電話・オンライン会議の報告（「B 社と Zoom で打ち合わせ、〜という話でした」）
- 代理店や仕入先との商談・条件交渉の報告
- 先方からの要望・懸念・回答の共有（「C 社から価格を下げてほしいと言われました」）
- 商談の進展・結果の報告（「D 社、受注いただけました」「E 社は今回見送りとのことです」）

## 抽出しないもの
- 社内メンバーだけのやり取り、社内の相談・調整・雑談
- これからやる予定の話だけで、まだ接触していないもの（「来週 A 社に行きます」だけなら記録にしない）
- 誰と話したのか特定できないもの（相手先が分からない記録は価値がない）
- すでに登録済みの記録と同じ接触を指しているもの
- 一般的な業界の話題やニュースの共有

## 判断の原則
- **迷ったら出さない。** この記録は基幹システムに入ります。誤登録を後から消すコストは高いです。
- 相手先が特定できない場合は、その記録ごと出さない（counterpartyName を推測で埋めない）。
- 会話に書かれていないことを補わない。detail に想像した内容を書かない。
- 1 回の接触につき 1 件にまとめる。同じ訪問について複数人が発言していても 1 件。
- 「来週行きます」（予定）と「行ってきました」（実績）を混同しない。記録は実績のみ。
- occurredAt は接触した日時。報告が翌日なら、報告日ではなく接触日を入れる。
  「本日」「先ほど」なら発言日時、「昨日」なら前日。特定できなければ null。
- 相対的な日付表現は現在時刻を基準に絶対時刻へ変換する。
- confidence は、相手先・日時・内容の 3 つがどれだけはっきりしているかで決める。
  相手先が曖昧、あるいは接触したのか予定なのか読み取れない場合は 0.5 未満にする。`;

export interface InteractionExtractionInput {
  groupId: string;
  targetMessages: StoredChatMessage[];
  contextMessages: StoredChatMessage[];
  /** 直近の既存記録。同じ接触を二重登録しないために渡す。 */
  recentRecords: StoredInteractionRecord[];
}

function renderMessages(messages: StoredChatMessage[]): string {
  return messages
    .map(
      (message) =>
        `[${message.messageId}] ${message.timestamp} ${message.displayName || message.userId}: ${message.text}`,
    )
    .join("\n");
}

function renderRecords(records: StoredInteractionRecord[]): string {
  if (records.length === 0) return "（登録済みの記録はありません）";
  return records
    .map(
      (record) =>
        `- ${record.occurredAt || "日時不明"} ${record.counterpartyName}（${record.kind === "customer" ? "顧客" : "パートナー"}）: ${record.subject}`,
    )
    .join("\n");
}

export async function extractInteractions(
  input: InteractionExtractionInput,
): Promise<ExtractedInteraction[] | null> {
  const contextBlock =
    input.contextMessages.length > 0
      ? `## これまでの会話（文脈。ここからは新規に記録を作らない）\n${renderMessages(input.contextMessages)}\n\n`
      : "";

  const userContent = `現在時刻: ${nowIsoInTimezone()}

## すでに登録済みの記録（重複させない）
${renderRecords(input.recentRecords)}

${contextBlock}## 今回の解析対象の会話
${renderMessages(input.targetMessages)}

上記の「今回の解析対象の会話」から、顧客との折衝記録およびパートナーとの打ち合わせ記録を抽出してください。
該当するものが無ければ records を空配列にしてください。`;

  const response = await anthropic.messages.parse({
    model: config.anthropic.model,
    max_tokens: 12000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
    output_config: {
      format: zodOutputFormat(ExtractionSchema),
      effort: config.anthropic.extractEffort as "low" | "medium" | "high",
    },
  });

  if (response.stop_reason === "refusal") {
    logger.warn("折衝記録の抽出が拒否されました", {
      groupId: input.groupId,
      category: response.stop_details?.category ?? null,
    });
    return null;
  }

  if (!response.parsed_output) {
    logger.warn("折衝記録の抽出で構造化出力が得られませんでした", {
      groupId: input.groupId,
      stopReason: response.stop_reason,
    });
    return null;
  }

  logger.info("折衝記録の抽出が完了しました", {
    groupId: input.groupId,
    records: response.parsed_output.records.length,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return response.parsed_output.records;
}
