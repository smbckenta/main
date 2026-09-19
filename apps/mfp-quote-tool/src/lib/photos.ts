import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDir } from "./store";

/**
 * 提案資料に載せる写真（複合機本体・オプション）の置き場。
 *
 * 写真はデータ保存先の photos/ に実ファイルとして置き、機種DBには
 * ファイル名だけを持たせる。画像を devices.json に埋め込むと
 * ファイルが数MBになり、案件を開くたびに読み込むことになるため。
 */

const PHOTO_DIR = path.join(DATA_DIR, "photos");

const MIME_BY_EXT: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

/** 中身の先頭バイトから画像の種類を見分ける（拡張子は当てにしない） */
function extOf(buffer: Buffer): string | undefined {
  if (buffer.subarray(0, 3).toString("hex") === "ffd8ff") return ".jpg";
  if (buffer.subarray(0, 8).toString("hex") === "89504e470d0a1a0a") return ".png";
  if (buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP")
    return ".webp";
  if (buffer.subarray(0, 3).toString("ascii") === "GIF") return ".gif";
  return undefined;
}

export const photoMime = (file: string): string =>
  MIME_BY_EXT[path.extname(file).toLowerCase()] ?? "application/octet-stream";

/** ディレクトリの外に出るファイル名を弾く */
function safeName(file: string): string | undefined {
  const base = path.basename(file);
  return base && base === file && !base.startsWith(".") ? base : undefined;
}

/**
 * 写真を保存してファイル名を返す。
 * 同じ画像を何度取得しても増えないよう、中身のハッシュをファイル名にする。
 */
export async function savePhoto(buffer: Buffer): Promise<string> {
  const ext = extOf(buffer);
  if (!ext) throw new Error("画像として読み取れませんでした（JPEG / PNG / WebP / GIF に対応しています）。");
  if (buffer.length > 8 * 1024 * 1024) throw new Error("画像が大きすぎます（8MBまで）。");

  await ensureDataDir();
  await fs.mkdir(PHOTO_DIR, { recursive: true });
  const name = `${createHash("sha256").update(buffer).digest("hex").slice(0, 16)}${ext}`;
  const target = path.join(PHOTO_DIR, name);
  // 同じ中身なら書き直さない（共有ドライブの同期を無駄に走らせない）
  try {
    await fs.access(target);
  } catch {
    await fs.writeFile(target, buffer);
  }
  return name;
}

export async function readPhoto(file: string): Promise<Buffer | undefined> {
  const name = safeName(file);
  if (!name) return undefined;
  try {
    return await fs.readFile(path.join(PHOTO_DIR, name));
  } catch {
    return undefined;
  }
}

/** 帳票のHTMLに直接埋める形（data URI）で読み込む */
export async function photoDataUri(file?: string): Promise<string | undefined> {
  if (!file) return undefined;
  const buffer = await readPhoto(file);
  if (!buffer) return undefined;
  return `data:${photoMime(file)};base64,${buffer.toString("base64")}`;
}

/** 帳票で使う写真をまとめて読み込む（同じ写真は1回だけ読む） */
export async function loadPhotos(files: (string | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(files.filter((f): f is string => Boolean(f)))];
  const entries = await Promise.all(
    unique.map(async (file) => [file, await photoDataUri(file)] as const),
  );
  return Object.fromEntries(entries.filter((e): e is [string, string] => Boolean(e[1])));
}
