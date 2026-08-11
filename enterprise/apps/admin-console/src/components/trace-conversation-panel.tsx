"use client";

import { useEffect, useState } from "react";
import { Button } from "@agenticx/ui";
import { adminFetch } from "../lib/admin-client-auth";
import type { TraceConversationTurn } from "../lib/trace-conversation-io";
import {
  ConversationMessageList,
  type ConversationMessageListLabels,
} from "./conversation-message-list";

export type TraceConversationPanelLabels = ConversationMessageListLabels & {
  title: string;
  titleSession?: string;
  loading: string;
  empty: string;
  loadFailed: string;
  expand: string;
  collapse: string;
  truncatedHint: string;
  scopeTurn?: string;
  scopeSession?: string;
  loadEarlier?: string;
  noSession?: string;
};

export function TraceConversationPanel({
  traceId,
  labels,
  onSessionId,
}: {
  traceId: string;
  labels: TraceConversationPanelLabels;
  onSessionId?: (sessionId: string | null) => void;
}) {
  const [data, setData] = useState<TraceConversationTurn | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const id = traceId.trim();
    if (!id) {
      setData(null);
      setLoading(false);
      onSessionId?.(null);
      return;
    }
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const qs = expanded ? "?expand=1" : "";
        const response = await adminFetch(
          `/api/traces/${encodeURIComponent(id)}/conversation${qs}`,
        );
        const payload = (await response.json()) as {
          data?: TraceConversationTurn;
          message?: string;
        };
        if (cancelled) return;
        if (!response.ok) {
          setError(payload.message ?? labels.loadFailed);
          setData(null);
          onSessionId?.(null);
          return;
        }
        const turn = payload.data ?? null;
        setData(turn);
        onSessionId?.(turn?.session_id ?? null);
      } catch {
        if (!cancelled) {
          setError(labels.loadFailed);
          setData(null);
          onSessionId?.(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceId, expanded, labels.loadFailed, onSessionId]);

  if (loading) {
    return <div className="text-xs text-muted-foreground">{labels.loading}</div>;
  }
  if (error) {
    return <div className="text-xs text-destructive">{error}</div>;
  }
  if (!data || data.empty || data.messages.length === 0) {
    return <div className="text-xs text-muted-foreground">{labels.empty}</div>;
  }

  const anyTruncated = data.messages.some(
    (m) => m.content.truncated || m.reasoning?.truncated,
  );

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-medium text-muted-foreground">{labels.title}</div>
        {anyTruncated || expanded ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-xs"
            onClick={() => setExpanded((v) => !v)}
          >
            {expanded ? labels.collapse : labels.expand}
          </Button>
        ) : null}
      </div>
      {anyTruncated && !expanded ? (
        <p className="text-[11px] text-muted-foreground">{labels.truncatedHint}</p>
      ) : null}
      <ConversationMessageList messages={data.messages} labels={labels} />
    </div>
  );
}
