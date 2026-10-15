import { NextResponse } from "next/server";
import { getSettings, hashPassword, saveSettings } from "@/lib/store";
import type { Settings } from "@/lib/types";

import { requireMasterEditor } from "@/lib/session";

export const runtime = "nodejs";

/**
 * 画面に返すときは、秘密そのものは渡さず「設定済みかどうか」だけにする。
 *
 * 削除パスワードのハッシュと、AIのAPIキーが対象。
 * とくにAPIキーは、画面を管理者だけにしても、このAPIを直に叩けば
 * 読めてしまう。渡さないのがいちばん確実。
 */
function forClient(settings: Settings) {
  return {
    ...settings,
    deletion: { passwordHash: "" },
    deletionPasswordSet: Boolean(settings.deletion.passwordHash),
    ai: { ...settings.ai, apiKey: "" },
    aiKeySet: Boolean(settings.ai.apiKey?.trim()),
  };
}

export async function GET() {
  return NextResponse.json(forClient(await getSettings()));
}

export async function PUT(req: Request) {
  // マスタの書き換えは管理者だけ
  const denied = await requireMasterEditor();
  if (denied) return denied;

  const body = (await req.json()) as Settings & { newDeletionPassword?: string };
  const current = await getSettings();
  const newPassword = (body.newDeletionPassword ?? "").trim();

  const { newDeletionPassword: _ignored, ...rest } = body;
  const apiKey = (body.ai?.apiKey ?? "").trim();
  const settings: Settings = {
    ...rest,
    // 画面にはキーを返していないので、空欄は「変更なし」として扱う。
    // そうしないと、設定を保存するたびにキーが消えてしまう
    ai: { ...rest.ai, apiKey: apiKey || current.ai.apiKey },
    // 新しいパスワードの入力があるときだけ差し替える（空欄なら現状維持）
    deletion: {
      passwordHash: newPassword ? hashPassword(newPassword) : current.deletion.passwordHash,
    },
  };
  return NextResponse.json(forClient(await saveSettings(settings)));
}
