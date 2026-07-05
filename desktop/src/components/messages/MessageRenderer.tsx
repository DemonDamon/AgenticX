import type { Message } from "../../store";
import { useMemo, type ReactNode } from "react";
import { Wrench } from "lucide-react";
import { useAppStore } from "../../store";
import { ImBubble } from "./ImBubble";
import { TerminalLine } from "./TerminalLine";
import { CleanBlock } from "./CleanBlock";
import { ToolCallCard } from "./ToolCallCard";
import { SystemNotice } from "./SystemNotice";
import { ContextNoticeLine } from "./ContextNoticeLine";
import { SupervisorNoticeLine } from "./SupervisorNoticeLine";
import { ContinuationNoticeLine } from "./ContinuationNoticeLine";
import { TurnInterruptionNoticeLine } from "./TurnInterruptionNoticeLine";
import { isSupervisorNoticeMessage } from "../../utils/supervisor-notice";
import { isContinuationNoticeMessage } from "../../utils/continuation-notice";
import { isTurnInterruptionNoticeMessage } from "../../utils/turn-interruption-notice";
import {
  isInterruptedAssistantPlaceholder,
  isNoisyToolStatusMessage,
} from "../../utils/noisy-chat-messages";
import {
  buildHookBlockFriendlyNotice,
  findNearbyHookBlockedTool,
  isHookBlockEchoAssistantMessage,
} from "../../utils/hook-block-message";
import { HookBlockNoticeLine } from "./HookBlockNoticeLine";
import { ViewImageInjectCard } from "./ViewImageInjectCard";
import { BudgetExceededCard } from "./BudgetExceededCard";
import { WidgetBlock } from "./WidgetBlock";
import { ClarificationCard } from "./ClarificationCard";
import { parseWidgetPayload, isBrokenStockChartAttempt, stockChartDegradedMessage } from "./widget-preview";
import { parseContextNotice } from "../../utils/context-notice";
import { parseBudgetExceededFromText } from "../../utils/budget-exceeded";
import { shouldShowBudgetIncompleteHint } from "../../utils/budget-incomplete-message";
import { isViewImageInjectMessage } from "../../utils/view-image-inject";
import { parseTodoMessage, TodoUpdateCard } from "../TodoUpdateCard";
import { isMetaLeaderIdentity, resolveMetaDisplayName } from "../../utils/display-name";
import { resolveReferencesForAssistant } from "../../utils/turn-reference-context";
import type { SkillPatchPreviewPayload } from "./skill-manage-preview";
import type { FileReferenceOpenRequest } from "../../utils/reference-attachment";

type Props = {
  message: Message;
  highlightTerms?: string[];
  assistantBadge?: ReactNode;
  onRevealPath?: (path: string) => void;
  onOpenFileReference?: (request: FileReferenceOpenRequest) => void;
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
  onFollowupClick?: (text: string, ctx?: { ownerSessionId?: string }) => void;
  omitSuggestedQuestions?: boolean;
  actionRhythmBodyTail?: boolean;
  /** When true, assistant messages cut off before budget_exceeded may show an incomplete hint. */
  budgetExceededActive?: boolean;
  allMessages?: Message[];
  sessionId?: string;
  onResumeInNewSession?: () => void;
  onOpenBudgetSettings?: () => void;
  onResumeTask?: () => void;
  resumeInFlight?: boolean;
  /** When true, the turn-interrupted resume button is hidden (task already complete). */
  isFutileResume?: boolean;
  /** Group chat: avatar + name on each user/assistant bubble. */
  showSenderIdentity?: boolean;
  senderAvatarVariant?: "circle" | "rounded-square";
  senderAvatarId?: string;
  sessionBusy?: boolean;
  isLastAssistantInPane?: boolean;
  streamStalled?: boolean;
  streamStalledSeconds?: number;
  onSkillManageApply?: (message: Message, payload: SkillPatchPreviewPayload, targetIndex: number | null) => void;
  onOpenClarification?: (
    requestId: string,
    prompt: string,
    options: string[],
    allowFreeText: boolean,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<{ answerText: string; selectedOptions: string[] } | null>;
  /**
   * Preferred for inline card: submit directly without forcing a blocking dialog.
   * Should perform POST /api/clarify and return true on success.
   */
  onSubmitClarification?: (
    requestId: string,
    answer: { answerText: string; selectedOptions: string[] },
    sessionId?: string,
    agentId?: string
  ) => Promise<boolean> | boolean;
};

function extractPathFromToolResult(msg: string): string {
  const match = msg.match(/```(?:[a-zA-Z0-9_-]+)?\n([^`\n]+)\n```/);
  return (match?.[1] ?? "").trim();
}

/** Reconstruct a ClarificationAnswer from persisted metadata (refresh survival). */
function extractClarificationAnswerFromMeta(
  meta: Record<string, unknown>,
): { answerText: string; selectedOptions: string[] } | null {
  const rawAnswer = meta.clarification_answer;
  if (rawAnswer && typeof rawAnswer === "object") {
    const a = rawAnswer as Record<string, unknown>;
    const answerText = typeof a.answer_text === "string" ? a.answer_text : "";
    const selectedOptions = Array.isArray(a.selected_options)
      ? a.selected_options.map((o) => String(o)).filter(Boolean)
      : [];
    return { answerText, selectedOptions };
  }
  // No stored answer payload, but the flag says it was answered: treat as empty
  // (shows the "已回复 / 按默认推进" state instead of re-prompting).
  return { answerText: "", selectedOptions: [] };
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

export { isNoisyToolStatusMessage } from "../../utils/noisy-chat-messages";

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
  onOpenFileReference,
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
  actionRhythmBodyTail = false,
  budgetExceededActive = false,
  allMessages = [],
  sessionId,
  onResumeInNewSession,
  onOpenBudgetSettings,
  onResumeTask,
  resumeInFlight = false,
  isFutileResume = false,
  showSenderIdentity = false,
  senderAvatarVariant = "circle",
  senderAvatarId,
  sessionBusy = false,
  isLastAssistantInPane = false,
  streamStalled = false,
  streamStalledSeconds = 0,
  onSkillManageApply,
  onOpenClarification,
  onSubmitClarification,
}: Props) {
  const chatStyle = useAppStore((s) => s.chatStyle);
  const resolvedReferences = useMemo(() => {
    if (message.role !== "assistant") return undefined;
    return resolveReferencesForAssistant(message, allMessages);
  }, [message, allMessages]);
  if (isViewImageInjectMessage(message)) {
    return <ViewImageInjectCard message={message} />;
  }
  if (message.role === "user" || message.role === "assistant") {
    if (isInterruptedAssistantPlaceholder(message)) {
      return null;
    }
    if (isHookBlockEchoAssistantMessage(message)) {
      const messageIndex = allMessages.findIndex((row) => row.id === message.id);
      const toolCtx =
        messageIndex >= 0 ? findNearbyHookBlockedTool(allMessages, messageIndex) : null;
      return <HookBlockNoticeLine text={buildHookBlockFriendlyNotice(toolCtx)} />;
    }
    if (chatStyle === "terminal") {
      return <TerminalLine message={message} badge={assistantBadge} onRevealPath={onRevealPath} onOpenFileReference={onOpenFileReference} />;
    }
    if (chatStyle === "clean") {
      return <CleanBlock message={message} badge={assistantBadge} onRevealPath={onRevealPath} onOpenFileReference={onOpenFileReference} />;
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
        resolvedReferences={resolvedReferences}
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
        onRevealPath={onRevealPath}
        onOpenFileReference={onOpenFileReference}
        omitSuggestedQuestions={omitSuggestedQuestions}
        actionRhythmBodyTail={actionRhythmBodyTail}
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
    if (isSupervisorNoticeMessage(message)) {
      return <SupervisorNoticeLine message={message} />;
    }
    if (isContinuationNoticeMessage(message)) {
      return <ContinuationNoticeLine message={message} />;
    }
    if (isTurnInterruptionNoticeMessage(message)) {
      return (
        <TurnInterruptionNoticeLine
          message={message}
          resumeInFlight={resumeInFlight}
          onResume={onResumeTask}
          isFutile={isFutileResume}
        />
      );
    }
    if (isTodoUpdateToolMessage(message.content)) {
      return (
        <div className="rounded-lg border border-border bg-surface-card px-3 py-3 text-[13px] text-text-muted">
          <TodoUpdateCard content={message.content} />
        </div>
      );
    }
    if ((message.toolName ?? "").trim() === "show_widget") {
      const payload = parseWidgetPayload(message.content);
      if (payload) {
        return (
          <div className="my-2 w-full min-w-0 px-4">
            <WidgetBlock payload={payload} />
          </div>
        );
      }
      if (/\[micro-compact tool=show_widget/i.test(message.content)) {
        return (
          <div className="my-2 w-full min-w-0 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            图表内容被上下文压缩截断，无法渲染。请重新生成或升级 Near 后重试本对话。
          </div>
        );
      }
      if (isBrokenStockChartAttempt(message.content)) {
        return (
          <div className="my-2 w-full min-w-0 rounded border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12px] text-amber-200">
            {stockChartDegradedMessage()}
          </div>
        );
      }
    }
    if (message.clarificationPrompt) {
      const clarMeta =
        message.metadata && typeof message.metadata === "object"
          ? (message.metadata as Record<string, unknown>)
          : null;
      const initialAnswer =
        clarMeta && clarMeta.clarification_answered === true
          ? extractClarificationAnswerFromMeta(clarMeta)
          : null;
      return (
        <ClarificationCard
          prompt={message.clarificationPrompt}
          suspended={message.clarificationSuspended}
          initialAnswer={initialAnswer}
          groupChatRail={showSenderIdentity}
          onReply={
            onOpenClarification
              ? (p) => {
                  void onOpenClarification(
                    p.requestId,
                    p.prompt,
                    p.options,
                    p.allowFreeText,
                    p.agentId,
                    p.context,
                  );
                }
              : undefined
          }
          onSubmitAnswer={
            onSubmitClarification
              ? (requestId, answer) =>
                  onSubmitClarification(
                    requestId,
                    answer,
                    message.clarificationPrompt?.sessionId,
                    message.clarificationPrompt?.agentId,
                  )
              : undefined
          }
          onSkip={
            onSubmitClarification
              ? (requestId) => {
                  void onSubmitClarification(
                    requestId,
                    { answerText: "", selectedOptions: [] },
                    message.clarificationPrompt?.sessionId,
                    message.clarificationPrompt?.agentId,
                  );
                }
              : undefined
          }
        />
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
        onSkillManageApply={onSkillManageApply}
      />
    );
  }
  return <SystemNotice text={message.content} />;
}
