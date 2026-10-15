import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readSessionToken, SESSION_COOKIE } from "@/lib/auth";
import { IDENTITY_HEADER, IDENTITY_SOURCE, TRUSTED_PROXY_TOKEN } from "@/lib/config";

/**
 * ログインしていない人を入口で止める。
 *
 * 仕切価格・顧客情報・APIキーを扱う画面なので、
 * ログイン画面と、ログインのためのAPIだけを開けておく。
 *
 * 基幹システムの中に入れたときは、入口は基幹システム側にある。
 * MFP_IDENTITY=header にすると、確かめ済みの利用者をヘッダーで受け取り、
 * このツールのログイン画面は使わない（パスワードを二重に持たないため）。
 */

/** ログインしなくても通す道（ログイン画面と、その処理に必要なもの） */
const PUBLIC_PATHS = ["/login", "/api/auth/login", "/api/auth/state", "/api/auth/setup"];

const isPublic = (pathname: string): boolean =>
  PUBLIC_PATHS.includes(pathname) ||
  pathname.startsWith("/_next/") ||
  pathname === "/favicon.ico";

/** 基幹システムが渡してきた利用者。前段を通った証拠がなければ受け取らない */
function headerIdentity(req: NextRequest): string | undefined {
  if (IDENTITY_SOURCE !== "header") return undefined;
  if (TRUSTED_PROXY_TOKEN && req.headers.get("x-denrai-proxy-token") !== TRUSTED_PROXY_TOKEN) {
    return undefined;
  }
  return req.headers.get(IDENTITY_HEADER)?.trim() || undefined;
}

export async function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  if (headerIdentity(req)) return NextResponse.next();

  // 基幹システムに入口を預けているときは、このツール側では受け付けない。
  // 入れなかった理由を基幹システム側で見られるよう、素直に401で返す。
  if (IDENTITY_SOURCE === "header") {
    return NextResponse.json({ error: "基幹システムからログインしてください。" }, { status: 401 });
  }

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

/**
 * どのリクエストを通すか。
 *
 * MFP_BASE_PATH を設定して `/mfp` のような場所にぶら下げると、
 * 照合に使われる道は基準部分を取り除いたあとのもので、
 * トップページだけが空文字になる。`/(.*)` の形だけでは引っかからず、
 * **トップページが素通りしてしまう**（実際にそうなっていた）。
 * `"/"` を別に並べて、必ず拾うようにしておく。
 *
 * `_next/` と favicon は isPublic 側で通している。
 */
export const config = {
  matcher: ["/", "/((?!_next/static|_next/image).*)"],
};
