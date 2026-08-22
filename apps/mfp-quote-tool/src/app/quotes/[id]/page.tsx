import { notFound } from "next/navigation";
import { getQuote } from "@/lib/store";
import { calcQuoteAll } from "@/lib/calc-context";
import QuoteEditor from "./QuoteEditor";

export const dynamic = "force-dynamic";

export default async function QuotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) notFound();

  const { settings, current, proposals, serviceArea } = await calcQuoteAll(quote);
  return (
    <QuoteEditor
      initialQuote={quote}
      initialCurrent={current}
      initialProposals={proposals}
      initialServiceArea={serviceArea}
      settings={settings}
    />
  );
}
