import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import LogoutButton from "./LogoutButton";
import { listUsers, readSessionToken, SESSION_COOKIE } from "@/lib/auth";
import "./globals.css";

export const metadata: Metadata = {
  title: "複合機 見積・比較表作成ツール",
  description: "カウンター明細とリース契約書から見積書・比較表を自動作成する",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // ログインしている人だけに、画面の上の行き先を出す
  const id = await readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  const me = id ? (await listUsers()).find((u) => u.id === id) : undefined;

  return (
    <html lang="ja">
      <body>
        <header className="app">
          <span className="brand">複合機 見積・比較表作成ツール</span>
          {me && (
            <>
              <nav>
                <Link href="/">案件一覧</Link>
                <Link href="/pricebook">仕切表</Link>
                <Link href="/devices">機種スペックDB</Link>
                <Link href="/settings">設定</Link>
              </nav>
              <span className="me">
                <span>
                  {me.name || me.id} さん
                  {/* 管理者かどうかは、他の人のパスワードを触る前に分かっているほうがよい */}
                  {me.role !== "member" && (
                    <span className="role">{me.role === "owner" ? "オーナー" : "管理者"}</span>
                  )}
                </span>
                <LogoutButton />
              </span>
            </>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
