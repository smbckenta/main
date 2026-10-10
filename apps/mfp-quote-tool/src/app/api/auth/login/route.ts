import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSessionToken, sessionCookieOptions, SESSION_COOKIE, verifyUser } from "@/lib/auth";

export const runtime = "nodejs";

/** IDと合言葉でログインする */
export async function POST(req: Request) {
  const { id, password } = (await req.json().catch(() => ({}))) as {
    id?: string;
    password?: string;
  };
  if (!id || !password) {
    return NextResponse.json({ error: "IDとパスワードを入れてください。" }, { status: 400 });
  }

  const user = await verifyUser(id, password);
  if (!user) {
    // どちらが違うかは伝えない（IDの総当たりを助けないため）
    return NextResponse.json({ error: "IDまたはパスワードが違います。" }, { status: 401 });
  }

  (await cookies()).set(SESSION_COOKIE, await createSessionToken(user.id), sessionCookieOptions);
  return NextResponse.json({ ok: true, me: user });
}
