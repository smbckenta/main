import { NextResponse } from "next/server";
import { deletePriceBookEntry, getPriceBook, upsertPriceBookEntry } from "@/lib/store";
import type { PriceBookEntry } from "@/lib/types";

import { requireMasterEditor } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getPriceBook());
}

export async function POST(req: Request) {
  // マスタの書き換えは管理者だけ
  const denied = await requireMasterEditor();
  if (denied) return denied;

  const entry = (await req.json()) as PriceBookEntry;
  if (!entry.id || !entry.model) {
    return NextResponse.json({ error: "id と model は必須です。" }, { status: 400 });
  }
  return NextResponse.json(await upsertPriceBookEntry(entry));
}

export async function DELETE(req: Request) {
  // マスタの書き換えは管理者だけ
  const denied = await requireMasterEditor();
  if (denied) return denied;

  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です。" }, { status: 400 });
  await deletePriceBookEntry(id);
  return NextResponse.json({ ok: true });
}
