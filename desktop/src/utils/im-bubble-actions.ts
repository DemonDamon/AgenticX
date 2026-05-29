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
