import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { changePassword, readSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

/** ログイン中の人が、自分のパスワードを変える */
export async function POST(req: Request) {
  const id = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!id) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });

  const { current, next } = (await req.json().catch(() => ({}))) as {
    current?: string;
    next?: string;
  };
  try {
    await changePassword(id, current ?? "", next ?? "");
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
