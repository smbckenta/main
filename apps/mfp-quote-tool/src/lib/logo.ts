import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDir } from "./store";

/**
 * 見積書・比較表に載せる会社ロゴ。
 * データ保存先の logo.（png / jpg / webp / svg）を使う。
 * 画像ファイルを置き換えるだけで差し替えられるよう、ファイル名で固定している。
 */

/** 優先順。実物の画像を置いたら、同梱の暫定SVGより優先される */
const CANDIDATES = [
  { file: "logo.png", mime: "image/png", raster: true },
  { file: "logo.jpg", mime: "image/jpeg", raster: true },
  { file: "logo.jpeg", mime: "image/jpeg", raster: true },
  { file: "logo.webp", mime: "image/webp", raster: true },
  { file: "logo.svg", mime: "image/svg+xml", raster: false },
] as const;

export interface LogoAsset {
  /** HTMLの img に直接入れられる形（data URI） */
  dataUri: string;
  mime: string;
  /** Excelに貼れる形式か（ExcelJSはSVGを扱えない） */
  raster: boolean;
  buffer: Buffer;
  file: string;
}

export async function loadLogo(): Promise<LogoAsset | undefined> {
  await ensureDataDir();
  for (const c of CANDIDATES) {
    try {
      const buffer = await fs.readFile(path.join(DATA_DIR, c.file));
      return {
        dataUri: `data:${c.mime};base64,${buffer.toString("base64")}`,
        mime: c.mime,
        raster: c.raster,
        buffer,
        file: c.file,
      };
    } catch {
      /* 次の候補へ */
    }
  }
  return undefined;
}

/** アップロードされたロゴを保存する（既存のロゴは置き換える） */
export async function saveLogo(fileName: string, buffer: Buffer): Promise<string> {
  await ensureDataDir();
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  const target = CANDIDATES.find((c) => c.file === `logo.${ext === "jpeg" ? "jpg" : ext}`);
  if (!target) {
    throw new Error("PNG / JPEG / WebP / SVG のいずれかを選んでください。");
  }
  // 拡張子違いの古いロゴが残っていると優先順で負けるため、まとめて消す
  for (const c of CANDIDATES) {
    if (c.file !== target.file) await fs.rm(path.join(DATA_DIR, c.file), { force: true });
  }
  await fs.writeFile(path.join(DATA_DIR, target.file), buffer);
  return target.file;
}
