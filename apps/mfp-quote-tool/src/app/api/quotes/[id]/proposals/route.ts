import { NextResponse } from "next/server";
import { getQuote, saveQuote } from "@/lib/store";
import { buildProposal } from "@/lib/proposal-builder";
import { calcQuoteAll } from "@/lib/calc-context";
import type { LeaseTerm, Maker } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 120;

type Ctx = { params: Promise<{ id: string }> };

/** 選択したメーカー分の提案をまとめて自動作成する */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });

  const body = (await req.json()) as {
    makers: Maker[];
    leaseTerm?: LeaseTerm;
    fetchSpec?: boolean;
    replace?: boolean;
  };
  if (!body.makers?.length) {
    return NextResponse.json({ error: "メーカーを1社以上選択してください。" }, { status: 400 });
  }

  const messages: string[] = [];
  const built = [];
  for (const maker of body.makers) {
    const result = await buildProposal(quote, maker, {
      leaseTerm: body.leaseTerm,
      fetchSpec: body.fetchSpec,
    });
    if (result.message) messages.push(result.message);
    built.push(result.proposal);
  }

  quote.proposals = body.replace ? built : [...quote.proposals, ...built];
  const saved = await saveQuote(quote);
  const calc = await calcQuoteAll(saved);
  return NextResponse.json({ quote: saved, ...calc, messages });
}
