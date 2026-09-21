import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Minimize2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { ScratchChat } from "../../utils/scratch-chat";
import {
  SCRATCH_FLOAT_HEIGHT,
  SCRATCH_FLOAT_WIDTH,
  clampScratchFloatPosition,
  defaultScratchFloatPosition,
} from "../../utils/scratch-chat-float";
import { ScratchChatCard } from "./ScratchChatCard";

type Props = {
  chat: ScratchChat;
  paneId: string;
  onDock: () => void;
  onSend?: (text: string) => Promise<boolean>;
  onRetry?: (userMessageId: string) => void;
  sending?: boolean;
  error?: string;
};

export function ScratchChatFloatOverlay({ chat, paneId, onDock, onSend, onRetry, sending, error }: Props) {
  const { t } = useTranslation("workspace");
  const [pos, setPos] = useState(() =>
    defaultScratchFloatPosition({ width: window.innerWidth, height: window.innerHeight }),
  );
  const dragRef = useRef<{ dx: number; dy: number } | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;
      setPos(
        clampScratchFloatPosition(
          { left: event.clientX - drag.dx, top: event.clientY - drag.dy },
          { width: SCRATCH_FLOAT_WIDTH, height: SCRATCH_FLOAT_HEIGHT },
          { width: window.innerWidth, height: window.innerHeight },
        ),
      );
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  return createPortal(
    <div
      className="fixed z-[130] flex flex-col overflow-hidden rounded-xl border border-border bg-surface-panel shadow-2xl"
      style={{
        left: pos.left,
        top: pos.top,
        width: SCRATCH_FLOAT_WIDTH,
        height: SCRATCH_FLOAT_HEIGHT,
      }}
    >
      <div
        className="flex h-8 shrink-0 cursor-grab items-center gap-2 bg-surface-panel px-3 active:cursor-grabbing"
        onPointerDown={(event) => {
          if ((event.target as HTMLElement).closest("button")) return;
          dragRef.current = { dx: event.clientX - pos.left, dy: event.clientY - pos.top };
        }}
      >
        <div className="min-w-0 flex-1 truncate text-[12px] text-text-subtle">{chat.title}</div>
        <button
          type="button"
          className="rounded p-1 text-text-faint hover:bg-surface-hover hover:text-text-strong"
          onClick={onDock}
          aria-label={t("work.scratchDock")}
        >
          <Minimize2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        <ScratchChatCard
          chat={{ ...chat, floating: false }}
          paneId={paneId}
          hideHeader
          onClose={onDock}
          onSend={onSend}
          onRetry={onRetry}
          sending={sending}
          error={error}
        />
      </div>
    </div>,
    document.body,
  );
}
