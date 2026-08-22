import { NextResponse } from "next/server";
import { getQuote } from "@/lib/store";
import { buildExports, zipFiles, type ExportRequest } from "@/lib/export/bundle";

export const runtime = "nodejs";
export const maxDuration = 180;

type Ctx = { params: Promise<{ id: string }> };

/** 見積書・比較表を PDF / Excel で出力する（複数ファイルはZIP） */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const quote = await getQuote(id);
  if (!quote) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });

  const body = (await req.json()) as ExportRequest;
  const request: ExportRequest = {
    proposalIds: body.proposalIds,
    docs: body.docs?.length ? body.docs : ["quote", "compare"],
    formats: body.formats?.length ? body.formats : ["pdf", "xlsx"],
    includeProfit: body.includeProfit ?? false,
  };

  const { files, warnings } = await buildExports(quote, request);
  if (!files.length) {
    return NextResponse.json(
      { error: warnings.join("\n") || "出力対象がありません。提案を1件以上作成してください。" },
      { status: 400 },
    );
  }

  const single = files.length === 1;
  const out = single
    ? files[0]
    : await zipFiles(files, `${quote.quoteDate}_${quote.customerName}_見積一式.zip`);

  return new NextResponse(new Uint8Array(out.buffer), {
    headers: {
      "Content-Type": out.contentType,
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(out.name)}`,
      ...(warnings.length ? { "X-Export-Warnings": encodeURIComponent(warnings.join(" / ")) } : {}),
    },
  });
}
