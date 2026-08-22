/**
 * Google API 用の認証。
 *
 * Cloud Run 上ではサービスアカウントの Application Default Credentials が自動で使われる。
 * Gmail 送信や個人カレンダーへの書き込みが必要な場合だけ、ドメイン全体の委任（DWD）で
 * GOOGLE_IMPERSONATE_SUBJECT のユーザーになりすます。
 *
 * 注意: DWD の subject 指定はサービスアカウント鍵（JWT）経由でのみ効く。
 * Cloud Run のメタデータサーバー由来の資格情報では効かないため、Gmail を使う場合は
 * GOOGLE_APPLICATION_CREDENTIALS に鍵ファイルを渡す必要がある（docs/setup.md 参照）。
 *
 * GoogleAuth は googleapis がバンドルしているものを使う。google-auth-library を
 * 直接依存に足すと、googleapis 内部の版とズレて型が合わなくなる。
 */

import { google } from "googleapis";
import { config } from "../config.js";

const SCOPES = [
  "https://www.googleapis.com/auth/spreadsheets",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/gmail.send",
];

function createAuth() {
  return new google.auth.GoogleAuth({
    scopes: SCOPES,
    ...(config.google.impersonateSubject
      ? { clientOptions: { subject: config.google.impersonateSubject } }
      : {}),
  });
}

let cached: ReturnType<typeof createAuth> | null = null;

export function getGoogleAuth(): ReturnType<typeof createAuth> {
  if (!cached) {
    cached = createAuth();
  }
  return cached;
}
