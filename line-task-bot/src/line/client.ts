/** LINE Messaging API クライアントと、表示名解決などの小さなヘルパ。 */

import { messagingApi } from "@line/bot-sdk";
type Message = messagingApi.Message;
import { config } from "../config.js";
import { logger } from "../logger.js";

export const lineClient = new messagingApi.MessagingApiClient({
  channelAccessToken: config.line.channelAccessToken,
});

/**
 * userId -> 表示名のキャッシュ。
 * グループメンバーのプロフィール取得は毎回叩くとレート制限に触れやすいので、
 * プロセス内で保持する（Cloud Run のインスタンスが入れ替われば消えるが、それで問題ない）。
 */
const displayNameCache = new Map<string, string>();

/**
 * トークメンバーの表示名を取得する。
 *
 * 友だち追加していないユーザーでもメンバーであれば取得できるが、
 * プロフィール非公開などで失敗することがあるので、その場合は userId の断片で代替する。
 * グループトークと複数人トーク（room）でエンドポイントが違う点に注意。
 */
export async function resolveDisplayName(
  conversationType: "group" | "room",
  conversationId: string,
  userId: string,
): Promise<string> {
  const cacheKey = `${conversationId}:${userId}`;
  const cached = displayNameCache.get(cacheKey);
  if (cached) return cached;

  try {
    const profile =
      conversationType === "group"
        ? await lineClient.getGroupMemberProfile(conversationId, userId)
        : await lineClient.getRoomMemberProfile(conversationId, userId);
    const name = profile.displayName ?? userId.slice(0, 8);
    displayNameCache.set(cacheKey, name);
    return name;
  } catch (error) {
    logger.debug("表示名を取得できませんでした", {
      conversationType,
      conversationId,
      userId,
      error: error instanceof Error ? error.message : String(error),
    });
    const fallback = `user_${userId.slice(0, 6)}`;
    displayNameCache.set(cacheKey, fallback);
    return fallback;
  }
}

export async function reply(
  replyToken: string,
  messages: Message[],
): Promise<void> {
  if (messages.length === 0) return;
  await lineClient.replyMessage({ replyToken, messages: messages.slice(0, 5) });
}

export async function push(to: string, messages: Message[]): Promise<void> {
  if (messages.length === 0) return;
  await lineClient.pushMessage({ to, messages: messages.slice(0, 5) });
}

/** 送信に失敗しても呼び出し元のジョブ全体は止めない、という場面で使う。 */
export async function pushSafely(
  to: string,
  messages: Message[],
): Promise<void> {
  try {
    await push(to, messages);
  } catch (error) {
    logger.error("LINE への送信に失敗しました", error, { to });
  }
}
