import { promises as fs } from "node:fs";
import path from "node:path";
import { DATA_DIR, ensureDataDir } from "./store";

/**
 * 見積書・比較表に載せる画像（会社ロゴと角印）。
 *
 * データ保存先の logo.（png / jpg / webp / svg）と seal.（同じ）を使う。
 * 画像ファイルを置き換えるだけで差し替えられるよう、ファイル名で固定している。
 */

/** 優先順。実物の画像を置いたら、同梱の暫定SVGより優先される */
const EXTENSIONS = [
  { ext: "png", mime: "image/png", raster: true },
  { ext: "jpg", mime: "image/jpeg", raster: true },
  { ext: "jpeg", mime: "image/jpeg", raster: true },
  { ext: "webp", mime: "image/webp", raster: true },
  { ext: "svg", mime: "image/svg+xml", raster: false },
] as const;

/** 画像の種類。ファイル名の頭がそのまま種類になる */
export type ImageKind = "logo" | "seal";

export interface LogoAsset {
  /** HTMLの img に直接入れられる形（data URI） */
  dataUri: string;
  mime: string;
  /** Excelに貼れる形式か（ExcelJSはSVGを扱えない） */
  raster: boolean;
  buffer: Buffer;
  file: string;
}

async function loadImage(kind: ImageKind): Promise<LogoAsset | undefined> {
  await ensureDataDir();
  for (const c of EXTENSIONS) {
    const file = `${kind}.${c.ext}`;
    try {
      const buffer = await fs.readFile(path.join(DATA_DIR, file));
      return {
        dataUri: `data:${c.mime};base64,${buffer.toString("base64")}`,
        mime: c.mime,
        raster: c.raster,
        buffer,
        file,
      };
    } catch {
      /* 次の候補へ */
    }
  }
  return undefined;
}

/** アップロードされた画像を保存する（同じ種類の既存画像は置き換える） */
async function saveImage(kind: ImageKind, fileName: string, buffer: Buffer): Promise<string> {
  await ensureDataDir();
  const raw = fileName.toLowerCase().split(".").pop() ?? "";
  const ext = raw === "jpeg" ? "jpg" : raw;
  const target = EXTENSIONS.find((c) => c.ext === ext);
  if (!target) {
    throw new Error("PNG / JPEG / WebP / SVG のいずれかを選んでください。");
  }
  // 拡張子違いの古い画像が残っていると優先順で負けるため、まとめて消す
  for (const c of EXTENSIONS) {
    if (c.ext !== target.ext) await fs.rm(path.join(DATA_DIR, `${kind}.${c.ext}`), { force: true });
  }
  const file = `${kind}.${target.ext}`;
  await fs.writeFile(path.join(DATA_DIR, file), buffer);
  return file;
}

export const loadLogo = (): Promise<LogoAsset | undefined> => loadImage("logo");
export const saveLogo = (fileName: string, buffer: Buffer): Promise<string> =>
  saveImage("logo", fileName, buffer);

/** 角印（社判）。見積書・比較表の自社情報に重ねて押す */
export const loadSeal = (): Promise<LogoAsset | undefined> => loadImage("seal");
export const saveSeal = (fileName: string, buffer: Buffer): Promise<string> =>
  saveImage("seal", fileName, buffer);

/** 帳票に載せる画像をまとめて読む */
export interface BrandAssets {
  logo?: LogoAsset;
  seal?: LogoAsset;
}

export async function loadBrandAssets(): Promise<BrandAssets> {
  const [logo, seal] = await Promise.all([loadLogo(), loadSeal()]);
  return { logo, seal };
}
