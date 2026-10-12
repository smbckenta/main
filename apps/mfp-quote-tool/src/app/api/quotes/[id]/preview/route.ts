import { NextResponse } from "next/server";
import { getQuote } from "@/lib/store";
import { calcQuoteAll, loadDocPhotos } from "@/lib/calc-context";
import {
  renderCompareHtml,
  renderFleetCompareHtml,
  renderFleetQuoteHtml,
  renderMultiCompareHtml,
  renderProposalDocHtml,
  renderQuoteHtml,
} from "@/lib/export/html";
import { loadBrandAssets } from "@/lib/logo";

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

  const [{ settings, priceBook, current, proposals, fleet }, { logo, seal }] = await Promise.all([
    calcQuoteAll(quote),
    loadBrandAssets(),
  ]);

  // 複数台の見積書・比較表は、提案（メーカー別の見積）が無くても出せる
  if (doc === "fleet-quote") {
    if (!fleet || !quote.fleet) {
      return new NextResponse("<html><body>複数台の入力がありません。</body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new NextResponse(
      renderFleetQuoteHtml(quote, quote.fleet, fleet, settings, priceBook, logo?.dataUri, seal?.dataUri),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  if (doc === "fleet") {
    if (!fleet || !quote.fleet) {
      return new NextResponse("<html><body>複数台の入力がありません。</body></html>", {
        headers: { "Content-Type": "text/html; charset=utf-8" },
      });
    }
    return new NextResponse(renderFleetCompareHtml(quote, quote.fleet, fleet, settings, logo?.dataUri), {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  if (!proposals.length) {
    return new NextResponse("<html><body>提案が登録されていません。</body></html>", {
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }

  const calc = proposalId ? proposals.find((p) => p.proposal.id === proposalId) : proposals[0];

  // 提案資料は写真を読み込む必要があるので先に分岐する
  if (doc === "proposal") {
    const target = calc ?? proposals[0];
    const photos = await loadDocPhotos(quote, target);
    return new NextResponse(
      renderProposalDocHtml(quote, current, target, settings, photos, logo?.dataUri, seal?.dataUri),
      { headers: { "Content-Type": "text/html; charset=utf-8" } },
    );
  }

  const html =
    doc === "compare-all"
      ? renderMultiCompareHtml(quote, current, proposals, settings, logo?.dataUri, seal?.dataUri)
      : doc === "compare"
        ? renderCompareHtml(quote, current, calc ?? proposals[0], settings, logo?.dataUri, seal?.dataUri)
        : renderQuoteHtml(quote, calc ?? proposals[0], settings, logo?.dataUri, seal?.dataUri);

  return new NextResponse(html, { headers: { "Content-Type": "text/html; charset=utf-8" } });
}
