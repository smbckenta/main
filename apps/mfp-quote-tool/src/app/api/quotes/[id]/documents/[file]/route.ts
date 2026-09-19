import { NextResponse } from "next/server";
import { readUpload, uploadMime } from "@/lib/uploads";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string; file: string }> };

/** 読み取った資料の原本を開く（画面の「原本を開く」から使う） */
export async function GET(_req: Request, { params }: Ctx) {
  const { id, file } = await params;
  const buffer = await readUpload(id, file);
  if (!buffer) return NextResponse.json({ error: "資料が見つかりません。" }, { status: 404 });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": uploadMime(file),
      "Content-Disposition": "inline",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
