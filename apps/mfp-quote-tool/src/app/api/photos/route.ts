import { NextResponse } from "next/server";
import { savePhoto } from "@/lib/photos";

export const runtime = "nodejs";

/**
 * 提案資料に使う写真をアップロードする。
 * 保存先のファイル名は中身のハッシュなので、同じ写真を何度上げても増えない。
 */
export async function POST(req: Request) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "ファイルが選ばれていません。" }, { status: 400 });
  }
  try {
    const photo = await savePhoto(Buffer.from(await file.arrayBuffer()));
    return NextResponse.json({ photo });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
}
