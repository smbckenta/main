import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "複合機 見積・比較表作成ツール",
  description: "カウンター明細とリース契約書から見積書・比較表を自動作成する",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body>
        <header className="app">
          <span className="brand">複合機 見積・比較表作成ツール</span>
          <nav>
            <Link href="/">案件一覧</Link>
            <Link href="/pricebook">仕切表</Link>
            <Link href="/devices">機種スペックDB</Link>
            <Link href="/settings">設定</Link>
          </nav>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
