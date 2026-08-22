import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // exceljs / pdfjs-dist / playwright は Node 実行時にそのまま読み込ませる
  serverExternalPackages: ["exceljs", "pdfjs-dist", "playwright"],
  experimental: {
    // 見積書PDFの生成やアップロードファイルの解析でボディサイズが大きくなる
    serverActions: { bodySizeLimit: "25mb" },
  },
};

export default nextConfig;
