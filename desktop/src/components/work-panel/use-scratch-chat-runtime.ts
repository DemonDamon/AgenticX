/**
 * Isolated scratch-chat send state. Safe to mount outside WorkPanel
 * so a floating card keeps sending after the workspace sidebar closes.
 *
 * Author: Damon Li
 */

import { useCallback, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useAppStore } from "../../store";
import type { ScratchChat } from "../../utils/scratch-chat";
import { resolveScratchChatModel } from "../../utils/scratch-chat";
import {
  defaultScratchChatTransport,
  prepareScratchRetry,
  runScratchChatTurn,
} from "../../utils/scratch-chat-runtime";
import { useScratchPaneMeta } from "./use-scratch-pane-meta";

const abortByKey = new Map<string, AbortController>();

type RuntimeSnap = {
  sending: Record<string, true>;
  errors: Record<string, string>;
};

let snap: RuntimeSnap = { sending: {}, errors: {} };
const listeners = new Set<() => void>();

function emit(next: RuntimeSnap): void {
  snap = next;
  listeners.forEach((fn) => fn());
}

function subscribeRuntime(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function getRuntimeSnap(): RuntimeSnap {
  return snap;
}

export function turnKey(paneId: string, chatId: string): string {
  return `${paneId}:${chatId}`;
}

export function abortScratchChatTurn(paneId: string, chatId: string): void {
  const key = turnKey(paneId, chatId);
  abortByKey.get(key)?.abort();
  abortByKey.delete(key);
}

export function useScratchChatRuntime(paneId: string) {
  const { t } = useTranslation("workspace");
  const patchScratchChat = useAppStore((s) => s.patchScratchChat);
  const apiBase = useAppStore((s) => s.apiBase);
  const apiToken = useAppStore((s) => s.apiToken);
  const scratchPaneMeta = useScratchPaneMeta(paneId);
  const runtime = useSyncExternalStore(subscribeRuntime, getRuntimeSnap, getRuntimeSnap);
  const prefix = `${paneId}:`;
  const sendingIds = Object.keys(runtime.sending)
    .filter((key) => key.startsWith(prefix))
    .map((key) => key.slice(prefix.length));
  const errors: Record<string, string> = {};
  for (const [key, message] of Object.entries(runtime.errors)) {
    if (key.startsWith(prefix)) errors[key.slice(prefix.length)] = message;
  }

  const sendScratch = useCallback(
    async (
      chat: ScratchChat,
      text: string,
      options?: { retryUserId?: string },
    ): Promise<boolean> => {
      const chatId = chat.id;
      const key = turnKey(paneId, chatId);
      if (snap.sending[key]) return false;
      abortScratchChatTurn(paneId, chatId);
      const abort = new AbortController();
      abortByKey.set(key, abort);
      emit({
        sending: { ...snap.sending, [key]: true },
        errors: Object.fromEntries(Object.entries(snap.errors).filter(([item]) => item !== key)),
      });
      let latest =
        useAppStore.getState().panes.find((item) => item.id === paneId)?.scratchChats?.find((item) => item.id === chatId) ??
        chat;
      let userText = text;
      let reuseUser = false;
      const retryUserId = String(options?.retryUserId ?? "").trim();
      if (retryUserId) {
        const prepared = prepareScratchRetry(latest.messages ?? [], retryUserId);
        if (!prepared) {
          const sending = { ...snap.sending };
          delete sending[key];
          abortByKey.delete(key);
          emit({ sending, errors: snap.errors });
          return false;
        }
        latest = { ...latest, messages: prepared.messages };
        userText = prepared.userText;
        reuseUser = true;
        patchScratchChat(paneId, chatId, { messages: prepared.messages });
      }
      const resolved = resolveScratchChatModel(latest, scratchPaneMeta);
      const result = await runScratchChatTurn({
        chat: latest,
        userText,
        paneAvatarId: scratchPaneMeta.avatarId,
        provider: resolved.provider,
        model: resolved.model,
        apiBase,
        apiToken,
        ids: {
          userId: crypto.randomUUID(),
          assistantId: crypto.randomUUID(),
          clientTurnId: crypto.randomUUID(),
        },
        transport: defaultScratchChatTransport,
        signal: abort.signal,
        reuseUser,
        onMessages: (messages) => patchScratchChat(paneId, chatId, { messages }),
        onSessionId: (sessionId) => patchScratchChat(paneId, chatId, { sessionId }),
      });
      abortByKey.delete(key);
      const sending = { ...snap.sending };
      delete sending[key];
      if (!result.ok) {
        const message =
          result.error === "createSession failed"
            ? t("work.scratchCreateFailed")
            : result.error === "empty_reply"
              ? t("work.scratchEmptyReply")
              : result.error === "aborted"
                ? t("work.scratchStopped")
                : result.error;
        emit({ sending, errors: { ...snap.errors, [key]: message } });
        return result.committed === true;
      }
      emit({ sending, errors: Object.fromEntries(Object.entries(snap.errors).filter(([item]) => item !== key)) });
      return true;
    },
    [apiBase, apiToken, paneId, patchScratchChat, scratchPaneMeta, t],
  );

  const clearScratchRuntime = useCallback((chatId: string) => {
    abortScratchChatTurn(paneId, chatId);
    const key = turnKey(paneId, chatId);
    const sending = { ...snap.sending };
    delete sending[key];
    emit({
      sending,
      errors: Object.fromEntries(Object.entries(snap.errors).filter(([item]) => item !== key)),
    });
  }, [paneId]);

  return { sendScratch, sendingIds, errors, clearScratchRuntime };
}
