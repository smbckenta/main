import { NextResponse } from "next/server";
import { findServiceArea, searchServiceAreas } from "@/lib/service-area";

export const runtime = "nodejs";

/** 保守対応エリアの検索（?q=久留米）と単件取得（?pref=福岡県&city=久留米市） */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const pref = url.searchParams.get("pref");
  const city = url.searchParams.get("city");
  if (pref && city) {
    const area = await findServiceArea(pref, city);
    return NextResponse.json({ area: area ?? null });
  }
  const q = url.searchParams.get("q") ?? "";
  return NextResponse.json({ areas: await searchServiceAreas(q) });
}
