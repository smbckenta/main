import { cookies, headers } from "next/headers";
import { IDENTITY_HEADER, IDENTITY_SOURCE, TRUSTED_PROXY_TOKEN } from "./config";
import { findUser, readSessionToken, SESSION_COOKIE, type PublicUser } from "./auth";

/**
 * 「いま操作しているのは誰か」を答える、ただ1か所。
 *
 * 今はこのツール自身のログイン画面が決めている。いずれ基幹システムの
 * 一部になると、入口は基幹システム側に移る。そのとき直す場所が
 * あちこちに散らばっていると移せないので、ここに集めておく。
 *
 * 画面もAPIも、クッキーを直接読まずにこの関数を通すこと。
 */

/** 基幹システムが渡してきた利用者を受け取ってよいか */
async function trustedHeaderId(): Promise<string | undefined> {
  if (IDENTITY_SOURCE !== "header") return undefined;
  const h = await headers();

  // 合言葉を決めてあるなら、一致しないリクエストは名乗りを信用しない。
  // ヘッダーは誰でも書けるので、前段を通ったことの確認がいる。
  if (TRUSTED_PROXY_TOKEN && h.get("x-denrai-proxy-token") !== TRUSTED_PROXY_TOKEN) {
    return undefined;
  }
  return h.get(IDENTITY_HEADER)?.trim().toLowerCase() || undefined;
}

/** ログインしている人のID。していなければ undefined */
export async function currentUserId(): Promise<string | undefined> {
  const fromHeader = await trustedHeaderId();
  if (fromHeader) return fromHeader;
  if (IDENTITY_SOURCE === "header") return undefined;
  return readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
}

/** ログインしている人。名前や権限まで要るとき */
export async function currentUser(): Promise<PublicUser | undefined> {
  const id = await currentUserId();
  return id ? findUser(id) : undefined;
}

/**
 * 記録に残す「操作した人」。
 *
 * 案件を作った・直したのが誰かは、1人で使っているうちは要らない。
 * 共有して使うようになってから足そうとすると、それまでの案件が
 * 全部「作った人が分からない」まま残る。先に入れておく。
 */
export async function actorId(): Promise<string> {
  return (await currentUserId()) ?? "";
}
