import { NextResponse } from "next/server";
import { loadSeal, saveSeal } from "@/lib/logo";

import { requireMasterEditor } from "@/lib/session";

export const runtime = "nodejs";

/** 現在の角印（見積書・比較表に押しているもの）を返す */
export async function GET() {
  const seal = await loadSeal();
  return NextResponse.json({ file: seal?.file ?? null, dataUri: seal?.dataUri ?? null });
}

/** 角印の画像を差し替える */
export async function POST(req: Request) {
  // マスタの書き換えは管理者だけ
  const denied = await requireMasterEditor();
  if (denied) return denied;

  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "画像ファイルを選んでください。" }, { status: 400 });
  }
  if (file.size > 5 * 1024 * 1024) {
    return NextResponse.json({ error: "ファイルが大きすぎます（5MBまで）。" }, { status: 400 });
  }
  try {
    const saved = await saveSeal(file.name, Buffer.from(await file.arrayBuffer()));
    const seal = await loadSeal();
    return NextResponse.json({ file: saved, dataUri: seal?.dataUri ?? null });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
