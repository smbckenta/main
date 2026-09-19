import { NextResponse } from "next/server";
import { lookupOptions } from "@/lib/specs/lookup";
import type { Maker } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

/** 機種のオプション一覧をメーカーサイトから取得する */
export async function POST(req: Request) {
  const { model, maker } = (await req.json()) as { model: string; maker?: Maker };
  if (!model) return NextResponse.json({ error: "型番が必要です。" }, { status: 400 });
  return NextResponse.json(await lookupOptions(model, maker));
}
