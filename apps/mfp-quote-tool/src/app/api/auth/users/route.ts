import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createUser, deleteUser, listPublicUsers, readSessionToken, SESSION_COOKIE } from "@/lib/auth";

export const runtime = "nodejs";

const me = async () => readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);

/** 利用者の一覧 */
export async function GET() {
  if (!(await me())) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  return NextResponse.json({ users: await listPublicUsers() });
}

/** 利用者を追加する */
export async function POST(req: Request) {
  if (!(await me())) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const { id, password, name } = (await req.json().catch(() => ({}))) as {
    id?: string;
    password?: string;
    name?: string;
  };
  try {
    await createUser(id ?? "", password ?? "", name);
    return NextResponse.json({ ok: true, users: await listPublicUsers() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** 利用者を削除する（自分自身は消せない） */
export async function DELETE(req: Request) {
  const current = await me();
  if (!current) return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (id.trim().toLowerCase() === current) {
    return NextResponse.json({ error: "ログイン中のご自身は削除できません。" }, { status: 400 });
  }
  try {
    await deleteUser(id);
    return NextResponse.json({ ok: true, users: await listPublicUsers() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
