import { useLayoutEffect, useRef, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MessageRenderer } from "../messages/MessageRenderer";
import { SessionGeneratingDots } from "../sidebar/SessionGeneratingDots";
import type { ManagedSessionView } from "../../hooks/useManagedSession";
import type { Message } from "../../store";

type Props = {
  view: ManagedSessionView;
  sessionId: string;
  assistantName: string;
  assistantAvatarUrl?: string;
  userName?: string;
  userAvatarUrl?: string;
};

export function ManagedTranscript(props: Props) {
  const [epoch, setEpoch] = useState(0);
  return <ManagedTranscriptBody key={epoch} {...props} onRetry={() => setEpoch((value) => value + 1)} />;
}

function ManagedTranscriptBody({
  view,
  sessionId,
  assistantName,
  assistantAvatarUrl,
  userName,
  userAvatarUrl,
  onRetry,
}: Props & { onRetry: () => void }) {
  const { t } = useTranslation("chat");
  const scrollerRef = useRef<HTMLDivElement>(null);
  const stickRef = useRef(true);
  const liveText = view.transcript.liveText;
  const running = view.transcript.status === "running";

  useLayoutEffect(() => {
    const el = scrollerRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [view.messages, liveText, running, view.connection, view.error]);

  if (view.error) {
    return (
      <div className="flex h-full min-h-0 items-center justify-center px-6">
        <div className="flex max-w-md flex-col items-center gap-3 text-center">
          <AlertTriangle className="h-5 w-5 text-amber-500" aria-hidden />
          <p className="text-[13px] text-text-strong">{t("managed.loadFailed", { message: view.error.message })}</p>
          <button
            type="button"
            className="rounded-md bg-[var(--ui-btn-primary-bg)] px-3 py-1 text-[12px] font-medium text-[var(--ui-btn-primary-text)]"
            onClick={() => {
              view.retry();
              onRetry();
            }}
          >
            {t("managed.retry")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={scrollerRef}
      className="h-full min-h-0 overflow-y-auto bg-surface"
      onScroll={() => {
        const el = scrollerRef.current;
        if (!el) return;
        const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
        stickRef.current = distance < 80;
      }}
    >
      {view.connection === "reconnecting" ? (
        <div className="sticky top-0 z-10 bg-surface-card px-3 py-1 text-center text-[12px] text-text-muted">
          {t("managed.reconnecting")}
        </div>
      ) : null}
      {view.messages.map((message) => (
        <MessageRenderer
          key={message.id}
          message={message}
          assistantName={assistantName}
          assistantAvatarUrl={assistantAvatarUrl}
          userName={userName}
          userAvatarUrl={userAvatarUrl}
          sessionId={sessionId}
          sessionBusy={running}
          onResolveInlineConfirm={(confirm, approved) => {
            void view.resolveApproval(confirm.requestId, approved);
          }}
        />
      ))}
      {running && liveText ? (
        <MessageRenderer
          message={liveRow(liveText, assistantName, sessionId)}
          assistantName={assistantName}
          assistantAvatarUrl={assistantAvatarUrl}
          userName={userName}
          userAvatarUrl={userAvatarUrl}
          sessionId={sessionId}
          sessionBusy
        />
      ) : null}
      {running && !liveText ? (
        <div className="flex items-center gap-2 px-4 py-2 text-text-muted">
          <span className="inline-flex h-8 w-8 items-center justify-center">
            <SessionGeneratingDots />
          </span>
          <span className="text-[13px]">{t("managed.thinking")}</span>
        </div>
      ) : null}
    </div>
  );
}

function liveRow(content: string, assistantName: string, sessionId: string): Message {
  return {
    id: "ma-live",
    role: "assistant",
    content,
    avatarName: assistantName,
    agentId: "ma",
    ownerSessionId: sessionId,
  };
}
