import { NextResponse } from "next/server";
import { deleteQuote, getQuote, getSettings, saveQuote, verifyPassword } from "@/lib/store";
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

/**
 * 案件の削除。
 * 誤って消せないよう、削除パスワードと担当者名の両方を必須にする。
 * 実体は quotes-deleted に退避し、誰がいつ削除したかを記録する。
 */
export async function DELETE(req: Request, { params }: Ctx) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { password?: string; deletedBy?: string };
  const settings = await getSettings();

  if (!settings.deletion.passwordHash) {
    return NextResponse.json(
      { error: "削除パスワードが未設定です。設定画面の「案件の削除」で設定してください。" },
      { status: 400 },
    );
  }
  const deletedBy = (body.deletedBy ?? "").trim();
  if (!deletedBy) {
    return NextResponse.json({ error: "削除する担当者を選んでください。" }, { status: 400 });
  }
  if (!verifyPassword(body.password ?? "", settings.deletion.passwordHash)) {
    return NextResponse.json({ error: "削除パスワードが違います。" }, { status: 403 });
  }

  try {
    const record = await deleteQuote(id, deletedBy);
    return NextResponse.json({ ok: true, record });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 404 });
  }
}
