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
  onSubmitClarification?: (
    requestId: string,
    answer: { answerText: string; selectedOptions: string[] },
    sessionId?: string,
    agentId?: string
  ) => Promise<boolean> | boolean;
};

export function LiteChatView({ onOpenConfirm, onOpenClarification, onSubmitClarification }: Props) {
  return (
    <ChatView
      onOpenConfirm={onOpenConfirm}
      onOpenClarification={onOpenClarification}
      onSubmitClarification={onSubmitClarification}
      mode="lite"
    />
  );
}
