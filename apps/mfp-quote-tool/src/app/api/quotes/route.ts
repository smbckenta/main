import { NextResponse } from "next/server";
import { listQuotes, newId, nextQuoteNo, saveQuote } from "@/lib/store";
import type { Quote } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listQuotes());
}

/** 新規案件を作成する（アップロード解析結果を初期値に使う） */
export async function POST(req: Request) {
  const body = (await req.json()) as Partial<Quote>;
  const now = new Date().toISOString();
  const quote: Quote = {
    id: newId(),
    title: body.title ?? "複合機入替のご提案",
    customerName: body.customerName ?? "",
    customerHonorific: body.customerHonorific ?? "御中",
    quoteNo: body.quoteNo ?? (await nextQuoteNo()),
    quoteDate: body.quoteDate ?? now.slice(0, 10),
    area: body.area ?? "福岡",
    serviceArea: body.serviceArea,
    current: body.current ?? {
      makerText: "",
      modelText: "",
      monthlyLease: 0,
      monoPages: 0,
      colorPages: 0,
      twoColorPages: 0,
      units: { mono: 0, color: 0, twoColor: 0, minCharge: 0 },
      maintenanceMonthly: 0,
    },
    proposals: body.proposals ?? [],
    ingest: body.ingest,
    createdAt: now,
    updatedAt: now,
  };
  return NextResponse.json(await saveQuote(quote));
}
