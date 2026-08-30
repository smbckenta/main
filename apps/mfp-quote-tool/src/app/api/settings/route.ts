import { NextResponse } from "next/server";
import { getSettings, hashPassword, saveSettings } from "@/lib/store";
import type { Settings } from "@/lib/types";

export const runtime = "nodejs";

/**
 * 画面に返すときは削除パスワードのハッシュを伏せ、
 * 設定済みかどうかだけを渡す。
 */
function forClient(settings: Settings) {
  return {
    ...settings,
    deletion: { passwordHash: "" },
    deletionPasswordSet: Boolean(settings.deletion.passwordHash),
  };
}

export async function GET() {
  return NextResponse.json(forClient(await getSettings()));
}

export async function PUT(req: Request) {
  const body = (await req.json()) as Settings & { newDeletionPassword?: string };
  const current = await getSettings();
  const newPassword = (body.newDeletionPassword ?? "").trim();

  const { newDeletionPassword: _ignored, ...rest } = body;
  const settings: Settings = {
    ...rest,
    // 新しいパスワードの入力があるときだけ差し替える（空欄なら現状維持）
    deletion: {
      passwordHash: newPassword ? hashPassword(newPassword) : current.deletion.passwordHash,
    },
  };
  return NextResponse.json(forClient(await saveSettings(settings)));
}
