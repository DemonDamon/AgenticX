import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Message } from "../../store";
import { AttachmentCard } from "./AttachmentCard";
import { ReasoningBlock } from "./ReasoningBlock";
import { parseReasoningContent } from "./reasoning-parser";
import { ForwardedHistoryCard } from "./ForwardedHistoryCard";
import { ForwardedHistoryModal } from "./ForwardedHistoryModal";

type Props = {
  message: Message;
  badge?: ReactNode;
  assistantName?: string;
  assistantAvatarUrl?: string;
  userName?: string;
  onCopyMessage?: (message: Message) => void;
  onQuoteMessage?: (message: Message) => void;
  onFavoriteMessage?: (message: Message) => void;
  onToggleSelectMessage?: (message: Message) => void;
  onForwardMessage?: (message: Message) => void;
  selectable?: boolean;
  selected?: boolean;
};

/** Cycling 1→3 dots for group-chat typing rows (name shown in header only). */
function TypingDots() {
  const [count, setCount] = useState(1);
  useEffect(() => {
    const id = window.setInterval(() => {
      setCount((c) => (c >= 3 ? 1 : c + 1));
    }, 400);
    return () => clearInterval(id);
  }, []);
  return (
    <span className="inline-block min-w-[1em] tabular-nums" aria-hidden>
      {".".repeat(count)}
    </span>
  );
}

function Avatar({ label, imageUrl }: { label: string; imageUrl?: string }) {
  const char = label.slice(0, 1) || "?";
  if (imageUrl) {
    return (
      <img
        src={imageUrl}
        alt={label}
        className="h-8 w-8 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <div
      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-bold"
      style={{
        background: "var(--chat-im-avatar-bg)",
        color: "var(--text-strong)",
      }}
    >
      {char}
    </div>
  );
}

export function ImBubble({
  message,
  badge,
  assistantName,
  assistantAvatarUrl,
  userName,
  onCopyMessage,
  onQuoteMessage,
  onFavoriteMessage,
  onToggleSelectMessage,
  onForwardMessage,
  selectable,
  selected,
}: Props) {
  const isUser = message.role === "user";
  const displayName = isUser ? (userName || "我") : (assistantName || "AI");
  const avatarUrl = isUser ? undefined : assistantAvatarUrl;
  const isStreaming = message.id === "__stream__";
  const isGroupTyping = !isUser && typeof message.id === "string" && message.id.startsWith("typing-");
  const parsed = !isUser ? parseReasoningContent(message.content) : null;
  const hasThinkTag = parsed?.hasReasoningTag ?? false;
  const bodyText = !isUser && hasThinkTag ? (parsed?.response ?? "") : message.content;
  const hasBody = !!bodyText?.trim();
  const bubbleStyle: CSSProperties = isUser
    ? {
        background: "var(--chat-im-user-bg)",
        borderColor: "var(--chat-im-user-border)",
        color: "var(--chat-im-user-text)",
      }
    : {
        background: "var(--chat-im-assistant-bg)",
        borderColor: "var(--chat-im-assistant-border)",
        color: "var(--chat-im-assistant-text)",
      };
  const [menuOpen, setMenuOpen] = useState(false);
  const [forwardedModalOpen, setForwardedModalOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (ev: globalThis.MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(ev.target as Node)) {
        setMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [menuOpen]);

  const openContextMenu = (ev: ReactMouseEvent) => {
    ev.preventDefault();
    setMenuPos({ x: ev.clientX, y: ev.clientY });
    setMenuOpen(true);
  };

  return (
    <div className="group relative flex min-w-0 items-start gap-2" onContextMenu={openContextMenu}>
      {selectable ? (
        <button
          type="button"
          className={`mt-8 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition ${
            selected
              ? "border-cyan-500 bg-cyan-500 text-white"
              : "border-text-faint bg-transparent text-transparent"
          }`}
          onClick={() => onToggleSelectMessage?.(message)}
          aria-label={selected ? "取消选择消息" : "选择消息"}
        >
          <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3.5 8.5L6.5 11.5L12.5 4.5" />
          </svg>
        </button>
      ) : null}
      <div className={`flex min-w-0 flex-1 gap-2 ${isUser ? "justify-end" : "justify-start"}`}>
        <div className={`flex min-w-0 gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
          <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
            <Avatar label={displayName} imageUrl={avatarUrl} />
          </div>
          <div className={`flex min-w-0 max-w-[80%] flex-col ${isUser ? "items-end" : "items-start"}`}>
            <span className="mb-0.5 max-w-full truncate px-1 text-[11px] text-text-faint">{displayName}</span>
            <div
              className={`relative max-w-full min-w-0 overflow-hidden rounded-xl border px-3 py-2 text-sm ${
                isUser ? "rounded-tr-[4px]" : "rounded-tl-[4px]"
              }`}
              style={bubbleStyle}
            >
              {isUser && message.attachments && message.attachments.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {message.attachments.map((attachment) => (
                    <AttachmentCard
                      key={`${attachment.name}:${attachment.size}:${attachment.mimeType}`}
                      attachment={attachment}
                    />
                  ))}
                </div>
              ) : null}
              <div className="msg-content break-words">
                {badge}
                {message.quotedContent ? (
                  <div className="mb-2 rounded-md border border-border bg-surface-panel/70 px-2 py-1 text-xs text-text-faint">
                    <span className="line-clamp-2">{message.quotedContent}</span>
                  </div>
                ) : null}
                {message.forwardedHistory ? (
                  <ForwardedHistoryCard history={message.forwardedHistory} onOpen={() => setForwardedModalOpen(true)} />
                ) : isGroupTyping ? (
                  <span className="inline-flex items-baseline gap-0.5" aria-live="polite" aria-label="正在输入">
                    <span>正在输入</span>
                    <TypingDots />
                  </span>
                ) : (
                  <>
                    {!isUser && isStreaming && (hasThinkTag || !hasBody) ? (
                      <ReasoningBlock text={parsed?.reasoning ?? ""} streaming />
                    ) : !isUser && !isStreaming && parsed?.reasoning ? (
                      <ReasoningBlock text={parsed.reasoning} />
                    ) : null}
                    {hasBody ? <ReactMarkdown remarkPlugins={[remarkGfm]}>{bodyText}</ReactMarkdown> : null}
                  </>
                )}
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-faint">
              <button type="button" className="hover:text-text-strong" onClick={() => onCopyMessage?.(message)}>复制</button>
              <button type="button" className="hover:text-text-strong" onClick={() => onQuoteMessage?.(message)}>引用</button>
              <button type="button" className="hover:text-text-strong" onClick={() => onFavoriteMessage?.(message)}>收藏</button>
              <button type="button" className="hover:text-text-strong" onClick={() => onForwardMessage?.(message)}>转发</button>
              <button type="button" className="hover:text-text-strong" onClick={() => onToggleSelectMessage?.(message)}>多选</button>
            </div>
          </div>
        </div>
      </div>
      {menuOpen ? (
        <div
          ref={menuRef}
          className="fixed z-[80] w-36 rounded-lg border border-border bg-surface-panel p-1 shadow-2xl"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover" onClick={() => { setMenuOpen(false); onCopyMessage?.(message); }}>复制</button>
          <button className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover" onClick={() => { setMenuOpen(false); onQuoteMessage?.(message); }}>引用</button>
          <button className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover" onClick={() => { setMenuOpen(false); onFavoriteMessage?.(message); }}>收藏</button>
          <button className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover" onClick={() => { setMenuOpen(false); onForwardMessage?.(message); }}>转发</button>
          <button className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover" onClick={() => { setMenuOpen(false); onToggleSelectMessage?.(message); }}>多选</button>
        </div>
      ) : null}
      <ForwardedHistoryModal
        open={forwardedModalOpen}
        history={message.forwardedHistory}
        onClose={() => setForwardedModalOpen(false)}
      />
    </div>
  );
}
