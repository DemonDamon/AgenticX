/**
 * Pane-level host for the scratch float overlay.
 * Must live outside WorkPanel so closing the workspace does not unmount it.
 *
 * Author: Damon Li
 */

import { useAppStore } from "../../store";
import type { ScratchChat } from "../../utils/scratch-chat";
import { ScratchChatFloatOverlay } from "./ScratchChatFloatOverlay";
import { useScratchChatRuntime } from "./use-scratch-chat-runtime";

const EMPTY_SCRATCH_CHATS: ScratchChat[] = [];

type Props = {
  paneId: string;
  onDock: (chatId: string) => void;
};

export function ScratchChatFloatHost({ paneId, onDock }: Props) {
  const floatingChat = useAppStore((s) => {
    const chats = s.panes.find((pane) => pane.id === paneId)?.scratchChats ?? EMPTY_SCRATCH_CHATS;
    return chats.find((chat) => chat.floating) ?? null;
  });
  const setScratchChatFloating = useAppStore((s) => s.setScratchChatFloating);
  const { sendScratch, sendingIds, errors } = useScratchChatRuntime(paneId);

  if (!floatingChat) return null;

  return (
      <ScratchChatFloatOverlay
        chat={floatingChat}
        paneId={paneId}
        onDock={() => {
        setScratchChatFloating(paneId, floatingChat.id, false);
        onDock(floatingChat.id);
      }}
      onSend={(text) => sendScratch(floatingChat, text)}
      onRetry={(userMessageId) => sendScratch(floatingChat, "", { retryUserId: userMessageId })}
      sending={sendingIds.includes(floatingChat.id)}
      error={errors[floatingChat.id]}
    />
  );
}
