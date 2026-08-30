import { NextResponse } from "next/server";
import { getQuote, getSettings, saveQuote } from "@/lib/store";
import { buildProposal } from "@/lib/proposal-builder";
import { calcQuoteAll } from "@/lib/calc-context";
import { allocateQuoteNumbers, syncRegister } from "@/lib/quote-register";
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

  // 見積書番号は「提案（機種）1件につき1つ」。台帳の続きから採番する
  const settings = await getSettings();
  const need = quote.proposals.filter((p) => !p.quoteNo);
  if (need.length) {
    const allocation = await allocateQuoteNumbers(need.length, settings.quoteRegister);
    need.forEach((p, i) => (p.quoteNo = allocation.numbers[i]));
    if (allocation.warning) messages.push(allocation.warning);
  }

  const saved = await saveQuote(quote);
  const calc = await calcQuoteAll(saved);

  // 台帳（スプレッドシート）へ番号・顧客名・内容を書き戻す（失敗しても提案作成は成功扱い）
  const sync = await syncRegister(saved, calc.proposals, settings.quoteRegister);
  if (sync.written) messages.push(`見積書番号を台帳に${sync.written}件転記しました。`);
  else if (sync.warning) messages.push(sync.warning);

  return NextResponse.json({ quote: saved, ...calc, messages, register: sync });
}
