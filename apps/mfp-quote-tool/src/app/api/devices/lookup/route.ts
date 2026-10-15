import { NextResponse } from "next/server";
import { lookupSpec } from "@/lib/specs/lookup";
import type { Maker } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

/** 機種スペックをDB→インターネットの順に取得する */
export async function POST(req: Request) {
  const { model, maker, forceRefresh } = (await req.json()) as {
    model: string;
    maker?: Maker;
    forceRefresh?: boolean;
  };
  if (!model) return NextResponse.json({ error: "型番が必要です。" }, { status: 400 });
  return NextResponse.json(await lookupSpec(model, maker, { forceRefresh }));
}
