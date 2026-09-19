import { promises as fs } from "node:fs";
import path from "node:path";
import { createSign } from "node:crypto";
import { DATA_DIR, ensureDataDir } from "../store";

/**
 * Googleサービスアカウントによる認証。
 * 保存先に置いた鍵ファイル（google-service-account.json）で
 * スプレッドシートへの読み書き用のアクセストークンを取得する。
 *
 * 外部ライブラリを増やさずに済むよう、JWTの組み立てと署名は node:crypto で行う。
 */

const KEY_FILE = "google-service-account.json";
/** 動作確認用に差し替えられるようにしている（通常は既定のまま） */
const TOKEN_URL = process.env.GOOGLE_TOKEN_URL ?? "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/spreadsheets";

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

export class GoogleAuthError extends Error {}

let cached: { token: string; expiresAt: number } | null = null;

export async function readServiceAccountKey(): Promise<ServiceAccountKey | undefined> {
  await ensureDataDir();
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, KEY_FILE), "utf8");
    const key = JSON.parse(raw) as Partial<ServiceAccountKey>;
    if (!key.client_email || !key.private_key) return undefined;
    return { client_email: key.client_email, private_key: key.private_key };
  } catch {
    return undefined;
  }
}

/** 鍵が置かれているか（画面に案内を出すために使う） */
export async function serviceAccountEmail(): Promise<string | undefined> {
  return (await readServiceAccountKey())?.client_email;
}

const base64url = (input: string | Buffer): string =>
  Buffer.from(input).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

/** アクセストークンを取得する（1時間有効なので使い回す） */
export async function getAccessToken(now = Date.now()): Promise<string> {
  if (cached && cached.expiresAt > now + 60_000) return cached.token;

  const key = await readServiceAccountKey();
  if (!key) {
    throw new GoogleAuthError(
      `Googleの鍵ファイルがありません。データの保存先に ${KEY_FILE} を置いてください。`,
    );
  }

  const issued = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: key.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: issued,
      exp: issued + 3600,
    }),
  );
  const sign = createSign("RSA-SHA256");
  sign.update(`${header}.${claims}`);
  const signature = base64url(sign.sign(key.private_key.replace(/\\n/g, "\n")));

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claims}.${signature}`,
    }),
  });
  const json = (await res.json()) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!res.ok || !json.access_token) {
    throw new GoogleAuthError(
      `Googleの認証に失敗しました（${json.error_description ?? res.status}）。鍵ファイルと、スプレッドシートの共有設定をご確認ください。`,
    );
  }
  cached = { token: json.access_token, expiresAt: now + (json.expires_in ?? 3600) * 1000 };
  return json.access_token;
}

/** 鍵を入れ替えたときにトークンを捨てる */
export function clearTokenCache(): void {
  cached = null;
}
