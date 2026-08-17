"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@agenticx/ui";
import { adminFetch } from "../lib/admin-client-auth";
import type {
  SessionConversation,
  TraceConversationMessage,
} from "../lib/trace-conversation-io";
import {
  ConversationMessageList,
  type ConversationMessageListLabels,
} from "./conversation-message-list";

export type SessionConversationPanelLabels = ConversationMessageListLabels & {
  title: string;
  loading: string;
  empty: string;
  loadFailed: string;
  truncatedHint: string;
  loadEarlier: string;
  reasoningExpand?: string;
  reasoningCollapse?: string;
};

export function SessionConversationPanel({
  sessionId,
  labels,
}: {
  sessionId: string;
  labels: SessionConversationPanelLabels;
}) {
  const [messages, setMessages] = useState<TraceConversationMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [nextBefore, setNextBefore] = useState<string | undefined>(undefined);
  const [expanded, setExpanded] = useState(false);

  const fetchPage = useCallback(
    async (opts: { before?: string; expand: boolean; append: boolean }) => {
      const id = sessionId.trim();
      if (!id) return;
      const params = new URLSearchParams();
      if (opts.expand) params.set("expand", "1");
      if (opts.before) params.set("before", opts.before);
      const qs = params.toString() ? `?${params.toString()}` : "";
      const response = await adminFetch(
        `/api/sessions/${encodeURIComponent(id)}/conversation${qs}`,
      );
      const payload = (await response.json()) as {
        data?: SessionConversation;
        message?: string;
      };
      if (!response.ok) {
        throw new Error(payload.message ?? labels.loadFailed);
      }
      const data = payload.data;
      if (!data) {
        setMessages([]);
        setHasMore(false);
        setNextBefore(undefined);
        return;
      }
      setHasMore(data.has_more);
      setNextBefore(data.next_before);
      setMessages((prev) => (opts.append ? [...data.messages, ...prev] : data.messages));
    },
    [sessionId, labels.loadFailed],
  );

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setMessages([]);
    void (async () => {
      try {
        await fetchPage({ expand: expanded, append: false });
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : labels.loadFailed);
          setMessages([]);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, expanded, fetchPage, labels.loadFailed]);

  const loadEarlier = async () => {
    if (!nextBefore || loadingMore) return;
    setLoadingMore(true);
    setError(null);
    try {
      await fetchPage({ before: nextBefore, expand: expanded, append: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : labels.loadFailed);
    } finally {
      setLoadingMore(false);
    }
  };

  if (loading) {
    return <div className="text-xs text-muted-foreground">{labels.loading}</div>;
  }
  if (error && messages.length === 0) {
    return <div className="text-xs text-destructive">{error}</div>;
  }
  if (messages.length === 0) {
    return <div className="text-xs text-muted-foreground">{labels.empty}</div>;
  }

  const anyTruncated = messages.some((m) => m.content.truncated || m.reasoning?.truncated);

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
      {hasMore ? (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 w-full text-xs"
          disabled={loadingMore}
          onClick={() => void loadEarlier()}
        >
          {loadingMore ? labels.loading : labels.loadEarlier}
        </Button>
      ) : null}
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
      <ConversationMessageList
        messages={messages}
        labels={{
          ...labels,
          expand: labels.reasoningExpand ?? labels.expand,
          collapse: labels.reasoningCollapse ?? labels.collapse,
        }}
      />
    </div>
  );
}
