import { ChatView } from "./ChatView";

type Props = {
  onOpenConfirm: (
    requestId: string,
    question: string,
    diff?: string,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<boolean>;
  onOpenClarification?: (
    requestId: string,
    prompt: string,
    options: string[],
    allowFreeText: boolean,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<{ answerText: string; selectedOptions: string[] } | null>;
};

export function LiteChatView({ onOpenConfirm, onOpenClarification }: Props) {
  return <ChatView onOpenConfirm={onOpenConfirm} onOpenClarification={onOpenClarification} mode="lite" />;
}
