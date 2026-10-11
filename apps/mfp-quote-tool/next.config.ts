import type { NextConfig } from "next";

/**
 * 基幹システムの中の、このツールの住所。
 *
 * ポータルの `/mfp` にぶら下げるなら MFP_BASE_PATH=/mfp。
 * 画面のリンクも、画像も、APIの宛先もこれを基準に出るので、
 * 置き場所が決まったときに書き換えるのはここ1か所で済む。
 * （src/lib/config.ts でも同じ値を読んでいる）
 */
const basePath = (() => {
  const raw = process.env.MFP_BASE_PATH?.trim();
  if (!raw) return undefined;
  return (raw.startsWith("/") ? raw : `/${raw}`).replace(/\/+$/, "") || undefined;
})();

const nextConfig: NextConfig = {
  ...(basePath ? { basePath } : {}),
  // ネイティブ／WASM を含むものは Node 実行時にそのまま読み込ませる
  serverExternalPackages: [
    "exceljs",
    "pdfjs-dist",
    "playwright",
    "tesseract.js",
    "@napi-rs/canvas",
    "heic-convert",
  ],
  experimental: {
    // 見積書PDFの生成やアップロードファイルの解析でボディサイズが大きくなる
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
