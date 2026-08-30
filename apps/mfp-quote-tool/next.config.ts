import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
