import { NextResponse } from "next/server";
import { getQuote } from "@/lib/store";
import { calcQuoteAll } from "@/lib/calc-context";
import { renderCompareHtml, renderMultiCompareHtml, renderQuoteHtml } from "@/lib/export/html";

export const runtime = "nodejs";

type Ctx = { params: Promise<{ id: string }> };

/** ブラウザ表示・印刷用のHTMLプレビュー */
export async function GET(req: Request, { params }: Ctx) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });

  const url = new URL(req.url);
  const doc = url.searchParams.get("doc") ?? "quote";
  const proposalId = url.searchParams.get("proposalId");

  const { settings, current, proposals } = await calcQuoteAll(quote);
  if (!proposals.length) {
    return new NextResponse("<html><body>提案が登録されていません。</body></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const calc = proposalId ? proposals.find((p) => p.proposal.id === proposalId) : proposals[0];
  const html =
    doc === "compare-all"
      ? renderMultiCompareHtml(quote, current, proposals, settings)
      : doc === "compare"
        ? renderCompareHtml(quote, current, calc ?? proposals[0], settings)
        : renderQuoteHtml(quote, calc ?? proposals[0], settings);

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
