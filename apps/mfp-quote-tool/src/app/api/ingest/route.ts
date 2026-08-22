import { NextResponse } from "next/server";
import { ingestDocuments, type DocRole } from "@/lib/ingest";

export const runtime = "nodejs";
// 写真・スキャンPDFのOCRは1ページ数秒かかるため長めに取る
export const maxDuration = 600;

/** リース契約書・印刷明細をアップロードして解析する */
export async function POST(req: Request) {
  const form = await req.formData();
  const entries = form.getAll("files").filter((f): f is File => f instanceof File);
  if (!entries.length) {
    return NextResponse.json({ error: "ファイルが指定されていません。" }, { status: 400 });
  }

  const roles = form.getAll("roles").map((r) => String(r) as DocRole);
  const inputs = await Promise.all(
    entries.map(async (file, i) => ({
      name: file.name,
      buffer: Buffer.from(await file.arrayBuffer()),
      mime: file.type,
      role: roles[i],
    })),
  );

  try {
    return NextResponse.json(await ingestDocuments(inputs));
  } catch (err) {
    return NextResponse.json(
      { error: `解析に失敗しました: ${(err as Error).message}` },
      { status: 500 },
    );
  }
}
