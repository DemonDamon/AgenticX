"use client";

import { useEffect, useState } from "react";
import { Badge, Button } from "@agenticx/ui";
import { adminFetch } from "../lib/admin-client-auth";
import type { TraceConversationTurn } from "../lib/trace-conversation-io";

export type TraceConversationPanelLabels = {
  title: string;
  loading: string;
  empty: string;
  loadFailed: string;
  expand: string;
  collapse: string;
  truncatedHint: string;
  roleUser: string;
  roleAssistant: string;
  roleTool: string;
  roleSystem: string;
  reasoning: string;
  attachments: string;
  chars: string;
};

function roleLabel(
  role: string,
  labels: TraceConversationPanelLabels,
): string {
  switch (role) {
    case "user":
      return labels.roleUser;
    case "assistant":
      return labels.roleAssistant;
    case "tool":
      return labels.roleTool;
    case "system":
      return labels.roleSystem;
    default:
      return role;
  }
}

export function TraceConversationPanel({
  traceId,
  labels,
}: {
  traceId: string;
  labels: TraceConversationPanelLabels;
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
          return;
        }
        setData(payload.data ?? null);
      } catch {
        if (!cancelled) {
          setError(labels.loadFailed);
          setData(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [traceId, expanded, labels.loadFailed]);

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
      <div className="max-h-[360px] space-y-2 overflow-auto">
        {data.messages.map((msg) => (
          <div
            key={msg.id}
            className="rounded-md border border-border bg-muted/30 p-2"
          >
            <div className="mb-1 flex flex-wrap items-center gap-1.5">
              <Badge variant={msg.role === "user" ? "secondary" : "outline"} className="h-5 text-[10px]">
                {roleLabel(msg.role, labels)}
              </Badge>
              {msg.model ? (
                <span className="font-mono text-[10px] text-muted-foreground">{msg.model}</span>
              ) : null}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">
                {msg.content.length.toLocaleString()} {labels.chars}
                {msg.content.truncated ? " · …" : ""}
              </span>
            </div>
            {msg.attachments && msg.attachments.length > 0 ? (
              <div className="mb-1.5 flex flex-wrap gap-1">
                <span className="text-[10px] text-muted-foreground">{labels.attachments}:</span>
                {msg.attachments.map((att, idx) => (
                  <Badge key={`${att.name ?? idx}`} variant="outline" className="h-5 max-w-[160px] truncate text-[10px]">
                    {att.name || att.mime || "file"}
                    {att.mime ? ` (${att.mime})` : ""}
                  </Badge>
                ))}
              </div>
            ) : null}
            {msg.reasoning?.text ? (
              <div className="mb-1.5 rounded border border-dashed border-border/80 bg-background/60 p-1.5">
                <div className="mb-0.5 text-[10px] font-medium text-muted-foreground">
                  {labels.reasoning}
                  {msg.reasoning.truncated ? " · …" : ""}
                </div>
                <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-muted-foreground">
                  {msg.reasoning.text}
                </pre>
              </div>
            ) : null}
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px]">{msg.content.text || "—"}</pre>
          </div>
        ))}
      </div>
    </div>
  );
}
