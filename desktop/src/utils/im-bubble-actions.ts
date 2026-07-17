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
}): boolean {
  const base =
    !args.hideActions &&
    !args.isUser &&
    !args.isStreaming &&
    !args.isGroupTyping &&
    !args.isMetaPendingWork &&
    args.hasBody;
  if (!base) return false;
  if (args.sessionBusy && args.isLastAssistantInPane) return false;
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
}): boolean {
  if (args.isUser) return false;
  if (args.isStreaming) return false;
  if (args.isGroupTyping) return false;
  if (args.omitSuggestedQuestions) return false;
  if (!args.hasBody) return false;
  if (!args.hasSuggestedQuestions) return false;
  if (!args.hasFollowupHandler) return false;
  if (args.sessionBusy && args.isLastAssistantInPane) return false;
  return true;
}
