import { addTrustedExternalHost, isTrustedExternalHost } from "./trusted-external-hosts";

export type ChatExternalLinkPending = {
  url: string;
  open: () => void;
};

let pending: ChatExternalLinkPending | null = null;
const listeners = new Set<(next: ChatExternalLinkPending | null) => void>();

function emit(): void {
  for (const listener of listeners) listener(pending);
}

export function getPendingChatExternalLink(): ChatExternalLinkPending | null {
  return pending;
}

export function subscribeChatExternalLinkPrompt(
  listener: (next: ChatExternalLinkPending | null) => void,
): () => void {
  listeners.add(listener);
  listener(pending);
  return () => {
    listeners.delete(listener);
  };
}

/** User clicked an http(s) link in a chat bubble. Trusted hosts skip the prompt. */
export function requestChatHttpLink(url: string, open: () => void): void {
  const href = String(url ?? "").trim();
  if (!/^https?:\/\//i.test(href)) return;
  if (isTrustedExternalHost(href)) {
    open();
    return;
  }
  pending = { url: href, open };
  emit();
}

export function dismissChatExternalLinkPrompt(): void {
  if (!pending) return;
  pending = null;
  emit();
}

export function confirmChatExternalLinkOpen(options?: { trustHost?: boolean }): void {
  const current = pending;
  if (!current) return;
  if (options?.trustHost) addTrustedExternalHost(current.url);
  pending = null;
  emit();
  current.open();
}

export function _resetChatExternalLinkForTests(): void {
  pending = null;
  listeners.clear();
}
