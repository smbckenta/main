import { NextResponse } from "next/server";
import { photoMime, readPhoto } from "@/lib/photos";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ file: string }> };

/** 提案資料に使う写真を返す（画面のプレビュー用） */
export async function GET(_req: Request, { params }: Ctx) {
  const { file } = await params;
  const buffer = await readPhoto(file);
  if (!buffer) return NextResponse.json({ error: "写真が見つかりません。" }, { status: 404 });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": photoMime(file),
      // ファイル名は中身のハッシュなので、内容が変わればURLも変わる
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
