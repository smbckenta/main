import { NextResponse } from "next/server";
import { deleteQuote, getQuote, saveQuote } from "@/lib/store";
import { calcQuoteAll } from "@/lib/calc-context";
import type { Quote } from "@/lib/types";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });

  // ?calc=1 で計算結果も返す
  if (new URL(req.url).searchParams.get("calc")) {
    const calc = await calcQuoteAll(quote);
    return NextResponse.json({ quote, ...calc });
  }
  return NextResponse.json(quote);
}

export async function PUT(req: Request, { params }: Ctx) {
  const { id } = await params;
  const existing = await getQuote(id);
  if (!existing) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });
  const body = (await req.json()) as Quote;
  const saved = await saveQuote({ ...existing, ...body, id, createdAt: existing.createdAt });
  const calc = await calcQuoteAll(saved);
  return NextResponse.json({ quote: saved, ...calc });
}

export async function DELETE(_req: Request, { params }: Ctx) {
  const { id } = await params;
  await deleteQuote(id);
  return NextResponse.json({ ok: true });
}
