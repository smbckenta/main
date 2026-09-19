import { NextResponse } from "next/server";
import { lookupPhoto } from "@/lib/specs/lookup";
import type { Maker } from "@/lib/types";

export const runtime = "nodejs";

/**
 * 機種の筐体写真を用意する口。
 *
 * すでに機種DBに写真があればそれを返し、インターネットには出ない。
 * 無いときだけメーカーのサイトを探しに行き、取れたらDBに保存する。
 * 提案する機種が決まるたびに画面から呼ばれるので、
 * 「毎回取りに行かない」ことがそのまま利用料の節約になる。
 */
export async function POST(req: Request) {
  const { model, maker, forceRefresh } = (await req.json()) as {
    model?: string;
    maker?: Maker;
    forceRefresh?: boolean;
  };
  if (!model?.trim()) {
    return NextResponse.json({ error: "型番が必要です。" }, { status: 400 });
  }
  return NextResponse.json(await lookupPhoto(model, maker, { forceRefresh: Boolean(forceRefresh) }));
}
