import type { Message } from "../../store";
import type { ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useAppStore } from "../../store";
import { ImBubble } from "./ImBubble";
import { TerminalLine } from "./TerminalLine";
import { CleanBlock } from "./CleanBlock";
import { ToolCallCard } from "./ToolCallCard";
import { SystemNotice } from "./SystemNotice";
import { ContextNoticeLine } from "./ContextNoticeLine";
import { BudgetExceededCard } from "./BudgetExceededCard";
import { parseContextNotice } from "../../utils/context-notice";
import { parseBudgetExceededFromText } from "../../utils/budget-exceeded";
import { shouldShowBudgetIncompleteHint } from "../../utils/budget-incomplete-message";
import { parseTodoMessage, TodoUpdateCard } from "../TodoUpdateCard";
import { isMetaLeaderIdentity, resolveMetaDisplayName } from "../../utils/display-name";

type Props = {
  message: Message;
  highlightTerms?: string[];
  assistantBadge?: ReactNode;
  onRevealPath?: (path: string) => void;
  assistantName?: string;
  assistantAvatarUrl?: string;
  /** IM assistant: align with ReAct block tool column (no duplicate avatar). */
  imAssistantVisual?: "default" | "compact-inline" | "compact-inline-with-actions";
  /** Pass-through to ImBubble: remove inner bubble border when inside unified ReAct container. */
  noBubbleBorder?: boolean;
  /** IM default ToolCallCard: omit w-8 left spacer when inside ReAct work column */
  toolCardOmitLeadingSpacer?: boolean;
  /** IM 风格下用户气泡旁显示名（默认「我」） */
  userName?: string;
  userAvatarUrl?: string;
  onCopyMessage?: (message: Message) => void;
  onQuoteMessage?: (message: Message, selectedText?: string) => void;
  onFavoriteMessage?: (message: Message, selectedText?: string) => void;
  onToggleSelectMessage?: (message: Message) => void;
  onForwardMessage?: (message: Message, selectedText?: string) => void;
  onRetryMessage?: (message: Message) => void;
  onEditMessage?: (message: Message, newContent: string) => void;
  selectable?: boolean;
  selected?: boolean;
  onResolveInlineConfirm?: (confirm: NonNullable<Message["inlineConfirm"]>, approved: boolean) => void;
  onFollowupClick?: (text: string) => void;
  omitSuggestedQuestions?: boolean;
  /** When true, assistant messages cut off before budget_exceeded may show an incomplete hint. */
  budgetExceededActive?: boolean;
  allMessages?: Message[];
  sessionId?: string;
  onResumeInNewSession?: () => void;
  onOpenBudgetSettings?: () => void;
  /** Group chat: avatar + name on each user/assistant bubble. */
  showSenderIdentity?: boolean;
  senderAvatarVariant?: "circle" | "rounded-square";
  senderAvatarId?: string;
  sessionBusy?: boolean;
  isLastAssistantInPane?: boolean;
  streamStalled?: boolean;
  streamStalledSeconds?: number;
};

function extractPathFromToolResult(msg: string): string {
  const match = msg.match(/```(?:[a-zA-Z0-9_-]+)?\n([^`\n]+)\n```/);
  return (match?.[1] ?? "").trim();
}

function GroupProgressLine({ message }: { message: Message }) {
  const text = String(message.toolResultPreview || message.content || "").trim();
  if (!text) return null;
  const running = message.toolStatus === "running" || message.toolStatus === "pending";
  return (
    <div className="flex min-w-0 items-center gap-2 px-3 py-1 text-[13px] text-text-muted">
      <span className="flex h-[20px] w-[20px] shrink-0 items-center justify-center" aria-hidden>
        <span
          className={`flex h-[18px] w-[18px] items-center justify-center rounded-full ring-1 ${
            running
              ? "bg-cyan-400/15 text-cyan-400/90 ring-cyan-400/35"
              : "bg-emerald-400/15 text-emerald-400/90 ring-emerald-400/35"
          }`}
        >
          <Wrench className="h-3 w-3" strokeWidth={2.2} />
        </span>
      </span>
      <span className="min-w-0 break-words leading-[1.65]">{text}</span>
    </div>
  );
}

export function isTodoUpdateToolMessage(content: string): boolean {
  return parseTodoMessage(content) !== null;
}

export function isNoisyToolStatusMessage(message: Pick<Message, "role" | "content" | "toolName">): boolean {
  if (message.role !== "tool") return false;
  const toolName = (message.toolName ?? "").trim();
  if (toolName === "check_resources") return true;
  const content = String(message.content ?? "").trim();
  if (!toolName && /^[✅🔧⚠️❌🗣]?\s*check_resources\b/i.test(content)) return true;
  if (toolName) return false;
  return content === "后台任务已完成" || content === "已发送中断请求";
}

/** Shared extras row under tool cards (inline confirm + workspace reveal). */
export function renderToolMessageExtras(
  message: Message,
  opts: {
    onRevealPath?: (path: string) => void;
    onResolveInlineConfirm?: (confirm: NonNullable<Message["inlineConfirm"]>, approved: boolean) => void;
  }
): ReactNode {
  const inlineConfirm = message.inlineConfirm;
  const inlineConfirmAction =
    inlineConfirm && opts.onResolveInlineConfirm ? (
      <div className="mt-1 flex items-center gap-2">
        <button
          type="button"
          className="rounded border border-border bg-surface-hover px-2 py-0.5 text-[11px] text-text-strong hover:opacity-90"
          onClick={() => opts.onResolveInlineConfirm!(inlineConfirm, true)}
        >
          同意
        </button>
        <button
          type="button"
          className="rounded border border-border bg-surface-hover px-2 py-0.5 text-[11px] text-text-strong hover:opacity-90"
          onClick={() => opts.onResolveInlineConfirm!(inlineConfirm, false)}
        >
          拒绝
        </button>
      </div>
    ) : null;
  const path = extractPathFromToolResult(message.content);
  return (
    <>
      {inlineConfirmAction}
      {path && opts.onRevealPath ? (
        <button
          type="button"
          className="rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-cyan-300 hover:bg-surface-hover"
          onClick={() => opts.onRevealPath!(path)}
        >
          查看此文件
        </button>
      ) : null}
    </>
  );
}

export function MessageRenderer({
  message,
  highlightTerms,
  assistantBadge,
  onRevealPath,
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
  onEditMessage,
  selectable,
  selected,
  onResolveInlineConfirm,
  imAssistantVisual = "default",
  toolCardOmitLeadingSpacer = false,
  noBubbleBorder = false,
  onFollowupClick,
  omitSuggestedQuestions = false,
  budgetExceededActive = false,
  allMessages = [],
  sessionId,
  onResumeInNewSession,
  onOpenBudgetSettings,
  showSenderIdentity = false,
  senderAvatarVariant = "circle",
  senderAvatarId,
  sessionBusy = false,
  isLastAssistantInPane = false,
  streamStalled = false,
  streamStalledSeconds = 0,
}: Props) {
  const chatStyle = useAppStore((s) => s.chatStyle);
  if (message.role === "user" || message.role === "assistant") {
    if (chatStyle === "terminal") {
      return <TerminalLine message={message} badge={assistantBadge} />;
    }
    if (chatStyle === "clean") {
      return <CleanBlock message={message} badge={assistantBadge} />;
    }
    const rawAssist = (message.avatarName ?? "").trim();
    const metaLeaderRow = message.role === "assistant" && isMetaLeaderIdentity(message.agentId, rawAssist);
    const mergedAssistName =
      message.role === "assistant"
        ? metaLeaderRow
          ? resolveMetaDisplayName(null)
          : rawAssist && rawAssist !== "分身"
            ? resolveMetaDisplayName(rawAssist)
            : assistantName
        : assistantName;
    const mergedAssistAvatarUrl = metaLeaderRow
      ? assistantAvatarUrl || message.avatarUrl
      : message.avatarUrl || assistantAvatarUrl;
    return (
      <ImBubble
        message={message}
        highlightTerms={highlightTerms}
        badge={assistantBadge}
        assistantName={mergedAssistName}
        assistantAvatarUrl={mergedAssistAvatarUrl}
        assistantVisual={message.role === "assistant" ? imAssistantVisual : "default"}
        noBubbleBorder={noBubbleBorder}
        userName={userName}
        userAvatarUrl={userAvatarUrl}
        onCopyMessage={onCopyMessage}
        onQuoteMessage={onQuoteMessage}
        onFavoriteMessage={onFavoriteMessage}
        onToggleSelectMessage={onToggleSelectMessage}
        onForwardMessage={onForwardMessage}
        onRetryMessage={onRetryMessage}
        onEditMessage={onEditMessage}
        selectable={selectable}
        selected={selected}
        onFollowupClick={onFollowupClick}
        omitSuggestedQuestions={omitSuggestedQuestions}
        budgetIncompleteHint={
          budgetExceededActive && allMessages.length > 0
            ? shouldShowBudgetIncompleteHint(message, allMessages, budgetExceededActive)
            : false
        }
        showSenderIdentity={showSenderIdentity}
        senderAvatarVariant={showSenderIdentity ? senderAvatarVariant : "circle"}
        senderAvatarId={senderAvatarId ?? (showSenderIdentity && message.role === "user" ? "user-self" : undefined)}
        sessionBusy={sessionBusy}
        isLastAssistantInPane={isLastAssistantInPane}
        streamStalled={streamStalled}
        streamStalledSeconds={streamStalledSeconds}
      />
    );
  }
  if (message.role === "tool") {
    if (isNoisyToolStatusMessage(message)) {
      return null;
    }
    if (message.toolName === "group_progress") {
      return <GroupProgressLine message={message} />;
    }
    if (message.noticeKind === "budget_exceeded" || /Token budget exceeded/i.test(String(message.content ?? ""))) {
      const current = Number(message.budgetCurrent);
      const maxAllowed = Number(message.budgetMax);
      const source = String(message.budgetSource ?? "session").trim() || "session";
      const parsed =
        Number.isFinite(current) && Number.isFinite(maxAllowed)
          ? { source, current, maxAllowed }
          : parseBudgetExceededFromText(message.content);
      if (parsed) {
        return (
          <BudgetExceededCard
            info={{ ...parsed, sessionId }}
            onResumeInNewSession={() => onResumeInNewSession?.()}
            onOpenSettings={() => onOpenBudgetSettings?.()}
          />
        );
      }
    }
    const contextNotice = parseContextNotice(message);
    if (contextNotice) {
      return <ContextNoticeLine text={contextNotice.text} />;
    }
    if (isTodoUpdateToolMessage(message.content)) {
      return (
        <div className="rounded-lg border border-border bg-surface-card px-3 py-3 text-[13px] text-text-muted">
          <TodoUpdateCard content={message.content} />
        </div>
      );
    }
    return (
      <ToolCallCard
        message={message}
        highlightTerms={highlightTerms}
        forceExpand={!!message.inlineConfirm}
        omitLeadingSpacer={toolCardOmitLeadingSpacer}
        variant={noBubbleBorder ? "flat" : "default"}
        selectable={selectable}
        selected={selected}
        onToggleSelectMessage={onToggleSelectMessage}
        action={renderToolMessageExtras(message, { onRevealPath, onResolveInlineConfirm })}
      />
    );
  }
  return <SystemNotice text={message.content} />;
}
