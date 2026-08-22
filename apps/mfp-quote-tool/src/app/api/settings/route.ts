import { NextResponse } from "next/server";
import { getSettings, saveSettings } from "@/lib/store";
import type { Settings } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await getSettings());
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Settings;
  return NextResponse.json(await saveSettings(body));
}
