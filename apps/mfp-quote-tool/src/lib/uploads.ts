import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDir } from "./store";

/**
 * お預かりした資料（リース契約書・カウンター明細）の保管。
 *
 * 「どのファイルを読み取ったのか」を後から確かめられるように、
 * 読み取ったファイルそのものを案件ごとに残す。
 * 数字が合わないときに原本を開き直せることが、いちばん効く。
 */

const UPLOAD_DIR = path.join(DATA_DIR, "uploads");

const MIME_BY_EXT: Record<string, string> = {
  ".pdf": "application/pdf",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".heic": "image/heic",
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".txt": "text/plain",
};

export const uploadMime = (file: string): string =>
  MIME_BY_EXT[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** ディレクトリの外に出る名前を弾く */
function safe(part: string): string | undefined {
  const base = path.basename(part);
  return base && base === part && !base.startsWith(".") ? base : undefined;
}

/**
 * 資料を案件のフォルダに保存し、保存名を返す。
 * 同じファイルを何度読み取っても増えないよう、中身のハッシュを名前にする。
 */
export async function saveUpload(quoteId: string, fileName: string, buffer: Buffer): Promise<string | undefined> {
  const id = safe(quoteId);
  if (!id) return undefined;
  // 原本は大きいこともあるので、保管するのは常識的な大きさまでにする
  if (buffer.length > 40 * 1024 * 1024) return undefined;

  const ext = (path.extname(fileName) || ".bin").toLowerCase();
  const name = `${createHash("sha256").update(buffer).digest("hex").slice(0, 16)}${ext}`;
  const dir = path.join(UPLOAD_DIR, id);

  await ensureDataDir();
  await fs.mkdir(dir, { recursive: true });
  const target = path.join(dir, name);
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, buffer);
  }
  return name;
}

export async function readUpload(quoteId: string, file: string): Promise<Buffer | undefined> {
  const id = safe(quoteId);
  const name = safe(file);
  if (!id || !name) return undefined;
  try {
    return await fs.readFile(path.join(UPLOAD_DIR, id, name));
  } catch {
    return undefined;
  }
}
