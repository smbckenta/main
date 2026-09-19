import { NextResponse } from "next/server";
import { loadLogo, saveLogo } from "@/lib/logo";

export const runtime = "nodejs";

/** 現在のロゴ（見積書・比較表に載せているもの）を返す */
export async function GET() {
  const logo = await loadLogo();
  return NextResponse.json({ file: logo?.file ?? null, dataUri: logo?.dataUri ?? null });
}

/** ロゴ画像を差し替える */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "画像ファイルを選んでください。" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "ファイルが大きすぎます（5MBまで）。" }, { status: 400 });
  }
  try {
    const saved = await saveLogo(file.name, Buffer.from(await file.arrayBuffer()));
    const logo = await loadLogo();
    return NextResponse.json({ file: saved, dataUri: logo?.dataUri ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
