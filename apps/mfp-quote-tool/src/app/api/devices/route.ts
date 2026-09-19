import { NextResponse } from "next/server";
import { deleteDevice, listDevices, upsertDevice } from "@/lib/store";
import type { DeviceSpec } from "@/lib/types";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listDevices());
}

export async function POST(req: Request) {
  const device = (await req.json()) as DeviceSpec;
  if (!device.model || !device.maker) {
    return NextResponse.json({ error: "メーカーと型番は必須です。" }, { status: 400 });
  }
  return NextResponse.json(
    await upsertDevice({
      ...device,
      source: device.source ?? { method: "manual" },
    }),
  );
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id が必要です。" }, { status: 400 });
  await deleteDevice(id);
  return NextResponse.json({ ok: true });
}
