import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createUser,
  deleteUser,
  findUser,
  isAdmin,
  listPublicUsers,
  readSessionToken,
  resetPassword,
  setRole,
  SESSION_COOKIE,
  transferOwnership,
  type Role,
} from "@/lib/auth";

export const runtime = "nodejs";

const me = async () => readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);

/** ログイン中の管理者。管理者でなければ undefined */
async function admin(): Promise<string | undefined> {
  const id = await me();
  if (!id) return undefined;
  return isAdmin(await findUser(id)) ? id : undefined;
}

const unauthorized = () => NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
const forbidden = () =>
  NextResponse.json({ error: "この操作ができるのは管理者だけです。" }, { status: 403 });

/** 利用者の一覧 */
export async function GET() {
  if (!(await me())) return unauthorized();
  return NextResponse.json({ users: await listPublicUsers() });
}

/** 利用者を追加する（管理者のみ） */
export async function POST(req: Request) {
  if (!(await me())) return unauthorized();
  if (!(await admin())) return forbidden();

  const { id, password, name, role } = (await req.json().catch(() => ({}))) as {
    id?: string;
    password?: string;
    name?: string;
    role?: Role;
  };
  try {
    await createUser(id ?? "", password ?? "", name, role === "admin" ? "admin" : "member");
    return NextResponse.json({ ok: true, users: await listPublicUsers() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/**
 * 権限を変える（オーナーのみ）、オーナーを引き継ぐ（オーナーのみ・要パスワード）、
 * パスワードを再発行する（管理者）。
 *
 * 再発行したパスワードは、ここで1度だけ返す。保存されるのはハッシュなので、
 * 画面を閉じたあとに読み直すことはできない。
 */
export async function PATCH(req: Request) {
  const current = await me();
  if (!current) return unauthorized();
  if (!(await admin())) return forbidden();

  const { id, role, password, transfer } = (await req.json().catch(() => ({}))) as {
    id?: string;
    role?: Role;
    password?: string;
    transfer?: boolean;
  };
  try {
    if (transfer) {
      const users = await transferOwnership(current, id ?? "", password ?? "");
      return NextResponse.json({ ok: true, users });
    }
    if (role) {
      const users = await setRole(current, id ?? "", role);
      return NextResponse.json({ ok: true, users });
    }
    const issued = await resetPassword(current, id ?? "", password);
    return NextResponse.json({ ok: true, password: issued, users: await listPublicUsers() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}

/** 利用者を削除する（管理者のみ・オーナーと自分自身は消せない） */
export async function DELETE(req: Request) {
  const current = await me();
  if (!current) return unauthorized();
  if (!(await admin())) return forbidden();

  try {
    await deleteUser(current, new URL(req.url).searchParams.get("id") ?? "");
    return NextResponse.json({ ok: true, users: await listPublicUsers() });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
