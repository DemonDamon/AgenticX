/** Visibility rules for assistant message action buttons (copy / retry / etc.). */

export function shouldShowAssistantIconButtons(args: {
  hideActions: boolean;
  isUser: boolean;
  isStreaming: boolean;
  isGroupTyping: boolean;
  isMetaPendingWork: boolean;
  hasBody: boolean;
  sessionBusy?: boolean;
  isLastAssistantInPane?: boolean;
  /** Group replies are committed on arrival; keep copy/quote visible while others still run. */
  keepActionsWhileBusy?: boolean;
  /** Run replay presentation: hide chrome so the demo is not cluttered. */
  presenting?: boolean;
}): boolean {
  if (args.presenting) return false;
  const base =
    !args.hideActions &&
    !args.isUser &&
    !args.isStreaming &&
    !args.isGroupTyping &&
    !args.isMetaPendingWork &&
    args.hasBody;
  if (!base) return false;
  if (args.sessionBusy && args.isLastAssistantInPane && !args.keepActionsWhileBusy) return false;
  return true;
}

export function shouldShowAssistantFollowups(args: {
  isUser: boolean;
  isStreaming: boolean;
  isGroupTyping: boolean;
  omitSuggestedQuestions?: boolean;
  hasBody: boolean;
  hasSuggestedQuestions: boolean;
  hasFollowupHandler: boolean;
  sessionBusy?: boolean;
  isLastAssistantInPane?: boolean;
  keepActionsWhileBusy?: boolean;
  presenting?: boolean;
}): boolean {
  if (args.presenting) return false;
  if (args.isUser) return false;
  if (args.isStreaming) return false;
  if (args.isGroupTyping) return false;
  if (args.omitSuggestedQuestions) return false;
  if (!args.hasBody) return false;
  if (!args.hasSuggestedQuestions) return false;
  if (!args.hasFollowupHandler) return false;
  if (args.sessionBusy && args.isLastAssistantInPane && !args.keepActionsWhileBusy) return false;
  return true;
}

/** Peeled ReAct copy/quote row — same chrome as ImBubble, hidden while the turn is live or presenting. */
export function shouldShowReActBlockActionTail(args: {
  hasStreamingRow: boolean;
  sessionWorkInProgress: boolean;
  subAgentsPending: boolean;
  hasWorkMessages: boolean;
  presenting?: boolean;
}): boolean {
  if (args.presenting) return false;
  return (
    !args.hasStreamingRow &&
    !args.sessionWorkInProgress &&
    !args.subAgentsPending &&
    args.hasWorkMessages
  );
}
