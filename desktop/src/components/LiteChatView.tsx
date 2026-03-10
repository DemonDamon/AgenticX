import { ChatView } from "./ChatView";

type Props = {
  onOpenConfirm: (
    requestId: string,
    question: string,
    diff?: string,
    agentId?: string,
    context?: Record<string, unknown>
  ) => Promise<boolean>;
};

export function LiteChatView({ onOpenConfirm }: Props) {
  return <ChatView onOpenConfirm={onOpenConfirm} mode="lite" />;
}
