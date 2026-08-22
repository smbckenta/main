/**
 * Gmail の下書き作成・送信。
 *
 * サービスアカウント単体では Gmail を操作できない。
 * GOOGLE_IMPERSONATE_SUBJECT を設定し、ドメイン全体の委任（DWD）で
 * 実在ユーザーの権限を借りる必要がある。詳細は docs/setup.md を参照。
 */

import { google } from "googleapis";
import { getGoogleAuth } from "../google/auth.js";
import { config } from "../config.js";
import type { ActionParams } from "../types.js";

/** RFC 2822 のメッセージを組み立て、base64url へエンコードする。 */
function buildRawMessage(
  to: string[],
  subject: string,
  body: string,
  from: string,
): string {
  // 日本語の件名は MIME encoded-word にしないと文字化けする
  const encodedSubject = `=?UTF-8?B?${Buffer.from(subject, "utf8").toString("base64")}?=`;
  const lines = [
    `From: ${from}`,
    `To: ${to.join(", ")}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(body, "utf8").toString("base64"),
  ];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64url");
}

function validate(params: ActionParams): {
  to: string[];
  subject: string;
  body: string;
} {
  const to = (params.to ?? []).filter((address) => address.includes("@"));
  if (to.length === 0) {
    throw new Error("宛先メールアドレスが特定できません");
  }
  if (!params.subject) {
    throw new Error("件名が指定されていません");
  }
  if (!params.body) {
    throw new Error("本文が指定されていません");
  }
  return { to, subject: params.subject, body: params.body };
}

function senderAddress(): string {
  if (!config.google.impersonateSubject) {
    throw new Error(
      "GOOGLE_IMPERSONATE_SUBJECT が未設定のため Gmail を操作できません",
    );
  }
  return config.google.impersonateSubject;
}

export async function createGmailDraft(params: ActionParams): Promise<string> {
  const { to, subject, body } = validate(params);
  const gmail = google.gmail({ version: "v1", auth: getGoogleAuth() });

  const response = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: { raw: buildRawMessage(to, subject, body, senderAddress()) },
    },
  });

  return `Gmail の下書きを作成しました（宛先: ${to.join(", ")} / 件名: ${subject}）\n下書き ID: ${response.data.id ?? "不明"}`;
}

export async function sendGmail(params: ActionParams): Promise<string> {
  const { to, subject, body } = validate(params);
  const gmail = google.gmail({ version: "v1", auth: getGoogleAuth() });

  await gmail.users.messages.send({
    userId: "me",
    requestBody: { raw: buildRawMessage(to, subject, body, senderAddress()) },
  });

  return `メールを送信しました（宛先: ${to.join(", ")} / 件名: ${subject}）`;
}
