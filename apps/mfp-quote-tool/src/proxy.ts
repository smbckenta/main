import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "@/lib/auth";

/**
 * ログインしていない人を入口で止める。
 *
 * 仕切価格・顧客情報・APIキーを扱う画面なので、
 * ログイン画面と、ログインのためのAPIだけを開けておく。
 */

/** ログインしなくても通す道（ログイン画面と、その処理に必要なもの） */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/state", "/api/auth/setup"];

const isPublic = (pathname: string): boolean =>
  PUBLIC_PATHS.includes(pathname) ||
  pathname.startsWith("/_next/") ||
  pathname === "/favicon.ico";

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  const id = await readSessionToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (id) return NextResponse.next();

  // APIは画面を返しても使えないので、そのまま401で返す
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "ログインしてください。" }, { status: 401 });
  }

  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + req.nextUrl.search)}`;
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
