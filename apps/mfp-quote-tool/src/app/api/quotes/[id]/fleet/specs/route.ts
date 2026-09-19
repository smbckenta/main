import { NextResponse } from "next/server";
import { calcQuoteAll } from "@/lib/calc-context";
import { hasFleet } from "@/lib/fleet";
import { fillFleetSpecs } from "@/lib/specs/fleet-specs";
import { getQuote, saveQuote } from "@/lib/store";
import type { Fleet, Quote } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 300;

type Ctx = { params: Promise<{ id: string }> };

/**
 * 複数台の案件で、現行機の印刷速度をまとめて調べて入れる。
 *
 * 機種DBにあればそれを使い、無ければメーカーのサイトから引く。
 * 引いた仕様は機種DBに残るので、同じ機種は二度と取りに行かない。
 */
export async function POST(req: Request, { params }: Ctx) {
  const { id } = await params;
  const stored = await getQuote(id);
  if (!stored) return NextResponse.json({ error: "案件が見つかりません。" }, { status: 404 });

  const body = (await req.json().catch(() => ({}))) as { fleet?: Fleet; forceRefresh?: boolean };
  // 画面で台を足した直後（保存前）でも押せるよう、画面の台をそのまま受け取る
  const quote: Quote = body.fleet ? { ...stored, fleet: body.fleet } : stored;
  if (!hasFleet(quote.fleet)) {
    return NextResponse.json({ error: "複数台の台が登録されていません。" }, { status: 400 });
  }

  const { fleet, filled, missing } = await fillFleetSpecs(quote.fleet, {
    fetchSpec: true,
    forceRefresh: Boolean(body.forceRefresh),
  });

  const saved = await saveQuote({ ...quote, fleet });
  const messages: string[] = [];
  if (filled.length) {
    const web = filled.filter((f) => f.origin === "web").length;
    messages.push(
      `${filled.map((f) => `${f.label} ${f.ppm}枚/分`).join(" / ")} を反映しました` +
        (web ? `（うち${web}件はインターネットから取得し、機種DBに保存しました）。` : "（機種DBから）。"),
    );
  }
  if (missing.length) {
    messages.push(
      `${missing.join("・")} は印刷速度を調べられませんでした。手で入力するか、機種DB画面から登録してください。`,
    );
  }
  if (!filled.length && !missing.length) messages.push("すべての台に印刷速度が入っています。");

  return NextResponse.json({ quote: saved, ...(await calcQuoteAll(saved)), messages });
}
