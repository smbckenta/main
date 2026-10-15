import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createSessionToken,
  createUser,
  hasAnyUser,
  sessionCookieOptions,
  SESSION_COOKIE,
} from "@/lib/auth";

export const runtime = "nodejs";

/**
 * いちばん最初の利用者を作る。
 * 誰かが登録されたあとは、この入口は閉じる（設定画面から追加する）。
 */
export async function POST(req: Request) {
  if (await hasAnyUser()) {
    return NextResponse.json(
      { error: "すでに利用者が登録されています。設定画面から追加してください。" },
      { status: 409 },
    );
  }
  const { id, password, name } = (await req.json().catch(() => ({}))) as {
    id?: string;
    password?: string;
    name?: string;
  };
  try {
    const user = await createUser(id ?? "", password ?? "", name);
    (await cookies()).set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);
    return NextResponse.json({ ok: true, me: user });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
