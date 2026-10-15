/**
 * 統合基幹システム（claude.aiのアーティファクト）へ持っていく部分の入口。
 *
 * 統合基幹システムはブラウザの中だけで動くページで、サーバーがない。
 * このツールのうち「料金を計算して、見積書・比較表のHTMLを組む」ところは
 * Nodeに依存していないので、そのまま持っていける。ここがその取り出し口。
 *
 * 組み立て方（esbuildはnpxで取ってくるので、依存には足していない）:
 *
 *   npx esbuild integration/browser-core.ts --bundle --format=iife \
 *     --platform=browser --target=es2020 --alias:@=./src \
 *     --global-name=MfpCore --outfile=integration/mfp-core.js
 *
 * 出来上がりは50KBほど。サーバーで作ったPDFと同じものが、
 * ブラウザの中だけで組めることは確認してある（docs/integration.md）。
 *
 * ここに置いてよいのは、ブラウザで動くものだけ。
 * node:fs や playwright を取り込むものを足すと、
 * src/lib/browser-safe.test.ts が落ちる。
 */
export { calcProposal, calcCurrent } from "@/lib/pricing";
export { calcFleet } from "@/lib/fleet";
export {
  renderQuoteHtml,
  renderCompareHtml,
  renderFleetCompareHtml,
  renderMultiCompareHtml,
} from "@/lib/export/html";
export { DEFAULT_SETTINGS } from "@/lib/defaults";
export type { Quote, Proposal, Settings, Fleet } from "@/lib/types";
