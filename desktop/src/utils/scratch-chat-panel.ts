/**
 * WorkPanel scratch-tab helpers (no React).
 *
 * Author: Damon Li
 */

import type { ScratchChat } from "./scratch-chat";

export function resolveActiveScratchId(
  chats: ScratchChat[],
  currentId: string | null,
): string | null {
  if (currentId && chats.some((chat) => chat.id === currentId)) return currentId;
  return chats[0]?.id ?? null;
}

export function resolveScratchFocusId(
  chats: ScratchChat[],
  requestedId: string | null | undefined,
  currentId: string | null,
): string | null {
  const req = String(requestedId ?? "").trim();
  if (req && chats.some((chat) => chat.id === req)) return req;
  return resolveActiveScratchId(chats, currentId);
}

export function shouldRenderDockedScratchBody(
  chat: ScratchChat | null | undefined,
): boolean {
  return Boolean(chat && !chat.floating);
}
