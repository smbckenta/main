/** Anthropic SDK クライアントの共有インスタンス。 */

import Anthropic from "@anthropic-ai/sdk";

/**
 * API キーは ANTHROPIC_API_KEY から SDK が自動で読む（config.ts で存在確認済み）。
 * ここで明示的に渡さないのは、将来 `ant auth login` プロファイルや
 * Workload Identity Federation に切り替えてもコードを触らずに済むため。
 */
export const anthropic = new Anthropic();
