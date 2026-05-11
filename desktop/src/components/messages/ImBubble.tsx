import { useEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, MouseEvent as ReactMouseEvent } from "react";
import ReactMarkdown from "react-markdown";
import type { Message, MessageAttachment } from "../../store";
import { AttachmentCard } from "./AttachmentCard";
import { ReasoningBlock } from "./ReasoningBlock";
import { parseReasoningContent } from "./reasoning-parser";
import { getContainedSelectionText } from "../../utils/favorite-selection";
import {
  chatMarkdownComponents,
  chatRehypePlugins,
  chatRemarkPlugins,
  chatUrlTransform,
  normalizeChatMarkdownContent,
} from "./markdown-components";
import { renderUserMessageInlineBody } from "./user-message-inline";

type Props = {
  message: Message;
  highlightTerms?: string[];
  badge?: ReactNode;
  assistantName?: string;
  assistantAvatarUrl?: string;
  /**
   * IM assistant layout: compact row aligns with tool cards (spacer only, no avatar/name),
   * used inside a parent ReAct block that renders the primary avatar column.
   */
  assistantVisual?: "default" | "compact-inline";
  /** When true and compact, remove inner bubble border so parent container provides the single border. */
  noBubbleBorder?: boolean;
  userName?: string;
  userAvatarUrl?: string;
  onCopyMessage?: (message: Message) => void;
  onQuoteMessage?: (message: Message, selectedText?: string) => void;
  onFavoriteMessage?: (message: Message, selectedText?: string) => void;
  onToggleSelectMessage?: (message: Message) => void;
  onForwardMessage?: (message: Message, selectedText?: string) => void;
  onRetryMessage?: (message: Message) => void;
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

/** Shared with ReAct block shell so top-of-stack avatar matches IM bubbles. */
export function ChatImAvatar({ label, imageUrl }: { label: string; imageUrl?: string }) {
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
  highlightTerms,
  badge,
  assistantName,
  assistantAvatarUrl,
  userName,
  userAvatarUrl,
  onCopyMessage,
  onQuoteMessage,
  onFavoriteMessage,
  onToggleSelectMessage,
  onForwardMessage,
  onRetryMessage,
  selectable,
  selected,
  assistantVisual = "default",
  noBubbleBorder = false,
}: Props) {
  const isUser = message.role === "user";
  const displayName = isUser ? (userName || "我") : (assistantName || "AI");
  const avatarUrl = isUser ? userAvatarUrl : assistantAvatarUrl;
  const isStreaming = message.id === "__stream__";
  const isGroupTyping = !isUser && typeof message.id === "string" && message.id.startsWith("typing-");
  const compactAssistant =
    !isUser && assistantVisual === "compact-inline" && !isGroupTyping;
  const parsed = !isUser ? parseReasoningContent(message.content) : null;
  const hasThinkTag = parsed?.hasReasoningTag ?? false;
  const bodyText = !isUser && hasThinkTag ? (parsed?.response ?? "") : message.content;
  const referenceAttachments = isUser
    ? (message.attachments ?? []).filter((attachment) => !!attachment.referenceToken)
    : [];
  const displayAttachments = isUser
    ? (message.attachments ?? []).filter((attachment) => !attachment.referenceToken)
    : [];
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
  const [menuPos, setMenuPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const menuRef = useRef<HTMLDivElement | null>(null);
  const msgContentRef = useRef<HTMLDivElement | null>(null);

  const runFavorite = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    onFavoriteMessage?.(message, picked ?? undefined);
  };

  const runQuote = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    onQuoteMessage?.(message, picked ?? undefined);
  };

  const runForward = () => {
    const picked = getContainedSelectionText(msgContentRef.current);
    onForwardMessage?.(message, picked ?? undefined);
  };

  const formatForwardSender = (sender?: string) => {
    const raw = String(sender || "").trim();
    if (!raw) return "AI";
    return raw.toLowerCase() === "meta" ? "Machi" : raw;
  };

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

  useEffect(() => {
    // NOTE: Keyword highlight used to mutate React-managed DOM nodes directly,
    // which can trigger removeChild/not-a-child crashes during reconciliation.
    // Keep this as a no-op until a fully declarative highlight renderer is added.
  }, [highlightTerms, message.content, message.quotedContent, message.forwardedHistory, isStreaming, isGroupTyping, hasBody]);

  const openContextMenu = (ev: ReactMouseEvent) => {
    if (compactAssistant) return;
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
        <div className={`flex min-w-0 flex-1 gap-2 ${isUser ? "flex-row-reverse" : "flex-row"}`}>
          {compactAssistant && noBubbleBorder ? null : (
            <div className="flex shrink-0 flex-col items-center gap-0.5 pt-0.5">
              {compactAssistant ? (
                <div className="h-8 w-8 shrink-0" aria-hidden />
              ) : (
                <ChatImAvatar label={displayName} imageUrl={avatarUrl} />
              )}
            </div>
          )}
          <div
            className={`flex min-w-0 flex-1 flex-col ${isUser ? "items-end" : "items-start"}`}
            style={compactAssistant && noBubbleBorder ? undefined : { maxWidth: isUser ? "min(80%, 700px)" : "min(92%, 960px)" }}
          >
            {compactAssistant ? null : (
              <span className="mb-0.5 max-w-full truncate px-1 text-[11px] text-text-faint">{displayName}</span>
            )}
            <div
              className={
                compactAssistant && noBubbleBorder
                  ? "relative min-w-0 w-full overflow-x-auto overflow-y-visible px-3 py-2.5 text-[15px] leading-relaxed"
                  : `relative min-w-0 overflow-x-auto overflow-y-visible rounded-xl border px-3 py-2 text-[15px] leading-relaxed ${isUser ? "max-w-full rounded-tr-[4px]" : "w-full rounded-tl-[4px]"}`
              }
              style={compactAssistant && noBubbleBorder ? undefined : bubbleStyle}
            >
              {isUser && displayAttachments.length > 0 ? (
                <div className="mb-2 flex flex-wrap gap-2">
                  {displayAttachments.map((attachment) => (
                    <AttachmentCard
                      key={`${attachment.name}:${attachment.size}:${attachment.mimeType}`}
                      attachment={attachment}
                    />
                  ))}
                </div>
              ) : null}
              <div ref={msgContentRef} className="msg-content min-w-0 break-words">
                {badge}
                {message.quotedContent ? (
                  <div className="mb-2 rounded-md border border-border bg-surface-panel/70 px-2 py-1 text-xs text-text-faint">
                    <span className="line-clamp-2">{message.quotedContent}</span>
                  </div>
                ) : null}
                {message.forwardedHistory ? (
                  <div className="space-y-2">
                    <div className="rounded-md border border-border bg-surface-panel/70 px-2 py-1 text-xs text-text-faint">
                      {message.forwardedHistory.note ? (
                        <div className="mb-1 break-words text-text-primary">{message.forwardedHistory.note}</div>
                      ) : null}
                      <div className="space-y-1">
                        {message.forwardedHistory.items.slice(0, 2).map((item, index) => (
                          <div
                            key={`${item.sender}-${index}-${item.content.slice(0, 20)}`}
                            className="line-clamp-2 break-words"
                          >
                            {formatForwardSender(item.sender)}: {item.content}
                          </div>
                        ))}
                        {message.forwardedHistory.items.length > 2 ? (
                          <div className="text-[11px] text-text-faint">...</div>
                        ) : null}
                      </div>
                    </div>
                  </div>
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
                    {hasBody ? (
                      isUser ? (
                        <div className="whitespace-pre-wrap break-words">
                          {renderUserMessageInlineBody(bodyText, referenceAttachments)}
                        </div>
                      ) : (
                        <div className={!isUser && parsed?.reasoning ? "mt-3" : undefined}>
                          <ReactMarkdown
                            remarkPlugins={chatRemarkPlugins}
                            rehypePlugins={chatRehypePlugins}
                            components={chatMarkdownComponents}
                            urlTransform={chatUrlTransform}
                          >
                            {normalizeChatMarkdownContent(bodyText)}
                          </ReactMarkdown>
                        </div>
                      )
                    ) : null}
                  </>
                )}
              </div>
            </div>
            {compactAssistant ? null : <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-text-faint">
              <button type="button" className="hover:text-text-strong" onClick={() => onCopyMessage?.(message)}>复制</button>
              <button
                type="button"
                className="hover:text-text-strong"
                onMouseDown={(e) => e.preventDefault()}
                onClick={runQuote}
              >
                引用
              </button>
              <button
                type="button"
                className="hover:text-text-strong"
                onMouseDown={(e) => e.preventDefault()}
                onClick={runFavorite}
              >
                收藏
              </button>
              <button
                type="button"
                className="hover:text-text-strong"
                onMouseDown={(e) => e.preventDefault()}
                onClick={runForward}
              >
                转发
              </button>
              {onRetryMessage ? (
                <button type="button" className="hover:text-text-strong" onClick={() => onRetryMessage(message)}>重试</button>
              ) : null}
              <button type="button" className="hover:text-text-strong" onClick={() => onToggleSelectMessage?.(message)}>多选</button>
            </div>}
          </div>
        </div>
      </div>
      {menuOpen && !compactAssistant ? (
        <div
          ref={menuRef}
          className="fixed z-[80] w-36 rounded-lg border border-border bg-surface-panel p-1 shadow-2xl"
          style={{ left: menuPos.x, top: menuPos.y }}
        >
          <button className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover" onClick={() => { setMenuOpen(false); onCopyMessage?.(message); }}>复制</button>
          <button
            className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setMenuOpen(false);
              runQuote();
            }}
          >
            引用
          </button>
          <button
            className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setMenuOpen(false);
              runFavorite();
            }}
          >
            收藏
          </button>
          <button
            className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              setMenuOpen(false);
              runForward();
            }}
          >
            转发
          </button>
          {onRetryMessage ? (
            <button className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover" onClick={() => { setMenuOpen(false); onRetryMessage(message); }}>重试</button>
          ) : null}
          <button className="w-full rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-surface-hover" onClick={() => { setMenuOpen(false); onToggleSelectMessage?.(message); }}>多选</button>
        </div>
      ) : null}
    </div>
  );
}
