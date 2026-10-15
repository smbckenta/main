import { NextResponse } from "next/server";
import { getQuote, getSettings, saveQuote } from "@/lib/store";
import { calcQuoteAll } from "@/lib/calc-context";
import { allocateQuoteNumbers, syncRegister } from "@/lib/quote-register";

export const runtime = "nodejs";
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * 見積書番号の台帳（スプレッドシート）へ転記する。
 * 番号が未採番の提案にはここで番号を割り当てる。
 * 台帳へ書けない環境でも、貼り付け用の行は返す。
 */
export async function POST(_req: Request, { params }: Ctx) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });

  const settings = await getSettings();
  const need = quote.proposals.filter((p) => !p.quoteNo);
  const messages: string[] = [];
  if (need.length) {
    const allocation = await allocateQuoteNumbers(need.length, settings.quoteRegister);
    need.forEach((p, i) => (p.quoteNo = allocation.numbers[i]));
    if (allocation.warning) messages.push(allocation.warning);
  }

  const saved = need.length ? await saveQuote(quote) : quote;
  const calc = await calcQuoteAll(saved);
  const sync = await syncRegister(saved, calc.proposals, settings.quoteRegister);

  return NextResponse.json({ quote: saved, ...calc, register: sync, messages });
}
