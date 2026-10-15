import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { findUser, hasAnyUser, listPublicUsers, readSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/**
 * ログイン画面と設定画面が最初に聞く情報。
 * まだ誰も登録されていなければ、最初の利用者を作る画面に切り替える。
 */
export async function GET() {
  const registered = await hasAnyUser();
  const id = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  return NextResponse.json({
    registered,
    me: id ?? null,
    role: id ? ((await findUser(id))?.role ?? null) : null,
    users: id ? await listPublicUsers() : [],
  });
}
