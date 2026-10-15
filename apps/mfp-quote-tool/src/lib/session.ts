import { cookies, headers } from "next/headers";
import { NextResponse } from "next/server";
import { IDENTITY_HEADER, IDENTITY_SOURCE, TRUSTED_PROXY_TOKEN } from "./config";
import { findUser, isAdmin, readSessionToken, SESSION_COOKIE, type PublicUser } from "./auth";

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

/**
 * 会社全体のマスタを書き換えてよい人か。
 *
 * 仕切表・機種スペックDB・設定・ロゴ／角印は、全員が同じものを見て
 * 同じ見積を作るための土台。ここが1人の思いつきで変わると、
 * 誰かが気づかないまま古い条件・違う条件で見積を出してしまう。
 * 直せるのは管理者（オーナーを含む）だけにする。
 */
export async function canEditMasters(): Promise<boolean> {
  return isAdmin(await currentUser());
}

/**
 * マスタを書き換えるAPIの入口。
 * 書き換えてよい人でなければ 403 を返す（通してよければ undefined）。
 */
export async function requireMasterEditor(): Promise<NextResponse | undefined> {
  if (await canEditMasters()) return undefined;
  return NextResponse.json(
    { error: "この内容を変更できるのは管理者だけです。管理者の方にご依頼ください。" },
    { status: 403 },
  );
}
